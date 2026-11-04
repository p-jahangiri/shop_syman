using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Sales;

public sealed record AcceptedQuoteLineV4Data(string ConversionId,string AgreementId,string AgreementLineId,string RequestId,string TaskId,string OfferId,string AcceptanceId,string AllocationId,string OfferLineId,string TermsHash,string AgreementVersion,string AllocationVersion,DateTimeOffset PurchaseUntil,DateTimeOffset AllocationExpiresAt);
public sealed record QuoteLineV4Data(string LineId,string LineKind,string VariantId,string ProductId,string SellerId,string CategoryId,string Sku,string Name,string Label,string Warranty,bool IsDigital,int Quantity,string UnitPriceRial,string LineTotalRial,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? PriceVersion,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]AcceptedQuoteLineV4Data? Accepted,[property:System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]UsedItemConditionData? UsedCondition=null);
public sealed record CheckoutQuoteV4Data(int SchemaVersion,string Locale,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? QuoteId,
    string CartVersion,string PricingFingerprint,DateTimeOffset CreatedAt,DateTimeOffset? ExpiresAt,QuoteLineV4Data[] Lines,string ItemsSubtotalRial,string MarkupRial,string DownPaymentRial,string GoodsTotalRial,bool ShippingRequired,string? ShippingRial,string? TaxRial,string? PayableTotalRial,PurchaseMethodData[] Methods,CreditPlanData[] Plans,PurchaseMethodData? SelectedMethod,CreditPlanData? SelectedPlan,ChequeAmount[] Installments,bool RequiresApproval,bool CanPlaceOrder,string[] Blockers,QuoteChargeRules? ChargeRules=null,TemporaryOrderOption? TemporaryOrder=null,bool CanPay=false);

// V4 keeps independently priced lines of the same SKU. Historical V3 line keys,
// JSON snapshots and order readers are deliberately unchanged.
public sealed class CheckoutQuoteLineV4
{
    public string QuoteId {get;set;}="";
    public string LineId {get;set;}="";
    public string LineKind {get;set;}="";
    public string VariantId {get;set;}="";
    public string ProductId {get;set;}="";
    public string SellerId {get;set;}="";
    public string CategoryId {get;set;}="";
    public string Sku {get;set;}="";
    public string Name {get;set;}="";
    public string Label {get;set;}="";
    public string Warranty {get;set;}="";
    public string? PriceVersion {get;set;}
    public bool IsDigital {get;set;}
    public int Quantity {get;set;}
    public long UnitPriceRial {get;set;}
    public long LineTotalRial {get;set;}
    public string? ConversionId {get;set;}
    public string? AgreementId {get;set;}
    public string? AgreementLineId {get;set;}
    public string? RequestId {get;set;}
    public string? TaskId {get;set;}
    public string? OfferId {get;set;}
    public string? AcceptanceId {get;set;}
    public string? AllocationId {get;set;}
    public string? OfferLineId {get;set;}
    public string? TermsHash {get;set;}
    public string? AgreementVersion {get;set;}
    public string? AllocationVersion {get;set;}
    public DateTimeOffset? PurchaseUntil {get;set;}
    public DateTimeOffset? AllocationExpiresAt {get;set;}
}

