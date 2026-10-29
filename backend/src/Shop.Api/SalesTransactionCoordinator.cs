using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Credit;
using Shop.Modules.Inventory;
using Shop.Modules.Payments;
using Shop.Modules.Sales;

// Request-scoped coordination only. Modules continue to own separate contexts.
public sealed class SalesTransactionCoordinator(IServiceProvider services, ILogger<SalesTransactionCoordinator> logger)
{
    public async Task<T> RunAsync<T>(Func<Task<T>> action, bool inventoryOnly = false, Func<T, bool>? commit = null, CancellationToken ct = default)
    {
        var sales = services.GetRequiredService<SalesDbContext>();
        if (sales.Database.CurrentTransaction is not null) throw new InvalidOperationException("Checkout transaction coordination requires an independent scope.");
        await using var transaction = await sales.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var enlisted = new List<DbContext>();
        try {
            var connection = sales.Database.GetDbConnection();
            Type[] participants = inventoryOnly ? [typeof(InventoryDbContext)] : [typeof(CatalogDbContext), typeof(InventoryDbContext), typeof(PaymentsDbContext), typeof(CreditDbContext)];
            foreach (var type in participants) {
                var db = (DbContext)services.GetRequiredService(type); var original = db.Database.GetDbConnection();
                if (original.State != ConnectionState.Closed || !string.Equals(original.Database, connection.Database, StringComparison.OrdinalIgnoreCase) || !string.Equals(original.DataSource, connection.DataSource, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Checkout requires closed module connections to the same database.");
                db.Database.SetDbConnection(connection, contextOwnsConnection: false); await db.Database.UseTransactionAsync(transaction.GetDbTransaction(), ct); enlisted.Add(db);
            }
            var result = await action(); if (commit is null || commit(result)) await transaction.CommitAsync(ct); return result;
        }
        finally {
            foreach (var db in enlisted) { try { await db.Database.UseTransactionAsync(null, CancellationToken.None); } catch (Exception e) when (e is not OutOfMemoryException) { logger.LogWarning("Could not detach checkout {Module} after {ExceptionType}", db.GetType().Name, e.GetType().Name); } }
        }
    }
}
