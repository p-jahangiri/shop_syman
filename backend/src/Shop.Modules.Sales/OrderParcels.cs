using Microsoft.EntityFrameworkCore;
namespace Shop.Modules.Sales;

public sealed class OrderFulfillmentHeader
{
    public string OrderId{get;set;}="";
    public string OwnerId{get;set;}="";
    public string ReservationId{get;set;}="";
    public int ReservationContract{get;set;}
    public long LastParcelNumber{get;set;}
    public DateTimeOffset CreatedAt{get;set;}
    public DateTimeOffset ChangedAt{get;set;}
    public DateTimeOffset? FirstDispatchRecordedAt{get;set;}
    public bool ContainsDemo{get;set;}
    public byte[] Version{get;set;}=[];
}
public sealed class OrderParcel
{
    public string Id{get;set;}="";
    public string OrderId{get;set;}="";
    public string OwnerId{get;set;}="";
    public string ReservationId{get;set;}="";
    public long Number{get;set;}
    public string Reference{get;set;}="";
    public string State{get;set;}="packed";
    public int PackingRevision{get;set;}=1;
    public string PackingFingerprint{get;set;}="";
    public DateTimeOffset PackedAt{get;set;}
    public DateTimeOffset ChangedAt{get;set;}
    public DateTimeOffset? DispatchedAt{get;set;}
    public DateTimeOffset? DeliveredAt{get;set;}
    public DateTimeOffset? VoidedAt{get;set;}
    public string? CarrierNameFa{get;set;}
    public string? CarrierNameEn{get;set;}
    public string? TrackingNumber{get;set;}
    public string? InventoryDispatchHash{get;set;}
    public bool ContainsDemo{get;set;}
    public byte[] Version{get;set;}=[];
}
public sealed class OrderParcelLine
{
    public string ParcelId{get;set;}="";
    public int PackingRevision{get;set;}
    public string LineKey{get;set;}="";
    public string VariantId{get;set;}="";
    public string ProductId{get;set;}="";
    public string Sku{get;set;}="";
    public string Name{get;set;}="";
    public string Label{get;set;}="";
    public string Warranty{get;set;}="";
    public string TrackingMode{get;set;}="none";
    public int Quantity{get;set;}
}
public sealed class OrderParcelUnit
{
    public string ParcelId{get;set;}="";
    public int PackingRevision{get;set;}
    public string UnitId{get;set;}="";
    public string LineKey{get;set;}="";
    public string VariantId{get;set;}="";
    public string InventoryVersion{get;set;}="";
    public string? Serial{get;set;}
    public string? Imei1{get;set;}
    public string? Imei2{get;set;}
    public DateTimeOffset? WarrantyUntil{get;set;}
}
// Current packing claims are mutable; the referenced revision snapshots are not.
public sealed class OrderParcelUnitClaim
{
    public string UnitId{get;set;}="";
    public string ParcelId{get;set;}="";
    public int PackingRevision{get;set;}
    public string OrderId{get;set;}="";
}
public sealed class OrderParcelCommand
{
    public string ActorId{get;set;}="";
    public string CommandId{get;set;}="";
    public string OrderId{get;set;}="";
    public string ParcelId{get;set;}="";
    public int PackingRevision{get;set;}
    public string Action{get;set;}="";
    public string PayloadHash{get;set;}="";
    public string ResponseHash{get;set;}="";
    public byte[] ProtectedResult{get;set;}=[];
    public DateTimeOffset RecordedAt{get;set;}
    public bool ContainsDemo{get;set;}
}
public sealed partial class SalesDbContext
{
    public DbSet<OrderFulfillmentHeader> FulfillmentHeaders=>Set<OrderFulfillmentHeader>();
    public DbSet<OrderParcel> Parcels=>Set<OrderParcel>();
    public DbSet<OrderParcelLine> ParcelLines=>Set<OrderParcelLine>();
    public DbSet<OrderParcelUnit> ParcelUnits=>Set<OrderParcelUnit>();
    public DbSet<OrderParcelUnitClaim> ParcelUnitClaims=>Set<OrderParcelUnitClaim>();
    public DbSet<OrderParcelCommand> ParcelCommands=>Set<OrderParcelCommand>();
}
internal static class OrderParcelModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<OrderFulfillmentHeader>(e=>{
            e.ToTable("FulfillmentHeaders",t=>{t.HasCheckConstraint("CK_FulfillmentHeader_Identity","LEN([OrderId])=32 AND LEN([ReservationId])=32 AND [ReservationContract] IN (1,2) AND [LastParcelNumber]>=0");t.HasCheckConstraint("CK_FulfillmentHeader_Dates","[ChangedAt]>=[CreatedAt] AND ([FirstDispatchRecordedAt] IS NULL OR ([FirstDispatchRecordedAt]>=[CreatedAt] AND [FirstDispatchRecordedAt]<=[ChangedAt]))");});e.HasKey(x=>x.OrderId);e.HasAlternateKey(x=>new{x.OrderId,x.OwnerId,x.ReservationId});e.Property(x=>x.OrderId).HasMaxLength(32);e.Property(x=>x.OwnerId).HasMaxLength(64);e.Property(x=>x.ReservationId).HasMaxLength(32);e.Property(x=>x.Version).IsRowVersion();e.HasOne<SalesOrder>().WithOne().HasForeignKey<OrderFulfillmentHeader>(x=>x.OrderId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<OrderParcel>(e=>{
            e.ToTable("OrderParcels",t=>{t.HasCheckConstraint("CK_OrderParcel_Identity","LEN([Id])=32 AND [Number]>0 AND [PackingRevision] BETWEEN 1 AND 1000000 AND LEN([PackingFingerprint])=64");t.HasCheckConstraint("CK_OrderParcel_Stage","([State]='packed' AND [DispatchedAt] IS NULL AND [DeliveredAt] IS NULL AND [VoidedAt] IS NULL AND [CarrierNameFa] IS NULL AND [CarrierNameEn] IS NULL AND [TrackingNumber] IS NULL AND [InventoryDispatchHash] IS NULL) OR ([State]='void' AND [DispatchedAt] IS NULL AND [DeliveredAt] IS NULL AND [VoidedAt] IS NOT NULL AND [CarrierNameFa] IS NULL AND [CarrierNameEn] IS NULL AND [TrackingNumber] IS NULL AND [InventoryDispatchHash] IS NULL) OR ([State]='dispatched' AND [DispatchedAt] IS NOT NULL AND [DeliveredAt] IS NULL AND [VoidedAt] IS NULL AND [CarrierNameFa] IS NOT NULL AND [CarrierNameEn] IS NOT NULL AND [InventoryDispatchHash] IS NOT NULL AND LEN([InventoryDispatchHash])=64) OR ([State]='delivered' AND [DispatchedAt] IS NOT NULL AND [DeliveredAt] IS NOT NULL AND [VoidedAt] IS NULL AND [CarrierNameFa] IS NOT NULL AND [CarrierNameEn] IS NOT NULL AND [InventoryDispatchHash] IS NOT NULL AND LEN([InventoryDispatchHash])=64)");t.HasCheckConstraint("CK_OrderParcel_Dates","[ChangedAt]>=[PackedAt] AND ([DispatchedAt] IS NULL OR ([DispatchedAt]>=[PackedAt] AND [DispatchedAt]<=[ChangedAt])) AND ([DeliveredAt] IS NULL OR ([DeliveredAt]>=[DispatchedAt] AND [DeliveredAt]<=[ChangedAt])) AND ([VoidedAt] IS NULL OR ([VoidedAt]>=[PackedAt] AND [VoidedAt]<=[ChangedAt]))");});e.HasKey(x=>x.Id);e.HasAlternateKey(x=>new{x.Id,x.OrderId});foreach(var n in new[]{"Id","OrderId","ReservationId"})e.Property<string>(n).HasMaxLength(32);e.Property(x=>x.OwnerId).HasMaxLength(64);e.Property(x=>x.Reference).HasMaxLength(120);e.Property(x=>x.State).HasMaxLength(12).IsUnicode(false);e.Property(x=>x.PackingFingerprint).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.InventoryDispatchHash).HasMaxLength(64).IsUnicode(false);foreach(var n in new[]{"CarrierNameFa","CarrierNameEn","TrackingNumber"})e.Property<string>(n).HasMaxLength(120);e.Property(x=>x.Version).IsRowVersion();e.HasIndex(x=>new{x.OrderId,x.Number}).IsUnique();e.HasIndex(x=>new{x.OrderId,x.State,x.Id});e.HasOne<OrderFulfillmentHeader>().WithMany().HasForeignKey(x=>new{x.OrderId,x.OwnerId,x.ReservationId}).HasPrincipalKey(x=>new{x.OrderId,x.OwnerId,x.ReservationId}).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<OrderParcelLine>(e=>{
            e.ToTable("ParcelLineSnapshots",t=>{t.HasCheckConstraint("CK_ParcelLine_Quantity","[Quantity] BETWEEN 1 AND 1000000 AND [PackingRevision] BETWEEN 1 AND 1000000");t.HasCheckConstraint("CK_ParcelLine_Mode","[TrackingMode] IN ('none','serial','imei')");});e.HasKey(x=>new{x.ParcelId,x.PackingRevision,x.LineKey});e.HasAlternateKey(x=>new{x.ParcelId,x.PackingRevision,x.LineKey,x.VariantId});e.Property(x=>x.ParcelId).HasMaxLength(32);foreach(var n in new[]{"LineKey","VariantId","ProductId"})e.Property<string>(n).HasMaxLength(64);e.Property(x=>x.Sku).HasMaxLength(80);e.Property(x=>x.Name).HasMaxLength(250);e.Property(x=>x.TrackingMode).HasMaxLength(8).IsUnicode(false);e.HasOne<OrderParcel>().WithMany().HasForeignKey(x=>x.ParcelId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<OrderParcelUnit>(e=>{
            e.ToTable("ParcelUnitSnapshots",t=>t.HasCheckConstraint("CK_ParcelUnit_Identity","LEN([UnitId])=32 AND LEN([InventoryVersion])=12 AND [PackingRevision] BETWEEN 1 AND 1000000 AND ([Serial] IS NOT NULL OR [Imei1] IS NOT NULL)"));e.HasKey(x=>new{x.ParcelId,x.PackingRevision,x.UnitId});foreach(var n in new[]{"ParcelId","UnitId"})e.Property<string>(n).HasMaxLength(32);foreach(var n in new[]{"LineKey","VariantId"})e.Property<string>(n).HasMaxLength(64);e.Property(x=>x.InventoryVersion).HasMaxLength(12).IsUnicode(false);e.Property(x=>x.Serial).HasMaxLength(100).IsUnicode(false);e.Property(x=>x.Imei1).HasMaxLength(15).IsUnicode(false);e.Property(x=>x.Imei2).HasMaxLength(15).IsUnicode(false);e.HasOne<OrderParcelLine>().WithMany().HasForeignKey(x=>new{x.ParcelId,x.PackingRevision,x.LineKey,x.VariantId}).HasPrincipalKey(x=>new{x.ParcelId,x.PackingRevision,x.LineKey,x.VariantId}).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<OrderParcelUnitClaim>(e=>{
            e.ToTable("ParcelUnitClaims");e.HasKey(x=>x.UnitId);foreach(var n in new[]{"UnitId","ParcelId","OrderId"})e.Property<string>(n).HasMaxLength(32);e.HasIndex(x=>new{x.OrderId,x.ParcelId});e.HasOne<OrderParcelUnit>().WithMany().HasForeignKey(x=>new{x.ParcelId,x.PackingRevision,x.UnitId}).OnDelete(DeleteBehavior.Restrict);e.HasOne<OrderParcel>().WithMany().HasForeignKey(x=>new{x.ParcelId,x.OrderId}).HasPrincipalKey(x=>new{x.Id,x.OrderId}).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<OrderParcelCommand>(e=>{
            e.ToTable("ParcelCommands",t=>{t.HasCheckConstraint("CK_ParcelCommand_Identity","LEN([CommandId])=32 AND LEN([PayloadHash])=64 AND LEN([ResponseHash])=64 AND [PackingRevision] BETWEEN 1 AND 1000000 AND [Action] IN ('pack','repack','void','dispatch','deliver')");t.HasCheckConstraint("CK_ParcelCommand_ProtectedLength","DATALENGTH([ProtectedResult]) BETWEEN 1 AND 8388608");});e.HasKey(x=>new{x.ActorId,x.CommandId});e.Property(x=>x.ActorId).HasMaxLength(64);foreach(var n in new[]{"CommandId","OrderId","ParcelId"})e.Property<string>(n).HasMaxLength(32);e.Property(x=>x.Action).HasMaxLength(8).IsUnicode(false);e.Property(x=>x.PayloadHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ResponseHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ProtectedResult).HasMaxLength(8388608);e.HasIndex(x=>new{x.ParcelId,x.PackingRevision,x.Action}).IsUnique();e.HasOne<OrderParcel>().WithMany().HasForeignKey(x=>new{x.ParcelId,x.OrderId}).HasPrincipalKey(x=>new{x.Id,x.OrderId}).OnDelete(DeleteBehavior.Restrict);
        });
    }
    public static void Guard(SalesDbContext db)
    {
        foreach(var entry in db.ChangeTracker.Entries()){
            if((entry.Entity is OrderParcelLine or OrderParcelUnit or OrderParcelCommand)&&(entry.State is EntityState.Modified or EntityState.Deleted))throw new InvalidOperationException("Parcel packing snapshots and command receipts are immutable.");
            if(entry.Entity is OrderFulfillmentHeader&& (entry.State==EntityState.Deleted||entry.State==EntityState.Modified&&new[]{"OrderId","OwnerId","ReservationId","ReservationContract","CreatedAt","ContainsDemo"}.Any(n=>entry.Property(n).IsModified)))throw new InvalidOperationException("The selected fulfillment identity must be retained.");
            if(entry.Entity is OrderFulfillmentHeader&&entry.State==EntityState.Modified&&entry.Property("FirstDispatchRecordedAt").IsModified&&entry.Property("FirstDispatchRecordedAt").OriginalValue is not null)throw new InvalidOperationException("The first warehouse dispatch record cannot be rewritten.");
            if(entry.Entity is OrderParcel&& (entry.State==EntityState.Deleted||entry.State==EntityState.Modified&&new[]{"Id","OrderId","OwnerId","ReservationId","Number","Reference","ContainsDemo"}.Any(n=>entry.Property(n).IsModified)))throw new InvalidOperationException("Parcel identity and reference must be retained.");
            if(entry.Entity is OrderParcel parcel&&entry.State==EntityState.Modified&&new[]{"PackingRevision","PackedAt","PackingFingerprint"}.Any(n=>entry.Property(n).IsModified)){
                if(entry.Property("State").OriginalValue?.ToString()!="packed"||parcel.State!="packed"||parcel.PackingRevision!=(int)entry.Property("PackingRevision").OriginalValue!+1)throw new InvalidOperationException("Only explicit repacking may append a packing revision before dispatch.");
            }
            if(entry.Entity is OrderParcel&&entry.State==EntityState.Modified){
                var before=entry.Property("State").OriginalValue?.ToString();var after=entry.Property("State").CurrentValue?.ToString();
                if(before is "void"or"delivered"||before=="dispatched"&&(after!="delivered"||entry.Properties.Any(p=>p.IsModified&&p.Metadata.Name is not("State"or"DeliveredAt"or"ChangedAt"))))throw new InvalidOperationException("A warehouse hand-off and its delivered history cannot be rewritten.");
                if(before=="packed"&&after is not("packed"or"void"or"dispatched"))throw new InvalidOperationException("Use an explicit valid parcel transition.");
            }
        }
    }
}
