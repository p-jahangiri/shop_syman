using Microsoft.EntityFrameworkCore;

namespace Shop.Modules.Sales;
public sealed class OrderShipment
{
    public string Id { get; set; } = "";
    public string OrderId { get; set; } = "";
    public string OwnerId { get; set; } = "";
    public string State { get; set; } = "packed";
    public int PackingRevision { get; set; } = 1;
    public string ReservationId { get; set; } = "";
    public string InventoryFingerprint { get; set; } = "";
    public DateTimeOffset PackedAt { get; set; }
    public DateTimeOffset? DispatchedAt { get; set; }
    public DateTimeOffset? DeliveredAt { get; set; }
    public DateTimeOffset ChangedAt { get; set; }
    public string? CarrierNameFa { get; set; }
    public string? CarrierNameEn { get; set; }
    public string? TrackingNumber { get; set; }
    public bool ContainsDemo { get; set; }
    public byte[] Version { get; set; } = [];
    public List<OrderShipmentLine> Lines { get; set; } = [];
    public List<OrderShipmentUnit> Units { get; set; } = [];
}
public sealed class OrderShipmentLine
{
    public int PackingRevision { get; set; }
    public string ShipmentId { get; set; } = "";
    public string LineKey { get; set; } = "";
    public string VariantId { get; set; } = "";
    public string ProductId { get; set; } = "";
    public string Sku { get; set; } = "";
    public string Name { get; set; } = "";
    public string Label { get; set; } = "";
    public string Warranty { get; set; } = "";
    public int Quantity { get; set; }
    public string TrackingMode { get; set; } = "none";
}
public sealed class OrderShipmentUnit
{
    public int PackingRevision { get; set; }
    public string ShipmentId { get; set; } = "";
    public string UnitId { get; set; } = "";
    public string LineKey { get; set; } = "";
    public string VariantId { get; set; } = "";
    public string InventoryVersion { get; set; } = "";
    public string? Serial { get; set; }
    public string? Imei1 { get; set; }
    public string? Imei2 { get; set; }
    public DateTimeOffset? WarrantyUntil { get; set; }
}
public sealed class OrderShipmentCommand
{
    public int PackingRevision { get; set; }
    public string ActorId { get; set; } = "";
    public string CommandId { get; set; } = "";
    public string OrderId { get; set; } = "";
    public string Action { get; set; } = "";
    public string PayloadHash { get; set; } = "";
    public string ResponseHash { get; set; } = "";
    public string ResponseJson { get; set; } = "";
    public bool ContainsDemo { get; set; }
    public DateTimeOffset At { get; set; }
}
internal static class OrderShipmentModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<OrderShipment>(e => {
            e.ToTable("OrderShipments", t => {
                t.HasCheckConstraint("CK_OrderShipment_Identity", "LEN([Id])=32 AND LEN([OrderId])=32 AND LEN([ReservationId])=32 AND LEN([InventoryFingerprint])=64 AND [PackingRevision] BETWEEN 1 AND 1000000");
                t.HasCheckConstraint("CK_OrderShipment_Stage", "([State]='packed' AND [DispatchedAt] IS NULL AND [DeliveredAt] IS NULL AND [CarrierNameFa] IS NULL AND [CarrierNameEn] IS NULL AND [TrackingNumber] IS NULL) OR ([State]='dispatched' AND [DispatchedAt] IS NOT NULL AND [DeliveredAt] IS NULL AND [CarrierNameFa] IS NOT NULL AND [CarrierNameEn] IS NOT NULL) OR ([State]='delivered' AND [DispatchedAt] IS NOT NULL AND [DeliveredAt] IS NOT NULL AND [CarrierNameFa] IS NOT NULL AND [CarrierNameEn] IS NOT NULL)");
                t.HasCheckConstraint("CK_OrderShipment_Dates", "[ChangedAt]>=[PackedAt] AND ([DispatchedAt] IS NULL OR ([DispatchedAt]>=[PackedAt] AND [DispatchedAt]<=[ChangedAt])) AND ([DeliveredAt] IS NULL OR ([DeliveredAt]>=[DispatchedAt] AND [DeliveredAt]<=[ChangedAt]))");
            });
            e.HasKey(x => x.Id); foreach (var n in new[] { "Id", "OrderId", "ReservationId" }) e.Property<string>(n).HasMaxLength(32);
            e.Property(x => x.OwnerId).HasMaxLength(64); e.Property(x => x.State).HasMaxLength(12).IsUnicode(false); e.Property(x => x.InventoryFingerprint).HasMaxLength(64).IsUnicode(false);
            e.Property(x => x.CarrierNameFa).HasMaxLength(120); e.Property(x => x.CarrierNameEn).HasMaxLength(120); e.Property(x => x.TrackingNumber).HasMaxLength(120); e.Property(x => x.Version).IsRowVersion();
            e.HasIndex(x => x.OrderId).IsUnique(); e.HasOne<SalesOrder>().WithMany().HasForeignKey(x => x.OrderId).OnDelete(DeleteBehavior.Restrict);
            e.HasMany(x => x.Lines).WithOne().HasForeignKey(x => x.ShipmentId).OnDelete(DeleteBehavior.Restrict); e.HasMany(x => x.Units).WithOne().HasForeignKey(x => x.ShipmentId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<OrderShipmentLine>(e => {
            e.ToTable("OrderShipmentLines", t => { t.HasCheckConstraint("CK_OrderShipmentLine_Quantity", "[Quantity] BETWEEN 1 AND 1000000 AND [PackingRevision] BETWEEN 1 AND 1000000"); t.HasCheckConstraint("CK_OrderShipmentLine_Mode", "[TrackingMode] IN ('none','serial','imei')"); });
            e.HasKey(x => new { x.ShipmentId, x.PackingRevision, x.LineKey }); e.Property(x => x.ShipmentId).HasMaxLength(32); foreach (var n in new[] { "LineKey", "VariantId", "ProductId" }) e.Property<string>(n).HasMaxLength(64);
            e.Property(x => x.Sku).HasMaxLength(80); e.Property(x => x.Name).HasMaxLength(250); e.Property(x => x.TrackingMode).HasMaxLength(8).IsUnicode(false);
        });
        b.Entity<OrderShipmentUnit>(e => {
            e.ToTable("OrderShipmentUnits", t => { t.HasCheckConstraint("CK_OrderShipmentUnit_Identity", "LEN([UnitId])=32 AND [PackingRevision] BETWEEN 1 AND 1000000 AND ([Serial] IS NOT NULL OR [Imei1] IS NOT NULL)"); });
            e.HasKey(x => new { x.ShipmentId, x.PackingRevision, x.UnitId }); foreach (var n in new[] { "ShipmentId", "UnitId" }) e.Property<string>(n).HasMaxLength(32); foreach (var n in new[] { "LineKey", "VariantId" }) e.Property<string>(n).HasMaxLength(64);
            e.Property(x => x.InventoryVersion).HasMaxLength(12); e.Property(x => x.Serial).HasMaxLength(100).IsUnicode(false); e.Property(x => x.Imei1).HasMaxLength(15).IsUnicode(false); e.Property(x => x.Imei2).HasMaxLength(15).IsUnicode(false);
            e.HasOne<OrderShipmentLine>().WithMany().HasForeignKey(x => new { x.ShipmentId, x.PackingRevision, x.LineKey }).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<OrderShipmentCommand>(e => {
            e.ToTable("OrderShipmentCommands", t => { t.HasCheckConstraint("CK_OrderShipmentCommand_Response", "ISJSON([ResponseJson])=1 AND DATALENGTH([ResponseJson])<=262144"); t.HasCheckConstraint("CK_OrderShipmentCommand_Identity", "LEN([CommandId])=32 AND LEN([OrderId])=32 AND LEN([PayloadHash])=64 AND LEN([ResponseHash])=64 AND [Action] IN ('pack','repack','dispatch','deliver') AND [PackingRevision] BETWEEN 1 AND 1000000"); });
            e.HasKey(x => new { x.ActorId, x.CommandId }); e.Property(x => x.ActorId).HasMaxLength(64); e.Property(x => x.CommandId).HasMaxLength(32); e.Property(x => x.OrderId).HasMaxLength(32); e.Property(x => x.PayloadHash).HasMaxLength(64).IsUnicode(false); e.Property(x => x.ResponseJson).HasMaxLength(131072);
            e.HasOne<SalesOrder>().WithMany().HasForeignKey(x => x.OrderId).OnDelete(DeleteBehavior.Restrict);
            e.Property(x => x.Action).HasMaxLength(8).IsUnicode(false); e.Property(x => x.ResponseHash).HasMaxLength(64).IsUnicode(false); e.HasIndex(x => new { x.OrderId, x.PackingRevision, x.Action }).IsUnique();
        });
    }
}
