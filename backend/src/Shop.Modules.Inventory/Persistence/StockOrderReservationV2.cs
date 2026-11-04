using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Inventory;

// Price-free immutable rights. ReservationItems remains the aggregate SKU
// counter; these rows preserve separate purchase lines even for one SKU.
public sealed class ReservationLineEntitlement
{
    public string ReservationId { get; set; } = "";
    public string LineId { get; set; } = "";
    public string VariantId { get; set; } = "";
    public int Quantity { get; set; }
    public string TrackingMode { get; set; } = "none";
    public string? AllocationId { get; set; }
    public string? OfferLineId { get; set; }
}

// Transfer history is never released or rewritten when the resulting order
// expires. A sourcing allocation can fund only one reservation in its lifetime.
public sealed class SourcingAllocationTransfer
{
    public string AllocationId { get; set; } = "";
    public string ReservationId { get; set; } = "";
    public string OrderId { get; set; } = "";
    public string OwnerId { get; set; } = "";
    public string AcceptanceId { get; set; } = "";
    public string AllocationVersion { get; set; } = "";
    public DateTimeOffset OriginalExpiresAt { get; set; }
    public DateTimeOffset TransferredAt { get; set; }
    public bool ContainsDemo { get; set; }
}

internal static class StockOrderReservationV2Model
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<ReservationLineEntitlement>(e => {
            e.ToTable("ReservationLineEntitlements", t => {
                t.HasCheckConstraint("CK_ReservationEntitlement_Quantity", "[Quantity] BETWEEN 1 AND 1000000");
                t.HasCheckConstraint("CK_ReservationEntitlement_Mode", "[TrackingMode] IN ('none','serial','imei')");
                t.HasCheckConstraint("CK_ReservationEntitlement_Provenance", "([AllocationId] IS NULL AND [OfferLineId] IS NULL) OR ([AllocationId] IS NOT NULL AND [OfferLineId] IS NOT NULL)");
                t.HasCheckConstraint("CK_ReservationEntitlement_Identity", "LEN([ReservationId])=32 AND LEN([LineId])=32");
            });
            e.HasKey(x => new { x.ReservationId, x.LineId });
            foreach (var name in new[] { "ReservationId", "LineId", "AllocationId", "OfferLineId" }) e.Property<string>(name).HasMaxLength(32);
            e.Property(x => x.VariantId).HasMaxLength(64); e.Property(x => x.TrackingMode).HasMaxLength(8);
            e.HasIndex(x => new { x.ReservationId, x.AllocationId, x.OfferLineId }).IsUnique().HasFilter("[AllocationId] IS NOT NULL");
            e.HasOne<StockReservation>().WithMany(x => x.LineEntitlements).HasForeignKey(x => x.ReservationId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<StockItem>().WithMany().HasForeignKey(x => x.VariantId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<SourcingStockAllocationLine>().WithMany().HasForeignKey(x => new { x.AllocationId, x.OfferLineId }).HasPrincipalKey(x => new { x.AllocationId, x.OfferLineId }).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<SourcingAllocationTransfer>(e => {
            e.ToTable("SourcingAllocationTransfers", t => {
                t.HasCheckConstraint("CK_SourcingTransfer_Identity", "LEN([AllocationId])=32 AND LEN([ReservationId])=32 AND LEN([OrderId])=32 AND LEN([AcceptanceId])=32");
                t.HasCheckConstraint("CK_SourcingTransfer_Dates", "[TransferredAt]<[OriginalExpiresAt]");
            });
            e.HasKey(x => x.AllocationId);
            foreach (var name in new[] { "AllocationId", "ReservationId", "OrderId", "AcceptanceId" }) e.Property<string>(name).HasMaxLength(32);
            e.Property(x => x.OwnerId).HasMaxLength(64); e.Property(x => x.AllocationVersion).HasMaxLength(12).IsUnicode(false);
            e.HasIndex(x => new { x.ReservationId, x.AllocationId });
            e.HasOne<SourcingStockAllocation>().WithOne().HasForeignKey<SourcingAllocationTransfer>(x => x.AllocationId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<StockReservation>().WithMany().HasForeignKey(x => x.ReservationId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<SerialUnit>(e => {
            e.Property(x => x.OrderLineId).HasMaxLength(32);
            e.ToTable("SerialUnits", t => t.HasCheckConstraint("CK_SerialUnit_OrderLine", "[OrderLineId] IS NULL OR ([ReservationId] IS NOT NULL AND [OrderId] IS NOT NULL AND [State] IN ('assigned','delivered'))"));
            e.HasOne<ReservationLineEntitlement>().WithMany().HasForeignKey(x => new { x.ReservationId, x.OrderLineId }).HasPrincipalKey(x => new { x.ReservationId, x.LineId }).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<SerialUnitClaim>().HasOne<ReservationLineEntitlement>().WithMany().HasForeignKey(x => new { x.ReservationId, x.OrderLineId }).HasPrincipalKey(x => new { x.ReservationId, x.LineId }).OnDelete(DeleteBehavior.Restrict);
    }
}

public static class StockOrderReservationV2Rules
{
    public static StockOrderHoldV2Request Normalize(StockOrderHoldV2Request request, bool allowDemo)
    {
        if (request is null || request.Lines is not { Length: > 0 and <= 64 } || request.Lines.Any(l => l is null) || request.Allocations is not { Length: > 0 and <= 64 } || request.Allocations.Any(a => a is null)) throw Invalid();
        var owner = SourcingAllocationRules.Actor(request.OwnerId);
        var lines = request.Lines.Select(l => new StockOrderLineV2(SourcingAllocationRules.Id(l.LineId), SourcingReceivingRules.Identifier(l.VariantId).ToUpperInvariant(), l.Quantity, l.AllocationId is null ? null : SourcingAllocationRules.Id(l.AllocationId), l.OfferLineId is null ? null : SourcingAllocationRules.Id(l.OfferLineId))).OrderBy(l => l.LineId, StringComparer.Ordinal).ToArray();
        if (lines.Any(l => l.Quantity is < 1 or > 1000000 || (l.AllocationId is null) != (l.OfferLineId is null)) || lines.Select(l => l.LineId).Distinct(StringComparer.Ordinal).Count() != lines.Length || lines.GroupBy(l => l.VariantId, StringComparer.OrdinalIgnoreCase).Any(g => g.Sum(l => (long)l.Quantity) > 1000000)) throw Invalid();
        var allocations = request.Allocations.Select(a => new StockOrderAllocationV2(SourcingAllocationRules.NormalizePlan(a.Plan), SourcingAllocationRules.Id(a.AllocationId), SourcingAllocationRules.Version(a.Version))).OrderBy(a => a.Plan.AcceptanceId, StringComparer.Ordinal).ToArray();
        if (allocations.Any(a => a.Plan.OwnerId != owner || a.Plan.ContainsDemo && !allowDemo)) throw new BusinessException("not_found", "The owned sourcing allocation was not found.");
        if (allocations.Select(a => a.AllocationId).Distinct(StringComparer.Ordinal).Count() != allocations.Length || allocations.Select(a => a.Plan.AcceptanceId).Distinct(StringComparer.Ordinal).Count() != allocations.Length) throw Invalid();
        var accepted = lines.Where(l => l.AllocationId is not null).ToArray();
        if (accepted.Length != allocations.Sum(a => a.Plan.Lines.Length) || accepted.Select(l => (l.AllocationId, l.OfferLineId)).Distinct().Count() != accepted.Length) throw Invalid();
        foreach (var allocation in allocations)
            foreach (var line in allocation.Plan.Lines)
                if (!accepted.Any(l => l.AllocationId == allocation.AllocationId && l.OfferLineId == line.OfferLineId && l.VariantId.Equals(line.VariantId, StringComparison.OrdinalIgnoreCase) && l.Quantity == line.Quantity)) throw Invalid();
        if (request.ExpiresAt.Offset != TimeSpan.Zero) throw Invalid();
        return new(owner, SourcingAllocationRules.Id(request.OrderId), SourcingAllocationRules.Id(request.RequestId), request.ExpiresAt, lines, allocations);
    }

    public static void ValidateDeadline(DateTimeOffset expiresAt, IEnumerable<DateTimeOffset> authorityDeadlines, DateTimeOffset now)
    {
        if (expiresAt.Offset != TimeSpan.Zero || expiresAt <= now || expiresAt > now.AddHours(1) || authorityDeadlines.Any(d => d.Offset != TimeSpan.Zero || expiresAt > d || d <= now))
            throw new BusinessException("reservation_deadline_conflict", "The absolute order reservation deadline is no longer available.");
    }
    private static BusinessException Invalid() => new("invalid_order_reservation_v2", "Use complete owned allocations and distinct bounded order line rights.");
}
