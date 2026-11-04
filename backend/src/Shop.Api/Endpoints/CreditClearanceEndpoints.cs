using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Credit;
using Shop.Modules.Identity;
using Shop.Modules.Sales;
using Shop.Modules.Inventory;
public sealed class CreditClearanceCoordinator(IServiceProvider services,CreditClearanceService service)
{
    public async Task<T> Atomic<T>(Func<Task<T>> work,CancellationToken ct)
    {
        var identity=services.GetRequiredService<IdentityDbContext>();await using var tx=await identity.Database.BeginTransactionAsync(IsolationLevel.Serializable,ct);var enlisted=new List<DbContext>();try{var connection=identity.Database.GetDbConnection();foreach(var type in new[]{typeof(SalesDbContext),typeof(CreditDbContext),typeof(InventoryDbContext)}){var db=(DbContext)services.GetRequiredService(type);var original=db.Database.GetDbConnection();if(original.State!=ConnectionState.Closed||original.Database!=connection.Database||original.DataSource!=connection.DataSource)throw new InvalidOperationException("Financial clearance participants must share the same root connection.");db.Database.SetDbConnection(connection,false);await db.Database.UseTransactionAsync(tx.GetDbTransaction(),ct);enlisted.Add(db);}var result=await work();await tx.CommitAsync(ct);return result;}finally{foreach(var db in enlisted)await db.Database.UseTransactionAsync(null,CancellationToken.None);}
    }
    public Task<T> ReadAsync<T>(Func<CreditClearanceService,Task<T>> read,CancellationToken ct)=>Atomic(()=>read(service),ct);
    public Task<CreditClearanceResult> WriteAsync(string actor,string owner,string order,string command,CreditClearanceInput input,string path,string trace,CancellationToken ct)=>Atomic(async()=>{var r=await service.WriteAsync(actor,owner,order,command,input,ct);if(!r.Replayed){var identity=services.GetRequiredService<IdentityDbContext>();identity.Audit.Add(new AuditEvent{ActorId=actor,Action="CREDIT_CLEARANCE_"+input.Action.ToUpperInvariant(),Resource=path,TraceId=trace});await identity.SaveChangesAsync(ct);await service.EnsureCommitAsync(owner,order,r,ct);}return r;},ct);
}
public static class CreditClearanceEndpoints
{
    public static void MapCreditClearance(this WebApplication app,string[] origins,string[] adminOrigins)
    {
        var customer=app.MapGroup("/api/credit/orders/{orderId}/clearance").RequireAuthorization("customer").RequireRateLimiting("credit_applications");CreditApplicationEndpoints.Configure(customer,origins);customer.MapGet("",async(string orderId,HttpContext h,CreditClearanceCoordinator c,CancellationToken ct)=>!CreditApplicationEndpoints.Query(h)?Results.BadRequest():Results.Ok(await c.ReadAsync(s=>s.CustomerAsync(CreditApplicationEndpoints.Actor(h),orderId,ct),ct)));
        var staff=app.MapGroup("/api/admin/credit/orders/{ownerId}/{orderId}/clearance").RequireAuthorization("staff_mfa","finance.read").RequireRateLimiting("credit_applications");CreditApplicationEndpoints.Configure(staff,adminOrigins);
        staff.MapGet("",async(string ownerId,string orderId,HttpContext h,CreditClearanceCoordinator c,CancellationToken ct)=>!CreditApplicationEndpoints.Query(h)?Results.BadRequest():Results.Ok(await c.ReadAsync(s=>s.PageAsync(ownerId,orderId,h.User.HasClaim("permission","finance.write"),ct),ct)));
        staff.MapGet("/history",async(string ownerId,string orderId,int? beforeSequence,HttpContext h,CreditClearanceCoordinator c,CancellationToken ct)=>!(CreditApplicationEndpoints.Query(h,"beforeSequence")&&(!h.Request.Query.ContainsKey("beforeSequence")?beforeSequence is null:beforeSequence is>0 and<=200&&h.Request.Query["beforeSequence"].ToString()==beforeSequence.Value.ToString(System.Globalization.CultureInfo.InvariantCulture)))?Results.BadRequest():Results.Ok(await c.ReadAsync(s=>s.HistoryAsync(ownerId,orderId,beforeSequence,ct),ct)));
        staff.MapPost("/commands/{commandId}",async(string ownerId,string orderId,string commandId,CreditClearanceInput input,HttpContext h,CreditClearanceCoordinator c,CancellationToken ct)=>!CreditApplicationEndpoints.Query(h)?Results.BadRequest():Results.Ok(await c.WriteAsync(CreditApplicationEndpoints.Actor(h),ownerId,orderId,commandId,input,h.Request.Path,h.TraceIdentifier,ct))).RequireAuthorization("finance.write");
        staff.MapGet("/commands/{commandId}",async(string ownerId,string orderId,string commandId,HttpContext h,CreditClearanceService s,CancellationToken ct)=>!CreditApplicationEndpoints.Query(h)?Results.BadRequest():Results.Ok(await s.ReceiptAsync(CreditApplicationEndpoints.Actor(h),ownerId,orderId,commandId,ct))).RequireAuthorization("finance.write");
    }
}
