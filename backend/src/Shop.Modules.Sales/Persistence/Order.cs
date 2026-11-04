using Microsoft.EntityFrameworkCore;

namespace Shop.Modules.Sales;
public enum OrderState { AwaitingPayment, Paid, Cancelled, Expired, Fulfilled, CreditApproved }
public sealed class SalesOrder
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public long Number { get; set; }
    public string OwnerId { get; set; } = "";
    public string RequestId { get; set; } = "";
    public string PayloadHash { get; set; } = "";
    public string QuoteId { get; set; } = "";
    public string PricingFingerprint { get; set; } = "";
    public string Locale { get; set; } = "";
    public OrderState State { get; set; }
    public string ReservationId { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset ChangedAt { get; set; }
    public string ContactName { get; set; } = "";
    public string ContactPhone { get; set; } = "";
    public bool ShippingRequired { get; set; }
    public string? CountryCode { get; set; }
    public string? Province { get; set; }
    public string? City { get; set; }
    public string? Address { get; set; }
    public string? PostalCode { get; set; }
    public string Note { get; set; } = "";
    public string MethodId { get; set; } = "";
    public string MethodName { get; set; } = "";
    public string ShippingName { get; set; } = "";
    public long ItemsSubtotalRial { get; set; }
    public long GoodsTotalRial { get; set; }
    public long ShippingRial { get; set; }
    public long? TaxRial { get; set; } = 0;
    public bool TaxBreakdownKnown { get; set; } = true;
    public long PayableTotalRial { get; set; }
    public bool TaxIncluded { get; set; }
    public string QuoteSnapshotJson { get; set; } = "";
    // NULL keeps every historical order on its original reader contract.
    public int? SnapshotVersion { get; set; }
    public bool ContainsDemo { get; set; }
    public byte[] Version { get; set; } = [];
    public List<SalesOrderLine> Lines { get; set; } = [];
    public List<SalesOrderLineV2> LinesV2 { get; set; } = [];
    public List<SalesOrderEvent> Events { get; set; } = [];
}
public sealed class SalesOrderLine
{
    public string OrderId { get; set; } = "";
    public string VariantId { get; set; } = "";
    public string ProductId { get; set; } = "";
    public string SellerId { get; set; } = "";
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
public sealed class SalesOrderEvent
{
    public long Id { get; set; }
    public string OrderId { get; set; } = "";
    public OrderState State { get; set; }
    public string ActorId { get; set; } = "";
    public string Reason { get; set; } = "";
    public DateTimeOffset At { get; set; }
}
internal static class SalesOrderModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<SalesOrder>(e => {
            e.ToTable("Orders", t => {
                t.HasCheckConstraint("CK_Order_State", "[State] IN ('AwaitingPayment','Paid','Cancelled','Expired','Fulfilled','CreditApproved')");
                t.HasCheckConstraint("CK_Order_Amounts", "[ItemsSubtotalRial]>=0 AND [GoodsTotalRial]>=[ItemsSubtotalRial] AND [ShippingRial]>=0 AND (([TaxBreakdownKnown]=1 AND [TaxRial] IS NOT NULL AND [TaxRial]>=0) OR ([TaxBreakdownKnown]=0 AND [TaxIncluded]=1 AND [TaxRial] IS NULL)) AND [PayableTotalRial]>0 AND CAST([PayableTotalRial] AS decimal(38,0))=CAST([GoodsTotalRial] AS decimal(38,0))+[ShippingRial]+CASE WHEN [TaxIncluded]=1 THEN 0 ELSE [TaxRial] END");
                t.HasCheckConstraint("CK_Order_TaxDisclosure", "([TaxBreakdownKnown]=1 AND COALESCE(JSON_VALUE([QuoteSnapshotJson],'$.ChargeRules.TaxMode'),'')<>'included_unitemized') OR ([TaxBreakdownKnown]=0 AND [TaxIncluded]=1 AND [TaxRial] IS NULL AND COALESCE(JSON_VALUE([QuoteSnapshotJson],'$.ChargeRules.TaxMode'),'')='included_unitemized' AND COALESCE(JSON_VALUE([QuoteSnapshotJson],'$.ChargeRules.TaxIncluded'),'')='true' AND JSON_VALUE([QuoteSnapshotJson],'$.ChargeRules.TaxRateBasisPoints') IS NULL AND JSON_VALUE([QuoteSnapshotJson],'$.TaxRial') IS NULL)");
                t.HasCheckConstraint("CK_Order_Dates", "[ExpiresAt]>[CreatedAt] AND [ChangedAt]>=[CreatedAt]");
                t.HasCheckConstraint("CK_Order_Delivery", "([ShippingRequired]=0 AND [CountryCode] IS NULL AND [Province] IS NULL AND [City] IS NULL AND [Address] IS NULL AND [PostalCode] IS NULL) OR ([ShippingRequired]=1 AND [CountryCode]='IR' AND [Province] IS NOT NULL AND [City] IS NOT NULL AND [Address] IS NOT NULL AND [PostalCode] IS NOT NULL)");
                t.HasCheckConstraint("CK_Order_QuoteSnapshot", "ISJSON([QuoteSnapshotJson])=1 AND DATALENGTH([QuoteSnapshotJson])<=1048576");
            });
            e.Property(x => x.TaxBreakdownKnown).HasDefaultValue(true).HasSentinel(true);
            e.HasKey(x => x.Id); e.Property(x => x.Id).HasMaxLength(32); e.Property(x => x.Number).UseIdentityColumn(); e.HasIndex(x => x.Number).IsUnique();
            e.Property(x => x.OwnerId).HasMaxLength(64); e.Property(x => x.RequestId).HasMaxLength(32); e.Property(x => x.PayloadHash).HasMaxLength(64).IsUnicode(false); e.Property(x => x.QuoteId).HasMaxLength(32); e.Property(x => x.PricingFingerprint).HasMaxLength(64).IsUnicode(false); e.Property(x => x.ReservationId).HasMaxLength(32); e.Property(x => x.Locale).HasMaxLength(2); e.Property(x => x.State).HasConversion<string>().HasMaxLength(24); e.Property(x => x.Version).IsRowVersion();
            e.HasIndex(x => new { x.OwnerId, x.RequestId }).IsUnique(); e.HasIndex(x => x.QuoteId).IsUnique(); e.HasIndex(x => new { x.OwnerId, x.CreatedAt, x.Id }); e.HasIndex(x => new { x.State, x.ExpiresAt });
            e.Property(x => x.ContactName).HasMaxLength(100); e.Property(x => x.ContactPhone).HasMaxLength(11).IsUnicode(false); e.Property(x => x.CountryCode).HasMaxLength(2).IsUnicode(false); e.Property(x => x.Province).HasMaxLength(100); e.Property(x => x.City).HasMaxLength(100); e.Property(x => x.Address).HasMaxLength(2000); e.Property(x => x.PostalCode).HasMaxLength(10).IsUnicode(false); e.Property(x => x.Note).HasMaxLength(500); e.Property(x => x.MethodId).HasMaxLength(64); e.Property(x => x.MethodName).HasMaxLength(200); e.Property(x => x.ShippingName).HasMaxLength(200);
            e.HasOne<CheckoutQuote>().WithMany().HasForeignKey(x => x.QuoteId).OnDelete(DeleteBehavior.Restrict);
            e.HasMany(x => x.Lines).WithOne().HasForeignKey(x => x.OrderId).OnDelete(DeleteBehavior.Cascade); e.HasMany(x => x.Events).WithOne().HasForeignKey(x => x.OrderId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<SalesOrderLine>(e => {
            e.ToTable("OrderLines", t => t.HasCheckConstraint("CK_OrderLine_Amount", "[Quantity] BETWEEN 1 AND 1000000 AND [UnitPriceRial]>=0 AND [LineTotalRial]>=0 AND CAST([LineTotalRial] AS decimal(38,0))=CAST([UnitPriceRial] AS decimal(38,0))*[Quantity]")); e.HasKey(x => new { x.OrderId, x.VariantId }); e.Property(x => x.OrderId).HasMaxLength(32); foreach (var name in new[] { "VariantId", "ProductId", "SellerId" }) e.Property<string>(name).HasMaxLength(64); e.Property(x => x.Sku).HasMaxLength(80); e.Property(x => x.Name).HasMaxLength(250); e.Property(x => x.PriceVersion).HasMaxLength(12);
        });
        b.Entity<SalesOrderEvent>(e => { e.ToTable("OrderEvents"); e.HasKey(x => x.Id); e.Property(x => x.OrderId).HasMaxLength(32); e.Property(x => x.State).HasConversion<string>().HasMaxLength(24); e.Property(x => x.ActorId).HasMaxLength(64); e.Property(x => x.Reason).HasMaxLength(100); e.HasIndex(x => new { x.OrderId, x.Id }); });
    }
}
