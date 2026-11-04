using Microsoft.EntityFrameworkCore;

namespace Shop.Modules.Sales;

// Command-only reads. The caller MUST first own the existing canonical
// sayman:sales:order-owner:<hash> Exclusive transaction application lock for
// this owner. Every current order writer (create/cancel/expiry, both versions)
// uses that same domain. The parent transaction stays Serializable.
//
// Missing owner/request/quote keys must not retain broad Serializable range S
// locks across unrelated owners and then wait for Stock. That would reverse
// the Stock -> new Orders insert sequence of a different owner's checkout.
// The owner lock, owned-quote validation and existing unique DB indexes retain
// idempotency/uniqueness. Existing immutable lines and owner-written events can
// be loaded only after a header exists, without locking other orders' gaps.
internal static class OrderCommandQueries
{
    private static IQueryable<SalesOrder> Headers(SalesDbContext db,string owner)
    {
        CartOfferRules.RequireParent(db);
        return db.Orders.FromSqlInterpolated($"SELECT * FROM [sales].[Orders] WITH (READCOMMITTEDLOCK) WHERE [OwnerId]={owner}");
    }
    internal static Task<SalesOrder?> PreviousAsync(SalesDbContext db,string owner,string request,CancellationToken ct)=>Headers(db,owner).SingleOrDefaultAsync(o=>o.RequestId==request,ct);
    internal static Task<SalesOrder?> FindAsync(SalesDbContext db,string owner,string id,CancellationToken ct)=>Headers(db,owner).SingleOrDefaultAsync(o=>o.Id==id,ct);
    internal static Task<bool> QuoteExistsAsync(SalesDbContext db,string owner,string quote,CancellationToken ct)=>Headers(db,owner).AnyAsync(o=>o.QuoteId==quote,ct);
    internal static Task<int> OpenCountAsync(SalesDbContext db,string owner,DateTimeOffset now,CancellationToken ct)=>Headers(db,owner).CountAsync(o=>o.State==OrderState.AwaitingPayment&&o.ExpiresAt>now,ct);
    internal static async Task LoadHistoryAsync(SalesDbContext db,SalesOrder row,CancellationToken ct)
    {
        CartOfferRules.RequireParent(db);var id=row.Id;
        row.Lines=await db.Set<SalesOrderLine>().FromSqlInterpolated($"SELECT * FROM [sales].[OrderLines] WITH (READCOMMITTEDLOCK) WHERE [OrderId]={id}").ToListAsync(ct);
        row.LinesV2=await db.OrderLinesV2.FromSqlInterpolated($"SELECT * FROM [sales].[OrderLinesV2] WITH (READCOMMITTEDLOCK) WHERE [OrderId]={id}").ToListAsync(ct);
        await LoadEventsAsync(db,row,ct);
    }
    internal static async Task LoadEventsAsync(SalesDbContext db,SalesOrder row,CancellationToken ct)
    {
        CartOfferRules.RequireParent(db);var id=row.Id;
        row.Events=await db.Set<SalesOrderEvent>().FromSqlInterpolated($"SELECT * FROM [sales].[OrderEvents] WITH (READCOMMITTEDLOCK) WHERE [OrderId]={id}").ToListAsync(ct);
    }
}
