using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Inventory;
using Shop.Modules.Market;
using Shop.Modules.Payments;
using Shop.Modules.Credit;
using Shop.Modules.Sales;

// Only the sourcing request endpoints use this unit of work. Every participant
// retains its owning context; existing purchase transaction behavior is unchanged.
public sealed class SourcingTransactionCoordinator(IServiceProvider services,ILogger<SourcingTransactionCoordinator> logger)
{
    public async Task<T> RunAsync<T>(Func<Task<T>> action,Func<T,bool>? commit=null,CancellationToken ct=default,bool includePurchaseConfiguration=false)
    {
        var sales=services.GetRequiredService<SalesDbContext>();
        if(sales.Database.CurrentTransaction is not null)throw new InvalidOperationException("Sourcing requires an independent request transaction.");
        await using var transaction=await sales.Database.BeginTransactionAsync(IsolationLevel.Serializable,ct);
        var enlisted=new List<DbContext>();
        try{
            var connection=sales.Database.GetDbConnection();
            var participants=new List<Type>{typeof(CatalogDbContext),typeof(InventoryDbContext),typeof(MarketDbContext)};
            if(includePurchaseConfiguration){participants.Add(typeof(PaymentsDbContext));participants.Add(typeof(CreditDbContext));}
            foreach(var type in participants){
                var db=(DbContext)services.GetRequiredService(type);var original=db.Database.GetDbConnection();
                if(original.State!=ConnectionState.Closed||!string.Equals(original.Database,connection.Database,StringComparison.OrdinalIgnoreCase)||!string.Equals(original.DataSource,connection.DataSource,StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("Sourcing requires closed module connections to the same database.");
                db.Database.SetDbConnection(connection,contextOwnsConnection:false);await db.Database.UseTransactionAsync(transaction.GetDbTransaction(),ct);enlisted.Add(db);
            }
            var result=await action();if(commit is null||commit(result))await transaction.CommitAsync(ct);return result;
        }finally{
            foreach(var db in enlisted){try{await db.Database.UseTransactionAsync(null,CancellationToken.None);}catch(Exception e)when(e is not OutOfMemoryException){logger.LogWarning("Could not detach sourcing {Module} after {ExceptionType}",db.GetType().Name,e.GetType().Name);}}
        }
    }
}
public sealed class SourcingTransactionFilter:IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context,EndpointFilterDelegate next)=>await context.HttpContext.RequestServices.GetRequiredService<SourcingTransactionCoordinator>().RunAsync(async()=>await next(context),commit:result=>context.HttpContext.Response.StatusCode<400&&result is not IStatusCodeHttpResult{StatusCode:>=400},ct:context.HttpContext.RequestAborted);
}
