using Shop.Modules.Credit;
using Shop.Modules.Identity;
public sealed class CreditReminderPolicyCoordinator(IServiceProvider services,CreditReminderCoordinator coordinator,CreditReminderPolicyService policy)
{
    public Task<T> ReadAsync<T>(Func<CreditReminderPolicyService,Task<T>> read,CancellationToken ct)=>coordinator.Atomic(()=>read(policy),ct);
    public Task<CreditReminderPolicyResult> WriteAsync(string actor,string command,CreditReminderPolicyInput input,string path,string trace,CancellationToken ct)=>coordinator.Atomic(async()=>{var r=await policy.WriteAsync(actor,command,input,ct);if(!r.Replayed){var identity=services.GetRequiredService<IdentityDbContext>();identity.Audit.Add(new AuditEvent{ActorId=actor,Action="CREDIT_REMINDER_POLICY_"+(input.Enabled?"ENABLE":"DISABLE"),Resource=path,TraceId=trace});await identity.SaveChangesAsync(ct);}return r;},ct);
}
public static class CreditReminderPolicyEndpoints
{
    public static void MapCreditReminderPolicy(this WebApplication app,string[] adminOrigins)
    {
        var g=app.MapGroup("/api/admin/credit/reminder-policy").RequireAuthorization("staff_mfa","finance.read").RequireRateLimiting("credit_applications");CreditApplicationEndpoints.Configure(g,adminOrigins);
        g.MapGet("",async(HttpContext h,CreditReminderPolicyCoordinator c,CancellationToken ct)=>!CreditApplicationEndpoints.Query(h)?Results.BadRequest():Results.Ok(await c.ReadAsync(p=>p.CurrentAsync(ct),ct)));
        g.MapGet("/history",async(int? beforeRevision,HttpContext h,CreditReminderPolicyCoordinator c,CancellationToken ct)=>!(CreditApplicationEndpoints.Query(h,"beforeRevision")&&(!h.Request.Query.ContainsKey("beforeRevision")?beforeRevision is null:beforeRevision is>0 and<=CreditReminderPolicyRules.MaxRevisions&&h.Request.Query["beforeRevision"].ToString()==beforeRevision.Value.ToString(System.Globalization.CultureInfo.InvariantCulture)))?Results.BadRequest():Results.Ok(await c.ReadAsync(p=>p.HistoryAsync(beforeRevision,ct),ct)));
        g.MapPost("/commands/{commandId}",async(string commandId,CreditReminderPolicyInput input,HttpContext h,CreditReminderPolicyCoordinator c,CancellationToken ct)=>!CreditApplicationEndpoints.Query(h)?Results.BadRequest():Results.Ok(await c.WriteAsync(CreditApplicationEndpoints.Actor(h),commandId,input,h.Request.Path,h.TraceIdentifier,ct))).RequireAuthorization("finance.write");
        g.MapGet("/commands/{commandId}",async(string commandId,HttpContext h,CreditReminderPolicyService p,CancellationToken ct)=>!CreditApplicationEndpoints.Query(h)?Results.BadRequest():Results.Ok(await p.ReceiptAsync(CreditApplicationEndpoints.Actor(h),commandId,ct))).RequireAuthorization("finance.write");
    }
}
