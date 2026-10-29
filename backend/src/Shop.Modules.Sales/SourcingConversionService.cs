using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Sales;

public static class SourcingConversionRules
{
    // The owner was verified by the Market plan and owner-scoped Sales read.
    // This proof compares all retained commercial terms, including original
    // public metadata in the accepted SKU, without using today's public price.
    public static void AssertCandidate(AcceptedSourcingPurchasePlan plan,SourcingPriceAgreementData agreement)
    {
        SourcingPriceAgreementRules.Validate(plan);if(agreement is null||agreement.SchemaVersion!=1||agreement.Lines is not {Length:>0 and <=64}||agreement.Lines.Any(l=>l is null)||agreement.Lines.Length!=plan.Lines.Length||agreement.RequestId!=plan.RequestId||agreement.TaskId!=plan.TaskId||agreement.OfferId!=plan.OfferId||agreement.AcceptanceId!=plan.AcceptanceId||agreement.Revision!=plan.Revision||agreement.TermsHash!=plan.TermsHash||agreement.Lines.Select(l=>l.OfferLineId).Distinct(StringComparer.Ordinal).Count()!=agreement.Lines.Length||agreement.Lines.Select(l=>l.Id).Distinct(StringComparer.Ordinal).Count()!=agreement.Lines.Length)throw Changed();
        CartOfferRules.Id(agreement.Id);CartOfferRules.Id(agreement.AllocationId);CartOfferRules.Version(agreement.Version);
        foreach(var line in agreement.Lines){if(line.Id!=SourcingPriceAgreementRules.LineId(plan.AcceptanceId,line.OfferLineId)||line.LineTotalRial!=CartOfferRules.Money(checked(SourcingPriceAgreementRules.Price(line.UnitPriceRial)*line.Quantity)))throw Changed();}
        var retained=plan with{TermsFa=agreement.TermsFa,TermsEn=agreement.TermsEn,PurchaseUntil=agreement.PurchaseUntil,ContainsDemo=agreement.IsDemo,Lines=agreement.Lines.Select(l=>new AcceptedSourcingPlanLine(l.OfferLineId,l.ListingId,l.Quantity,l.UnitPriceRial,l.Sku)).ToArray()};
        if(SourcingPriceAgreementRules.SnapshotHash(plan)!=SourcingPriceAgreementRules.SnapshotHash(retained))throw Changed();
    }
    private static BusinessException Changed()=>new("sourcing_agreement_terms_conflict","The retained agreement differs from the exact accepted purchase snapshot.");
}

