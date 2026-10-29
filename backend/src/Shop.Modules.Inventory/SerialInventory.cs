using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;

namespace Shop.Modules.Inventory;

public sealed class SerialUnit
{
    public string Id{get;set;}=Guid.NewGuid().ToString("N");
    public string VariantId{get;set;}="";
    public string? Serial{get;set;}
    public string? Imei1{get;set;}
    public string? Imei2{get;set;}
    public string State{get;set;}="available";
    public string? ReservationId{get;set;}
    public string? OrderId{get;set;}
    public string? OrderLineId{get;set;}
    public DateTimeOffset? WarrantyUntil{get;set;}
    public DateTimeOffset CreatedAt{get;set;}
    public DateTimeOffset ChangedAt{get;set;}
    public byte[] Version{get;set;}=[];
}
public sealed class SerialIdentifier
{
    public string Key{get;set;}="";
    public string UnitId{get;set;}="";
}
public sealed class SerialUnitEvent
{
    public long Id{get;set;}
    public string UnitId{get;set;}="";
    public string State{get;set;}="";
    public string ActorId{get;set;}="";
    public string Reason{get;set;}="";
    public string? OrderId{get;set;}
    public DateTimeOffset At{get;set;}
}
public sealed class SerialCommand
{
    public string ActorId{get;set;}="";
    public string RequestId{get;set;}="";
    public string PayloadHash{get;set;}="";
    public string ResponseJson{get;set;}="";
    public DateTimeOffset At{get;set;}
}
public sealed record SerialModeInput(string? Mode,string? Version,string? RequestId);
public sealed record SerialUnitInput(string? Serial=null,string? Imei1=null,string? Imei2=null);
public sealed record SerialReceiptInput(SerialUnitInput[]? Units,string? Reason,string? Version,string? RequestId);
public sealed record SerialRetireInput(string? UnitVersion,string? Reason,string? Version,string? RequestId);
public sealed record SerialStock(string VariantId,string Mode,int OnHand,int Reserved,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? Version);
public sealed record SerialUnitData(string Id,string VariantId,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? Serial,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? Imei1,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? Imei2,string State,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? OrderId,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? ReservationId,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]DateTimeOffset? WarrantyUntil,DateTimeOffset CreatedAt,DateTimeOffset ChangedAt,string Version);
public sealed record SerialCommandResult(int SchemaVersion,SerialStock Stock,SerialUnitData[] Units);
public sealed record SerialUnitPage(int SchemaVersion,int PageSize,SerialStock Stock,SerialUnitData[] Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? NextCursor);
public sealed record SerialHistoryEntry(string Id,string UnitId,string State,string ActorId,string Reason,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? OrderId,DateTimeOffset At);
public sealed record SerialHistoryPage(int SchemaVersion,int PageSize,SerialHistoryEntry[] Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? NextBefore);
public interface IAdminSerialReader
{
    Task<SerialUnitPage> PageAsync(SerialPageQuery query,string? cursor,CancellationToken ct);
    Task<SerialHistoryPage> HistoryAsync(string variantId,string unitId,string? before,CancellationToken ct);
}
public interface IAdminSerialV2Reader
{
    Task<SerialUnitPageV2> PageAsync(SerialPageQuery query,string? cursor,CancellationToken ct);
}

internal static class SerialInventoryModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<StockItem>().Property(s=>s.TrackingMode).HasMaxLength(8).HasDefaultValue("none");
        b.Entity<StockItem>().ToTable(t=>t.HasCheckConstraint("CK_Stock_TrackingMode","[TrackingMode] IN ('none','serial','imei')"));
        b.Entity<SerialUnit>(e=>{e.ToTable("SerialUnits",t=>{t.HasCheckConstraint("CK_SerialUnit_State","[State] IN ('available','assigned','delivered','retired')");t.HasCheckConstraint("CK_SerialUnit_Identity","[Serial] IS NOT NULL OR [Imei1] IS NOT NULL");t.HasCheckConstraint("CK_SerialUnit_Order","([State] IN ('available','retired') AND [ReservationId] IS NULL AND [OrderId] IS NULL AND [WarrantyUntil] IS NULL) OR ([State] IN ('assigned','delivered') AND [ReservationId] IS NOT NULL AND [OrderId] IS NOT NULL)");});e.HasKey(u=>u.Id);e.Property(u=>u.Id).HasMaxLength(32);e.Property(u=>u.VariantId).HasMaxLength(64);e.Property(u=>u.Serial).HasMaxLength(100).IsUnicode(false);e.Property(u=>u.Imei1).HasMaxLength(15).IsUnicode(false);e.Property(u=>u.Imei2).HasMaxLength(15).IsUnicode(false);e.Property(u=>u.State).HasMaxLength(12);e.Property(u=>u.ReservationId).HasMaxLength(32);e.Property(u=>u.OrderId).HasMaxLength(32);e.Property(u=>u.Version).IsRowVersion();e.HasIndex(u=>new{u.VariantId,u.State,u.Id});e.HasIndex(u=>new{u.ReservationId,u.VariantId,u.State});e.HasOne<StockItem>().WithMany().HasForeignKey(u=>u.VariantId).OnDelete(DeleteBehavior.Restrict);e.HasOne<StockReservation>().WithMany().HasForeignKey(u=>u.ReservationId).OnDelete(DeleteBehavior.Restrict);});
        b.Entity<SerialIdentifier>(e=>{e.ToTable("SerialIdentifiers");e.HasKey(x=>x.Key);e.Property(x=>x.Key).HasMaxLength(170).IsUnicode(false);e.Property(x=>x.UnitId).HasMaxLength(32);e.HasIndex(x=>x.UnitId);e.HasOne<SerialUnit>().WithMany().HasForeignKey(x=>x.UnitId).OnDelete(DeleteBehavior.Restrict);});
        b.Entity<SerialUnitEvent>(e=>{e.ToTable("SerialUnitEvents");e.HasKey(x=>x.Id);e.Property(x=>x.UnitId).HasMaxLength(32);e.Property(x=>x.State).HasMaxLength(12);e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.Reason).HasMaxLength(500);e.Property(x=>x.OrderId).HasMaxLength(32);e.HasIndex(x=>new{x.UnitId,x.Id});e.HasOne<SerialUnit>().WithMany().HasForeignKey(x=>x.UnitId).OnDelete(DeleteBehavior.Restrict);});
        b.Entity<SerialCommand>(e=>{e.ToTable("SerialCommands",t=>t.HasCheckConstraint("CK_SerialCommand_Response","ISJSON([ResponseJson])=1 AND DATALENGTH([ResponseJson])<=262144"));e.HasKey(x=>new{x.ActorId,x.RequestId});e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.RequestId).HasMaxLength(32);e.Property(x=>x.PayloadHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ResponseJson).HasColumnType("nvarchar(max)");});
    }
}
