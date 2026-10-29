using Shop.Modules.Credit;
using Shop.Modules.Identity;
public sealed class ChequeApprovalCoordinator(CreditScheduleCoordinator transactions,ChequeApprovalService service,IdentityDbContext identity)
{
    public Task<T> ReadAsync<T>(Func<ChequeApprovalService,Task<T>> work,CancellationToken ct)=>transactions.Atomic(()=>work(service),ct);
    public Task<ChequeApprovalResult> WriteAsync(string actor,string owner,string order,string cheque,string command,ChequeApprovalInput input,string path,string trace,CancellationToken ct)=>transactions.Atomic(async()=>{
        var r=await service.WriteAsync(actor,owner,order,cheque,command,input,ct);if(!r.Replayed){identity.Audit.Add(new AuditEvent{ActorId=actor,Action="CREDIT_CHEQUE_APPROVAL_"+input.Action.ToUpperInvariant(),Resource=path,TraceId=trace});await identity.SaveChangesAsync(ct);await service.EnsureCommitAsync(owner,order,cheque,input,ct);}return r;
    },ct);
}
public static class ChequeApprovalEndpoints
{
    public static void MapChequeApproval(this WebApplication app,string[] origins,string[] adminOrigins)
    {
        var customer=app.MapGroup("/api/credit/orders/{orderId}/cheque-approvals").RequireAuthorization("customer").RequireRateLimiting("credit_applications");CreditApplicationEndpoints.Configure(customer,origins);
        customer.MapGet("",async(string orderId,HttpContext h,ChequeApprovalCoordinator c,CancellationToken ct)=>!CreditApplicationEndpoints.Query(h)?Results.BadRequest():Results.Ok(await c.ReadAsync(s=>s.PageAsync(CreditApplicationEndpoints.Actor(h),orderId,ct),ct)));
        var staff=app.MapGroup("/api/admin/credit/orders/{ownerId}/{orderId}/cheque-approvals").RequireAuthorization("staff_mfa","finance.read").RequireRateLimiting("credit_applications");CreditApplicationEndpoints.Configure(staff,adminOrigins);
        staff.MapGet("",async(string ownerId,string orderId,HttpContext h,ChequeApprovalCoordinator c,CancellationToken ct)=>!CreditApplicationEndpoints.Query(h)?Results.BadRequest():Results.Ok(await c.ReadAsync(s=>s.PageAsync(ownerId,orderId,ct),ct)));
        staff.MapGet("/{chequeId}",async(string ownerId,string orderId,string chequeId,HttpContext h,ChequeApprovalCoordinator c,CancellationToken ct)=>!CreditApplicationEndpoints.Query(h)?Results.BadRequest():Results.Ok(await c.ReadAsync(s=>s.DetailAsync(ownerId,orderId,chequeId,ct,h.User.HasClaim("permission","finance.write")),ct)));
        staff.MapGet("/{chequeId}/history",async(string ownerId,string orderId,string chequeId,int? beforeSequence,HttpContext h,ChequeApprovalCoordinator c,CancellationToken ct)=>!(CreditApplicationEndpoints.Query(h,"beforeSequence")&&(!h.Request.Query.ContainsKey("beforeSequence")?beforeSequence is null:beforeSequence is>0 and<=200&&h.Request.Query["beforeSequence"].ToString()==beforeSequence.Value.ToString(System.Globalization.CultureInfo.InvariantCulture)))?Results.BadRequest():Results.Ok(await c.ReadAsync(s=>s.HistoryAsync(ownerId,orderId,chequeId,beforeSequence,ct),ct)));
        staff.MapPost("/{chequeId}/commands/{commandId}",async(string ownerId,string orderId,string chequeId,string commandId,ChequeApprovalInput input,HttpContext h,ChequeApprovalCoordinator c,CancellationToken ct)=>!CreditApplicationEndpoints.Query(h)?Results.BadRequest():Results.Ok(await c.WriteAsync(CreditApplicationEndpoints.Actor(h),ownerId,orderId,chequeId,commandId,input,h.Request.Path,h.TraceIdentifier,ct))).RequireAuthorization("finance.write");
        staff.MapGet("/{chequeId}/commands/{commandId}",async(string ownerId,string orderId,string chequeId,string commandId,HttpContext h,ChequeApprovalService service,CancellationToken ct)=>!CreditApplicationEndpoints.Query(h)?Results.BadRequest():Results.Ok(await service.ReceiptAsync(CreditApplicationEndpoints.Actor(h),ownerId,orderId,chequeId,commandId,ct))).RequireAuthorization("finance.write");
    }
}