internal static class CheckoutQuoteV4Model
{
    internal static void Configure(ModelBuilder b)
    {
        b.Entity<CheckoutQuote>().ToTable(t=>t.HasCheckConstraint("CK_Quote_ContractVersion","[ContractVersion] IS NULL OR [ContractVersion] IN (3,4,5)"));
        b.Entity<CheckoutQuote>().HasMany(x=>x.LinesV4).WithOne().HasForeignKey(x=>x.QuoteId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<CheckoutQuoteLineV4>(e=>{
            var provenance=new[]{"ConversionId","AgreementId","AgreementLineId","RequestId","TaskId","OfferId","AcceptanceId","AllocationId","OfferLineId","TermsHash","AgreementVersion","AllocationVersion","PurchaseUntil","AllocationExpiresAt"};
            var present=string.Join(" AND ",provenance.Select(n=>$"[{n}] IS NOT NULL"));
            var absent=string.Join(" AND ",provenance.Select(n=>$"[{n}] IS NULL"));
            e.ToTable("CheckoutQuoteLinesV4",t=>{
                t.HasCheckConstraint("CK_QuoteLineV4_Amount","[Quantity] BETWEEN 1 AND 1000000 AND [UnitPriceRial]>=0 AND [LineTotalRial]>=0 AND CAST([LineTotalRial] AS decimal(38,0))=CAST([UnitPriceRial] AS decimal(38,0))*[Quantity]");
                t.HasCheckConstraint("CK_QuoteLineV4_Provenance",$"([LineKind]='ordinary' AND [PriceVersion] IS NOT NULL AND {absent}) OR ([LineKind]='acceptedOffer' AND [PriceVersion] IS NULL AND [IsDigital]=0 AND {present} AND [AllocationExpiresAt]<=[PurchaseUntil])");
                t.HasCheckConstraint("CK_QuoteLineV4_Identity","LEN([QuoteId])=32 AND LEN([LineId])=32 AND LEN([VariantId]) BETWEEN 1 AND 64");
            });
            e.HasKey(x=>new{x.QuoteId,x.LineId});
            foreach(var n in new[]{"QuoteId","LineId","ConversionId","AgreementId","AgreementLineId","RequestId","TaskId","OfferId","AcceptanceId","AllocationId","OfferLineId"})e.Property<string>(n).HasMaxLength(32);
            e.Property(x=>x.LineKind).HasMaxLength(16).IsUnicode(false);
            foreach(var n in new[]{"VariantId","ProductId","SellerId","CategoryId"})e.Property<string>(n).HasMaxLength(64);
            e.Property(x=>x.Sku).HasMaxLength(80);e.Property(x=>x.Name).HasMaxLength(250);
            foreach(var n in new[]{"PriceVersion","AgreementVersion","AllocationVersion"})e.Property<string>(n).HasMaxLength(12);
            e.Property(x=>x.TermsHash).HasMaxLength(64).IsUnicode(false);
            e.HasIndex(x=>new{x.QuoteId,x.AgreementId,x.AgreementLineId}).IsUnique().HasFilter("[AgreementId] IS NOT NULL");
        });
    }
}

public sealed record PreparedQuoteAgreementV4(SourcingPriceAgreement Agreement,SourcingStockAllocationPlan StockPlan,QuoteLineV4Data[] Lines);
public static class CheckoutQuoteV4Rules
{
    public const string OrderUnavailable="accepted_offer_order_unavailable";
    // Pure validation is not an inventory capability. The service takes every
    // Agreement lock before calling this and then obtains an exact batch proof.
    public static PreparedQuoteAgreementV4 Accepted(string cartId,string owner,CartOfferLine[] rows,SourcingPriceAgreement agreement,SourcingConversion conversion,string locale,DateTimeOffset now,bool allowDemo)
    {
        if(rows is not {Length:>0 and <=64}||agreement is null||conversion is null||agreement.Lines.Count!=rows.Length||agreement.Lines.Count is <1 or >64||!agreement.OwnerId.Equals(owner,StringComparison.OrdinalIgnoreCase)||!conversion.OwnerId.Equals(owner,StringComparison.OrdinalIgnoreCase)||agreement.ContainsDemo&&!allowDemo||conversion.ContainsDemo!=agreement.ContainsDemo||agreement.State!="Active"||agreement.ConsumedOrderId is not null)throw Changed();
        if(agreement.PurchaseUntil<=now)throw Expired();
        CartOfferRules.Id(cartId);CartOfferRules.Id(agreement.Id);CartOfferRules.Version(Convert.ToBase64String(agreement.Version));
        if(conversion.CartId!=cartId||conversion.AgreementId!=agreement.Id||conversion.RequestId!=agreement.RequestId||conversion.TaskId!=agreement.TaskId||conversion.OfferId!=agreement.OfferId||conversion.AcceptanceId!=agreement.AcceptanceId||conversion.AllocationId!=agreement.AllocationId||rows.Any(r=>r.ConversionId!=conversion.Id)||rows.Select(r=>r.AllocationVersion).Distinct(StringComparer.Ordinal).Count()!=1||rows.Select(r=>r.AllocationExpiresAt).Distinct().Count()!=1||rows.Select(r=>r.Id).Distinct(StringComparer.Ordinal).Count()!=rows.Length||rows.Select(r=>r.AgreementLineId).Distinct(StringComparer.Ordinal).Count()!=rows.Length)throw Changed();
        var links=JsonSerializer.Deserialize<SourcingCartLineLink[]>(conversion.LineLinksJson,CartOfferRules.Json)??throw Changed();
        if(links.Length!=rows.Length||links.Select(l=>l.LineId).Distinct(StringComparer.Ordinal).Count()!=links.Length||rows.Any(r=>!links.Any(l=>l.LineId==r.Id&&l.AgreementLineId==r.AgreementLineId&&l.OfferLineId==r.OfferLineId)))throw Changed();
        var acceptedLines=new List<AcceptedSourcingPlanLine>();var result=new List<QuoteLineV4Data>();
        foreach(var line in agreement.Lines.OrderBy(l=>l.OfferLineId,StringComparer.Ordinal)){
            var row=rows.SingleOrDefault(r=>r.AgreementLineId==line.Id)??throw Changed();var sku=JsonSerializer.Deserialize<OfferSkuSnapshot>(line.SkuSnapshotJson,SourcingPriceAgreementRules.Json)??throw Changed();
            long total;try{total=checked(line.UnitPriceRial*line.Quantity);}catch(OverflowException){throw Amount();}
            if(line.AgreementId!=agreement.Id||row.CartId!=cartId||row.Id!=CartOfferRules.OfferLineId(cartId,agreement.Id,line.Id)||row.AgreementId!=agreement.Id||row.RequestId!=agreement.RequestId||row.TaskId!=agreement.TaskId||row.OfferId!=agreement.OfferId||row.AcceptanceId!=agreement.AcceptanceId||row.AllocationId!=agreement.AllocationId||row.OfferLineId!=line.OfferLineId||row.Quantity!=line.Quantity||row.Quantity is <1 or >1000000||!row.VariantId.Equals(line.VariantId,StringComparison.OrdinalIgnoreCase)||sku.VariantId!=line.VariantId||sku.Model.Id!=sku.ProductId||line.Id!=SourcingPriceAgreementRules.LineId(agreement.AcceptanceId,line.OfferLineId)||line.LineTotalRial!=total||line.UnitPriceRial<0||row.ContainsDemo!=agreement.ContainsDemo||row.AllocationExpiresAt>agreement.PurchaseUntil||row.AllocationExpiresAt.Offset!=TimeSpan.Zero)throw Changed();
            CartOfferRules.Version(row.AllocationVersion);if(row.AllocationExpiresAt<=now)throw Expired();
            acceptedLines.Add(new(line.OfferLineId,line.ListingId,line.Quantity,Money(line.UnitPriceRial),sku));
            result.Add(new(row.Id,"acceptedOffer",line.VariantId,sku.ProductId,sku.SellerId,sku.Model.CategoryId,sku.Sku,locale=="en"?sku.Model.NameEn:sku.Model.NameFa,locale=="en"?sku.LabelEn:sku.LabelFa,locale=="en"?sku.WarrantyEn:sku.WarrantyFa,false,line.Quantity,Money(line.UnitPriceRial),Money(line.LineTotalRial),null,new(conversion.Id,agreement.Id,line.Id,agreement.RequestId,agreement.TaskId,agreement.OfferId,agreement.AcceptanceId,agreement.AllocationId,line.OfferLineId,agreement.TermsHash,Convert.ToBase64String(agreement.Version),row.AllocationVersion,agreement.PurchaseUntil,row.AllocationExpiresAt)));
        }
        const string ignoredVersion="AAAAAAAAAAA=";
        var plan=new AcceptedSourcingPurchasePlan(agreement.RequestId,agreement.TaskId,agreement.OfferId,agreement.Revision,agreement.AcceptanceId,agreement.OwnerId,agreement.TermsHash,ignoredVersion,ignoredVersion,ignoredVersion,agreement.PurchaseUntil,agreement.TermsFa,agreement.TermsEn,agreement.ContainsDemo,acceptedLines.ToArray());
        if(SourcingPriceAgreementRules.SnapshotHash(plan)!=agreement.SnapshotHash)throw Changed();
        return new(agreement,new(agreement.RequestId,agreement.TaskId,agreement.OfferId,agreement.AcceptanceId,agreement.OwnerId,agreement.TermsHash,agreement.PurchaseUntil,agreement.ContainsDemo,plan.Lines.Select(l=>new SourcingStockAllocationPlanLine(l.OfferLineId,l.Sku.VariantId,l.Sku.ProductId,l.Quantity,l.Sku.MaterialFingerprint)).ToArray()),result.ToArray());
    }
    public static DateTimeOffset Expiry(DateTimeOffset now,IEnumerable<QuoteLineV4Data> lines)
    {
        var expires=now.AddMinutes(5);foreach(var line in lines)if(line.Accepted is {} a){if(a.PurchaseUntil<expires)expires=a.PurchaseUntil;if(a.AllocationExpiresAt<expires)expires=a.AllocationExpiresAt;}if(expires<=now)throw Expired();return expires;
    }
    public static TemporaryOrderOption Fence(TemporaryOrderOption option)=>option with{CanCreate=false,Blockers=option.Blockers.Append(OrderUnavailable).Distinct(StringComparer.Ordinal).ToArray()};
    internal static string Money(long value)=>value.ToString(CultureInfo.InvariantCulture);
    internal static BusinessException Changed()=>new("quote_accepted_offer_conflict","Review every exact accepted agreement and its original allocation before calculating again.");
    internal static BusinessException Expired()=>new("quote_accepted_offer_expired_conflict","The accepted price or actual stock hold has expired.");
    internal static BusinessException Amount()=>new("quote_amount_limit","The quote exceeds the supported integer rial amount.");
}
