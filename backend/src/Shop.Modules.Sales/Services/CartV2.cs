using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Sales;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CartV2LineInput(string VariantId,int Quantity);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CartV2Input(CartV2LineInput[] Lines,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? Version);
public sealed record CartOrdinaryLineV2Data(string LineId,string LineKind,string VariantId,int Quantity,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? ProductId,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? Slug,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? Name,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? Label,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? UnitPriceRial,int Available,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? LineTotalRial,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? Issue,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.WhenWritingNull)]string? CompareAtRial = null);
public sealed record CartOfferLineData(string LineId,string LineKind,string ConversionId,string AgreementId,string AgreementLineId,
    string RequestId,string TaskId,string OfferId,string AcceptanceId,string AllocationId,string OfferLineId,string VariantId,int Quantity,
    string ProductId,string Slug,string Sku,string Name,string Label,string Warranty,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? ImageUrl,
    string UnitPriceRial,string LineTotalRial,DateTimeOffset PurchaseUntil,DateTimeOffset AllocationExpiresAt,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? Issue);
public sealed record CartSnapshotV2(int SchemaVersion,string Locale,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? Version,
    CartOrdinaryLineV2Data[] OrdinaryLines,CartOfferLineData[] OfferLines,CartSourcingSnapshot Inquiry,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? OrdinarySubtotalRial,string OfferSubtotalRial,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? BuySubtotalRial,bool HasIssues,bool CanCheckout,bool CanPay,string[] Blockers);

