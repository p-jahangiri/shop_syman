using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Credit;
using Shop.Modules.Identity;
using IdentityContext=Shop.Modules.Identity.IdentityDbContext;
using static CreditApplicationEndpoints;

public sealed class CreditRequirementsCoordinator(IdentityContext identity,CreditDbContext credit,CreditRequirementsService service)
{
    public async Task<T> RunAsync<T>(string actor,string action,string path,string trace,Func<CreditRequirementsService,Task<T>> work,CancellationToken ct)where T:ICreditRequirementsCommandResult
    {
        if(action is not("CREDIT_REQUIREMENTS"or"CREDIT_CONSENT"))throw new InvalidOperationException("Unknown credit audit action.");
        await using var tx=await identity.Database.BeginTransactionAsync(IsolationLevel.Serializable,ct);var connection=identity.Database.GetDbConnection();var original=credit.Database.GetDbConnection();if(original.State!=ConnectionState.Closed||original.Database!=connection.Database||original.DataSource!=connection.DataSource)throw new InvalidOperationException("Credit audit requires closed module connections to the same database.");credit.Database.SetDbConnection(connection,false);await credit.Database.UseTransactionAsync(tx.GetDbTransaction(),ct);
        try{var result=await work(service);if(!result.Replayed){identity.Audit.Add(new AuditEvent{ActorId=actor,Action=action,Resource=path,TraceId=trace});await identity.SaveChangesAsync(ct);}await tx.CommitAsync(ct);return result;}finally{await credit.Database.UseTransactionAsync(null,CancellationToken.None);}
    }
}
public static class CreditRequirementsEndpoints
{
    public static void MapCreditRequirements(this WebApplication app,string[] origins,string[] adminOrigins)
    {
        var customer=app.MapGroup("/api/credit").RequireAuthorization("customer").RequireRateLimiting("credit_applications");Configure(customer,origins);
        customer.MapGet("/requirements",async(HttpContext h,CreditRequirementsService s,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await s.CurrentAsync(ct)));
        customer.MapGet("/applications/{id}/requirements",async(string id,HttpContext h,CreditRequirementsService s,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await s.CaseAsync(Actor(h),false,id,ct)));
        customer.MapGet("/applications/{id}/consents/{commandId}",async(string id,string commandId,HttpContext h,CreditRequirementsService s,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await s.ConsentReceiptAsync(Actor(h),id,commandId,ct)));
        customer.MapPost("/applications/{id}/consents/{commandId}",async(string id,string commandId,AcceptCreditRequirementsInput input,HttpContext h,CreditRequirementsCoordinator c,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await c.RunAsync(Actor(h),"CREDIT_CONSENT",h.Request.Path,h.TraceIdentifier,s=>s.AcceptAsync(Actor(h),id,commandId,input,ct),ct)));

        var readers=app.MapGroup("/api/admin/credit").RequireAuthorization("staff_mfa","credit.read").RequireRateLimiting("credit_applications");Configure(readers,adminOrigins);
        readers.MapGet("/applications/{id}/requirements",async(string id,HttpContext h,CreditRequirementsService s,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await s.CaseAsync(Actor(h),true,id,ct)));

        // Financial plan managers can configure public application rules, but
        // this grants no access to a customer's private credit case/documents.
        var policies=app.MapGroup("/api/admin/credit/requirements").RequireAuthorization("staff_mfa","finance.read").RequireRateLimiting("credit_applications");Configure(policies,adminOrigins);
        policies.MapGet("",async(HttpContext h,CreditRequirementsService s,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await s.CurrentAsync(ct)));
        policies.MapGet("/history",async(string? cursor,HttpContext h,CreditRequirementsService s,CancellationToken ct)=>!Query(h,"cursor")?Results.BadRequest():Results.Ok(await s.HistoryAsync(cursor,ct)));
        policies.MapGet("/revisions/{id}",async(string id,HttpContext h,CreditRequirementsService s,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await s.RevisionAsync(id,ct)));
        policies.MapGet("/commands/{commandId}",async(string commandId,HttpContext h,CreditRequirementsService s,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await s.PublishReceiptAsync(Actor(h),commandId,ct))).RequireAuthorization("finance.write");
        policies.MapPost("/commands/{commandId}",async(string commandId,PublishCreditRequirementsInput input,HttpContext h,CreditRequirementsCoordinator c,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await c.RunAsync(Actor(h),"CREDIT_REQUIREMENTS",h.Request.Path,h.TraceIdentifier,s=>s.PublishAsync(Actor(h),commandId,input,ct),ct))).RequireAuthorization("finance.write");
    }
}
