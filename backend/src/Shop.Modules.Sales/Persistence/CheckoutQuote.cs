using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Sales;
public sealed class CheckoutQuote
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string ActorKey { get; set; } = "";
    public string RequestId { get; set; } = "";
    public string PayloadHash { get; set; } = "";
    public string CartId { get; set; } = "";
    public string CartVersion { get; set; } = "";
    public string PricingFingerprint { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public long ItemsSubtotalRial { get; set; }
    public long MarkupRial { get; set; }
    public long DownPaymentRial { get; set; }
    public long GoodsTotalRial { get; set; }
    public long? ShippingRial { get; set; }
    public long? TaxRial { get; set; }
    public long? PayableTotalRial { get; set; }
    public string? ChargePolicyVersion { get; set; }
    public string? ShippingMode { get; set; }
    public string? TaxMode { get; set; }
    public long? TaxableBaseRial { get; set; }
    public int? TaxRateBasisPoints { get; set; }
    public bool TaxIncluded { get; set; }
    public string ResponseJson { get; set; } = "";
    // NULL is retained for pre-marker Quote1–3 history; new writers are explicit.
    public int? ContractVersion { get; set; }
    public List<CheckoutQuoteLine> Lines { get; set; } = [];
    public List<CheckoutQuoteLineV4> LinesV4 { get; set; } = [];
    public List<CheckoutQuoteInstallment> Installments { get; set; } = [];
}
public sealed class CheckoutQuoteLine
{
    public string QuoteId { get; set; } = "";
    public string VariantId { get; set; } = "";
    public string ProductId { get; set; } = "";
    public string SellerId { get; set; } = "";
    public string CategoryId { get; set; } = "";
    public string Sku { get; set; } = "";
    public string Name { get; set; } = "";
    public string Label { get; set; } = "";
    public string Warranty { get; set; } = "";
    public string PriceVersion { get; set; } = "";
    public bool IsDigital { get; set; }
    public int Quantity { get; set; }
    public long UnitPriceRial { get; set; }
    public long LineTotalRial { get; set; }
}
public sealed class CheckoutQuoteInstallment
{
    public string QuoteId { get; set; } = "";
    public int Sequence { get; set; }
    public int MonthOffset { get; set; }
    public long AmountRial { get; set; }
}
public sealed record CheckoutQuoteInput(string? CartVersion, string? MethodId, string? PlanId, string? RequestId);
public sealed record QuoteLineData(string VariantId, string ProductId, string SellerId, string CategoryId, string Sku, string Name, string Label, string Warranty, bool IsDigital, int Quantity, string UnitPriceRial, string LineTotalRial, string? PriceVersion = null,[property:System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]UsedItemConditionData? UsedCondition=null);
public sealed record CheckoutQuoteData(int SchemaVersion, string Locale, string? QuoteId, string CartVersion, string PricingFingerprint, DateTimeOffset CreatedAt, DateTimeOffset? ExpiresAt, QuoteLineData[] Lines, string ItemsSubtotalRial, string MarkupRial, string DownPaymentRial, string GoodsTotalRial, bool ShippingRequired, string? ShippingRial, string? TaxRial, string? PayableTotalRial, PurchaseMethodData[] Methods, CreditPlanData[] Plans, PurchaseMethodData? SelectedMethod, CreditPlanData? SelectedPlan, ChequeAmount[] Installments, bool RequiresApproval, bool CanPlaceOrder, string[] Blockers, QuoteChargeRules? ChargeRules = null, TemporaryOrderOption? TemporaryOrder = null);
internal static class CheckoutQuoteModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<CheckoutQuote>(e => {
            e.ToTable("CheckoutQuotes", t => { t.HasCheckConstraint("CK_Quote_Amounts", "[ItemsSubtotalRial]>=0 AND [MarkupRial]>=0 AND [DownPaymentRial]>=0 AND [DownPaymentRial]<=[ItemsSubtotalRial] AND [GoodsTotalRial]>=[ItemsSubtotalRial] AND ([ShippingRial] IS NULL OR [ShippingRial]>=0) AND ([TaxRial] IS NULL OR [TaxRial]>=0) AND ([PayableTotalRial] IS NULL OR [PayableTotalRial]>=0)"); t.HasCheckConstraint("CK_Quote_Expiry", "[ExpiresAt]>[CreatedAt]"); t.HasCheckConstraint("CK_Quote_Response", "ISJSON([ResponseJson])=1 AND DATALENGTH([ResponseJson])<=1048576"); });
            e.HasKey(x => x.Id); e.Property(x => x.Id).HasMaxLength(32); e.Property(x => x.ActorKey).HasMaxLength(64).IsUnicode(false); e.Property(x => x.RequestId).HasMaxLength(32); e.Property(x => x.PayloadHash).HasMaxLength(64).IsUnicode(false); e.Property(x => x.CartId).HasMaxLength(32); e.Property(x => x.CartVersion).HasMaxLength(12); e.Property(x => x.PricingFingerprint).HasMaxLength(64).IsUnicode(false);
            e.HasIndex(x => new { x.ActorKey, x.RequestId }).IsUnique(); e.HasIndex(x => x.ExpiresAt);
            e.Property(x => x.ChargePolicyVersion).HasMaxLength(12); e.Property(x => x.ShippingMode).HasMaxLength(16).IsUnicode(false); e.Property(x => x.TaxMode).HasMaxLength(24).IsUnicode(false);
            e.ToTable(t => t.HasCheckConstraint("CK_Quote_Tax", "([TaxableBaseRial] IS NULL OR [TaxableBaseRial]>=0) AND ([TaxRateBasisPoints] IS NULL OR [TaxRateBasisPoints] BETWEEN 1 AND 10000)"));
            e.HasMany(x => x.Lines).WithOne().HasForeignKey(x => x.QuoteId).OnDelete(DeleteBehavior.Cascade); e.HasMany(x => x.Installments).WithOne().HasForeignKey(x => x.QuoteId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<CheckoutQuoteLine>(e => {
            e.ToTable("CheckoutQuoteLines", t => t.HasCheckConstraint("CK_QuoteLine_Amount", "[Quantity] BETWEEN 1 AND 1000000 AND [UnitPriceRial]>=0 AND [LineTotalRial]>=0")); e.HasKey(x => new { x.QuoteId, x.VariantId }); e.Property(x => x.QuoteId).HasMaxLength(32); foreach (var name in new[] { "VariantId", "ProductId", "SellerId", "CategoryId" }) e.Property<string>(name).HasMaxLength(64); e.Property(x => x.Sku).HasMaxLength(80); e.Property(x => x.Name).HasMaxLength(250); e.Property(x => x.PriceVersion).HasMaxLength(12);
        });
        b.Entity<CheckoutQuoteInstallment>(e => { e.ToTable("CheckoutQuoteInstallments", t => t.HasCheckConstraint("CK_QuoteCheque_Amount", "[Sequence] BETWEEN 1 AND 60 AND [MonthOffset] BETWEEN 1 AND 60 AND [AmountRial]>0")); e.HasKey(x => new { x.QuoteId, x.Sequence }); e.Property(x => x.QuoteId).HasMaxLength(32); });
        CheckoutQuoteV4Model.Configure(b);
    }
}