// Opaque request-scoped preparation. It is neither a wire DTO nor a caller's
// authority to choose quantities, prices, an owner or another allocation.
public sealed class PreparedSourcingConversion
{
    internal PreparedSourcingConversion(object scope,Guid transaction,string owner,SourcingConversionInput input,AcceptedSourcingPurchasePlan plan,ShoppingCart cart,SourcingPriceAgreement agreement,string hash,string snapshotHash)
    {Scope=scope;Transaction=transaction;Owner=owner;Input=input;Plan=plan;Cart=cart;Agreement=agreement;Hash=hash;SnapshotHash=snapshotHash;}
    internal object Scope {get;}
    internal Guid Transaction {get;}
    internal string Owner {get;}
    internal SourcingConversionInput Input {get;}
    internal AcceptedSourcingPurchasePlan Plan {get;}
    internal ShoppingCart Cart {get;}
    internal SourcingPriceAgreement Agreement {get;}
    internal string Hash {get;}
    internal string SnapshotHash {get;}
}
public sealed class SourcingConversionService(SalesDbContext db,CartService carts,SourcingPriceAgreementService agreements,ICartCatalogReader catalog,TimeProvider clock,bool allowDemo)
{
    private sealed record Gate(string Owner,Guid Transaction,string? Request=null,string? Offer=null,string? Hash=null,bool Fresh=false);
    private readonly Dictionary<string,Gate> gates=new(StringComparer.Ordinal);
    private readonly HashSet<PreparedSourcingConversion> prepared=[];
    private readonly object scope=new();
    public async Task AcquireCommandLockAsync(string ownerId,string commandId,CancellationToken ct)
    {
        var owner=CartOfferRules.Owner(ownerId);commandId=CartOfferRules.CommandId(commandId);CartOfferRules.RequireParent(db);await CartOfferCommands.LockAsync(db,owner,"convert",commandId,ct);
        var transaction=db.Database.CurrentTransaction!.TransactionId;if(gates.TryGetValue(commandId,out var previous)&&previous.Transaction==transaction&&previous.Owner!=owner)throw new InvalidOperationException("A conversion command cannot change its verified owner.");gates[commandId]=new(owner,transaction);
    }
    public async Task<SourcingConversionMutation?> ReplayAsync(string ownerId,string requestId,string offerId,SourcingConversionInput supplied,CancellationToken ct)
    {
        var owner=CartOfferRules.Owner(ownerId);var input=CartOfferRules.Normalize(supplied);requestId=CartOfferRules.Id(requestId);offerId=CartOfferRules.Id(offerId);var gate=RequireGate(owner,input.RequestId);var hash=Payload(requestId,offerId,input);
        var previous=await CartOfferCommands.PreviousAsync(db,owner,"convert",input.RequestId,input.AgreementId,requestId,offerId,hash,allowDemo,ct);gates[input.RequestId]=gate with{Request=requestId,Offer=offerId,Hash=hash,Fresh=previous is null};return previous is null?null:Deserialize(previous) with{Replayed=true};
    }
    public async Task<PreparedSourcingConversion> PrepareAsync(string ownerId,AcceptedSourcingPurchasePlan plan,SourcingConversionInput supplied,CancellationToken ct)
    {
        var owner=CartOfferRules.Owner(ownerId);var input=CartOfferRules.Normalize(supplied);var gate=RequireGate(owner,input.RequestId);SourcingPriceAgreementRules.Validate(plan);
        if(!gate.Fresh||gate.Request!=plan.RequestId||gate.Offer!=plan.OfferId||gate.Hash!=Payload(plan.RequestId,plan.OfferId,input))throw new InvalidOperationException("Replay the exact conversion command before preparing fresh cart changes.");
        if(!owner.Equals(plan.OwnerId,StringComparison.OrdinalIgnoreCase)||plan.TaskId!=input.TaskId||plan.AcceptanceId!=input.AcceptanceId||plan.TermsHash!=input.TermsHash||plan.RequestVersion!=input.RequestVersion||plan.TaskVersion!=input.TaskVersion||plan.OfferVersion!=input.OfferVersion||plan.ContainsDemo&&!allowDemo)throw CartOfferRules.Missing();
        var identity=new CartIdentity(owner,null);await carts.LockIdentityAsync(identity,true,ct);var cart=await carts.FindAsync(identity,true,ct);CartService.EnsureCapacity(cart);
        if(input.CartVersion!=(cart is null?null:Convert.ToBase64String(cart.Version)))throw new BusinessException("cart_version_conflict","The cart changed before adding the accepted offer. Refresh all three sections.");
        await agreements.LockAsync(plan.AcceptanceId,ct);
        var agreement=await db.SourcingPriceAgreements.FromSqlInterpolated($"SELECT * FROM [sales].[SourcingPriceAgreements] WITH (UPDLOCK,HOLDLOCK) WHERE [Id]={input.AgreementId}").SingleOrDefaultAsync(ct)??throw CartOfferRules.Missing();await db.Entry(agreement).ReloadAsync(ct);
        if(!agreement.OwnerId.Equals(owner,StringComparison.OrdinalIgnoreCase)||agreement.RequestId!=plan.RequestId||agreement.TaskId!=plan.TaskId||agreement.OfferId!=plan.OfferId||agreement.AcceptanceId!=plan.AcceptanceId||agreement.ContainsDemo&&!allowDemo)throw CartOfferRules.Missing();
        if(Convert.ToBase64String(agreement.Version)!=input.AgreementVersion)throw new BusinessException("version_conflict","The accepted price agreement changed. Read its current allocation before converting.");
        if(agreement.State!="Active"||agreement.ConsumedOrderId is not null)throw new BusinessException("sourcing_agreement_consumed_conflict","This agreement is revoked or already consumed by an actual order.");
        if(agreement.AllocationId!=input.AllocationId)throw new BusinessException("sourcing_conversion_allocation_conflict","The agreement now references another stock allocation. Review its current provenance.");
        var snapshotHash=SourcingPriceAgreementRules.SnapshotHash(plan);if(agreement.SnapshotHash!=snapshotHash||agreement.TermsHash!=plan.TermsHash||agreement.PurchaseUntil!=plan.PurchaseUntil)throw new BusinessException("sourcing_agreement_terms_conflict","The immutable accepted snapshot differs from the requested conversion.");
        var existing=await db.SourcingConversions.FromSqlInterpolated($"SELECT * FROM [sales].[SourcingConversions] WITH (UPDLOCK,HOLDLOCK) WHERE [AcceptanceId]={plan.AcceptanceId}").AsNoTracking().SingleOrDefaultAsync(ct);
        if(existing is not null)throw new BusinessException("sourcing_conversion_exists_conflict","This acceptance was already converted. Its old command never adds a removed group again.");
        await db.Entry(agreement).Collection(x=>x.Lines).Query().OrderBy(l=>l.Id).Take(65).LoadAsync(ct);
        if(agreement.Lines.Count!=plan.Lines.Length||agreement.Lines.Count is <1 or >64||plan.Lines.Any(line=>!agreement.Lines.Any(l=>l.Id==SourcingPriceAgreementRules.LineId(plan.AcceptanceId,line.OfferLineId)&&l.OfferLineId==line.OfferLineId&&l.VariantId.Equals(line.Sku.VariantId,StringComparison.OrdinalIgnoreCase)&&l.Quantity==line.Quantity&&l.UnitPriceRial==SourcingPriceAgreementRules.Price(line.UnitPriceRial)&&l.LineTotalRial==checked(line.Quantity*SourcingPriceAgreementRules.Price(line.UnitPriceRial))&&l.SkuSnapshotJson==JsonSerializer.Serialize(line.Sku,SourcingPriceAgreementRules.Json))))throw new BusinessException("sourcing_agreement_terms_conflict","Convert every exact immutable agreement line and quantity.");
        if((cart?.Lines.Count??0)+(cart?.OfferLines.Count??0)+agreement.Lines.Count>64)throw new BusinessException("cart_limit","All ordinary and accepted-offer purchase lines together must fit within 64 lines.");
        CartOfferRules.EnsureSkuCapacity((cart?.Lines??[]).Select(l=>(l.VariantId,l.Quantity)).Concat((cart?.OfferLines??[]).Select(l=>(l.VariantId,l.Quantity))).Concat(agreement.Lines.Select(l=>(l.VariantId,l.Quantity))));
        // No Stock read here: Inventory's allocation guard is the next module.
        // Price arithmetic uses public prices only for existing ordinary rows.
        var normal=cart?.Lines.ToArray()??[];var variants=await catalog.ReadCartVariantsAsync("fa",normal.Select(l=>l.VariantId).ToArray(),ct);
        var oldOfferTotals=cart is null?[]:await (from c in db.CartOfferLines.AsNoTracking() join a in db.SourcingPriceAgreementLines.AsNoTracking() on new{c.AgreementId,Id=c.AgreementLineId} equals new{a.AgreementId,a.Id} where c.CartId==cart.Id select a.LineTotalRial).ToArrayAsync(ct);
        try{long total=SourcingPriceAgreementRules.Total(plan.Lines);foreach(var value in oldOfferTotals)total=checked(total+value);foreach(var line in normal)if(variants.TryGetValue(line.VariantId,out var sku))total=checked(total+checked(sku.PriceRial*line.Quantity));}
        catch(OverflowException){throw new BusinessException("cart_amount_limit","The complete purchase cart exceeds integer rial capacity.");}
        if(plan.PurchaseUntil<=clock.GetUtcNow())throw new BusinessException("sourcing_conversion_expired_conflict","The accepted purchase deadline elapsed while preparing the cart.");
        cart??=carts.NewCart(identity);var token=new PreparedSourcingConversion(scope,gate.Transaction,owner,input,plan,cart,agreement,gate.Hash!,snapshotHash);prepared.Add(token);return token;
    }
    public async Task<SourcingConversionMutation> CompleteAsync(PreparedSourcingConversion token,SourcingStockConversionProof proof,CancellationToken ct)
    {
        CartOfferRules.RequireParent(db);if(token is null||!ReferenceEquals(token.Scope,scope)||!prepared.Contains(token)||token.Transaction!=db.Database.CurrentTransaction!.TransactionId)throw new InvalidOperationException("Complete only the exact preparation in its original scoped transaction.");
        var input=token.Input;var plan=token.Plan;var gate=RequireGate(token.Owner,input.RequestId);
        if(!gate.Fresh||gate.Hash!=token.Hash||token.SnapshotHash!=SourcingPriceAgreementRules.SnapshotHash(plan)||proof is null||proof.AllocationId!=input.AllocationId||proof.RequestId!=plan.RequestId||proof.TaskId!=plan.TaskId||proof.OfferId!=plan.OfferId||proof.AcceptanceId!=plan.AcceptanceId||proof.TermsHash!=plan.TermsHash||proof.Version!=input.AllocationVersion||proof.IsDemo!=plan.ContainsDemo||proof.ExpiresAt.Offset!=TimeSpan.Zero||proof.ExpiresAt>plan.PurchaseUntil||proof.Lines is not {Length:>0 and <=64}||proof.Lines.Length!=plan.Lines.Length||proof.Lines.Select(l=>l.OfferLineId).Distinct(StringComparer.Ordinal).Count()!=plan.Lines.Length||plan.Lines.Any(l=>!proof.Lines.Any(p=>p.OfferLineId==l.OfferLineId&&p.VariantId.Equals(l.Sku.VariantId,StringComparison.OrdinalIgnoreCase)&&p.Quantity==l.Quantity)))throw new InvalidOperationException("Complete only the exact active owned allocation proof for every prepared agreement line.");
        if(proof.ExpiresAt<=clock.GetUtcNow()||plan.PurchaseUntil<=clock.GetUtcNow())throw new BusinessException("sourcing_conversion_expired_conflict","The accepted price or actual stock hold expired before the cart could be saved.");
        var cart=token.Cart;var now=clock.GetUtcNow();var id=Guid.NewGuid().ToString("N");var links=token.Agreement.Lines.OrderBy(l=>l.OfferLineId,StringComparer.Ordinal).Select(l=>new SourcingCartLineLink(CartOfferRules.OfferLineId(cart.Id,token.Agreement.Id,l.Id),l.Id,l.OfferLineId)).ToArray();
        var conversion=new SourcingConversion{Id=id,OwnerId=token.Owner,RequestId=plan.RequestId,TaskId=plan.TaskId,OfferId=plan.OfferId,AcceptanceId=plan.AcceptanceId,AgreementId=token.Agreement.Id,AllocationId=proof.AllocationId,CartId=cart.Id,CommandId=input.RequestId,CreatedAt=now,ContainsDemo=plan.ContainsDemo,LineLinksJson=JsonSerializer.Serialize(links,CartOfferRules.Json),CartVersion=input.CartVersion??""};
        db.SourcingConversions.Add(conversion);if(db.Entry(cart).State==EntityState.Detached)db.Carts.Add(cart);
        foreach(var line in token.Agreement.Lines){var link=links.Single(l=>l.AgreementLineId==line.Id);cart.OfferLines.Add(new(){CartId=cart.Id,Id=link.LineId,ConversionId=id,AgreementId=token.Agreement.Id,AgreementLineId=line.Id,RequestId=plan.RequestId,TaskId=plan.TaskId,OfferId=plan.OfferId,AcceptanceId=plan.AcceptanceId,AllocationId=proof.AllocationId,AllocationVersion=proof.Version,AllocationExpiresAt=proof.ExpiresAt,OfferLineId=line.OfferLineId,VariantId=line.VariantId,Quantity=line.Quantity,ContainsDemo=plan.ContainsDemo,CreatedAt=now});}
        CartService.EnsureCapacity(cart);carts.Touch(cart);await db.SaveChangesAsync(ct);conversion.CartVersion=Convert.ToBase64String(cart.Version);
        var result=new SourcingConversionMutation(1,id,plan.RequestId,plan.TaskId,plan.OfferId,plan.AcceptanceId,token.Agreement.Id,proof.AllocationId,cart.Id,conversion.CartVersion,links,input.RequestId,now,false);
        db.CartOfferCommandReceipts.Add(CartOfferCommands.Receipt(token.Owner,"convert",input.RequestId,token.Agreement.Id,plan.RequestId,plan.OfferId,token.Hash,result,plan.ContainsDemo,now));
        if(proof.ExpiresAt<=clock.GetUtcNow()||plan.PurchaseUntil<=clock.GetUtcNow())throw new BusinessException("sourcing_conversion_expired_conflict","The stock or accepted-price deadline elapsed before conversion completion.");
        await db.SaveChangesAsync(ct);if(proof.ExpiresAt<=clock.GetUtcNow()||plan.PurchaseUntil<=clock.GetUtcNow())throw new BusinessException("sourcing_conversion_expired_conflict","The stock or accepted-price deadline elapsed while saving conversion.");prepared.Remove(token);gates[input.RequestId]=gate with{Fresh=false};return result;
    }
    public async Task<SourcingConversionMutation> ReadCommandAsync(string ownerId,string requestId,string offerId,string commandId,CancellationToken ct)
    {
        var owner=CartOfferRules.Owner(ownerId);requestId=CartOfferRules.Id(requestId);offerId=CartOfferRules.Id(offerId);commandId=CartOfferRules.CommandId(commandId);var row=await db.CartOfferCommandReceipts.AsNoTracking().SingleOrDefaultAsync(r=>r.ActorId==owner&&r.Operation=="convert"&&r.RequestId==requestId&&r.OfferId==offerId&&r.CommandId==commandId&&(allowDemo||!r.ContainsDemo),ct)??throw CartOfferRules.Missing();return Deserialize(row) with{Replayed=true};
    }
    public async Task<SourcingConversionExisting?> ReadExistingAsync(string ownerId,string acceptanceId,CancellationToken ct)
    {
        var owner=CartOfferRules.Owner(ownerId);acceptanceId=CartOfferRules.Id(acceptanceId);var row=await db.SourcingConversions.AsNoTracking().SingleOrDefaultAsync(c=>c.OwnerId==owner&&c.AcceptanceId==acceptanceId&&(allowDemo||!c.ContainsDemo),ct);if(row is null)return null;
        var links=JsonSerializer.Deserialize<SourcingCartLineLink[]>(row.LineLinksJson,CartOfferRules.Json)??throw new InvalidOperationException("Invalid conversion line provenance.");if(links.Length is <1 or >64)throw CartOfferRules.Capacity();return new(row.Id,row.CartVersion,links);
    }
    private Gate RequireGate(string owner,string command){CartOfferRules.RequireParent(db);if(!gates.TryGetValue(command,out var gate)||gate.Owner!=owner||gate.Transaction!=db.Database.CurrentTransaction!.TransactionId)throw new InvalidOperationException("Acquire the owner-bound conversion command lock before replay or live preparation.");return gate;}
    private static string Payload(string request,string offer,SourcingConversionInput input)=>CartOfferRules.Payload(new{Request=request,Offer=offer,Input=input});
    private static SourcingConversionMutation Deserialize(CartOfferCommandReceipt row)=>JsonSerializer.Deserialize<SourcingConversionMutation>(row.ResultJson,CartOfferRules.Json)??throw new InvalidOperationException("Invalid sourcing conversion receipt.");
}
