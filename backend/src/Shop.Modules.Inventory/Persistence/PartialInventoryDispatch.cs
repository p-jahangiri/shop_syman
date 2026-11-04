using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;
namespace Shop.Modules.Inventory;

public sealed class PartialInventoryDispatch
{
    public string Id{get;set;}="";
    public string ReservationId{get;set;}="";
    public string OrderId{get;set;}="";
    public string OwnerId{get;set;}="";
    public string ActorId{get;set;}="";
    public string RequestId{get;set;}="";
    public int Sequence{get;set;}
    public int ReservationContract{get;set;}
    public string PayloadHash{get;set;}="";
    public string ResponseHash{get;set;}="";
    public string FingerprintBefore{get;set;}="";
    public string ReservationVersionAfter{get;set;}="";
    public StockReservationState StateAfter{get;set;}
    public DateTimeOffset RecordedAt{get;set;}
    public bool ContainsDemo{get;set;}
    public List<PartialInventoryDispatchLine> Lines{get;set;}=[];
    public List<PartialInventoryDispatchUnit> Units{get;set;}=[];
}
public sealed class PartialInventoryDispatchLine
{
    public string DispatchId{get;set;}="";
    public string LineKey{get;set;}="";
    public string VariantId{get;set;}="";
    public int Quantity{get;set;}
    public string TrackingMode{get;set;}="none";
    public long MovementId{get;set;}
}
public sealed class PartialInventoryDispatchUnit
{
    public string DispatchId{get;set;}="";
    public string ReservationId{get;set;}="";
    public string UnitId{get;set;}="";
    public string LineKey{get;set;}="";
    public string VariantId{get;set;}="";
    public string InventoryVersion{get;set;}="";
    public string? Serial{get;set;}
    public string? Imei1{get;set;}
    public string? Imei2{get;set;}
    public DateTimeOffset? WarrantyUntil{get;set;}
}
internal static class PartialInventoryDispatchModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<PartialInventoryDispatch>(e=>{
            e.ToTable("PartialDispatches",t=>{t.HasCheckConstraint("CK_PartialDispatch_Identity","LEN([Id])=32 AND LEN([ReservationId])=32 AND LEN([OrderId])=32 AND LEN([RequestId])=32 AND [ReservationContract] IN (1,2) AND [Sequence] BETWEEN 1 AND 64");t.HasCheckConstraint("CK_PartialDispatch_Evidence","LEN([PayloadHash])=64 AND LEN([ResponseHash])=64 AND LEN([FingerprintBefore])=64 AND LEN([ReservationVersionAfter])=12 AND [StateAfter] IN ('Allocated','Fulfilled')");});
            e.HasKey(x=>x.Id);e.HasAlternateKey(x=>new{x.Id,x.ReservationId});foreach(var n in new[]{"Id","ReservationId","OrderId","RequestId"})e.Property<string>(n).HasMaxLength(32);foreach(var n in new[]{"OwnerId","ActorId"})e.Property<string>(n).HasMaxLength(64);foreach(var n in new[]{"PayloadHash","ResponseHash","FingerprintBefore"})e.Property<string>(n).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ReservationVersionAfter).HasMaxLength(12).IsUnicode(false);e.Property(x=>x.StateAfter).HasConversion<string>().HasMaxLength(16).IsUnicode(false);
            e.HasIndex(x=>new{x.ActorId,x.RequestId}).IsUnique();e.HasIndex(x=>new{x.ReservationId,x.Sequence}).IsUnique();e.HasOne<StockReservation>().WithMany().HasForeignKey(x=>x.ReservationId).OnDelete(DeleteBehavior.Restrict);e.HasMany(x=>x.Lines).WithOne().HasForeignKey(x=>x.DispatchId).OnDelete(DeleteBehavior.Restrict);e.HasMany(x=>x.Units).WithOne().HasForeignKey(x=>new{x.DispatchId,x.ReservationId}).HasPrincipalKey(x=>new{x.Id,x.ReservationId}).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<PartialInventoryDispatchLine>(e=>{
            e.ToTable("PartialDispatchLines",t=>{t.HasCheckConstraint("CK_PartialDispatchLine_Quantity","[Quantity] BETWEEN 1 AND 1000000");t.HasCheckConstraint("CK_PartialDispatchLine_Mode","[TrackingMode] IN ('none','serial','imei')");});e.HasKey(x=>new{x.DispatchId,x.LineKey});e.HasAlternateKey(x=>new{x.DispatchId,x.LineKey,x.VariantId});e.Property(x=>x.DispatchId).HasMaxLength(32);foreach(var n in new[]{"LineKey","VariantId"})e.Property<string>(n).HasMaxLength(64);e.Property(x=>x.TrackingMode).HasMaxLength(8).IsUnicode(false);e.HasOne<StockMovement>().WithMany().HasForeignKey(x=>x.MovementId).OnDelete(DeleteBehavior.Restrict);e.HasOne<StockItem>().WithMany().HasForeignKey(x=>x.VariantId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<PartialInventoryDispatchUnit>(e=>{
            e.ToTable("PartialDispatchUnits",t=>t.HasCheckConstraint("CK_PartialDispatchUnit_Identity","LEN([UnitId])=32 AND LEN([InventoryVersion])=12 AND ([Serial] IS NOT NULL OR [Imei1] IS NOT NULL)"));e.HasKey(x=>new{x.DispatchId,x.UnitId});e.HasIndex(x=>new{x.ReservationId,x.UnitId}).IsUnique();foreach(var n in new[]{"DispatchId","ReservationId","UnitId"})e.Property<string>(n).HasMaxLength(32);foreach(var n in new[]{"LineKey","VariantId"})e.Property<string>(n).HasMaxLength(64);e.Property(x=>x.InventoryVersion).HasMaxLength(12).IsUnicode(false);e.Property(x=>x.Serial).HasMaxLength(100).IsUnicode(false);e.Property(x=>x.Imei1).HasMaxLength(15).IsUnicode(false);e.Property(x=>x.Imei2).HasMaxLength(15).IsUnicode(false);e.HasOne<PartialInventoryDispatchLine>().WithMany().HasForeignKey(x=>new{x.DispatchId,x.LineKey,x.VariantId}).HasPrincipalKey(x=>new{x.DispatchId,x.LineKey,x.VariantId}).OnDelete(DeleteBehavior.Restrict);e.HasOne<SerialUnit>().WithMany().HasForeignKey(x=>x.UnitId).OnDelete(DeleteBehavior.Restrict);
        });
    }
}
