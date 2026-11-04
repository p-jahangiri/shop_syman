using System.Data;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Cms;
using Shop.Modules.Identity;
public sealed class CmsRedirectCoordinator(IdentityDbContext identity,CmsDbContext cms,CmsRedirectService service)
{
    private async Task<T> Atomic<T>(Func<Task<T>> work,CancellationToken ct)
    {
        await using var tx=await identity.Database.BeginTransactionAsync(IsolationLevel.Serializable,ct);var connection=identity.Database.GetDbConnection();var original=cms.Database.GetDbConnection();if(original.State!=ConnectionState.Closed||original.Database!=connection.Database||original.DataSource!=connection.DataSource)throw new InvalidOperationException("CMS redirect audit requires closed module connections to the same database.");
        cms.Database.SetDbConnection(connection,false);await cms.Database.UseTransactionAsync(tx.GetDbTransaction(),ct);try{var result=await work();await tx.CommitAsync(ct);return result;}finally{await cms.Database.UseTransactionAsync(null,CancellationToken.None);}
    }
    public Task<CmsRedirectPreview> PreviewAsync(string id,CancellationToken ct)=>Atomic(()=>service.PreviewAsync(id,ct),ct);
    public Task<CmsRedirectResult> WriteAsync(string actor,string? id,string command,CmsRedirectWrite input,string path,string trace,CancellationToken ct)=>Atomic(async()=>{var result=await service.WriteAsync(actor,id,command,input,ct);if(!result.Replayed){identity.Audit.Add(new AuditEvent{ActorId=actor,Action="CMS_REDIRECT_"+input.Action.ToUpperInvariant(),Resource=path,TraceId=trace});await identity.SaveChangesAsync(ct);}return result;},ct);
}
public static class CmsRedirectEndpoints
{
    public static void MapCmsRedirects(this WebApplication app,string[] adminOrigins)
    {
        app.MapGet("/api/content/redirects/resolve",async(string path,HttpContext h,CmsRedirectService s,CancellationToken ct)=>h.Request.Query.Count!=1||h.Request.Query["path"].Count!=1?Results.BadRequest():Results.Ok(await s.ResolveAsync(path,ct))).AllowAnonymous();
        var staff=app.MapGroup("/api/admin/redirects").RequireAuthorization("staff_mfa","cms.read");
        staff.AddEndpointFilter(async(c,next)=>{var h=c.HttpContext;var origin=h.Request.Headers.Origin.ToString();if((!HttpMethods.IsGet(h.Request.Method)||origin.Length>0)&&!adminOrigins.Contains(origin,StringComparer.Ordinal))return Results.StatusCode(403);return await next(c);});
        static bool Query(HttpContext h,params string[] names)=>h.Request.Query.All(x=>names.Contains(x.Key,StringComparer.Ordinal)&&x.Value.Count==1);
        static string Actor(HttpContext h)=>h.User.FindFirstValue("sub")??throw CmsRedirectRules.Invalid();
        staff.MapGet("",async(string? cursor,HttpContext h,CmsRedirectService s,CancellationToken ct)=>!Query(h,"cursor")?Results.BadRequest():Results.Ok(await s.ListAsync(cursor,ct)));
        staff.MapGet("/{id}",async(string id,HttpContext h,CmsRedirectService s,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await s.DetailAsync(id,ct)));
        staff.MapGet("/{id}/preview",async(string id,HttpContext h,CmsRedirectCoordinator c,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await c.PreviewAsync(id,ct)));
        staff.MapGet("/{id}/history",async(string id,int? beforePublication,HttpContext h,CmsRedirectService s,CancellationToken ct)=>!Query(h,"beforePublication")||(h.Request.Query.ContainsKey("beforePublication")&&(beforePublication is not(>=1 and<=10000)||h.Request.Query["beforePublication"].ToString()!=beforePublication.Value.ToString(System.Globalization.CultureInfo.InvariantCulture)))?Results.BadRequest():Results.Ok(await s.HistoryAsync(id,beforePublication,ct)));
        staff.MapGet("/{id}/revisions/{revisionId}",async(string id,string revisionId,HttpContext h,CmsRedirectService s,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await s.RevisionAsync(id,revisionId,ct)));
        staff.MapPost("/commands/{commandId}",async(string commandId,CmsRedirectWrite input,HttpContext h,CmsRedirectCoordinator c,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await c.WriteAsync(Actor(h),null,commandId,input,h.Request.Path,h.TraceIdentifier,ct))).RequireAuthorization("cms.write");
        staff.MapPost("/{id}/commands/{commandId}",async(string id,string commandId,CmsRedirectWrite input,HttpContext h,CmsRedirectCoordinator c,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await c.WriteAsync(Actor(h),id,commandId,input,h.Request.Path,h.TraceIdentifier,ct))).RequireAuthorization("cms.write");
        staff.MapGet("/commands/{commandId}",async(string commandId,HttpContext h,CmsRedirectService s,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await s.ReceiptAsync(Actor(h),commandId,null,ct))).RequireAuthorization("cms.write");
        staff.MapGet("/{id}/commands/{commandId}",async(string id,string commandId,HttpContext h,CmsRedirectService s,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await s.ReceiptAsync(Actor(h),commandId,id,ct))).RequireAuthorization("cms.write");
    }
}
