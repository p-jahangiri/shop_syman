using Microsoft.EntityFrameworkCore;

namespace Shop.Modules.Inventory;

public sealed class SourcingStockAllocation
{
    public string Id{get;set;}="";
    public string RequestId{get;set;}="";
    public string TaskId{get;set;}="";
    public string OfferId{get;set;}="";
    public string AcceptanceId{get;set;}="";
    public string OwnerId{get;set;}="";
    public string TermsHash{get;set;}="";
    public string State{get;set;}="Active";
    public bool IsActive{get;set;}=true;
    public bool ContainsDemo{get;set;}
    public DateTimeOffset CreatedAt{get;set;}
    public DateTimeOffset ChangedAt{get;set;}
    public DateTimeOffset ExpiresAt{get;set;}
    public byte[] Version{get;set;}=[];
    public List<SourcingStockAllocationLine> Lines{get;set;}=[];
}
public sealed class SourcingStockAllocationLine
{
    public string AllocationId{get;set;}="";
    public string OfferLineId{get;set;}="";
    public string VariantId{get;set;}="";
    public int Quantity{get;set;}
    public string TrackingMode{get;set;}="none";
}
public sealed class SourcingAllocationCommand
{
    public string ActorId{get;set;}="";
    public string Operation{get;set;}="";
    public string CommandId{get;set;}="";
    public string AllocationId{get;set;}="";
    public string RequestId{get;set;}="";
    public string TaskId{get;set;}="";
    public string PayloadHash{get;set;}="";
    public string ResultJson{get;set;}="";
    public bool ContainsDemo{get;set;}
    public DateTimeOffset At{get;set;}
}
public sealed class SourcingAllocationEvent
{
    public long Id{get;set;}
    public string AllocationId{get;set;}="";
    public string State{get;set;}="";
    public string ActorId{get;set;}="";
    public string Reason{get;set;}="";
    public DateTimeOffset At{get;set;}
}
public sealed class SerialUnitClaim
{
    public string Id{get;set;}=Guid.NewGuid().ToString("N");
    public string UnitId{get;set;}="";
    public string VariantId{get;set;}="";
    public string OriginAllocationId{get;set;}="";
    public string OfferLineId{get;set;}="";
    public string State{get;set;}="AllocationHeld";
    public bool IsActive{get;set;}=true;
    public string? ReservationId{get;set;}
    public string? OrderId{get;set;}
    public string? OrderLineId{get;set;}
    public DateTimeOffset CreatedAt{get;set;}
    public DateTimeOffset ChangedAt{get;set;}
    public byte[] Version{get;set;}=[];
}
public static class SourcingAllocationModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<SourcingStockAllocation>(e=>{
            e.ToTable("SourcingAllocations",t=>{t.HasCheckConstraint("CK_SourcingAllocation_State","[State] IN ('Active','Released','Expired','Transferred')");t.HasCheckConstraint("CK_SourcingAllocation_Active","([IsActive]=1 AND [State]='Active') OR ([IsActive]=0 AND [State]<>'Active')");t.HasCheckConstraint("CK_SourcingAllocation_Dates","[ExpiresAt]>[CreatedAt] AND [ChangedAt]>=[CreatedAt]");});e.HasKey(x=>x.Id);foreach(var name in new[]{"Id","RequestId","TaskId","OfferId","AcceptanceId"})e.Property<string>(name).HasMaxLength(32);e.Property(x=>x.OwnerId).HasMaxLength(64);e.Property(x=>x.TermsHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.State).HasMaxLength(16);e.Property(x=>x.Version).IsRowVersion();e.HasIndex(x=>x.AcceptanceId).IsUnique().HasFilter("[IsActive] = 1");e.HasIndex(x=>new{x.State,x.ExpiresAt,x.Id});e.HasIndex(x=>new{x.OwnerId,x.Id});e.HasMany(x=>x.Lines).WithOne().HasForeignKey(x=>x.AllocationId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<SourcingStockAllocationLine>(e=>{e.ToTable("SourcingAllocationLines",t=>{t.HasCheckConstraint("CK_SourcingAllocationLine_Quantity","[Quantity] BETWEEN 1 AND 1000000");t.HasCheckConstraint("CK_SourcingAllocationLine_Mode","[TrackingMode] IN ('none','serial','imei')");});e.HasKey(x=>new{x.AllocationId,x.OfferLineId});e.Property(x=>x.AllocationId).HasMaxLength(32);e.Property(x=>x.OfferLineId).HasMaxLength(32);e.Property(x=>x.VariantId).HasMaxLength(64);e.Property(x=>x.TrackingMode).HasMaxLength(8);e.HasOne<StockItem>().WithMany().HasForeignKey(x=>x.VariantId).OnDelete(DeleteBehavior.Restrict);});
        b.Entity<SerialUnitClaim>(e=>{
            e.ToTable("SerialUnitClaims",t=>{t.HasCheckConstraint("CK_SerialUnitClaim_State","[State] IN ('AllocationHeld','OrderHeld','Released','Expired','Assigned','Fulfilled')");t.HasCheckConstraint("CK_SerialUnitClaim_Active","([IsActive]=1 AND [State] IN ('AllocationHeld','OrderHeld')) OR ([IsActive]=0 AND [State] IN ('Released','Expired','Assigned','Fulfilled'))");t.HasCheckConstraint("CK_SerialUnitClaim_Order","([ReservationId] IS NULL AND [OrderId] IS NULL AND [OrderLineId] IS NULL AND [State] NOT IN ('OrderHeld','Assigned','Fulfilled')) OR ([ReservationId] IS NOT NULL AND [OrderId] IS NOT NULL AND [OrderLineId] IS NOT NULL AND [State]<>'AllocationHeld')");});e.HasKey(x=>x.Id);foreach(var name in new[]{"Id","UnitId","OriginAllocationId","OfferLineId","ReservationId","OrderId","OrderLineId"})e.Property<string>(name).HasMaxLength(32);e.Property(x=>x.VariantId).HasMaxLength(64);e.Property(x=>x.State).HasMaxLength(16);e.Property(x=>x.Version).IsRowVersion();e.HasIndex(x=>x.UnitId).IsUnique().HasFilter("[IsActive] = 1");e.HasIndex(x=>new{x.OriginAllocationId,x.IsActive,x.UnitId});e.HasIndex(x=>new{x.ReservationId,x.IsActive,x.UnitId});e.HasOne<SerialUnit>().WithMany().HasForeignKey(x=>x.UnitId).OnDelete(DeleteBehavior.Restrict);e.HasOne<SourcingStockAllocationLine>().WithMany().HasForeignKey(x=>new{x.OriginAllocationId,x.OfferLineId}).HasPrincipalKey(x=>new{x.AllocationId,x.OfferLineId}).OnDelete(DeleteBehavior.Restrict);e.HasOne<StockReservation>().WithMany().HasForeignKey(x=>x.ReservationId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<SourcingAllocationCommand>(e=>{e.ToTable("SourcingAllocationCommands",t=>{t.HasCheckConstraint("CK_SourcingAllocationCommand_Operation","[Operation] IN ('allocate','release')");t.HasCheckConstraint("CK_SourcingAllocationCommand_Result","ISJSON([ResultJson])=1 AND DATALENGTH([ResultJson])<=16384");});e.HasKey(x=>new{x.ActorId,x.Operation,x.CommandId});e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.Operation).HasMaxLength(16);foreach(var name in new[]{"CommandId","AllocationId","RequestId","TaskId"})e.Property<string>(name).HasMaxLength(32);e.Property(x=>x.PayloadHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ResultJson).HasMaxLength(8192);});
        b.Entity<SourcingAllocationEvent>(e=>{e.ToTable("SourcingAllocationEvents",t=>t.HasCheckConstraint("CK_SourcingAllocationEvent_State","[State] IN ('Active','Released','Expired','Transferred')"));e.HasKey(x=>x.Id);e.Property(x=>x.AllocationId).HasMaxLength(32);e.Property(x=>x.State).HasMaxLength(16);e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.Reason).HasMaxLength(500);e.HasIndex(x=>new{x.AllocationId,x.Id});e.HasOne<SourcingStockAllocation>().WithMany().HasForeignKey(x=>x.AllocationId).OnDelete(DeleteBehavior.Restrict);});
    }
}