public sealed class CartV2Service(SalesDbContext db,CartService carts,CartSourcingService sourcing,IInventorySourcingAllocations allocations,ICatalogOfferReader catalog,TimeProvider clock,bool allowDemo)
{
    private sealed record OfferRead(CartOfferLine Cart,SourcingPriceAgreement Agreement,SourcingPriceAgreementLine Line,OfferSkuSnapshot Snapshot,SourcingAllocationSummaryData? Allocation,bool Complete,bool MaterialMatches);
    private const int MaximumResponseBytes=2*1024*1024;
    public async Task<string?> ReadVersionAsync(CartIdentity identity,CancellationToken ct)
    {
        CartService.ValidateIdentity(identity);CartOfferRules.RequireParent(db);if(identity.OwnerId is null&&identity.GuestToken is null)return null;await carts.LockIdentityAsync(identity,false,ct);var cart=await carts.FindAsync(identity,false,ct);CartService.EnsureCapacity(cart);return cart is null?null:Convert.ToBase64String(cart.Version);
    }
    public async Task<CartSnapshotV2> ReadAsync(CartIdentity identity,string locale,CancellationToken ct,bool includeCompareAt=false)
    {
        CartService.ValidateIdentity(identity);CartService.ValidateLocale(locale);CartOfferRules.RequireParent(db);if(identity.OwnerId is null&&identity.GuestToken is null)return Empty(locale);
        await carts.LockIdentityAsync(identity,false,ct);var cart=await carts.FindAsync(identity,false,ct);CartService.EnsureCapacity(cart);var offers=await ReadOffersAsync(identity,cart,ct);return await SnapshotAsync(identity,cart,locale,offers,includeCompareAt,ct);
    }
    public async Task<CartSnapshotV2> ReplaceAsync(CartIdentity identity,string locale,CartV2Input input,CancellationToken ct,bool includeCompareAt=false)
    {
        CartService.ValidateIdentity(identity);CartService.ValidateLocale(locale);ValidateInput(input);CartOfferRules.RequireParent(db);if(identity.OwnerId is null&&identity.GuestToken is null)throw new BusinessException("invalid_cart","A guest session is required for cart changes.");
        await carts.LockIdentityAsync(identity,true,ct);var before=await carts.FindAsync(identity,true,ct);CartService.EnsureCapacity(before,input.Lines.Length);
        // Agreement -> allocation reads precede ordinary Stock reads, including
        // no-op updates. Never invert the allocation/expiry writer's order.
        var offers=await ReadOffersAsync(identity,before,ct);var previousVersion=before is null?null:Convert.ToBase64String(before.Version);
        var cart=await carts.ReplaceInTransactionAsync(identity,locale,new(input.Lines.Select(l=>new CartLineInput(l.VariantId,l.Quantity)).ToArray(),input.Version),true,ct);
        var result=await SnapshotAsync(identity,cart,locale,offers,includeCompareAt,ct);if(previousVersion!=result.Version&&result.OrdinarySubtotalRial is not null&&result.BuySubtotalRial is null)throw new BusinessException("cart_amount_limit","All purchase lanes together exceed integer rial capacity.");return result;
    }
    public async Task<CartSnapshotV2> MergeAsync(string ownerId,string? guestToken,string locale,CancellationToken ct,bool includeCompareAt=false)
    {
        var identity=new CartIdentity(ownerId,null);CartService.ValidateIdentity(identity);CartService.ValidateLocale(locale);CartOfferRules.RequireParent(db);
        // The core obtains both cart identities in their existing canonical
        // order. It never reads Stock or follows agreement/allocation pointers.
        var cart=await carts.MergeInTransactionAsync(ownerId,guestToken,locale,true,ct);var offers=await ReadOffersAsync(identity,cart,ct);var result=await SnapshotAsync(identity,cart,locale,offers,includeCompareAt,ct);
        if(result.OrdinarySubtotalRial is not null&&result.BuySubtotalRial is null)throw new BusinessException("cart_amount_limit","All merged purchase lanes together exceed integer rial capacity.");return result;
    }
    private async Task<OfferRead[]> ReadOffersAsync(CartIdentity identity,ShoppingCart? cart,CancellationToken ct)
    {
        if(cart is null||cart.OfferLines.Count==0)return [];
        if(identity.OwnerId is null)throw new BusinessException("cart_offer_owner_conflict","Accepted agreements cannot belong to a guest cart.");
        CartService.EnsureCapacity(cart);var rows=cart.OfferLines.OrderBy(l=>l.Id,StringComparer.Ordinal).ToArray();var ids=rows.Select(l=>l.AgreementId).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToArray();
        var agreements=await db.SourcingPriceAgreements.AsNoTracking().Where(a=>ids.Contains(a.Id)).OrderBy(a=>a.Id).Take(65).ToDictionaryAsync(a=>a.Id,ct);
        if(agreements.Count!=ids.Length||agreements.Values.Any(a=>!a.OwnerId.Equals(identity.OwnerId,StringComparison.OrdinalIgnoreCase)||a.ContainsDemo&&!allowDemo))throw CartOfferRules.Missing();
        var joined=await (from c in db.CartOfferLines.AsNoTracking() join a in db.SourcingPriceAgreementLines.AsNoTracking() on new{c.AgreementId,Id=c.AgreementLineId} equals new{a.AgreementId,a.Id} where c.CartId==cart.Id select a).Take(65).ToArrayAsync(ct);
        if(joined.Length!=rows.Length)throw CartOfferRules.Capacity();var lines=joined.ToDictionary(l=>(l.AgreementId,l.Id));
        var counts=await db.SourcingPriceAgreementLines.AsNoTracking().Where(l=>ids.Contains(l.AgreementId)).GroupBy(l=>l.AgreementId).Select(g=>new{Id=g.Key,Count=g.Count()}).ToDictionaryAsync(g=>g.Id,g=>g.Count,ct);
        if(counts.Values.Any(n=>n is <1 or >64))throw CartOfferRules.Capacity();
        var acceptanceIds=agreements.Values.Select(a=>a.AcceptanceId).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToArray();var summaries=new List<SourcingAllocationSummaryData>();
        foreach(var batch in acceptanceIds.Chunk(50))summaries.AddRange(await allocations.ReadSummariesAsync(batch,identity.OwnerId,ct));
        if(summaries.Count>64||summaries.Select(a=>a.AcceptanceId).Distinct(StringComparer.Ordinal).Count()!=summaries.Count)throw CartOfferRules.Capacity();var currentAllocations=summaries.ToDictionary(a=>a.AcceptanceId,StringComparer.Ordinal);
        var variants=rows.Select(l=>l.VariantId).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();IReadOnlyDictionary<string,OfferSkuSnapshot> current;
        try{current=await catalog.ReadAsync(variants,ct);}catch(BusinessException e)when(e.Code=="catalog_unavailable"){current=new Dictionary<string,OfferSkuSnapshot>(StringComparer.OrdinalIgnoreCase);}
        // Retained accepted terms remain readable/removable when today's
        // public graph exceeds its bounds. This issue never authorizes buying.
        var result=new List<OfferRead>();
        foreach(var row in rows){
            if(row.ContainsDemo&&!allowDemo||!lines.TryGetValue((row.AgreementId,row.AgreementLineId),out var line))throw CartOfferRules.Missing();var agreement=agreements[row.AgreementId];
            if(row.RequestId!=agreement.RequestId||row.TaskId!=agreement.TaskId||row.OfferId!=agreement.OfferId||row.AcceptanceId!=agreement.AcceptanceId||row.OfferLineId!=line.OfferLineId||!row.VariantId.Equals(line.VariantId,StringComparison.OrdinalIgnoreCase)||row.Quantity!=line.Quantity||line.LineTotalRial!=checked(line.UnitPriceRial*line.Quantity))throw CartOfferRules.Capacity();
            var snapshot=JsonSerializer.Deserialize<OfferSkuSnapshot>(line.SkuSnapshotJson,SourcingPriceAgreementRules.Json)??throw CartOfferRules.Capacity();if(snapshot.VariantId!=line.VariantId)throw CartOfferRules.Capacity();
            var material=current.TryGetValue(line.VariantId,out var sku)&&sku.ProductId==snapshot.ProductId&&sku.MaterialFingerprint==snapshot.MaterialFingerprint;
            result.Add(new(row,agreement,line,snapshot,currentAllocations.GetValueOrDefault(agreement.AcceptanceId),rows.Count(l=>l.AgreementId==agreement.Id)==counts.GetValueOrDefault(agreement.Id),material));
        }
        return result.ToArray();
    }
    private async Task<CartSnapshotV2> SnapshotAsync(CartIdentity identity,ShoppingCart? cart,string locale,OfferRead[] offers,bool includeCompareAt,CancellationToken ct)
    {
        var ordinary=await carts.SnapshotOrdinaryAsync(cart,locale,ct);var inquiry=await sourcing.ReadAsync(identity,locale,ct);if(inquiry.Version!=ordinary.Version)throw new BusinessException("cart_version_conflict","The cart sections changed while being read.");
        var now=clock.GetUtcNow();var accepted=offers.Select(item=>Data(item,locale,now)).ToArray();long offerTotal;
        try{offerTotal=offers.Aggregate(0L,(sum,item)=>checked(sum+item.Line.LineTotalRial));}catch(OverflowException){throw CartOfferRules.Capacity();}
        string? total=null;var amountIssue=false;if(ordinary.SubtotalRial is not null){try{total=CartOfferRules.Money(checked(long.Parse(ordinary.SubtotalRial,CultureInfo.InvariantCulture)+offerTotal));}catch(OverflowException){amountIssue=true;}}
        var normal=ordinary.Lines.Select(l=>new CartOrdinaryLineV2Data(CartOfferRules.OrdinaryLineId(cart!.Id,l.VariantId),"ordinary",l.VariantId,l.Quantity,l.ProductId,l.Slug,l.Name,l.Label,l.UnitPriceRial,l.Available,l.LineTotalRial,l.Issue,includeCompareAt?l.CompareAtRial:null)).ToArray();
        var blockers=new List<string>();if(normal.Length==0&&accepted.Length==0)blockers.Add("empty_cart");if(ordinary.HasIssues)blockers.Add("ordinary_cart_review_required");if(accepted.Length>0)blockers.Add("accepted_offer_checkout_unavailable");if(accepted.Any(l=>l.Issue is not null))blockers.Add("accepted_offer_review_required");if(inquiry.HasIssues)blockers.Add("inquiry_review_required");if(amountIssue)blockers.Add("cart_amount_limit");
        var value=new CartSnapshotV2(2,locale,ordinary.Version,normal,accepted,inquiry,ordinary.SubtotalRial,CartOfferRules.Money(offerTotal),total,ordinary.HasIssues||accepted.Any(l=>l.Issue is not null)||inquiry.HasIssues||amountIssue,accepted.Length==0&&normal.Length>0&&!ordinary.HasIssues&&!amountIssue,false,blockers.ToArray());return Bound(value);
    }
    private static CartOfferLineData Data(OfferRead item,string locale,DateTimeOffset now)
    {
        var c=item.Cart;var a=item.Agreement;var allocation=item.Allocation;string? issue=null;
        if(a.State=="Revoked")issue="agreement_revoked";else if(a.State=="Consumed"||a.ConsumedOrderId is not null)issue="agreement_consumed";else if(a.PurchaseUntil<=now)issue="agreement_expired";
        else if(a.AllocationId!=c.AllocationId||allocation is not null&&allocation.Id!=c.AllocationId)issue="allocation_changed";
        else if(allocation is null)issue="allocation_unavailable";else if(allocation.State!="Active"||allocation.EffectiveState!="Active"||allocation.ExpiresAt<=now||c.AllocationExpiresAt<=now)issue="allocation_expired";
        else if(allocation.Version!=c.AllocationVersion||allocation.RequestId!=c.RequestId||allocation.TaskId!=c.TaskId||allocation.OfferId!=c.OfferId||allocation.AcceptanceId!=c.AcceptanceId||!allocation.Lines.Any(l=>l.OfferLineId==c.OfferLineId&&l.VariantId.Equals(c.VariantId,StringComparison.OrdinalIgnoreCase)&&l.Quantity==c.Quantity))issue="allocation_changed";
        else if(!item.Complete)issue="agreement_incomplete";else if(!item.MaterialMatches)issue="material_changed";
        var sku=item.Snapshot;return new(c.Id,"acceptedOffer",c.ConversionId,c.AgreementId,c.AgreementLineId,c.RequestId,c.TaskId,c.OfferId,c.AcceptanceId,c.AllocationId,c.OfferLineId,c.VariantId,c.Quantity,sku.ProductId,sku.Model.Slug,sku.Sku,locale=="en"?sku.Model.NameEn:sku.Model.NameFa,locale=="en"?sku.LabelEn:sku.LabelFa,locale=="en"?sku.WarrantyEn:sku.WarrantyFa,sku.Model.Images.FirstOrDefault(),CartOfferRules.Money(item.Line.UnitPriceRial),CartOfferRules.Money(item.Line.LineTotalRial),a.PurchaseUntil,c.AllocationExpiresAt,issue);
    }
    private static void ValidateInput(CartV2Input input)
    {
        if(input is null||input.Lines is null||input.Lines.Length>64||input.Lines.Any(l=>l is null||l.VariantId is not {Length:>0 and <=64}||l.VariantId.Any(c=>!char.IsAsciiLetterOrDigit(c)&&c is not ('-' or '_'))||l.Quantity is <1 or >1000000)||input.Lines.Select(l=>l.VariantId).Distinct(StringComparer.OrdinalIgnoreCase).Count()!=input.Lines.Length)throw new BusinessException("invalid_cart","Use up to 64 distinct ordinary SKU selections with bounded positive quantities.");if(input.Version is not null)CartOfferRules.Version(input.Version);
    }
    private static CartSnapshotV2 Empty(string locale)=>new(2,locale,null,[],[],new(1,locale,null,24,true,false,[],false),"0","0","0",false,false,false,["empty_cart"]);
    private static CartSnapshotV2 Bound(CartSnapshotV2 value){if(JsonSerializer.SerializeToUtf8Bytes(value,CartOfferRules.Json).Length>MaximumResponseBytes)throw CartOfferRules.Capacity();return value;}
}
