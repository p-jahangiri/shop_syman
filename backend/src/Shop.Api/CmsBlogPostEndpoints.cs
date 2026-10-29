using System.Data;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Cms;
using Shop.Modules.Identity;
public sealed class CmsBlogPostCoordinator(IdentityDbContext identity,CmsDbContext cms,CmsBlogPostService service)
{
    public async Task<CmsBlogPostResult> WriteAsync(string actor,string? page,string command,CmsBlogPostWrite input,string path,string trace,CancellationToken ct)
    {
        await using var tx=await identity.Database.BeginTransactionAsync(IsolationLevel.Serializable,ct);var connection=identity.Database.GetDbConnection();var original=cms.Database.GetDbConnection();if(original.State!=ConnectionState.Closed||original.Database!=connection.Database||original.DataSource!=connection.DataSource)throw new InvalidOperationException("CMS page audit requires closed module connections to the same database.");
        cms.Database.SetDbConnection(connection,false);await cms.Database.UseTransactionAsync(tx.GetDbTransaction(),ct);
        try{var r=await service.WriteAsync(actor,page,command,input,ct);if(!r.Replayed){identity.Audit.Add(new AuditEvent{ActorId=actor,Action="CMS_BLOG_POST_"+input.Action.ToUpperInvariant(),Resource=path,TraceId=trace});await identity.SaveChangesAsync(ct);}await tx.CommitAsync(ct);return r;}finally{await cms.Database.UseTransactionAsync(null,CancellationToken.None);}
    }
}
public static class CmsBlogPostEndpoints
{
    public static void MapCmsBlogPosts(this WebApplication app,string[] adminOrigins)
    {
        static bool PublicQuery(HttpContext h,params string[] names)=>h.Request.Query.All(x=>names.Contains(x.Key,StringComparer.Ordinal)&&x.Value.Count==1);
        static void PublicHeaders(HttpContext h){h.Response.Headers.CacheControl="no-store";h.Response.Headers["X-Robots-Tag"]="noindex, nofollow";h.Response.Headers["X-Sayman-Blog"]="1";}
        app.MapGet("/api/content/blog/{locale}",async(string locale,string? tag,string? cursor,HttpContext h,CmsBlogPostService service,CancellationToken ct)=>{PublicHeaders(h);return !PublicQuery(h,"tag","cursor")?Results.BadRequest():Results.Ok(await service.PublicListAsync(locale,tag,cursor,ct));}).AllowAnonymous();
        app.MapGet("/api/content/blog/{locale}/{slug}",async(string locale,string slug,HttpContext h,CmsBlogPostService service,CancellationToken ct)=>{PublicHeaders(h);return !PublicQuery(h)?Results.BadRequest():Results.Ok(await service.PublicAsync(slug,locale,ct));}).AllowAnonymous();
        var staff=app.MapGroup("/api/admin/blog-posts").RequireAuthorization("staff_mfa","cms.read").RequireRateLimiting("cms_blog");
        staff.AddEndpointFilter(async(c,next)=>{var h=c.HttpContext;var origin=h.Request.Headers.Origin.ToString();if((!HttpMethods.IsGet(h.Request.Method)||origin.Length>0)&&!adminOrigins.Contains(origin,StringComparer.Ordinal))return Results.StatusCode(403);return await next(c);});
        static bool Query(HttpContext h,params string[] names)=>h.Request.Query.All(x=>names.Contains(x.Key,StringComparer.Ordinal)&&x.Value.Count==1);
        static string Actor(HttpContext h)=>h.User.FindFirstValue("sub")??throw CmsBlogPostRules.Invalid();
        staff.MapGet("",async(string? cursor,HttpContext h,CmsBlogPostService s,CancellationToken ct)=>!Query(h,"cursor")?Results.BadRequest():Results.Ok(await s.ListAsync(cursor,ct)));
        staff.MapGet("/{postId}",async(string postId,HttpContext h,CmsBlogPostService s,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await s.DetailAsync(postId,ct)));
        staff.MapGet("/{postId}/history",async(string postId,int? beforePublication,HttpContext h,CmsBlogPostService s,CancellationToken ct)=>!Query(h,"beforePublication")||(h.Request.Query.ContainsKey("beforePublication")&&(beforePublication is not(>=1 and<=10000)||h.Request.Query["beforePublication"].ToString()!=beforePublication.Value.ToString(System.Globalization.CultureInfo.InvariantCulture)))?Results.BadRequest():Results.Ok(await s.HistoryAsync(postId,beforePublication,ct)));
        staff.MapGet("/{postId}/revisions/{revisionId}",async(string postId,string revisionId,HttpContext h,CmsBlogPostService s,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await s.RevisionAsync(postId,revisionId,ct)));
        staff.MapPost("/commands/{commandId}",async(string commandId,CmsBlogPostWrite input,HttpContext h,CmsBlogPostCoordinator c,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await c.WriteAsync(Actor(h),null,commandId,input,h.Request.Path,h.TraceIdentifier,ct))).RequireAuthorization("cms.write");
        staff.MapPost("/{postId}/commands/{commandId}",async(string postId,string commandId,CmsBlogPostWrite input,HttpContext h,CmsBlogPostCoordinator c,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await c.WriteAsync(Actor(h),postId,commandId,input,h.Request.Path,h.TraceIdentifier,ct))).RequireAuthorization("cms.write");
        staff.MapGet("/commands/{commandId}",async(string commandId,HttpContext h,CmsBlogPostService s,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await s.ReceiptAsync(Actor(h),commandId,null,ct))).RequireAuthorization("cms.write");
        staff.MapGet("/{postId}/commands/{commandId}",async(string postId,string commandId,HttpContext h,CmsBlogPostService s,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await s.ReceiptAsync(Actor(h),commandId,postId,ct))).RequireAuthorization("cms.write");
    }
}
