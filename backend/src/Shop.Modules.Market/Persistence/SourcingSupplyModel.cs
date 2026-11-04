using Microsoft.EntityFrameworkCore;

namespace Shop.Modules.Market;

public sealed class SourcingSupplyTask
{
    public string Id {get;set;}="";
    public string RequestId {get;set;}="";
    public string OfferId {get;set;}="";
    public string AcceptanceId {get;set;}="";
    public string OwnerId {get;set;}="";
    public string TermsHash {get;set;}="";
    public string State {get;set;}="PendingSupply";
    public bool IsOpen {get;set;}=true;
    public bool ContainsDemo {get;set;}
    public string? SourceKind {get;set;}
    public string? SourceKey {get;set;}
    public string? SourceNameFa {get;set;}
    public string? SourceNameEn {get;set;}
    public string? Reference {get;set;}
    public DateTimeOffset? ActionAt {get;set;}
    public DateTimeOffset? ExpectedAt {get;set;}
    public string PublicMessageFa {get;set;}="";
    public string PublicMessageEn {get;set;}="";
    public string ProtectedNote {get;set;}="";
    public DateTimeOffset CreatedAt {get;set;}
    public DateTimeOffset ChangedAt {get;set;}
    public byte[] Version {get;set;}=[];
    public List<SourcingSupplyTaskLine> Lines {get;set;}=[];
}
public sealed class SourcingSupplyTaskLine
{
    public string TaskId {get;set;}="";
    public string OfferLineId {get;set;}="";
    public string VariantId {get;set;}="";
    public string ProductId {get;set;}="";
    public string Sku {get;set;}="";
    public string NameFa {get;set;}="";
    public string NameEn {get;set;}="";
    public string LabelFa {get;set;}="";
    public string LabelEn {get;set;}="";
    public string MaterialFingerprint {get;set;}="";
    public int RequiredQuantity {get;set;}
    public int ReceivedQuantity {get;set;}
}
public sealed class SourcingSupplyEvent
{
    public long Id {get;set;}
    public string TaskId {get;set;}="";
    public string ActorId {get;set;}="";
    public string ActorKind {get;set;}="staff";
    public string? StateBefore {get;set;}
    public string StateAfter {get;set;}="";
    public string ReceiptProgress {get;set;}="None";
    public string ReasonCode {get;set;}="";
    public string PublicMessageFa {get;set;}="";
    public string PublicMessageEn {get;set;}="";
    public string? SourceKind {get;set;}
    public string? SourceKey {get;set;}
    public string? SourceNameFa {get;set;}
    public string? SourceNameEn {get;set;}
    public string? Reference {get;set;}
    public string ProtectedNote {get;set;}="";
    public DateTimeOffset? ActionAt {get;set;}
    public DateTimeOffset? ExpectedAt {get;set;}
    public DateTimeOffset At {get;set;}
}
public sealed class SourcingSupplyCommandReceipt
{
    public string ActorId {get;set;}="";
    public string Operation {get;set;}="";
    public string CommandId {get;set;}="";
    public string RequestId {get;set;}="";
    public string TaskId {get;set;}="";
    public string PayloadHash {get;set;}="";
    public string ResultJson {get;set;}="";
    public bool ContainsDemo {get;set;}
    public DateTimeOffset CreatedAt {get;set;}
}
// An Inventory receipt can be projected into Market once. Its identity is an
// opaque contract value; there is deliberately no foreign-schema FK.
public sealed class SourcingSupplyReceiptApplication
{
    public string ReceiptId {get;set;}="";
    public string TaskId {get;set;}="";
    public DateTimeOffset At {get;set;}
}
internal static class SourcingSupplyModel
{
    private const string States="'PendingSupply','SupplierRequested','SupplierOrderRecorded','Cancelled','Failed'";
    internal static void Configure(ModelBuilder b)
    {
        b.Entity<SourcingSupplyTask>(e=>{
            e.ToTable("SourcingSupplyTasks",t=>{
                t.HasCheckConstraint("CK_SourcingSupply_State","[State] IN ("+States+")");
                t.HasCheckConstraint("CK_SourcingSupply_Open","([IsOpen]=1 AND [State] IN ('PendingSupply','SupplierRequested','SupplierOrderRecorded')) OR ([IsOpen]=0 AND [State] IN ('Cancelled','Failed'))");
                t.HasCheckConstraint("CK_SourcingSupply_Source","([SourceKind] IS NULL AND [SourceKey] IS NULL AND [SourceNameFa] IS NULL AND [SourceNameEn] IS NULL AND [Reference] IS NULL) OR ([SourceKind] IS NOT NULL AND [SourceKind] IN ('manual','csv') AND [SourceKey] IS NOT NULL AND [SourceNameFa] IS NOT NULL AND [SourceNameEn] IS NOT NULL)");
                t.HasCheckConstraint("CK_SourcingSupply_SourceState","[State] NOT IN ('SupplierRequested','SupplierOrderRecorded') OR [SourceKind] IS NOT NULL");
                t.HasCheckConstraint("CK_SourcingSupply_Ordered","[State]<>'SupplierOrderRecorded' OR [Reference] IS NOT NULL");
                t.HasCheckConstraint("CK_SourcingSupply_Dates","[ChangedAt]>=[CreatedAt]");
            });
            e.HasKey(x=>x.Id);foreach(var n in new[]{"Id","RequestId","OfferId","AcceptanceId"})e.Property<string>(n).HasMaxLength(32);e.Property(x=>x.OwnerId).HasMaxLength(64);e.Property(x=>x.TermsHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.State).HasMaxLength(24);e.Property(x=>x.Version).IsRowVersion();e.Property(x=>x.ProtectedNote).HasMaxLength(65536);
            Source(e);e.Property(x=>x.PublicMessageFa).HasMaxLength(500);e.Property(x=>x.PublicMessageEn).HasMaxLength(500);
            e.HasIndex(x=>x.AcceptanceId).IsUnique();e.HasIndex(x=>x.RequestId).IsUnique().HasFilter("[IsOpen] = 1");e.HasIndex(x=>new{x.CreatedAt,x.Id});e.HasIndex(x=>new{x.RequestId,x.CreatedAt,x.Id});
            e.HasOne<SourcingRequest>().WithMany().HasForeignKey(x=>x.RequestId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<SourcingOfferAcceptance>().WithMany().HasForeignKey(x=>x.OfferId).OnDelete(DeleteBehavior.Restrict);
            e.HasMany(x=>x.Lines).WithOne().HasForeignKey(x=>x.TaskId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<SourcingSupplyTaskLine>(e=>{
            e.ToTable("SourcingSupplyTaskLines",t=>t.HasCheckConstraint("CK_SourcingSupplyLine_Quantity","[RequiredQuantity] BETWEEN 1 AND 1000000 AND [ReceivedQuantity] BETWEEN 0 AND [RequiredQuantity]"));e.HasKey(x=>new{x.TaskId,x.OfferLineId});e.Property(x=>x.TaskId).HasMaxLength(32);e.Property(x=>x.OfferLineId).HasMaxLength(32);foreach(var n in new[]{"VariantId","ProductId"})e.Property<string>(n).HasMaxLength(64);e.Property(x=>x.Sku).HasMaxLength(80);foreach(var n in new[]{"NameFa","NameEn"})e.Property<string>(n).HasMaxLength(250);foreach(var n in new[]{"LabelFa","LabelEn"})e.Property<string>(n).HasMaxLength(2000);e.Property(x=>x.MaterialFingerprint).HasMaxLength(64).IsUnicode(false);
        });
        b.Entity<SourcingSupplyEvent>(e=>{
            e.ToTable("SourcingSupplyEvents",t=>{t.HasCheckConstraint("CK_SourcingSupplyEvent_State","([StateBefore] IS NULL OR [StateBefore] IN ("+States+")) AND [StateAfter] IN ("+States+")");t.HasCheckConstraint("CK_SourcingSupplyEvent_Progress","[ReceiptProgress] IN ('None','Partial','Complete')");t.HasCheckConstraint("CK_SourcingSupplyEvent_Actor","[ActorKind] IN ('staff','customer','system')");});
            e.HasKey(x=>x.Id);e.Property(x=>x.TaskId).HasMaxLength(32);e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.ActorKind).HasMaxLength(16);e.Property(x=>x.StateBefore).HasMaxLength(24);e.Property(x=>x.StateAfter).HasMaxLength(24);e.Property(x=>x.ReceiptProgress).HasMaxLength(12);e.Property(x=>x.ReasonCode).HasMaxLength(64);Source(e);e.Property(x=>x.PublicMessageFa).HasMaxLength(500);e.Property(x=>x.PublicMessageEn).HasMaxLength(500);e.Property(x=>x.ProtectedNote).HasMaxLength(65536);e.HasIndex(x=>new{x.TaskId,x.Id});e.HasOne<SourcingSupplyTask>().WithMany().HasForeignKey(x=>x.TaskId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<SourcingSupplyCommandReceipt>(e=>{
            e.ToTable("SourcingSupplyCommandReceipts",t=>{t.HasCheckConstraint("CK_SourcingSupplyReceipt_Operation","[Operation] IN ('start','requested','ordered','progress','cancel','fail')");t.HasCheckConstraint("CK_SourcingSupplyReceipt_Result","ISJSON([ResultJson])=1 AND DATALENGTH([ResultJson])<=16384");});e.HasKey(x=>new{x.ActorId,x.Operation,x.CommandId});e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.Operation).HasMaxLength(16);foreach(var n in new[]{"CommandId","RequestId","TaskId"})e.Property<string>(n).HasMaxLength(32);e.Property(x=>x.PayloadHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ResultJson).HasMaxLength(8192);
        });
        b.Entity<SourcingSupplyReceiptApplication>(e=>{e.ToTable("SourcingSupplyReceiptApplications");e.HasKey(x=>x.ReceiptId);e.Property(x=>x.ReceiptId).HasMaxLength(32);e.Property(x=>x.TaskId).HasMaxLength(32);e.HasIndex(x=>x.TaskId);e.HasOne<SourcingSupplyTask>().WithMany().HasForeignKey(x=>x.TaskId).OnDelete(DeleteBehavior.Restrict);});
    }
    private static void Source<TEntity>(Microsoft.EntityFrameworkCore.Metadata.Builders.EntityTypeBuilder<TEntity> e)where TEntity:class
    {
        e.Property<string?>("SourceKind").HasMaxLength(8);e.Property<string?>("SourceKey").HasMaxLength(120).UseCollation("Latin1_General_100_BIN2");e.Property<string?>("SourceNameFa").HasMaxLength(200);e.Property<string?>("SourceNameEn").HasMaxLength(200);e.Property<string?>("Reference").HasMaxLength(200).UseCollation("Latin1_General_100_BIN2");
    }
}
