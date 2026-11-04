using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Inventory;

public sealed class StockReservation
{
    public int? ContractVersion { get; set; }
    public string Id { get; set; } = "";
    public string OwnerId { get; set; } = "";
    public string OrderId { get; set; } = "";
    public string RequestId { get; set; } = "";
    public string PayloadHash { get; set; } = "";
    public StockReservationState State { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset ChangedAt { get; set; }
    public byte[] Version { get; set; } = [];
    public List<StockReservationItem> Items { get; set; } = [];
    public List<ReservationLineEntitlement> LineEntitlements { get; set; } = [];
}
public sealed class StockReservationItem
{
    public string ReservationId { get; set; } = "";
    public string VariantId { get; set; } = "";
    public int Quantity { get; set; }
}
public sealed class StockReservationEvent
{
    public long Id { get; set; }
    public string ReservationId { get; set; } = "";
    public StockReservationState State { get; set; }
    public string ActorId { get; set; } = "";
    public DateTimeOffset At { get; set; }
}
internal static class StockReservationModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<StockReservation>(e => {
            e.ToTable("Reservations", t => {
                t.HasCheckConstraint("CK_Reservation_State", "[State] IN ('Active','Allocated','Released','Expired','Fulfilled')");
                t.HasCheckConstraint("CK_Reservation_Deadline", "[ExpiresAt] > [CreatedAt]");
                t.HasCheckConstraint("CK_Reservation_Contract", "[ContractVersion] IS NULL OR [ContractVersion]=2");
            });
            e.HasKey(x => x.Id); e.Property(x => x.Id).HasMaxLength(32);
            e.Property(x => x.OwnerId).HasMaxLength(64); e.Property(x => x.OrderId).HasMaxLength(32); e.Property(x => x.RequestId).HasMaxLength(32);
            e.Property(x => x.PayloadHash).HasMaxLength(64).IsUnicode(false);
            e.Property(x => x.State).HasConversion<string>().HasMaxLength(16); e.Property(x => x.Version).IsRowVersion();
            e.HasIndex(x => new { x.OwnerId, x.RequestId }).IsUnique(); e.HasIndex(x => x.OrderId).IsUnique();
            e.HasIndex(x => new { x.State, x.ExpiresAt, x.Id });
            e.HasMany(x => x.Items).WithOne().HasForeignKey(x => x.ReservationId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<StockReservationItem>(e => {
            e.ToTable("ReservationItems", t => t.HasCheckConstraint("CK_ReservationItem_Quantity", "[Quantity] > 0 AND [Quantity] <= 1000000"));
            e.HasKey(x => new { x.ReservationId, x.VariantId }); e.Property(x => x.ReservationId).HasMaxLength(32); e.Property(x => x.VariantId).HasMaxLength(64);
            e.HasOne<StockItem>().WithMany().HasForeignKey(x => x.VariantId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<StockReservationEvent>(e => {
            e.ToTable("ReservationEvents"); e.HasKey(x => x.Id); e.Property(x => x.ReservationId).HasMaxLength(32);
            e.Property(x => x.State).HasConversion<string>().HasMaxLength(16); e.Property(x => x.ActorId).HasMaxLength(64);
            e.HasIndex(x => new { x.ReservationId, x.State }).IsUnique();
            e.HasOne<StockReservation>().WithMany().HasForeignKey(x => x.ReservationId).OnDelete(DeleteBehavior.Restrict);
        });
    }
}
