using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Identity;
using Shop.Modules.Sales;
public sealed class ChequeReviewHoldCoordinator(IdentityDbContext identity,SalesDbContext sales,ChequeReviewHoldService service)
{
    public async Task<T> ReadAsync<T>(Func<ChequeReviewHoldService,Task<T>> work,CancellationToken ct)
    {
        await using var tx=await identity.Database.BeginTransactionAsync(IsolationLevel.Serializable,ct);var connection=identity.Database.GetDbConnection();var original=sales.Database.GetDbConnection();if(original.State!=ConnectionState.Closed||original.Database!=connection.Database||original.DataSource!=connection.DataSource)throw new InvalidOperationException("Review-hold policy requires closed Sales and Identity connections to the same database.");sales.Database.SetDbConnection(connection,false);await sales.Database.UseTransactionAsync(tx.GetDbTransaction(),ct);try{var r=await work(service);await tx.CommitAsync(ct);return r;}finally{await sales.Database.UseTransactionAsync(null,CancellationToken.None);}
    }
    public Task<ChequeReviewHoldResult> WriteAsync(string actor,string command,ChequeReviewHoldInput input,string path,string trace,CancellationToken ct)=>ReadAsync(async s=>{
        var r=await s.WriteAsync(actor,command,input,ct);if(!r.Replayed){identity.Audit.Add(new AuditEvent{ActorId=actor,Action="SALES_CHEQUE_REVIEW_HOLD_"+input.Action.ToUpperInvariant(),Resource=path,TraceId=trace});await identity.SaveChangesAsync(ct);}return r;
    },ct);
}
public static class ChequeReviewHoldEndpoints
{
    public static void MapChequeReviewHold(this WebApplication app,string[] adminOrigins)
    {
        var staff=app.MapGroup("/api/admin/credit/review-hold-policy").RequireAuthorization("staff_mfa","finance.read").RequireRateLimiting("credit_applications");CreditApplicationEndpoints.Configure(staff,adminOrigins);
        staff.MapGet("",async(HttpContext h,ChequeReviewHoldCoordinator c,CancellationToken ct)=>!CreditApplicationEndpoints.Query(h)?Results.BadRequest():Results.Ok(await c.ReadAsync(s=>s.CurrentAsync(ct),ct)));
        staff.MapGet("/history",async(int? beforeRevision,HttpContext h,ChequeReviewHoldCoordinator c,CancellationToken ct)=>!(CreditApplicationEndpoints.Query(h,"beforeRevision")&&(!h.Request.Query.ContainsKey("beforeRevision")?beforeRevision is null:beforeRevision is>0 and<=10000&&h.Request.Query["beforeRevision"].ToString()==beforeRevision.Value.ToString(System.Globalization.CultureInfo.InvariantCulture)))?Results.BadRequest():Results.Ok(await c.ReadAsync(s=>s.HistoryAsync(beforeRevision,ct),ct)));
        staff.MapPost("/commands/{commandId}",async(string commandId,ChequeReviewHoldInput input,HttpContext h,ChequeReviewHoldCoordinator c,CancellationToken ct)=>!CreditApplicationEndpoints.Query(h)?Results.BadRequest():Results.Ok(await c.WriteAsync(CreditApplicationEndpoints.Actor(h),commandId,input,h.Request.Path,h.TraceIdentifier,ct))).RequireAuthorization("finance.write");
        staff.MapGet("/commands/{commandId}",async(string commandId,HttpContext h,ChequeReviewHoldService s,CancellationToken ct)=>!CreditApplicationEndpoints.Query(h)?Results.BadRequest():Results.Ok(await s.ReceiptAsync(CreditApplicationEndpoints.Actor(h),commandId,ct))).RequireAuthorization("finance.write");
    }
}
