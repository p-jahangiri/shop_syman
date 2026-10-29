using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Credit;
using Shop.Modules.Identity;
using Shop.Modules.Notifications;
using Shop.Modules.Sales;
public sealed class CreditReminderCoordinator(IServiceProvider services,CreditReminderService service)
{
    public async Task<T> Atomic<T>(Func<Task<T>> work,CancellationToken ct)
    {
        var identity=services.GetRequiredService<IdentityDbContext>();await using var tx=await identity.Database.BeginTransactionAsync(IsolationLevel.Serializable,ct);var enlisted=new List<DbContext>();
        try{var connection=identity.Database.GetDbConnection();foreach(var type in new[]{typeof(SalesDbContext),typeof(CreditDbContext),typeof(NotificationsDbContext)}){var db=(DbContext)services.GetRequiredService(type);var original=db.Database.GetDbConnection();if(original.State!=ConnectionState.Closed||original.Database!=connection.Database||original.DataSource!=connection.DataSource)throw new InvalidOperationException("Private cheque reminders require closed module connections to the same database.");db.Database.SetDbConnection(connection,false);await db.Database.UseTransactionAsync(tx.GetDbTransaction(),ct);enlisted.Add(db);}var value=await work();await tx.CommitAsync(ct);return value;}finally{foreach(var db in enlisted)await db.Database.UseTransactionAsync(null,CancellationToken.None);}
    }
    public Task<T> ReadAsync<T>(Func<CreditReminderService,Task<T>> read,CancellationToken ct)=>Atomic(()=>read(service),ct);
    public Task<CreditReminderResult> SendAsync(string actor,string owner,string order,string cheque,string command,CreditReminderInput input,string path,string trace,CancellationToken ct)=>Atomic(async()=>{var r=await service.SendAsync(actor,owner,order,cheque,command,input,ct);if(!r.Replayed){var identity=services.GetRequiredService<IdentityDbContext>();identity.Audit.Add(new AuditEvent{ActorId=actor,Action="CREDIT_CHEQUE_REMINDER",Resource=path,TraceId=trace});await identity.SaveChangesAsync(ct);await service.EnsureCommitAsync(owner,order,cheque,input,r,ct);}return r;},ct);
}
public static class CreditReminderEndpoints
{
    public static void MapCreditReminders(this WebApplication app,string[] adminOrigins)
    {
        var group=app.MapGroup("/api/admin/credit/orders/{ownerId}/{orderId}/cheques/{chequeId}/reminders").RequireAuthorization("staff_mfa","finance.read").RequireRateLimiting("credit_applications");CreditApplicationEndpoints.Configure(group,adminOrigins);
        group.MapGet("",async(string ownerId,string orderId,string chequeId,HttpContext h,CreditReminderCoordinator c,CancellationToken ct)=>!CreditApplicationEndpoints.Query(h)?Results.BadRequest():Results.Ok(await c.ReadAsync(s=>s.PageAsync(ownerId,orderId,chequeId,h.User.HasClaim("permission","finance.write"),ct),ct)));
        group.MapGet("/history",async(string ownerId,string orderId,string chequeId,int? beforeSequence,HttpContext h,CreditReminderCoordinator c,CancellationToken ct)=>!(CreditApplicationEndpoints.Query(h,"beforeSequence")&&(!h.Request.Query.ContainsKey("beforeSequence")?beforeSequence is null:beforeSequence is>0 and<=CreditReminderRules.MaxEvents&&h.Request.Query["beforeSequence"].ToString()==beforeSequence.Value.ToString(System.Globalization.CultureInfo.InvariantCulture)))?Results.BadRequest():Results.Ok(await c.ReadAsync(s=>s.HistoryAsync(ownerId,orderId,chequeId,beforeSequence,ct),ct)));
        group.MapPost("/commands/{commandId}",async(string ownerId,string orderId,string chequeId,string commandId,CreditReminderInput input,HttpContext h,CreditReminderCoordinator c,CancellationToken ct)=>!CreditApplicationEndpoints.Query(h)?Results.BadRequest():Results.Ok(await c.SendAsync(CreditApplicationEndpoints.Actor(h),ownerId,orderId,chequeId,commandId,input,h.Request.Path,h.TraceIdentifier,ct))).RequireAuthorization("finance.write");
        group.MapGet("/commands/{commandId}",async(string ownerId,string orderId,string chequeId,string commandId,HttpContext h,CreditReminderService service,CancellationToken ct)=>!CreditApplicationEndpoints.Query(h)?Results.BadRequest():Results.Ok(await service.ReceiptAsync(CreditApplicationEndpoints.Actor(h),ownerId,orderId,chequeId,commandId,ct))).RequireAuthorization("finance.write");
    }
}
