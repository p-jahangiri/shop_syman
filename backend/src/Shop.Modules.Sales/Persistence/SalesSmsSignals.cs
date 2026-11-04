using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Sales;

public sealed class SalesSmsSignal
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public long OrderEventId { get; set; }
    public SalesOrderEvent OrderEvent { get; set; } = null!;
    public string Kind { get; set; } = "";
    public string? TrackingCode { get; set; }
    public DateTimeOffset? ProcessedAt { get; set; }
}

internal static class SalesSmsSignalModel
{
    internal static void Configure(ModelBuilder b)
    {
        b.Entity<SalesSmsSignal>(e => {
            e.ToTable("SmsSignals", t => t.HasCheckConstraint("CK_SalesSmsSignal_Kind", "[Kind] IN ('orderCreated','orderPaid','orderCancelled','orderShipped','creditApproved','orderDigitalReady')"));
            e.HasKey(x => x.Id); e.Property(x => x.Id).HasMaxLength(32).IsUnicode(false);
            e.Property(x => x.Kind).HasMaxLength(24).IsUnicode(false);
            e.Property(x => x.TrackingCode).HasMaxLength(120);
            e.HasOne(x => x.OrderEvent).WithOne().HasForeignKey<SalesSmsSignal>(x => x.OrderEventId).OnDelete(DeleteBehavior.Restrict);
            e.HasIndex(x => new { x.ProcessedAt, x.OrderEventId });
        });
    }
}

public sealed partial class SalesDbContext
{
    public DbSet<SalesSmsSignal> SmsSignals => Set<SalesSmsSignal>();
    private readonly Dictionary<SalesOrderEvent, SalesSmsSignal> capturedSms = new(ReferenceEqualityComparer.Instance);

    private void CaptureSmsSignals()
    {
        foreach (var entry in ChangeTracker.Entries<SalesSmsSignal>().ToArray()) {
            if (entry.State == EntityState.Deleted || entry.State == EntityState.Modified
                && (entry.Properties.Any(p => p.IsModified && p.Metadata.Name != nameof(SalesSmsSignal.ProcessedAt))
                    || entry.OriginalValues.GetValue<DateTimeOffset?>(nameof(SalesSmsSignal.ProcessedAt)) is not null
                    || entry.Entity.ProcessedAt is null)) throw new InvalidOperationException("SMS business signal history is immutable.");
        }
        foreach (var entry in ChangeTracker.Entries<SalesOrderEvent>().Where(e => e.State == EntityState.Added).ToArray()) {
            var value = entry.Entity;
            if (capturedSms.TryGetValue(value, out var previous) && Entry(previous).State != EntityState.Detached) continue;
            var kind = value.Reason switch {
                "temporary_order_created" or "temporary_order_v2_created" or "credit_temporary_order_created" => "orderCreated",
                "cash_payment_verified" when value.State == OrderState.Paid => "orderPaid",
                "unpaid_order_cancelled" or "reservation_expired" when value.State is OrderState.Cancelled or OrderState.Expired => "orderCancelled",
                "shipment_dispatched" or "parcel_dispatch" => "orderShipped",
                "credit_financially_approved" when value.State == OrderState.CreditApproved => "creditApproved",
                "digital_content_available" => "orderDigitalReady",
                _ => null
            };
            if (kind is null) continue;
            var tracking = value.Reason == "shipment_dispatched"
                ? ChangeTracker.Entries<OrderShipment>().Where(x => x.Entity.OrderId == value.OrderId && x.Entity.State == "dispatched").Select(x => x.Entity.TrackingNumber).SingleOrDefault()
                : value.Reason == "parcel_dispatch"
                    ? ChangeTracker.Entries<OrderParcel>().Where(x => x.Entity.OrderId == value.OrderId && x.Entity.State == "dispatched" && x.Entity.ChangedAt == value.At).Select(x => x.Entity.TrackingNumber).SingleOrDefault()
                    : null;
            var signal = new SalesSmsSignal { OrderEvent = value, Kind = kind, TrackingCode = tracking };
            capturedSms[value] = signal; SmsSignals.Add(signal);
        }
    }
}

public sealed class SalesSmsSignals(SalesDbContext db, TimeProvider clock) : ISalesSmsSignals
{
    public async Task<SmsBusinessEvent[]> PendingAsync(CancellationToken ct)
    {
        // Pending rows, not a high-watermark cursor: an earlier identity value
        // committed later must still be delivered once after it becomes visible.
        var rows = await (from signal in db.SmsSignals.AsNoTracking()
            join ev in db.Set<SalesOrderEvent>().AsNoTracking() on signal.OrderEventId equals ev.Id
            join order in db.Orders.AsNoTracking() on ev.OrderId equals order.Id
            where signal.ProcessedAt == null
            orderby signal.OrderEventId
            select new { signal.Id, signal.Kind, signal.TrackingCode, ev.At, ev.State, order.OwnerId, order.Number,
                order.PayableTotalRial, order.ContainsDemo }).Take(100).ToArrayAsync(ct);
        return rows.Select(row => {
            var facts = new Dictionary<string, string>(StringComparer.Ordinal) {
                ["orderNumber"] = "SM-" + row.Number.ToString(CultureInfo.InvariantCulture),
                ["amountRial"] = row.PayableTotalRial.ToString(CultureInfo.InvariantCulture),
                ["orderStatus"] = row.Kind == "orderShipped" ? "ارسال‌شده" : row.Kind == "orderDigitalReady" ? "آماده دریافت" : row.State switch {
                    OrderState.Expired => "پایان مهلت پرداخت", OrderState.Cancelled => "لغوشده",
                    OrderState.Paid => "پرداخت‌شده", OrderState.CreditApproved => "تأیید خرید چکی",
                    OrderState.Fulfilled => "تکمیل تحویل", _ => "در انتظار پرداخت"
                }
            };
            if (row.TrackingCode is not null) facts["trackingCode"] = row.TrackingCode;
            return new SmsBusinessEvent("sales", row.Id, row.Kind, row.OwnerId, row.At, facts, row.ContainsDemo);
        }).ToArray();
    }
    public async Task AcknowledgeAsync(string id, CancellationToken ct)
    {
        if (!Guid.TryParseExact(id, "N", out var parsed) || parsed == Guid.Empty || parsed.ToString("N") != id)
            throw new BusinessException("invalid_sms_signal", "The SMS signal reference is invalid.");
        await db.SmsSignals.Where(s => s.Id == id && s.ProcessedAt == null)
            .ExecuteUpdateAsync(update => update.SetProperty(s => s.ProcessedAt, clock.GetUtcNow()), ct);
    }
}
public sealed class SmsOrderFactsReader(SalesDbContext db) : ISmsOrderFactsReader
{
    public async Task<SmsOrderFacts?> ReadAsync(string orderId, CancellationToken ct)
    {
        var row = await db.Orders.AsNoTracking().Where(x => x.Id == orderId)
            .Select(x => new { x.OwnerId, x.Number, x.ContainsDemo }).SingleOrDefaultAsync(ct);
        return row is null ? null : new(row.OwnerId, "SM-" + row.Number.ToString(CultureInfo.InvariantCulture), row.ContainsDemo);
    }
}
