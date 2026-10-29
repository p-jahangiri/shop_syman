using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Inventory;
using Shop.Modules.Payments;
using Shop.Modules.Sales;

// One fresh request scope per operation. No gateway network work may run inside
// this boundary; preparation and verified settlement are separate SQL phases.
public sealed class CashPaymentTransactionCoordinator(IServiceProvider services,ILogger<CashPaymentTransactionCoordinator> logger)
{
    public async Task<T> RunAsync<T>(Func<Task<T>> action,CancellationToken ct=default)
    {
        var payments=services.GetRequiredService<PaymentsDbContext>();if(payments.Database.CurrentTransaction is not null)throw new InvalidOperationException("Cash payment coordination requires an independent root transaction.");
        await using var transaction=await payments.Database.BeginTransactionAsync(IsolationLevel.Serializable,ct);var enlisted=new List<DbContext>();
        try{
            var connection=payments.Database.GetDbConnection();foreach(var type in new[]{typeof(SalesDbContext),typeof(InventoryDbContext)}){
                var db=(DbContext)services.GetRequiredService(type);var original=db.Database.GetDbConnection();if(db.Database.CurrentTransaction is not null||original.State!=ConnectionState.Closed||!string.Equals(original.Database,connection.Database,StringComparison.OrdinalIgnoreCase)||!string.Equals(original.DataSource,connection.DataSource,StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("Cash payment participants require closed connections to the same database.");
                db.Database.SetDbConnection(connection,contextOwnsConnection:false);await db.Database.UseTransactionAsync(transaction.GetDbTransaction(),ct);enlisted.Add(db);
            }
            var result=await action();await transaction.CommitAsync(ct);return result;
        }finally{
            foreach(var db in enlisted)try{await db.Database.UseTransactionAsync(null,CancellationToken.None);}catch(Exception e)when(e is not OutOfMemoryException){logger.LogWarning("Could not detach payment {Module} after {ExceptionType}",db.GetType().Name,e.GetType().Name);}
        }
    }
}
