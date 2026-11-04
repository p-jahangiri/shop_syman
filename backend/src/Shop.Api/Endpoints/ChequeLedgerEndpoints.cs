using Shop.Modules.Credit;
using Shop.Modules.Identity;
using IdentityContext=Shop.Modules.Identity.IdentityDbContext;
public sealed class ChequeLedgerCoordinator(CreditScheduleCoordinator transactions,ChequeLedgerService service,IdentityContext identity)
{
    public Task<T> ReadAsync<T>(Func<ChequeLedgerService,Task<T>> work,CancellationToken ct)=>transactions.Atomic(()=>work(service),ct);
    public Task<ChequeCommandResult> ReceiveAsync(string actor,string owner,string order,string cmd,ReceiveChequeInput input,string path,string trace,CancellationToken ct)=>transactions.Atomic(async()=>{
        var r=await service.ReceiveAsync(actor,owner,order,cmd,input,ct);if(!r.Replayed){await Audit(actor,"CREDIT_CHEQUE_RECEIVE",path,trace,ct);await service.EnsureReceiveCommit(owner,order,input.OrderVersion,ct);}return r;
    },ct);
    public Task<ChequeCommandResult> MoveAsync(string actor,string owner,string order,string cheque,string cmd,MoveChequeInput input,string path,string trace,CancellationToken ct)=>transactions.Atomic(async()=>{
        var r=await service.MoveAsync(actor,owner,order,cheque,cmd,input,ct);if(!r.Replayed){await Audit(actor,"CREDIT_CHEQUE_MOVE",path,trace,ct);await service.EnsureMoveCommit(owner,order,input.AcknowledgedClosedOrder,ct);}return r;
    },ct);
    private async Task Audit(string actor,string action,string path,string trace,CancellationToken ct)
    {
        identity.Audit.Add(new AuditEvent{ActorId=actor,Action=action,Resource=path,TraceId=trace});await identity.SaveChangesAsync(ct);
    }
}
public static class ChequeLedgerEndpoints
{
    private static bool Query(HttpContext h)=>CreditApplicationEndpoints.Query(h);
    public static void MapChequeLedger(this WebApplication app,string[] origins,string[] adminOrigins)
    {
        var customer=app.MapGroup("/api/credit/orders/{orderId}/cheques").RequireAuthorization("customer").RequireRateLimiting("credit_applications");CreditApplicationEndpoints.Configure(customer,origins);
        customer.MapGet("",async(string orderId,HttpContext h,ChequeLedgerCoordinator c,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await c.ReadAsync(s=>s.PageAsync(CreditApplicationEndpoints.Actor(h),orderId,false,ct),ct)));
        var staff=app.MapGroup("/api/admin/credit/orders/{ownerId}/{orderId}/cheques").RequireAuthorization("staff_mfa","finance.read").RequireRateLimiting("credit_applications");CreditApplicationEndpoints.Configure(staff,adminOrigins);
        staff.MapGet("",async(string ownerId,string orderId,HttpContext h,ChequeLedgerCoordinator c,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await c.ReadAsync(s=>s.PageAsync(ownerId,orderId,h.User.HasClaim("permission","finance.write"),ct),ct)));
        staff.MapGet("/{chequeId}",async(string ownerId,string orderId,string chequeId,HttpContext h,ChequeLedgerCoordinator c,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await c.ReadAsync(s=>s.DetailAsync(ownerId,orderId,chequeId,h.User.HasClaim("permission","finance.write"),ct),ct)));
        staff.MapGet("/{chequeId}/history",async(string ownerId,string orderId,string chequeId,int? beforeSequence,HttpContext h,ChequeLedgerCoordinator c,CancellationToken ct)=>!(CreditApplicationEndpoints.Query(h,"beforeSequence")&&(!h.Request.Query.ContainsKey("beforeSequence")?beforeSequence is null:beforeSequence is>0 and <=200&&beforeSequence.Value.ToString(System.Globalization.CultureInfo.InvariantCulture)==h.Request.Query["beforeSequence"].ToString()))?Results.BadRequest():Results.Ok(await c.ReadAsync(s=>s.HistoryAsync(ownerId,orderId,chequeId,beforeSequence,ct),ct)));
        staff.MapPost("/receive/commands/{commandId}",async(string ownerId,string orderId,string commandId,ReceiveChequeInput input,HttpContext h,ChequeLedgerCoordinator c,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await c.ReceiveAsync(CreditApplicationEndpoints.Actor(h),ownerId,orderId,commandId,input,h.Request.Path,h.TraceIdentifier,ct))).RequireAuthorization("finance.write");
        staff.MapPost("/{chequeId}/commands/{commandId}",async(string ownerId,string orderId,string chequeId,string commandId,MoveChequeInput input,HttpContext h,ChequeLedgerCoordinator c,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await c.MoveAsync(CreditApplicationEndpoints.Actor(h),ownerId,orderId,chequeId,commandId,input,h.Request.Path,h.TraceIdentifier,ct))).RequireAuthorization("finance.write");
        staff.MapGet("/commands/{commandId}",async(string ownerId,string orderId,string commandId,HttpContext h,ChequeLedgerService s,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await s.ReceiptAsync(CreditApplicationEndpoints.Actor(h),ownerId,orderId,commandId,ct))).RequireAuthorization("finance.write");
    }
}
