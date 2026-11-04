using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Sales;

// The consumer must persist EventId in its own transaction. Delivery can be
// retried after any lost acknowledgement; it never grants checkout authority.
public sealed class OrderOutboxService(SalesDbContext db,TimeProvider clock)
{
    internal static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web){DefaultIgnoreCondition=JsonIgnoreCondition.Never,UnmappedMemberHandling=JsonUnmappedMemberHandling.Disallow,MaxDepth=8};
    public async Task<string[]> PendingEventIdsAsync(int limit,CancellationToken ct)
    {
        if(limit is <1 or >100)throw new ArgumentOutOfRangeException(nameof(limit));var now=clock.GetUtcNow();
        return await db.OrderOutbox.AsNoTracking().Where(e=>e.DeliveredAt==null&&(e.NextAttemptAt==null||e.NextAttemptAt<=now)).OrderBy(e=>e.CreatedAt).ThenBy(e=>e.Id).Take(limit).Select(e=>e.Id).ToArrayAsync(ct);
    }
    public async Task<SourcingAgreementOrderedEvent> ReadAsync(string eventId,CancellationToken ct)
    {
        var id=SourcingPriceAgreementRules.Id(eventId);var row=await db.OrderOutbox.AsNoTracking().SingleOrDefaultAsync(e=>e.Id==id,ct)??throw new BusinessException("not_found","Order event not found.");return Parse(row);
    }
    public async Task<SourcingAgreementOrderedEvent[]> PendingAsync(int limit,CancellationToken ct)
    {
        if(limit is <1 or >100)throw new ArgumentOutOfRangeException(nameof(limit));
        var now=clock.GetUtcNow();var rows=await db.OrderOutbox.AsNoTracking().Where(e=>e.DeliveredAt==null&&(e.NextAttemptAt==null||e.NextAttemptAt<=now)).OrderBy(e=>e.CreatedAt).ThenBy(e=>e.Id).Take(limit).ToArrayAsync(ct);
        return rows.Select(Parse).ToArray();
    }
    public async Task MarkDeliveredAsync(string eventId,CancellationToken ct)
    {
        var row=await LockedAsync(eventId,ct);if(row.DeliveredAt is not null)return;Parse(row);
        var now=clock.GetUtcNow();row.Attempts=Math.Min(row.Attempts+1,1000000);row.LastAttemptAt=now;row.DeliveredAt=now;row.NextAttemptAt=null;await db.SaveChangesAsync(ct);
    }
    public async Task MarkFailedAsync(string eventId,CancellationToken ct)
    {
        var row=await LockedAsync(eventId,ct);if(row.DeliveredAt is not null)return;
        row.Attempts=Math.Min(row.Attempts+1,1000000);row.LastAttemptAt=clock.GetUtcNow();row.NextAttemptAt=row.LastAttemptAt.Value.AddSeconds(Math.Min(3600,5*(1<<Math.Min(10,row.Attempts-1))));await db.SaveChangesAsync(ct);
    }
    private async Task<SalesOrderOutboxEvent> LockedAsync(string supplied,CancellationToken ct)
    {
        CartOfferRules.RequireParent(db);var id=SourcingPriceAgreementRules.Id(supplied);
        var row=await db.OrderOutbox.FromSqlInterpolated($"SELECT * FROM [sales].[OrderOutbox] WITH (UPDLOCK,HOLDLOCK) WHERE [Id]={id}").SingleOrDefaultAsync(ct)??throw new BusinessException("not_found","Order event not found.");
        await db.Entry(row).ReloadAsync(ct);return row;
    }
    private static SourcingAgreementOrderedEvent Parse(SalesOrderOutboxEvent row)
    {
        var value=JsonSerializer.Deserialize<SourcingAgreementOrderedEvent>(row.PayloadJson,Json)??throw new InvalidOperationException("Invalid accepted-order outbox event.");
        if(value.SchemaVersion!=1||value.EventId!=row.Id||value.OrderId!=row.OrderId||value.AgreementId!=row.AgreementId||value.At!=row.CreatedAt||row.EventType!="SourcingAgreementOrdered")throw new InvalidOperationException("Accepted-order outbox identity mismatch.");
        return value;
    }
}
