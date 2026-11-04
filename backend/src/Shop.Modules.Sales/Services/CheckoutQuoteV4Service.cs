using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;

namespace Shop.Modules.Sales;

public sealed class CheckoutQuoteV4Service(SalesDbContext db,CartService carts,ICheckoutCatalogReader catalog,ICatalogOfferReader offerCatalog,IInventoryCheckoutOffers inventory,IPurchaseConfiguration purchasing,CheckoutChargePolicyService chargePolicies,CheckoutOrderSettingsService orderSettings,SourcingPriceAgreementService agreements,TimeProvider clock,bool allowDemo)
{
    private static readonly JsonSerializerOptions SnapshotJson=new(){NumberHandling=JsonNumberHandling.WriteAsString|JsonNumberHandling.AllowReadingFromString,DefaultIgnoreCondition=JsonIgnoreCondition.Never,MaxDepth=32};
    public async Task<CheckoutQuoteV4Data> CreateAsync(CartIdentity identity,string locale,CheckoutQuoteInput input,CancellationToken ct)
    {
        CartService.ValidateIdentity(identity);CartService.ValidateLocale(locale);
        if(identity.OwnerId is null)throw new BusinessException("quote_owner_required","Sign in to calculate an accepted-offer quote.");
        if(input is null||!OptionalId(input.MethodId)||!OptionalId(input.PlanId))throw new BusinessException("invalid_quote","Use bounded purchase method and plan identifiers.");
        var methodId=input.MethodId?.ToLowerInvariant();var planId=input.PlanId?.ToLowerInvariant();
        if(methodId is null&&planId is not null)throw new BusinessException("invalid_quote","Select a purchase method before a plan.");
        var requestId=methodId is null?null:Guid.TryParse(input.RequestId,out var id)&&id!=Guid.Empty?id.ToString("N"):throw new BusinessException("invalid_quote","A UUID request id is required for a saved quote.");
        CartOfferRules.RequireParent(db);
        // Raw whole-cart read owns only Sales state. Do not hydrate Cart2 here:
        // its ordinary Stock read would precede the Agreement/allocation locks.
        await carts.LockIdentityAsync(identity,false,ct);
        var cart=await carts.FindAsync(identity,false,ct);CartService.EnsureCapacity(cart);
        var actor=CartService.ActorKey(identity);var payload=Hash(JsonSerializer.Serialize(new{Locale=locale,input.CartVersion,MethodId=methodId,PlanId=planId}));
        if(requestId is not null){
            await LockQuoteAsync(actor,requestId,ct);
            var previous=await db.Quotes.FromSqlInterpolated($"SELECT * FROM [sales].[CheckoutQuotes] WITH (UPDLOCK,HOLDLOCK) WHERE [ActorKey]={actor} AND [RequestId]={requestId}").AsNoTracking().SingleOrDefaultAsync(ct);
            if(previous is not null){
                if(previous.ContractVersion!=4)throw new BusinessException("quote_contract_conflict","This request id belongs to another quote contract.");
                if(previous.PayloadHash!=payload)throw new BusinessException("idempotency_conflict","This quote request id has a different payload.");
                if(!allowDemo){
                    // The environment guard precedes deserialization and uses
                    // immutable Sales provenance, without reviving live holds.
                    var ids=await db.Set<CheckoutQuoteLineV4>().AsNoTracking().Where(l=>l.QuoteId==previous.Id&&l.LineKind=="acceptedOffer").Select(l=>l.AgreementId!).Distinct().Take(65).ToArrayAsync(ct);
                    if(ids.Length is <1 or >64)throw CartOfferRules.Missing();
                    var owned=await db.SourcingPriceAgreements.AsNoTracking().Where(a=>ids.Contains(a.Id)&&a.OwnerId==identity.OwnerId&&!a.ContainsDemo).Select(a=>a.Id).ToArrayAsync(ct);
                    if(owned.Length!=ids.Length)throw CartOfferRules.Missing();
                }
                var replay=JsonSerializer.Deserialize<CheckoutQuoteV4Data>(previous.ResponseJson,SnapshotJson)??throw new InvalidOperationException("The saved V4 quote is invalid.");
                if(replay.SchemaVersion!=4||replay.QuoteId!=previous.Id)throw new InvalidOperationException("The saved V4 quote contract is invalid.");
                // A receipt is historical, never a renewed stock entitlement.
                var expired=previous.ExpiresAt<=clock.GetUtcNow();
                return replay with{CanPlaceOrder=false,CanPay=false,Blockers=replay.Blockers.Append(CheckoutQuoteV4Rules.OrderUnavailable).Concat(expired?["quote_expired"]:Array.Empty<string>()).Distinct(StringComparer.Ordinal).ToArray(),TemporaryOrder=replay.TemporaryOrder is null?null:CheckoutQuoteV4Rules.Fence(replay.TemporaryOrder) with{Blockers=CheckoutQuoteV4Rules.Fence(replay.TemporaryOrder).Blockers.Concat(expired?["quote_expired"]:Array.Empty<string>()).Distinct(StringComparer.Ordinal).ToArray()}};
            }
        }
        if(cart is null||cart.OfferLines.Count==0)throw new BusinessException("quote_v4_requires_accepted_offer","This quote contract requires an accepted-offer selection.");
        var cartVersion=Convert.ToBase64String(cart.Version);
        if(input.CartVersion!=cartVersion)throw new BusinessException("cart_version_conflict","The cart changed. Reload before requesting a quote.");
        CartOfferRules.EnsureSkuCapacity(cart.Lines.Select(l=>(l.VariantId,l.Quantity)).Concat(cart.OfferLines.Select(l=>(l.VariantId,l.Quantity))));
        var prepared=await ReadAcceptedAsync(identity.OwnerId,cart,locale,ct);
        var variantIds=cart.Lines.Select(l=>l.VariantId).Concat(cart.OfferLines.Select(l=>l.VariantId)).Distinct(StringComparer.OrdinalIgnoreCase).Order(StringComparer.Ordinal).ToArray();
        var variants=await catalog.ReadCheckoutVariantsAsync(locale,variantIds,ct);
        if(variantIds.Any(id=>!variants.ContainsKey(id)))throw new BusinessException("cart_review_conflict","A selected item is no longer published for purchase.");
        var current=await offerCatalog.ReadAsync(cart.OfferLines.Select(l=>l.VariantId).Distinct(StringComparer.OrdinalIgnoreCase).ToArray(),ct);
        foreach(var group in prepared)foreach(var line in group.Lines){
            var accepted=group.StockPlan.Lines.Single(l=>l.OfferLineId==line.Accepted!.OfferLineId);
            if(!current.TryGetValue(line.VariantId,out var sku)||sku.ProductId!=line.ProductId||sku.SellerId!=line.SellerId||sku.MaterialFingerprint!=accepted.MaterialFingerprint||variants[line.VariantId].Variant.IsDigital||variants[line.VariantId].Variant.ProductId!=line.ProductId)throw CheckoutQuoteV4Rules.Changed();
        }
        // This single price-free boundary owns all acceptance/resource locks,
        // then every Stock lock in canonical order; no prior Stock read exists.
        var proof=await inventory.AssertAsync(identity.OwnerId,prepared.Select(p=>new SourcingCheckoutAllocationRequest(p.StockPlan,p.Agreement.AllocationId,p.Lines[0].Accepted!.AllocationVersion)).ToArray(),cart.Lines.Select(l=>new SourcingCheckoutOrdinaryLine(l.VariantId,l.Quantity)).ToArray(),ct);
        ValidateProof(prepared,proof);
        if(cart.Lines.Any(l=>proof.OrdinaryAvailable.GetValueOrDefault(l.VariantId)<l.Quantity))throw new BusinessException("cart_review_conflict","An ordinary quantity exceeds stock outside accepted-offer holds.");
        QuoteLineV4Data[] lines;long subtotal;
        try{
            lines=cart.Lines.OrderBy(l=>l.VariantId,StringComparer.Ordinal).Select(l=>{var p=variants[l.VariantId];return new QuoteLineV4Data(CartOfferRules.OrdinaryLineId(cart.Id,l.VariantId),"ordinary",l.VariantId,p.Variant.ProductId,p.SellerId,p.Variant.CategoryId,p.Sku,p.Variant.Name,p.Variant.Label,p.Warranty,p.Variant.IsDigital,l.Quantity,Money(p.Variant.PriceRial),Money(checked(p.Variant.PriceRial*l.Quantity)),p.PriceVersion,null,p.UsedCondition);}).Concat(prepared.SelectMany(p=>p.Lines).OrderBy(l=>l.LineId,StringComparer.Ordinal)).ToArray();
            subtotal=lines.Aggregate(0L,(sum,l)=>checked(sum+Parse(l.LineTotalRial)));
        }catch(OverflowException){throw CheckoutQuoteV4Rules.Amount();}
        var now=clock.GetUtcNow();var expires=CheckoutQuoteV4Rules.Expiry(now,lines);
        var choice=CheckoutQuoteChoices.Select(subtotal,variants.Values,(await purchasing.MethodsAsync(locale,ct)).ToArray(),(await purchasing.PlansAsync(locale,ct)).ToArray(),methodId,planId);
        DigitalDeliveryRules.RequireOrderCapacity(lines.Select(l=>(l.IsDigital,l.Quantity,l.Sku,l.Name,l.Label)));
        var shippingRequired=lines.Any(l=>!l.IsDigital);
        var charges=CheckoutChargeCalculator.Calculate(subtotal,choice.Amounts.GoodsTotalRial,shippingRequired,await chargePolicies.ReadAsync(ct),locale);
        var temporary=CheckoutQuoteV4Rules.Fence(CheckoutOrderSettingsService.Option(await orderSettings.ReadAsync(ct),choice.Method,charges.PayableTotalRial is null?null:Money(charges.PayableTotalRial.Value)));
        // Today's public price/version never enters accepted-line authority or
        // its fingerprint; only current eligibility/configuration does.
        var eligibility=variants.Values.OrderBy(v=>v.Variant.Id,StringComparer.Ordinal).Select(v=>new{v.Variant.Id,v.Variant.ProductId,v.Variant.CategoryId,v.Variant.IsDigital,v.ProductMethodIds,v.VariantMethodIds,v.ChequePlanIds}).ToArray();
        var fingerprint=Hash(JsonSerializer.Serialize(new{Lines=lines,Eligibility=eligibility,Method=choice.Method,Plan=choice.Plan,ChargeRules=charges.Rules,temporary.SettingsVersion},SnapshotJson));
        var blockers=new List<string>{CheckoutQuoteV4Rules.OrderUnavailable};
        if (charges.TaxRial is null && charges.Rules.TaxMode != "included_unitemized")blockers.Add(charges.Rules.TaxMode=="unconfigured"?"tax_unconfigured":"tax_basis_unavailable");
        if(charges.ShippingRial is null)blockers.Add("shipping_unconfigured");
        if(choice.Method is null)blockers.Add(choice.Methods.Length==0?"no_purchase_method":"method_required");
        else{blockers.Add(choice.Method.Kind switch{"cheque"=>"credit_approval_required","installment"=>"installment_provider_unconfigured",_=>"gateway_unconfigured"});if(choice.Method.RequiresApproval&&choice.Method.Kind!="cheque")blockers.Add("approval_required");}
        var quoteId=methodId is null?null:Guid.NewGuid().ToString("N");
        var result=new CheckoutQuoteV4Data(4,locale,quoteId,cartVersion,fingerprint,now,expires,lines,Money(subtotal),Money(choice.Amounts.MarkupRial),Money(choice.Amounts.DownPaymentRial),Money(choice.Amounts.GoodsTotalRial),shippingRequired,charges.ShippingRial is null?null:Money(charges.ShippingRial.Value),charges.TaxRial is null?null:Money(charges.TaxRial.Value),charges.PayableTotalRial is null?null:Money(charges.PayableTotalRial.Value),choice.Methods,choice.Plans,choice.Method,choice.Plan,choice.Amounts.Installments,choice.Method?.RequiresApproval==true||choice.Method?.Kind=="cheque",false,blockers.ToArray(),charges.Rules,temporary,false);
        var json=JsonSerializer.Serialize(result,SnapshotJson);
        if(Encoding.Unicode.GetByteCount(json)>1048576||Encoding.UTF8.GetByteCount(json)>524288)throw new BusinessException("quote_configuration_limit","The quote snapshot is too large.");
        if(expires<=clock.GetUtcNow())throw CheckoutQuoteV4Rules.Expired();
        if(quoteId is not null){
            db.Quotes.Add(Store(result,cart.Id,actor,requestId!,payload,json));await db.SaveChangesAsync(ct);
            if(expires<=clock.GetUtcNow())throw CheckoutQuoteV4Rules.Expired();
        }
        return result;
    }
    private async Task<PreparedQuoteAgreementV4[]> ReadAcceptedAsync(string owner,ShoppingCart cart,string locale,CancellationToken ct)
    {
        var rows=cart.OfferLines.OrderBy(l=>l.Id,StringComparer.Ordinal).ToArray();
        foreach(var acceptance in rows.Select(l=>l.AcceptanceId).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal))await agreements.LockAsync(acceptance,ct);
        var ids=rows.Select(l=>l.AgreementId).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToArray();
        var stored=await db.SourcingPriceAgreements.AsNoTracking().Where(a=>ids.Contains(a.Id)).Include(a=>a.Lines.OrderBy(l=>l.OfferLineId).Take(65)).OrderBy(a=>a.AcceptanceId).ToArrayAsync(ct);
        if(stored.Length!=ids.Length)throw CheckoutQuoteV4Rules.Changed();
        var conversionIds=rows.Select(l=>l.ConversionId).Distinct(StringComparer.Ordinal).ToArray();
        var conversions=await db.SourcingConversions.AsNoTracking().Where(c=>conversionIds.Contains(c.Id)).ToDictionaryAsync(c=>c.Id,ct);
        if(conversions.Count!=conversionIds.Length)throw CheckoutQuoteV4Rules.Changed();
        return stored.OrderBy(a=>a.AcceptanceId,StringComparer.Ordinal).Select(a=>{
            var group=rows.Where(r=>r.AgreementId==a.Id).ToArray();
            if(group.Length==0||!conversions.TryGetValue(group[0].ConversionId,out var conversion))throw CheckoutQuoteV4Rules.Changed();
            return CheckoutQuoteV4Rules.Accepted(cart.Id,owner,group,a,conversion,locale,clock.GetUtcNow(),allowDemo);
        }).ToArray();
    }
    private static void ValidateProof(PreparedQuoteAgreementV4[] groups,SourcingCheckoutInventoryProof proof)
    {
        if(proof is null||proof.Allocations is null||proof.OrdinaryAvailable is null||proof.Allocations.Length!=groups.Length||proof.Allocations.Select(a=>a.AcceptanceId).Distinct(StringComparer.Ordinal).Count()!=groups.Length)throw new InvalidOperationException("The exact batch checkout allocation proof is required.");
        foreach(var group in groups){
            var a=group.Agreement;var p=proof.Allocations.SingleOrDefault(p=>p.AcceptanceId==a.AcceptanceId)??throw new InvalidOperationException("An accepted allocation proof is missing.");
            if(p.AllocationId!=a.AllocationId||p.RequestId!=a.RequestId||p.TaskId!=a.TaskId||p.OfferId!=a.OfferId||p.TermsHash!=a.TermsHash||p.IsDemo!=a.ContainsDemo||p.ExpiresAt> a.PurchaseUntil||p.Lines.Length!=group.Lines.Length||p.Lines.Select(l=>l.OfferLineId).Distinct(StringComparer.Ordinal).Count()!=p.Lines.Length||group.Lines.Any(l=>p.Version!=l.Accepted!.AllocationVersion||p.ExpiresAt!=l.Accepted.AllocationExpiresAt||!p.Lines.Any(pl=>pl.OfferLineId==l.Accepted.OfferLineId&&pl.VariantId.Equals(l.VariantId,StringComparison.OrdinalIgnoreCase)&&pl.Quantity==l.Quantity)))throw new InvalidOperationException("The complete original accepted allocation proof differs from the retained cart selection.");
        }
    }
    private static CheckoutQuote Store(CheckoutQuoteV4Data result,string cartId,string actor,string requestId,string payload,string json)=>new(){
        Id=result.QuoteId!,ContractVersion=4,ActorKey=actor,RequestId=requestId,PayloadHash=payload,CartId=cartId,CartVersion=result.CartVersion,PricingFingerprint=result.PricingFingerprint,CreatedAt=result.CreatedAt,ExpiresAt=result.ExpiresAt!.Value,ItemsSubtotalRial=Parse(result.ItemsSubtotalRial),MarkupRial=Parse(result.MarkupRial),DownPaymentRial=Parse(result.DownPaymentRial),GoodsTotalRial=Parse(result.GoodsTotalRial),ShippingRial=result.ShippingRial is null?null:Parse(result.ShippingRial),TaxRial=result.TaxRial is null?null:Parse(result.TaxRial),PayableTotalRial=result.PayableTotalRial is null?null:Parse(result.PayableTotalRial),ChargePolicyVersion=result.ChargeRules!.Version,ShippingMode=result.ChargeRules.ShippingMode,TaxMode=result.ChargeRules.TaxMode,TaxRateBasisPoints=result.ChargeRules.TaxRateBasisPoints,TaxableBaseRial=result.ChargeRules.TaxableBaseRial is null?null:Parse(result.ChargeRules.TaxableBaseRial),TaxIncluded=result.ChargeRules.TaxIncluded,ResponseJson=json,
        LinesV4=result.Lines.Select(l=>new CheckoutQuoteLineV4{QuoteId=result.QuoteId!,LineId=l.LineId,LineKind=l.LineKind,VariantId=l.VariantId,ProductId=l.ProductId,SellerId=l.SellerId,CategoryId=l.CategoryId,Sku=l.Sku,Name=l.Name,Label=l.Label,Warranty=l.Warranty,PriceVersion=l.PriceVersion,IsDigital=l.IsDigital,Quantity=l.Quantity,UnitPriceRial=Parse(l.UnitPriceRial),LineTotalRial=Parse(l.LineTotalRial),ConversionId=l.Accepted?.ConversionId,AgreementId=l.Accepted?.AgreementId,AgreementLineId=l.Accepted?.AgreementLineId,RequestId=l.Accepted?.RequestId,TaskId=l.Accepted?.TaskId,OfferId=l.Accepted?.OfferId,AcceptanceId=l.Accepted?.AcceptanceId,AllocationId=l.Accepted?.AllocationId,OfferLineId=l.Accepted?.OfferLineId,TermsHash=l.Accepted?.TermsHash,AgreementVersion=l.Accepted?.AgreementVersion,AllocationVersion=l.Accepted?.AllocationVersion,PurchaseUntil=l.Accepted?.PurchaseUntil,AllocationExpiresAt=l.Accepted?.AllocationExpiresAt}).ToList(),
        Installments=result.Installments.Select(i=>new CheckoutQuoteInstallment{QuoteId=result.QuoteId!,Sequence=i.Sequence,MonthOffset=i.MonthOffset,AmountRial=Parse(i.AmountRial)}).ToList()
    };
    private async Task LockQuoteAsync(string actor,string requestId,CancellationToken ct)
    {
        var transaction=db.Database.CurrentTransaction!;await using var command=db.Database.GetDbConnection().CreateCommand();command.Transaction=transaction.GetDbTransaction();command.CommandTimeout=12;
        command.CommandText="DECLARE @result int;EXEC @result=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;SELECT @result;";
        var p=command.CreateParameter();p.ParameterName="@resource";p.DbType=DbType.String;p.Size=255;p.Value="sayman:sales:quote:"+Hash(actor+":"+requestId);command.Parameters.Add(p);
        if(Convert.ToInt32(await command.ExecuteScalarAsync(ct),CultureInfo.InvariantCulture)>=0)return;
        await transaction.RollbackAsync(CancellationToken.None);throw new BusinessException("quote_busy_conflict","The quote is busy. Retry with the same request id.");
    }
    private static bool OptionalId(string? id)=>id is null||id.Length is >0 and <=64&&id.All(c=>char.IsAsciiLetterOrDigit(c)||c is '-' or '_');
    private static string Hash(string text)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)));
    private static long Parse(string value)=>long.Parse(value,CultureInfo.InvariantCulture);
    private static string Money(long value)=>value.ToString(CultureInfo.InvariantCulture);
}
