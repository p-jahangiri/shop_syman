using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Credit;
using Shop.Modules.Sales;
using Shop.Modules.Identity;
using IdentityContext=Shop.Modules.Identity.IdentityDbContext;
public sealed class CreditScheduleCoordinator(IServiceProvider services,CreditScheduleService service)
{
    public Task<CreditScheduleResult> SaveAsync(string actor,string owner,string orderId,string commandId,SaveCreditScheduleInput input,string path,string trace,CancellationToken ct)=>Atomic(async()=>{
        var result=await service.SaveAsync(actor,owner,orderId,commandId,input,ct);if(!result.Replayed){var identity=services.GetRequiredService<IdentityContext>();identity.Audit.Add(new AuditEvent{ActorId=actor,Action="CREDIT_SCHEDULE_SAVE",Resource=path,TraceId=trace});await identity.SaveChangesAsync(ct);await service.EnsureCommitAsync(owner,orderId,input.OrderVersion,ct);}return result;
    },ct);
    public Task<T> ReadAsync<T>(Func<CreditScheduleService,Task<T>> read,CancellationToken ct)=>Atomic(()=>read(service),ct);
    public async Task<T> Atomic<T>(Func<Task<T>> work,CancellationToken ct)
    {
        var identity=services.GetRequiredService<IdentityContext>();await using var tx=await identity.Database.BeginTransactionAsync(IsolationLevel.Serializable,ct);var enlisted=new List<DbContext>();
        try{var connection=identity.Database.GetDbConnection();foreach(var type in new[]{typeof(SalesDbContext),typeof(CreditDbContext)}){var db=(DbContext)services.GetRequiredService(type);var original=db.Database.GetDbConnection();if(original.State!=ConnectionState.Closed||original.Database!=connection.Database||original.DataSource!=connection.DataSource)throw new InvalidOperationException("Cheque schedules require closed module connections to the same database.");db.Database.SetDbConnection(connection,false);await db.Database.UseTransactionAsync(tx.GetDbTransaction(),ct);enlisted.Add(db);}var value=await work();await tx.CommitAsync(ct);return value;}finally{foreach(var db in enlisted)await db.Database.UseTransactionAsync(null,CancellationToken.None);}
    }
}
public static class CreditScheduleEndpoints
{
    private static bool HistoryQuery(HttpContext h,int? value)=>CreditApplicationEndpoints.Query(h,"beforeRevision")&&(!h.Request.Query.ContainsKey("beforeRevision")?value is null:value is>0&&h.Request.Query["beforeRevision"].ToString()==value.Value.ToString(System.Globalization.CultureInfo.InvariantCulture));
    public static void MapCreditSchedules(this WebApplication app,string[] origins,string[] adminOrigins)
    {
        var customer=app.MapGroup("/api/credit/orders/{orderId}/schedule").RequireAuthorization("customer").RequireRateLimiting("credit_applications");CreditApplicationEndpoints.Configure(customer,origins);
        customer.MapGet("",async(string orderId,HttpContext h,CreditScheduleCoordinator c,CancellationToken ct)=>!CreditApplicationEndpoints.Query(h)?Results.BadRequest():Results.Ok(await c.ReadAsync(s=>s.PageAsync(CreditApplicationEndpoints.Actor(h),orderId,false,ct),ct)));
        customer.MapGet("/history",async(string orderId,int? beforeRevision,HttpContext h,CreditScheduleCoordinator c,CancellationToken ct)=>!HistoryQuery(h,beforeRevision)?Results.BadRequest():Results.Ok(await c.ReadAsync(s=>s.HistoryAsync(CreditApplicationEndpoints.Actor(h),orderId,beforeRevision,ct),ct)));
        var queue=app.MapGroup("/api/admin/credit/orders").RequireAuthorization("staff_mfa","finance.read").RequireRateLimiting("credit_applications");CreditApplicationEndpoints.Configure(queue,adminOrigins);
        queue.MapGet("",async(string? cursor,HttpContext h,Shop.SharedKernel.ICreditOrderScheduleSource source,CancellationToken ct)=>!CreditApplicationEndpoints.Query(h,"cursor")?Results.BadRequest():Results.Ok(await source.PageForFinanceAsync(cursor,ct)));
        var staff=app.MapGroup("/api/admin/credit/orders/{ownerId}/{orderId}/schedule").RequireAuthorization("staff_mfa","finance.read").RequireRateLimiting("credit_applications");CreditApplicationEndpoints.Configure(staff,adminOrigins);
        staff.MapGet("",async(string ownerId,string orderId,HttpContext h,CreditScheduleCoordinator c,CancellationToken ct)=>!CreditApplicationEndpoints.Query(h)?Results.BadRequest():Results.Ok(await c.ReadAsync(s=>s.PageAsync(ownerId,orderId,h.User.HasClaim("permission","finance.write"),ct),ct)));
        staff.MapGet("/history",async(string ownerId,string orderId,int? beforeRevision,HttpContext h,CreditScheduleCoordinator c,CancellationToken ct)=>!HistoryQuery(h,beforeRevision)?Results.BadRequest():Results.Ok(await c.ReadAsync(s=>s.HistoryAsync(ownerId,orderId,beforeRevision,ct),ct)));
        staff.MapPost("/preview",async(string ownerId,string orderId,CreditSchedulePreviewInput input,HttpContext h,CreditScheduleCoordinator c,CancellationToken ct)=>!CreditApplicationEndpoints.Query(h)?Results.BadRequest():Results.Ok(await c.ReadAsync(s=>s.PreviewAsync(ownerId,orderId,input,ct),ct))).RequireAuthorization("finance.write");
        staff.MapPost("/commands/{commandId}",async(string ownerId,string orderId,string commandId,SaveCreditScheduleInput input,HttpContext h,CreditScheduleCoordinator c,CancellationToken ct)=>!CreditApplicationEndpoints.Query(h)?Results.BadRequest():Results.Ok(await c.SaveAsync(CreditApplicationEndpoints.Actor(h),ownerId,orderId,commandId,input,h.Request.Path,h.TraceIdentifier,ct))).RequireAuthorization("finance.write");
        staff.MapGet("/commands/{commandId}",async(string ownerId,string orderId,string commandId,HttpContext h,CreditScheduleService s,CancellationToken ct)=>!CreditApplicationEndpoints.Query(h)?Results.BadRequest():Results.Ok(await s.ReceiptAsync(CreditApplicationEndpoints.Actor(h),ownerId,orderId,commandId,ct))).RequireAuthorization("finance.write");
    }
}
