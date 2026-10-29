using Shop.SharedKernel;
using Microsoft.EntityFrameworkCore;
using System.Text.Json.Serialization;

namespace Shop.Modules.Sales;

public sealed class SalesOrderLineV2
{
    public string OrderId{get;set;}="";public string LineId{get;set;}="";public string LineKind{get;set;}="";
    public string VariantId{get;set;}="";public string ProductId{get;set;}="";public string SellerId{get;set;}="";public string CategoryId{get;set;}="";
    public string Sku{get;set;}="";public string Name{get;set;}="";public string Label{get;set;}="";public string Warranty{get;set;}="";public string? PriceVersion{get;set;}
    public bool IsDigital{get;set;}public int Quantity{get;set;}public long UnitPriceRial{get;set;}public long LineTotalRial{get;set;}
    public string? ConversionId{get;set;}public string? AgreementId{get;set;}public string? AgreementLineId{get;set;}public string? RequestId{get;set;}public string? TaskId{get;set;}public string? OfferId{get;set;}public string? AcceptanceId{get;set;}public string? AllocationId{get;set;}public string? OfferLineId{get;set;}
    public string? TermsHash{get;set;}public string? AgreementVersion{get;set;}public string? AllocationVersion{get;set;}public DateTimeOffset? PurchaseUntil{get;set;}public DateTimeOffset? AllocationExpiresAt{get;set;}
    public int? Revision{get;set;}public string? SnapshotHash{get;set;}public string? TermsFa{get;set;}public string? TermsEn{get;set;}public string? MaterialFingerprint{get;set;}public bool ContainsDemo{get;set;}
}
public sealed class SalesOrderOutboxEvent
{
    public string Id{get;set;}="";public string OrderId{get;set;}="";public string AgreementId{get;set;}="";public string EventType{get;set;}="SourcingAgreementOrdered";public string PayloadJson{get;set;}="";
    public DateTimeOffset CreatedAt{get;set;}public DateTimeOffset? DeliveredAt{get;set;}public int Attempts{get;set;}public DateTimeOffset? LastAttemptAt{get;set;}public DateTimeOffset? NextAttemptAt{get;set;}public byte[] Version{get;set;}=[];
}
public sealed record OrderSummaryV2Data(string Id,string Reference,string Locale,string State,DateTimeOffset CreatedAt,DateTimeOffset ExpiresAt,string PayableTotalRial,int ItemCount,string Version,int OriginalSnapshotVersion,string? OwnerId=null);
public sealed record OrderLineV2Data(string LineId,string LineKind,string VariantId,string ProductId,string SellerId,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? CategoryId,string Sku,string Name,string Label,string Warranty,bool IsDigital,int Quantity,string UnitPriceRial,string LineTotalRial,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? PriceVersion,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]AcceptedQuoteLineV5Data? Accepted,[property:System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]UsedItemConditionData? UsedCondition=null);
public sealed record OrderDetailV2Data(int SchemaVersion,int OriginalSnapshotVersion,OrderSummaryV2Data Summary,string QuoteId,string ContactName,string ContactPhone,OrderAddressInput? Delivery,string Note,bool ShippingRequired,string MethodName,string ShippingName,string ItemsSubtotalRial,string GoodsTotalRial,string ShippingRial,string TaxRial,string PayableTotalRial,bool TaxIncluded,OrderLineV2Data[] Lines,OrderEventData[] Events,bool CanCancel,bool CanPay,string PaymentAvailability);
public sealed record CreateOrderResultV2(OrderDetailV2Data Order,bool Replayed);
public sealed record OrderPageV2Data(int SchemaVersion,OrderSummaryV2Data[] Items,string? NextCursor);
public static class OrderV2HistoryRules
{
    // An old unknown version remains unknown. It is never replaced by a
    // fabricated rowversion or used as a new order entitlement.
    public static string? PriceVersion(string? value)
    {
        if(value is not {Length:12})return null;
        try{return Convert.FromBase64String(value).Length==8&&Convert.ToBase64String(Convert.FromBase64String(value))==value?value:null;}
        catch(FormatException){return null;}
    }
}

