using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Credit;
using Shop.Modules.Files;
using Shop.Modules.Identity;
using IdentityContext=Shop.Modules.Identity.IdentityDbContext;
using static CreditApplicationEndpoints;

public sealed class CreditReviewCoordinator(IdentityContext identity,CreditDbContext credit,FilesDbContext files,CreditReviewService service)
{
    public async Task<CreditReviewResult> RunAsync(string actor,string path,string trace,Func<CreditReviewService,Task<CreditReviewResult>> work,CancellationToken ct)
    {
        await using var tx=await identity.Database.BeginTransactionAsync(IsolationLevel.Serializable,ct);DbContext[] participants=[credit,files];var enlisted=new List<DbContext>();
        try{
            var connection=identity.Database.GetDbConnection();foreach(var db in participants){var original=db.Database.GetDbConnection();if(original.State!=ConnectionState.Closed||original.Database!=connection.Database||original.DataSource!=connection.DataSource)throw new InvalidOperationException("Credit review snapshots require closed module connections to the same database.");db.Database.SetDbConnection(connection,false);await db.Database.UseTransactionAsync(tx.GetDbTransaction(),ct);enlisted.Add(db);}
            var result=await work(service);if(!result.Replayed){identity.Audit.Add(new AuditEvent{ActorId=actor,Action="CREDIT_REVIEW",Resource=path,TraceId=trace});await identity.SaveChangesAsync(ct);}await tx.CommitAsync(ct);return result;
        }finally{foreach(var db in enlisted)await db.Database.UseTransactionAsync(null,CancellationToken.None);}
    }
}
public static class CreditReviewEndpoints
{
    public static void MapCreditReviews(this WebApplication app,string[] origins,string[] adminOrigins)
    {
        var customer=app.MapGroup("/api/credit").RequireAuthorization("customer").RequireRateLimiting("credit_applications");Configure(customer,origins);Reads(customer,false);
        var staff=app.MapGroup("/api/admin/credit").RequireAuthorization("staff_mfa","credit.read").RequireRateLimiting("credit_applications");Configure(staff,adminOrigins);Reads(staff,true);
        staff.MapGet("/applications/{id}/review",async(string id,HttpContext h,CreditReviewService service,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await service.CapabilitiesAsync(Actor(h),h.User.HasClaim("permission","credit.write"),id,ct)));
        staff.MapPost("/applications/{id}/reviews/commands/{commandId}",async(string id,string commandId,ReviewCreditApplicationInput input,HttpContext h,CreditReviewCoordinator coordinator,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await coordinator.RunAsync(Actor(h),h.Request.Path,h.TraceIdentifier,s=>s.ReviewAsync(Actor(h),id,commandId,input,ct),ct))).RequireAuthorization("credit.write");
        staff.MapGet("/applications/{id}/reviews/commands/{commandId}",async(string id,string commandId,HttpContext h,CreditReviewService service,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await service.ReceiptAsync(Actor(h),id,commandId,ct))).RequireAuthorization("credit.write");
    }
    private static void Reads(RouteGroupBuilder group,bool staff)
    {
        group.MapGet("/applications/{id}/reviews",async(string id,HttpContext h,CreditReviewService service,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await service.PageAsync(Actor(h),staff,id,ct)));
        group.MapGet("/applications/{id}/reviews/{reviewId}",async(string id,string reviewId,HttpContext h,CreditReviewService service,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await service.DetailAsync(Actor(h),staff,id,reviewId,ct)));
    }
}
