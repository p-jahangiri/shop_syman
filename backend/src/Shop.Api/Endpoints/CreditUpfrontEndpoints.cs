using Shop.Modules.Credit;
using Shop.Modules.Identity;
public sealed class CreditUpfrontCoordinator(CreditScheduleCoordinator transactions,CreditUpfrontService service,IdentityDbContext identity)
{
    public Task<T> ReadAsync<T>(Func<CreditUpfrontService,Task<T>> work,CancellationToken ct)=>transactions.Atomic(()=>work(service),ct);
    public Task<CreditUpfrontResult> WriteAsync(string actor,string owner,string order,string command,CreditUpfrontInput input,string path,string trace,CancellationToken ct)=>transactions.Atomic(async()=>{
        var result=await service.WriteAsync(actor,owner,order,command,input,ct);if(!result.Replayed){identity.Audit.Add(new AuditEvent{ActorId=actor,Action="CREDIT_UPFRONT_"+input.Action.ToUpperInvariant(),Resource=path,TraceId=trace});await identity.SaveChangesAsync(ct);await service.EnsureCommitAsync(owner,order,input,ct);}return result;
    },ct);
}
public static class CreditUpfrontEndpoints
{
    public static void MapCreditUpfront(this WebApplication app,string[] origins,string[] adminOrigins)
    {
        var customer=app.MapGroup("/api/credit/orders/{orderId}/upfront").RequireAuthorization("customer").RequireRateLimiting("credit_applications");CreditApplicationEndpoints.Configure(customer,origins);
        customer.MapGet("",async(string orderId,HttpContext h,CreditUpfrontCoordinator c,CancellationToken ct)=>!CreditApplicationEndpoints.Query(h)?Results.BadRequest():Results.Ok(await c.ReadAsync(s=>s.CustomerAsync(CreditApplicationEndpoints.Actor(h),orderId,ct),ct)));
        var staff=app.MapGroup("/api/admin/credit/orders/{ownerId}/{orderId}/upfront").RequireAuthorization("staff_mfa","finance.read").RequireRateLimiting("credit_applications");CreditApplicationEndpoints.Configure(staff,adminOrigins);
        staff.MapGet("",async(string ownerId,string orderId,HttpContext h,CreditUpfrontCoordinator c,CancellationToken ct)=>!CreditApplicationEndpoints.Query(h)?Results.BadRequest():Results.Ok(await c.ReadAsync(s=>s.PageAsync(ownerId,orderId,h.User.HasClaim("permission","finance.write"),ct),ct)));
        staff.MapGet("/history",async(string ownerId,string orderId,int? beforeSequence,HttpContext h,CreditUpfrontCoordinator c,CancellationToken ct)=>!(CreditApplicationEndpoints.Query(h,"beforeSequence")&&(!h.Request.Query.ContainsKey("beforeSequence")?beforeSequence is null:beforeSequence is>0 and<=200&&h.Request.Query["beforeSequence"].ToString()==beforeSequence.Value.ToString(System.Globalization.CultureInfo.InvariantCulture)))?Results.BadRequest():Results.Ok(await c.ReadAsync(s=>s.HistoryAsync(ownerId,orderId,beforeSequence,ct),ct)));
        staff.MapPost("/commands/{commandId}",async(string ownerId,string orderId,string commandId,CreditUpfrontInput input,HttpContext h,CreditUpfrontCoordinator c,CancellationToken ct)=>!CreditApplicationEndpoints.Query(h)?Results.BadRequest():Results.Ok(await c.WriteAsync(CreditApplicationEndpoints.Actor(h),ownerId,orderId,commandId,input,h.Request.Path,h.TraceIdentifier,ct))).RequireAuthorization("finance.write");
        staff.MapGet("/commands/{commandId}",async(string ownerId,string orderId,string commandId,HttpContext h,CreditUpfrontService service,CancellationToken ct)=>!CreditApplicationEndpoints.Query(h)?Results.BadRequest():Results.Ok(await service.ReceiptAsync(CreditApplicationEndpoints.Actor(h),ownerId,orderId,commandId,ct))).RequireAuthorization("finance.write");
    }
}
