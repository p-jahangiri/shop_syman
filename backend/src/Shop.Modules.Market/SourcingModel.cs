using Microsoft.EntityFrameworkCore;

namespace Shop.Modules.Market;

public sealed class SourcingRequest
{
    public string Id {get;set;}=Guid.NewGuid().ToString("N");
    public long Number {get;set;}
    public string OwnerId {get;set;}="";
    public string SubmitRequestId {get;set;}="";
    public string PayloadHash {get;set;}="";
    public string CartId {get;set;}="";
    public string SubmittedCartVersion {get;set;}="";
    public string Locale {get;set;}="";
    public string State {get;set;}="Submitted";
    public string ProtectedNote {get;set;}="";
    public bool ContainsDemo {get;set;}
    public DateTimeOffset CreatedAt {get;set;}
    public DateTimeOffset ChangedAt {get;set;}
    public byte[] Version {get;set;}=[];
    public List<SourcingRequestLine> Lines {get;set;}=[];
}
public sealed class SourcingRequestLine
{
    public string RequestId {get;set;}="";
    public string ListingId {get;set;}="";
    public string ModelId {get;set;}="";
    public int Quantity {get;set;}
    public string Slug {get;set;}="";
    public string CategoryId {get;set;}="";
    public string CategoryNameFa {get;set;}="";
    public string CategoryNameEn {get;set;}="";
    public string BrandId {get;set;}="";
    public string Brand {get;set;}="";
    public string NameFa {get;set;}="";
    public string NameEn {get;set;}="";
    public string SearchText {get;set;}="";
    public string DescriptionFa {get;set;}="";
    public string DescriptionEn {get;set;}="";
    public string ModelVersion {get;set;}="";
    public string ModelFingerprint {get;set;}="";
    public string ListingVersion {get;set;}="";
    public string SelectionFingerprint {get;set;}="";
    public string SourceKey {get;set;}="";
    public string SourceItemKey {get;set;}="";
    public string SourceNameFa {get;set;}="";
    public string SourceNameEn {get;set;}="";
    public string? SourceUrl {get;set;}
    public string Availability {get;set;}="unknown";
    public DateTimeOffset? ObservedAt {get;set;}
    public DateTimeOffset? ValidUntil {get;set;}
    public long? ReferencePriceRial {get;set;}
    public bool ReferencePriceCurrent {get;set;}
    public bool IsDemo {get;set;}
    public string? PhoneConfigurationJson {get;set;}
    public List<SourcingRequestImage> Images {get;set;}=[];
    public List<SourcingRequestAttribute> Attributes {get;set;}=[];
}
public sealed class SourcingRequestImage
{
    public string RequestId {get;set;}="";
    public string ListingId {get;set;}="";
    public int SortOrder {get;set;}
    public string Url {get;set;}="";
}
public sealed class SourcingRequestAttribute
{
    public string RequestId {get;set;}="";
    public string ListingId {get;set;}="";
    public string AttributeId {get;set;}="";
    public string Key {get;set;}="";
    public string DataType {get;set;}="";
    public string LabelFa {get;set;}="";
    public string LabelEn {get;set;}="";
    public string? Unit {get;set;}
    public string? UnitFa {get;set;}
    public string? UnitEn {get;set;}
    public string? TextFa {get;set;}
    public string? TextEn {get;set;}
    public decimal? Number {get;set;}
    public bool? Bool {get;set;}
    public List<SourcingRequestOption> Options {get;set;}=[];
}
public sealed class SourcingRequestOption
{
    public string RequestId {get;set;}="";
    public string ListingId {get;set;}="";
    public string AttributeId {get;set;}="";
    public string OptionId {get;set;}="";
    public string LabelFa {get;set;}="";
    public string LabelEn {get;set;}="";
}
public sealed class SourcingRequestEvent
{
    public long Id {get;set;}
    public string RequestId {get;set;}="";
    public string ActorId {get;set;}="";
    public string ActorKind {get;set;}="";
    public string? StateBefore {get;set;}
    public string StateAfter {get;set;}="";
    public string ReasonCode {get;set;}="";
    public string PublicMessage {get;set;}="";
    public DateTimeOffset At {get;set;}
}
public sealed class SourcingCommandReceipt
{
    public string ActorId {get;set;}="";
    public string Operation {get;set;}="";
    public string RequestId {get;set;}="";
    public string TargetId {get;set;}="";
    public string PayloadHash {get;set;}="";
    public string ResultJson {get;set;}="";
    public bool ContainsDemo {get;set;}
    public DateTimeOffset CreatedAt {get;set;}
}
internal static class SourcingModel
{
    internal static void Configure(ModelBuilder b)
    {
        b.Entity<SourcingRequest>(e=>{
            e.ToTable("SourcingRequests",t=>{t.HasCheckConstraint("CK_SourcingRequest_State","[State] IN ('Submitted','Reviewing','Unavailable','Cancelled')");t.HasCheckConstraint("CK_SourcingRequest_Locale","[Locale] IN ('fa','en')");t.HasCheckConstraint("CK_SourcingRequest_Dates","[ChangedAt]>=[CreatedAt]");t.HasCheckConstraint("CK_SourcingRequest_Note","LEN([ProtectedNote]) BETWEEN 1 AND 32768");});
            e.HasKey(x=>x.Id);e.Property(x=>x.Id).HasMaxLength(32);e.Property(x=>x.Number).UseIdentityColumn();e.HasIndex(x=>x.Number).IsUnique();e.Property(x=>x.OwnerId).HasMaxLength(64);e.Property(x=>x.SubmitRequestId).HasMaxLength(32);e.Property(x=>x.PayloadHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.CartId).HasMaxLength(32);e.Property(x=>x.SubmittedCartVersion).HasMaxLength(12);e.Property(x=>x.Locale).HasMaxLength(2);e.Property(x=>x.State).HasMaxLength(16);e.Property(x=>x.ProtectedNote).HasMaxLength(32768).IsUnicode(false);e.Property(x=>x.Version).IsRowVersion();
            e.HasIndex(x=>new{x.OwnerId,x.SubmitRequestId}).IsUnique();e.HasIndex(x=>new{x.CartId,x.SubmittedCartVersion}).IsUnique();e.HasIndex(x=>new{x.OwnerId,x.CreatedAt,x.Id});e.HasIndex(x=>new{x.State,x.CreatedAt,x.Id});e.HasMany(x=>x.Lines).WithOne().HasForeignKey(x=>x.RequestId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<SourcingRequestLine>(e=>{
            e.ToTable("SourcingRequestLines",t=>{t.HasCheckConstraint("CK_SourcingLine_Quantity","[Quantity] BETWEEN 1 AND 1000000");t.HasCheckConstraint("CK_SourcingLine_Price","[ReferencePriceRial] IS NULL OR [ReferencePriceRial]>0");t.HasCheckConstraint("CK_SourcingLine_Availability","[Availability] IN ('unknown','available','unavailable','stale')");t.HasCheckConstraint("CK_SourcingLine_Observation","([ObservedAt] IS NULL AND [ValidUntil] IS NULL AND [Availability]='unknown' AND [ReferencePriceRial] IS NULL AND [ReferencePriceCurrent]=0) OR ([ObservedAt] IS NOT NULL AND [ValidUntil] IS NOT NULL AND [ValidUntil]>[ObservedAt])");});
            e.Property(x=>x.PhoneConfigurationJson).HasMaxLength(8000);e.ToTable(t=>t.HasCheckConstraint("CK_SourcingLine_PhoneConfiguration","[PhoneConfigurationJson] IS NULL OR (ISJSON([PhoneConfigurationJson])=1 AND DATALENGTH([PhoneConfigurationJson])<=16000)"));
            e.HasKey(x=>new{x.RequestId,x.ListingId});e.Property(x=>x.RequestId).HasMaxLength(32);e.Property(x=>x.ListingId).HasMaxLength(32);foreach(var name in new[]{"ModelId","CategoryId","BrandId"})e.Property<string>(name).HasMaxLength(64);e.Property(x=>x.Slug).HasMaxLength(150);foreach(var name in new[]{"CategoryNameFa","CategoryNameEn","SourceNameFa","SourceNameEn"})e.Property<string>(name).HasMaxLength(200);e.Property(x=>x.Brand).HasMaxLength(120);e.Property(x=>x.NameFa).HasMaxLength(250);e.Property(x=>x.NameEn).HasMaxLength(250);e.Property(x=>x.SearchText).HasColumnType("nvarchar(max)");e.Property(x=>x.DescriptionFa).HasMaxLength(8000);e.Property(x=>x.DescriptionEn).HasMaxLength(8000);e.Property(x=>x.ModelVersion).HasMaxLength(12);e.Property(x=>x.ListingVersion).HasMaxLength(12);e.Property(x=>x.ModelFingerprint).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.SelectionFingerprint).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.SourceKey).HasMaxLength(64);e.Property(x=>x.SourceItemKey).HasMaxLength(120);e.Property(x=>x.SourceUrl).HasMaxLength(1500);e.Property(x=>x.Availability).HasMaxLength(16);e.Property(x=>x.ReferencePriceRial).HasColumnType("bigint");
            e.HasMany(x=>x.Images).WithOne().HasForeignKey(x=>new{x.RequestId,x.ListingId}).OnDelete(DeleteBehavior.Cascade);e.HasMany(x=>x.Attributes).WithOne().HasForeignKey(x=>new{x.RequestId,x.ListingId}).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<SourcingRequestImage>(e=>{e.ToTable("SourcingRequestImages",t=>t.HasCheckConstraint("CK_SourcingImage_Order","[SortOrder] BETWEEN 0 AND 23"));e.HasKey(x=>new{x.RequestId,x.ListingId,x.SortOrder});e.Property(x=>x.RequestId).HasMaxLength(32);e.Property(x=>x.ListingId).HasMaxLength(32);e.Property(x=>x.Url).HasMaxLength(1500);});
        b.Entity<SourcingRequestAttribute>(e=>{
            e.ToTable("SourcingRequestAttributes",t=>{t.HasCheckConstraint("CK_SourcingAttribute_Type","[DataType] IN ('Text','Number','Bool','Select','MultiSelect')");t.HasCheckConstraint("CK_SourcingAttribute_Value","([DataType]='Text' AND [TextFa] IS NOT NULL AND [TextEn] IS NOT NULL AND [Number] IS NULL AND [Bool] IS NULL) OR ([DataType]='Number' AND [Number] IS NOT NULL AND [TextFa] IS NULL AND [TextEn] IS NULL AND [Bool] IS NULL) OR ([DataType]='Bool' AND [Bool] IS NOT NULL AND [TextFa] IS NULL AND [TextEn] IS NULL AND [Number] IS NULL) OR ([DataType] IN ('Select','MultiSelect') AND [TextFa] IS NULL AND [TextEn] IS NULL AND [Number] IS NULL AND [Bool] IS NULL)");});
            e.HasKey(x=>new{x.RequestId,x.ListingId,x.AttributeId});e.Property(x=>x.RequestId).HasMaxLength(32);e.Property(x=>x.ListingId).HasMaxLength(32);e.Property(x=>x.AttributeId).HasMaxLength(64);e.Property(x=>x.Key).HasMaxLength(150);e.Property(x=>x.DataType).HasMaxLength(16);e.Property(x=>x.LabelFa).HasMaxLength(200);e.Property(x=>x.LabelEn).HasMaxLength(200);e.Property(x=>x.Unit).HasMaxLength(80);e.Property(x=>x.UnitFa).HasMaxLength(80);e.Property(x=>x.UnitEn).HasMaxLength(80);e.Property(x=>x.TextFa).HasMaxLength(8000);e.Property(x=>x.TextEn).HasMaxLength(8000);e.Property(x=>x.Number).HasPrecision(28,8);e.HasMany(x=>x.Options).WithOne().HasForeignKey(x=>new{x.RequestId,x.ListingId,x.AttributeId}).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<SourcingRequestOption>(e=>{e.ToTable("SourcingRequestOptions");e.HasKey(x=>new{x.RequestId,x.ListingId,x.AttributeId,x.OptionId});e.Property(x=>x.RequestId).HasMaxLength(32);e.Property(x=>x.ListingId).HasMaxLength(32);e.Property(x=>x.AttributeId).HasMaxLength(64);e.Property(x=>x.OptionId).HasMaxLength(64);e.Property(x=>x.LabelFa).HasMaxLength(200);e.Property(x=>x.LabelEn).HasMaxLength(200);});
        b.Entity<SourcingRequestEvent>(e=>{e.ToTable("SourcingRequestEvents",t=>{t.HasCheckConstraint("CK_SourcingEvent_State","([StateBefore] IS NULL OR [StateBefore] IN ('Submitted','Reviewing','Unavailable','Cancelled')) AND [StateAfter] IN ('Submitted','Reviewing','Unavailable','Cancelled')");t.HasCheckConstraint("CK_SourcingEvent_Actor","[ActorKind] IN ('customer','staff','system')");});e.HasKey(x=>x.Id);e.Property(x=>x.RequestId).HasMaxLength(32);e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.ActorKind).HasMaxLength(16);e.Property(x=>x.StateBefore).HasMaxLength(16);e.Property(x=>x.StateAfter).HasMaxLength(16);e.Property(x=>x.ReasonCode).HasMaxLength(64);e.Property(x=>x.PublicMessage).HasMaxLength(500);e.HasOne<SourcingRequest>().WithMany().HasForeignKey(x=>x.RequestId).OnDelete(DeleteBehavior.Cascade);e.HasIndex(x=>new{x.RequestId,x.Id});});
        b.Entity<SourcingCommandReceipt>(e=>{e.ToTable("SourcingCommandReceipts",t=>t.HasCheckConstraint("CK_SourcingReceipt_Result","ISJSON([ResultJson])=1 AND DATALENGTH([ResultJson])<=16384"));e.HasKey(x=>new{x.ActorId,x.Operation,x.RequestId});e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.Operation).HasMaxLength(16);e.Property(x=>x.RequestId).HasMaxLength(32);e.Property(x=>x.TargetId).HasMaxLength(32);e.Property(x=>x.PayloadHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ResultJson).HasMaxLength(8192);});
    }
}