internal static class SalesOrderV2Model
{
    internal static void Configure(ModelBuilder b)
    {
        b.Entity<SalesOrder>(e=>{
            e.ToTable(t=>t.HasCheckConstraint("CK_Order_SnapshotVersion","[SnapshotVersion] IS NULL OR [SnapshotVersion]=2"));
            e.HasMany(x=>x.LinesV2).WithOne().HasForeignKey(x=>x.OrderId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<SalesOrderLineV2>(e=>{
            var provenance=new[]{"ConversionId","AgreementId","AgreementLineId","RequestId","TaskId","OfferId","AcceptanceId","AllocationId","OfferLineId","TermsHash","AgreementVersion","AllocationVersion","PurchaseUntil","AllocationExpiresAt","Revision","SnapshotHash","TermsFa","TermsEn","MaterialFingerprint"};
            var present=string.Join(" AND ",provenance.Select(n=>$"[{n}] IS NOT NULL"));var absent=string.Join(" AND ",provenance.Select(n=>$"[{n}] IS NULL"));
            e.ToTable("OrderLinesV2",t=>{
                t.HasCheckConstraint("CK_OrderLineV2_Amount","[Quantity] BETWEEN 1 AND 1000000 AND [UnitPriceRial]>=0 AND [LineTotalRial]>=0 AND CAST([LineTotalRial] AS decimal(38,0))=CAST([UnitPriceRial] AS decimal(38,0))*[Quantity]");
                t.HasCheckConstraint("CK_OrderLineV2_Identity","LEN([OrderId])=32 AND LEN([LineId])=32 AND LEN([VariantId]) BETWEEN 1 AND 64");
                t.HasCheckConstraint("CK_OrderLineV2_Provenance",$"([LineKind]='ordinary' AND [PriceVersion] IS NOT NULL AND [ContainsDemo]=0 AND {absent}) OR ([LineKind]='acceptedOffer' AND [PriceVersion] IS NULL AND [IsDigital]=0 AND {present} AND [Revision]>0 AND [AllocationExpiresAt]<=[PurchaseUntil])");
            });
            e.HasKey(x=>new{x.OrderId,x.LineId});foreach(var n in new[]{"OrderId","LineId","ConversionId","AgreementId","AgreementLineId","RequestId","TaskId","OfferId","AcceptanceId","AllocationId","OfferLineId"})e.Property<string>(n).HasMaxLength(32);
            foreach(var n in new[]{"VariantId","ProductId","SellerId","CategoryId"})e.Property<string>(n).HasMaxLength(64);
            e.Property(x=>x.LineKind).HasMaxLength(16).IsUnicode(false);e.Property(x=>x.Sku).HasMaxLength(80);e.Property(x=>x.Name).HasMaxLength(250);
            foreach(var n in new[]{"PriceVersion","AgreementVersion","AllocationVersion"})e.Property<string>(n).HasMaxLength(12);
            foreach(var n in new[]{"TermsHash","SnapshotHash","MaterialFingerprint"})e.Property<string>(n).HasMaxLength(64).IsUnicode(false);
            e.Property(x=>x.TermsFa).HasMaxLength(4000);e.Property(x=>x.TermsEn).HasMaxLength(4000);
            e.HasIndex(x=>new{x.OrderId,x.AgreementId,x.AgreementLineId}).IsUnique().HasFilter("[AgreementId] IS NOT NULL");
        });
        b.Entity<SalesOrderOutboxEvent>(e=>{
            e.ToTable("OrderOutbox",t=>{
                t.HasCheckConstraint("CK_OrderOutbox_Payload","ISJSON([PayloadJson])=1 AND DATALENGTH([PayloadJson])<=16384");
                t.HasCheckConstraint("CK_OrderOutbox_Progress","[Attempts] BETWEEN 0 AND 1000000 AND ([LastAttemptAt] IS NULL OR [LastAttemptAt]>=[CreatedAt]) AND ([NextAttemptAt] IS NULL OR [NextAttemptAt]>=[CreatedAt]) AND ([DeliveredAt] IS NULL OR ([DeliveredAt]>=[CreatedAt] AND [NextAttemptAt] IS NULL))");
                t.HasCheckConstraint("CK_OrderOutbox_EventType","[EventType]='SourcingAgreementOrdered'");
            });
            e.HasKey(x=>x.Id);foreach(var n in new[]{"Id","OrderId","AgreementId"})e.Property<string>(n).HasMaxLength(32);e.Property(x=>x.EventType).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.PayloadJson).HasMaxLength(8192);e.Property(x=>x.Version).IsRowVersion();
            e.HasIndex(x=>new{x.OrderId,x.AgreementId,x.EventType}).IsUnique();e.HasIndex(x=>new{x.DeliveredAt,x.NextAttemptAt,x.CreatedAt,x.Id});e.HasOne<SalesOrder>().WithMany().HasForeignKey(x=>x.OrderId).OnDelete(DeleteBehavior.Restrict);
        });
    }
}
