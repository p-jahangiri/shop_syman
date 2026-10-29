using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Credit;
using Shop.Modules.Identity;
using Shop.Modules.Inventory;
using Shop.Modules.Sales;
using Shop.SharedKernel;

public sealed class OrderParcelCoordinator(IServiceProvider services,OrderParcelService service)
{
    public async Task<T> Atomic<T>(Func<Task<T>> work,CancellationToken ct)
    {
        var identity=services.GetRequiredService<IdentityDbContext>();await using var tx=await identity.Database.BeginTransactionAsync(IsolationLevel.Serializable,ct);var enlisted=new List<DbContext>();
        try{var connection=identity.Database.GetDbConnection();foreach(var type in new[]{typeof(SalesDbContext),typeof(InventoryDbContext),typeof(CreditDbContext)}){var db=(DbContext)services.GetRequiredService(type);var original=db.Database.GetDbConnection();if(original.State!=ConnectionState.Closed||original.Database!=connection.Database||original.DataSource!=connection.DataSource)throw new InvalidOperationException("Parcel participants must share the root audit transaction.");db.Database.SetDbConnection(connection,false);await db.Database.UseTransactionAsync(tx.GetDbTransaction(),ct);enlisted.Add(db);}var result=await work();await tx.CommitAsync(ct);return result;}
        finally{foreach(var db in enlisted)await db.Database.UseTransactionAsync(null,CancellationToken.None);}
    }
    public Task<T> ReadAsync<T>(Func<OrderParcelService,Task<T>> read,CancellationToken ct)=>Atomic(()=>read(service),ct);
    public Task<ParcelCommandResult> WriteAsync(string actor,string owner,string order,string command,ParcelCommandInput input,string path,string trace,CancellationToken ct)
    {
        if(!string.Equals(input.OwnerId,owner,StringComparison.OrdinalIgnoreCase)||input.CommandId!=command)throw ParcelRules.Invalid();
        return Atomic(async()=>{var result=await service.ApplyAsync(actor,order,input,ct);if(!result.Replayed){var identity=services.GetRequiredService<IdentityDbContext>();identity.Audit.Add(new AuditEvent{ActorId=actor,Action="ORDER_PARCEL_"+input.Action.ToUpperInvariant(),Resource=path,TraceId=trace});await identity.SaveChangesAsync(ct);}return result;},ct);
    }
}
public static class OrderParcelEndpoints
{
    public static void MapOrderParcels(this WebApplication app,string[] origins,string[] adminOrigins)
    {
        var staff=app.MapGroup("/api/admin/orders/{ownerId}/{orderId}/fulfillment").RequireAuthorization("staff_mfa","sales.read","inventory.read").RequireRateLimiting("orders");Configure(staff,adminOrigins);
        staff.MapGet("",async(string ownerId,string orderId,HttpContext h,OrderParcelCoordinator c,CancellationToken ct)=>!Query(h,"after")?Results.BadRequest():Results.Ok(await c.ReadAsync(s=>s.ReadAdminAsync(ownerId,orderId,After(h),ct),ct)));
        staff.MapGet("/parcels/{parcelId}",async(string ownerId,string orderId,string parcelId,HttpContext h,OrderParcelCoordinator c,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await c.ReadAsync(s=>s.ReadDetailAsync(ownerId,orderId,parcelId,false,ct),ct)));
        staff.MapPost("/commands/{commandId}",async(string ownerId,string orderId,string commandId,ParcelCommandInput input,HttpContext h,OrderParcelCoordinator c,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await c.WriteAsync(CreditApplicationEndpoints.Actor(h),ownerId,orderId,commandId,input,h.Request.Path,h.TraceIdentifier,ct))).RequireAuthorization("sales.write","inventory.write").WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(65536));
        staff.MapGet("/commands/{commandId}",async(string ownerId,string orderId,string commandId,HttpContext h,OrderParcelService s,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await s.ReadReceiptAsync(CreditApplicationEndpoints.Actor(h),ownerId,orderId,commandId,ct))).RequireAuthorization("sales.write","inventory.write");
        foreach(var prefix in new[]{"/api/orders/{orderId}/fulfillment","/api/orders/v2/{orderId}/fulfillment"}){
            var customer=app.MapGroup(prefix).RequireAuthorization("customer").RequireRateLimiting("orders");Configure(customer,origins);
            customer.MapGet("",async(string orderId,HttpContext h,OrderParcelCoordinator c,CancellationToken ct)=>!Query(h,"after")?Results.BadRequest():Results.Ok(await c.ReadAsync(s=>s.ReadCustomerAsync(CreditApplicationEndpoints.Actor(h),orderId,After(h),ct),ct)));
            customer.MapGet("/parcels/{parcelId}",async(string orderId,string parcelId,HttpContext h,OrderParcelCoordinator c,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await c.ReadAsync(s=>s.ReadDetailAsync(CreditApplicationEndpoints.Actor(h),orderId,parcelId,true,ct),ct)));
        }
    }
    private static void Configure(RouteGroupBuilder group,string[] origins)
    {
        CreditApplicationEndpoints.Configure(group,origins);group.AddEndpointFilter(async(context,next)=>{context.HttpContext.Response.Headers["X-Sayman-Fulfillment-Contract"]="parcels-v1";return await next(context);});
    }
    private static bool Query(HttpContext h,params string[] allowed)=>CreditApplicationEndpoints.Query(h,allowed);
    private static string? After(HttpContext h)=>h.Request.Query.ContainsKey("after")?ParcelRules.After(h.Request.Query["after"].ToString()):null;
}
