using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Credit;
using Shop.Modules.Files;
using Shop.Modules.Identity;
using IdentityContext=Shop.Modules.Identity.IdentityDbContext;
using static CreditApplicationEndpoints;

public sealed class CreditSubmissionCoordinator(IdentityContext identity,CreditDbContext credit,FilesDbContext files,CreditSubmissionService service)
{
    public async Task<CreditSubmissionResult> RunAsync(string actor,string path,string trace,Func<CreditSubmissionService,Task<CreditSubmissionResult>> work,CancellationToken ct)
    {
        await using var tx=await identity.Database.BeginTransactionAsync(IsolationLevel.Serializable,ct);DbContext[] participants=[credit,files];var enlisted=new List<DbContext>();
        try{
            var connection=identity.Database.GetDbConnection();foreach(var db in participants){var original=db.Database.GetDbConnection();if(original.State!=ConnectionState.Closed||original.Database!=connection.Database||original.DataSource!=connection.DataSource)throw new InvalidOperationException("Credit submission snapshots require closed module connections to the same database.");db.Database.SetDbConnection(connection,false);await db.Database.UseTransactionAsync(tx.GetDbTransaction(),ct);enlisted.Add(db);}
            var result=await work(service);if(!result.Replayed){identity.Audit.Add(new AuditEvent{ActorId=actor,Action="CREDIT_SUBMIT",Resource=path,TraceId=trace});await identity.SaveChangesAsync(ct);}await tx.CommitAsync(ct);return result;
        }finally{foreach(var db in enlisted)await db.Database.UseTransactionAsync(null,CancellationToken.None);}
    }
}
public static class CreditSubmissionEndpoints
{
    public static void MapCreditSubmissions(this WebApplication app,string[] origins,string[] adminOrigins)
    {
        var customer=app.MapGroup("/api/credit").RequireAuthorization("customer").RequireRateLimiting("credit_applications");Configure(customer,origins);Reads(customer,false);
        customer.MapPost("/applications/{id}/submissions/commands/{commandId}",async(string id,string commandId,SubmitCreditApplicationInput input,HttpContext h,CreditSubmissionCoordinator coordinator,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await coordinator.RunAsync(Actor(h),h.Request.Path,h.TraceIdentifier,s=>s.SubmitAsync(Actor(h),id,commandId,input,ct),ct)));
        customer.MapGet("/applications/{id}/submissions/commands/{commandId}",async(string id,string commandId,HttpContext h,CreditSubmissionService service,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await service.ReceiptAsync(Actor(h),id,commandId,ct)));
        var staff=app.MapGroup("/api/admin/credit").RequireAuthorization("staff_mfa","credit.read").RequireRateLimiting("credit_applications");Configure(staff,adminOrigins);Reads(staff,true);
    }
    private static void Reads(RouteGroupBuilder group,bool staff)
    {
        group.MapGet("/applications/{id}/submission",async(string id,HttpContext h,CreditSubmissionService service,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await service.CapabilitiesAsync(Actor(h),staff,id,ct)));
        group.MapGet("/applications/{id}/submissions",async(string id,HttpContext h,CreditSubmissionService service,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await service.PageAsync(Actor(h),staff,id,null,ct)));
        group.MapGet("/applications/{id}/submissions/{submissionId}",async(string id,string submissionId,HttpContext h,CreditSubmissionService service,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await service.DetailAsync(Actor(h),staff,id,submissionId,ct)));
    }
}
