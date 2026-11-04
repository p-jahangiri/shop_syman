using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Credit;
using Shop.Modules.Inventory;
using Shop.Modules.Payments;
using Shop.Modules.Sales;
using Shop.Modules.Identity;
using IdentityContext=Shop.Modules.Identity.IdentityDbContext;

public sealed class CreditOrderCoordinator(IServiceProvider services,CreditOrderService service)
{
    public Task<CreditOrderResult> RunAsync(string owner,string path,string trace,string commandId,CreditOrderInput input,CancellationToken ct)=>Atomic(async()=>{
        var result=await service.CreateAsync(owner,commandId,input,ct);if(!result.Replayed){var identity=services.GetRequiredService<IdentityContext>();identity.Audit.Add(new AuditEvent{ActorId=owner,Action="SALES_CREDIT_ORDER",Resource=path,TraceId=trace});await identity.SaveChangesAsync(ct);await service.EnsureCreationCommitAsync(owner,result,ct);}return result;
    },ct);
    public Task<CreditOrderReadiness> ReadinessAsync(string owner,string quoteId,CancellationToken ct)=>Atomic(()=>service.ReadinessAsync(owner,quoteId,ct),ct);
    private async Task<T> Atomic<T>(Func<Task<T>> work,CancellationToken ct)
    {
        var identity=services.GetRequiredService<IdentityContext>();await using var tx=await identity.Database.BeginTransactionAsync(IsolationLevel.Serializable,ct);var enlisted=new List<DbContext>();
        try{
            var connection=identity.Database.GetDbConnection();
            foreach(var type in new[]{typeof(SalesDbContext),typeof(CatalogDbContext),typeof(InventoryDbContext),typeof(PaymentsDbContext),typeof(CreditDbContext)}){
                var db=(DbContext)services.GetRequiredService(type);var original=db.Database.GetDbConnection();
                if(original.State!=ConnectionState.Closed||original.Database!=connection.Database||original.DataSource!=connection.DataSource)throw new InvalidOperationException("Cheque orders require closed module connections to the same database.");
                db.Database.SetDbConnection(connection,false);await db.Database.UseTransactionAsync(tx.GetDbTransaction(),ct);enlisted.Add(db);
            }
            var result=await work();await tx.CommitAsync(ct);return result;
        }finally{foreach(var db in enlisted)await db.Database.UseTransactionAsync(null,CancellationToken.None);}
    }
}
public static class CreditOrderEndpoints
{
    public static bool IsScope(string path)=>path.Equals("/api/credit-orders",StringComparison.OrdinalIgnoreCase)||path.StartsWith("/api/credit-orders/",StringComparison.OrdinalIgnoreCase)||path.StartsWith("/api/admin/credit-orders/",StringComparison.OrdinalIgnoreCase);
    public static void MapCreditOrders(this WebApplication app,string[] origins,string[] adminOrigins)
    {
        var group=app.MapGroup("/api/credit-orders").RequireAuthorization("customer").RequireRateLimiting("orders");CreditApplicationEndpoints.Configure(group,origins);
        group.MapGet("/quotes",async(string? cursor,HttpContext h,CreditCheckoutQuoteService quotes,CancellationToken ct)=>
            h.Request.Query.Count>1||h.Request.Query.Any(x=>x.Key!="cursor"||x.Value.Count!=1)?Results.BadRequest():Results.Ok(await quotes.HistoryAsync(CreditApplicationEndpoints.Actor(h),cursor,ct)));
        group.MapGet("/quotes/{quoteId}/readiness",async(string quoteId,HttpContext h,CreditOrderCoordinator coordinator,CancellationToken ct)=>
            !CreditApplicationEndpoints.Query(h)?Results.BadRequest():Results.Ok(await coordinator.ReadinessAsync(CreditApplicationEndpoints.Actor(h),quoteId,ct)));
        group.MapPost("/commands/{commandId}",async(string commandId,CreditOrderInput input,HttpContext h,CreditOrderCoordinator coordinator,CancellationToken ct)=>
            !CreditApplicationEndpoints.Query(h)?Results.BadRequest():Results.Json(await coordinator.RunAsync(CreditApplicationEndpoints.Actor(h),h.Request.Path,h.TraceIdentifier,commandId,input,ct)));
        group.MapGet("/commands/{commandId}",async(string commandId,HttpContext h,CreditOrderService service,CancellationToken ct)=>
            !CreditApplicationEndpoints.Query(h)?Results.BadRequest():Results.Ok(await service.ReceiptAsync(CreditApplicationEndpoints.Actor(h),commandId,ct)));
        group.MapGet("/{id}",async(string id,HttpContext h,CreditOrderService service,CancellationToken ct)=>
            !CreditApplicationEndpoints.Query(h)?Results.BadRequest():Results.Ok(await service.DetailAsync(CreditApplicationEndpoints.Actor(h),id,ct)));
        var admin=app.MapGroup("/api/admin/credit-orders").RequireAuthorization("staff_mfa","sales.write").RequireRateLimiting("orders");CreditApplicationEndpoints.Configure(admin,adminOrigins);
        admin.MapGet("/{ownerId}/{id}",async(string ownerId,string id,HttpContext h,CreditOrderService service,CancellationToken ct)=>
            !CreditApplicationEndpoints.Query(h)?Results.BadRequest():Results.Ok(await service.DetailAsync(ownerId,id,ct)));
    }
}
