using System.Globalization;
using System.Text.Json.Serialization;
using Shop.SharedKernel;

namespace Shop.Modules.Sales;

// A new contract deliberately preserves Quote4 as a historical calculator.
// These complete accepted terms are copied into the immutable order snapshot.
public sealed record AcceptedQuoteLineV5Data(string ConversionId,string AgreementId,string AgreementLineId,string RequestId,string TaskId,string OfferId,string AcceptanceId,string AllocationId,string OfferLineId,string TermsHash,string AgreementVersion,string AllocationVersion,DateTimeOffset PurchaseUntil,DateTimeOffset AllocationExpiresAt,int Revision,string SnapshotHash,string TermsFa,string TermsEn,string MaterialFingerprint,bool ContainsDemo);
public sealed record QuoteLineV5Data(string LineId,string LineKind,string VariantId,string ProductId,string SellerId,string CategoryId,string Sku,string Name,string Label,string Warranty,bool IsDigital,int Quantity,string UnitPriceRial,string LineTotalRial,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? PriceVersion,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]AcceptedQuoteLineV5Data? Accepted,[property:System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]UsedItemConditionData? UsedCondition=null);
public sealed record CheckoutQuoteV5Data(int SchemaVersion,string Locale,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? QuoteId,
    string CartVersion,string PricingFingerprint,DateTimeOffset CreatedAt,DateTimeOffset? ExpiresAt,QuoteLineV5Data[] Lines,string ItemsSubtotalRial,string MarkupRial,string DownPaymentRial,string GoodsTotalRial,bool ShippingRequired,string? ShippingRial,string? TaxRial,string? PayableTotalRial,PurchaseMethodData[] Methods,CreditPlanData[] Plans,PurchaseMethodData? SelectedMethod,CreditPlanData? SelectedPlan,ChequeAmount[] Installments,bool RequiresApproval,bool CanPlaceOrder,string[] Blockers,QuoteChargeRules? ChargeRules=null,TemporaryOrderOption? TemporaryOrder=null,bool CanPay=false);
public sealed record PreparedQuoteAgreementV5(SourcingPriceAgreement Agreement,SourcingStockAllocationPlan StockPlan,QuoteLineV5Data[] Lines);

public static class CheckoutQuoteV5Rules
{
    public static PreparedQuoteAgreementV5 Accepted(string cartId,string owner,CartOfferLine[] rows,SourcingPriceAgreement agreement,SourcingConversion conversion,string locale,DateTimeOffset now,bool allowDemo)
    {
        // Pure immutable authority validation is shared; no Quote4 capability,
        // header, replay, snapshot or deadline is changed by this operation.
        var v4=CheckoutQuoteV4Rules.Accepted(cartId,owner,rows,agreement,conversion,locale,now,allowDemo);
        var lines=v4.Lines.Select(l=>{
            var a=l.Accepted!;var material=v4.StockPlan.Lines.Single(p=>p.OfferLineId==a.OfferLineId).MaterialFingerprint;
            return new QuoteLineV5Data(l.LineId,l.LineKind,l.VariantId,l.ProductId,l.SellerId,l.CategoryId,l.Sku,l.Name,l.Label,l.Warranty,l.IsDigital,l.Quantity,l.UnitPriceRial,l.LineTotalRial,null,new(a.ConversionId,a.AgreementId,a.AgreementLineId,a.RequestId,a.TaskId,a.OfferId,a.AcceptanceId,a.AllocationId,a.OfferLineId,a.TermsHash,a.AgreementVersion,a.AllocationVersion,a.PurchaseUntil,a.AllocationExpiresAt,agreement.Revision,agreement.SnapshotHash,agreement.TermsFa,agreement.TermsEn,material,agreement.ContainsDemo));
        }).ToArray();
        return new(agreement,v4.StockPlan,lines);
    }
    public static DateTimeOffset Expiry(DateTimeOffset now,IEnumerable<QuoteLineV5Data> lines)
    {
        var expires=now.AddMinutes(5);foreach(var l in lines)if(l.Accepted is {} a){if(a.PurchaseUntil<expires)expires=a.PurchaseUntil;if(a.AllocationExpiresAt<expires)expires=a.AllocationExpiresAt;}
        if(expires<=now)throw CheckoutQuoteV4Rules.Expired();return expires;
    }
    public static DateTimeOffset OrderExpiry(DateTimeOffset now,DateTimeOffset quoteExpiry,IEnumerable<QuoteLineV5Data> lines,int reservationMinutes)
    {
        if(reservationMinutes is <1 or >60)throw new BusinessException("invalid_order_settings","Use an explicitly configured reservation lifetime.");
        // The quote must be fresh when the order is created. Its short pricing
        // lifetime does not shorten the separately configured payment hold.
        if(quoteExpiry<=now)throw CheckoutQuoteV4Rules.Expired();
        var until=now.AddMinutes(reservationMinutes);
        foreach(var l in lines)if(l.Accepted is {} a){if(a.PurchaseUntil<until)until=a.PurchaseUntil;if(a.AllocationExpiresAt<until)until=a.AllocationExpiresAt;}
        if(until<=now)throw CheckoutQuoteV4Rules.Expired();return until;
    }
    internal static string Money(long value)=>value.ToString(CultureInfo.InvariantCulture);
}
