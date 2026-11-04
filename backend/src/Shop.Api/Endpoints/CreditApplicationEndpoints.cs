using System.Data;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Credit;
using Shop.Modules.Identity;
using Shop.SharedKernel;
using IdentityContext=Shop.Modules.Identity.IdentityDbContext;
public sealed class CreditApplicationCoordinator(IdentityContext identity,CreditDbContext credit,CreditApplicationService service)
{
    public async Task<CreditApplicationResult> RunAsync(string actor,string path,string trace,Func<CreditApplicationService,Task<CreditApplicationResult>> work,CancellationToken ct)
    {
        await using var tx=await identity.Database.BeginTransactionAsync(IsolationLevel.Serializable,ct);var connection=identity.Database.GetDbConnection();var original=credit.Database.GetDbConnection();if(original.State!=ConnectionState.Closed||original.Database!=connection.Database||original.DataSource!=connection.DataSource)throw new InvalidOperationException("Credit audit requires closed module connections to the same database.");credit.Database.SetDbConnection(connection,false);await credit.Database.UseTransactionAsync(tx.GetDbTransaction(),ct);
        try{var result=await work(service);if(!result.Replayed){identity.Audit.Add(new AuditEvent{ActorId=actor,Action="CREDIT_APPLICATION",Resource=path,TraceId=trace});await identity.SaveChangesAsync(ct);}await tx.CommitAsync(ct);return result;}finally{await credit.Database.UseTransactionAsync(null,CancellationToken.None);}
    }
}
public static class CreditApplicationEndpoints
{
    public static bool IsScope(PathString path)=>path.StartsWithSegments("/api/credit")||path.StartsWithSegments("/api/admin/credit");
    public static void MapCreditApplications(this WebApplication app,string[] origins,string[] adminOrigins)
    {
        var customer=app.MapGroup("/api/credit").RequireAuthorization("customer").RequireRateLimiting("credit_applications");Configure(customer,origins);MapReads(customer,false);
        customer.MapGet("/plans",async(string? after,HttpContext http,CreditApplicationService service,CancellationToken ct)=>!Query(http,"after")?Results.BadRequest():Results.Ok(await service.PlansAsync(after,ct)));
        customer.MapGet("/commands/{commandId}",async(string commandId,HttpContext http,CreditApplicationService service,CancellationToken ct)=>!Query(http)?Results.BadRequest():Results.Ok(await service.ReceiptAsync(Actor(http),commandId,ct)));
        customer.MapPost("/applications/commands/{commandId}",async(string commandId,CreateCreditApplicationInput input,HttpContext http,CreditApplicationCoordinator coordinator,CancellationToken ct)=>!Query(http)?Results.BadRequest():Results.Ok(await coordinator.RunAsync(Actor(http),http.Request.Path,http.TraceIdentifier,s=>s.CreateAsync(Actor(http),commandId,input,ct),ct)));
        customer.MapPut("/applications/{id}/cancel/{commandId}",async(string id,string commandId,CancelCreditApplicationInput input,HttpContext http,CreditApplicationCoordinator coordinator,CancellationToken ct)=>!Query(http)?Results.BadRequest():Results.Ok(await coordinator.RunAsync(Actor(http),http.Request.Path,http.TraceIdentifier,s=>s.CancelAsync(Actor(http),id,commandId,input,ct),ct)));
        var staff=app.MapGroup("/api/admin/credit").RequireAuthorization("staff_mfa","credit.read").RequireRateLimiting("credit_applications");Configure(staff,adminOrigins);MapReads(staff,true);
    }
    internal static void Configure(RouteGroupBuilder group,string[] origins)
    {
        group.AddEndpointFilter(InputValidation.Filter);group.AddEndpointFilter(async(context,next)=>{var request=context.HttpContext.Request;var origin=request.Headers.Origin.ToString();if((!HttpMethods.IsGet(request.Method)||origin.Length>0)&&!origins.Contains(origin,StringComparer.Ordinal))return Results.StatusCode(403);return await next(context);});
    }
    private static void MapReads(RouteGroupBuilder group,bool staff)
    {
        group.MapGet("/applications",async(string? state,string? cursor,HttpContext http,CreditApplicationService service,CancellationToken ct)=>!Query(http,"state","cursor")?Results.BadRequest():Results.Ok(await service.PageAsync(Actor(http),staff,state,cursor,ct)));
        group.MapGet("/applications/{id}",async(string id,HttpContext http,CreditApplicationService service,CancellationToken ct)=>!Query(http)?Results.BadRequest():Results.Ok(await service.DetailAsync(Actor(http),staff,id,ct)));
    }
    internal static bool Query(HttpContext http,params string[] names)=>http.Request.Query.All(x=>names.Contains(x.Key,StringComparer.Ordinal)&&x.Value.Count==1);
    internal static string Actor(HttpContext http)=>http.User.FindFirstValue("sub")??throw CreditApplicationRules.Invalid();
}
