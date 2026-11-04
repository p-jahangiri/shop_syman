using System.Data;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Cms;
using Shop.Modules.Identity;
public sealed class CmsPageCoordinator(IdentityDbContext identity,CmsDbContext cms,CmsPageService service)
{
    public async Task<CmsPageResult> WriteAsync(string actor,string? page,string command,CmsPageWrite input,string path,string trace,CancellationToken ct)
    {
        await using var tx=await identity.Database.BeginTransactionAsync(IsolationLevel.Serializable,ct);var connection=identity.Database.GetDbConnection();var original=cms.Database.GetDbConnection();if(original.State!=ConnectionState.Closed||original.Database!=connection.Database||original.DataSource!=connection.DataSource)throw new InvalidOperationException("CMS page audit requires closed module connections to the same database.");
        cms.Database.SetDbConnection(connection,false);await cms.Database.UseTransactionAsync(tx.GetDbTransaction(),ct);
        try{var r=await service.WriteAsync(actor,page,command,input,ct);if(!r.Replayed){identity.Audit.Add(new AuditEvent{ActorId=actor,Action="CMS_PAGE_"+input.Action.ToUpperInvariant(),Resource=path,TraceId=trace});await identity.SaveChangesAsync(ct);}await tx.CommitAsync(ct);return r;}finally{await cms.Database.UseTransactionAsync(null,CancellationToken.None);}
    }
}
public static class CmsPageEndpoints
{
    public static void MapCmsPages(this WebApplication app,string[] adminOrigins)
    {
        app.MapGet("/api/content/pages/{locale}/{slug}",async(string locale,string slug,HttpContext h,CmsPageService service,CancellationToken ct)=>h.Request.Query.Count!=0?Results.BadRequest():Results.Ok(await service.PublicAsync(slug,locale,ct))).AllowAnonymous();
        var staff=app.MapGroup("/api/admin/pages").RequireAuthorization("staff_mfa","cms.editorial.read");
        staff.AddEndpointFilter(async(c,next)=>{var h=c.HttpContext;var origin=h.Request.Headers.Origin.ToString();if((!HttpMethods.IsGet(h.Request.Method)||origin.Length>0)&&!adminOrigins.Contains(origin,StringComparer.Ordinal))return Results.StatusCode(403);return await next(c);});
        static bool Query(HttpContext h,params string[] names)=>h.Request.Query.All(x=>names.Contains(x.Key,StringComparer.Ordinal)&&x.Value.Count==1);
        static string Actor(HttpContext h)=>h.User.FindFirstValue("sub")??throw CmsPageRules.Invalid();
        staff.MapGet("",async(string? cursor,HttpContext h,CmsPageService s,CancellationToken ct)=>!Query(h,"cursor")?Results.BadRequest():Results.Ok(await s.ListAsync(cursor,ct)));
        staff.MapGet("/{pageId}",async(string pageId,HttpContext h,CmsPageService s,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await s.DetailAsync(pageId,ct)));
        staff.MapGet("/{pageId}/history",async(string pageId,int? beforePublication,HttpContext h,CmsPageService s,CancellationToken ct)=>!Query(h,"beforePublication")||(h.Request.Query.ContainsKey("beforePublication")&&(beforePublication is not(>=1 and<=10000)||h.Request.Query["beforePublication"].ToString()!=beforePublication.Value.ToString(System.Globalization.CultureInfo.InvariantCulture)))?Results.BadRequest():Results.Ok(await s.HistoryAsync(pageId,beforePublication,ct)));
        staff.MapGet("/{pageId}/revisions/{revisionId}",async(string pageId,string revisionId,HttpContext h,CmsPageService s,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await s.RevisionAsync(pageId,revisionId,ct)));
        staff.MapPost("/commands/{commandId}",async(string commandId,CmsPageWrite input,HttpContext h,CmsPageCoordinator c,CancellationToken ct)=>!Query(h)?Results.BadRequest():!CmsEditorialAccess.CanWrite(h.User,input.Action)?Results.StatusCode(403):Results.Ok(await c.WriteAsync(Actor(h),null,commandId,input,h.Request.Path,h.TraceIdentifier,ct))).RequireAuthorization("cms.editorial.write");
        staff.MapPost("/{pageId}/commands/{commandId}",async(string pageId,string commandId,CmsPageWrite input,HttpContext h,CmsPageCoordinator c,CancellationToken ct)=>!Query(h)?Results.BadRequest():!CmsEditorialAccess.CanWrite(h.User,input.Action)?Results.StatusCode(403):Results.Ok(await c.WriteAsync(Actor(h),pageId,commandId,input,h.Request.Path,h.TraceIdentifier,ct))).RequireAuthorization("cms.editorial.write");
        staff.MapGet("/commands/{commandId}",async(string commandId,HttpContext h,CmsPageService s,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await s.ReceiptAsync(Actor(h),commandId,null,ct))).RequireAuthorization("cms.editorial.write");
        staff.MapGet("/{pageId}/commands/{commandId}",async(string pageId,string commandId,HttpContext h,CmsPageService s,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await s.ReceiptAsync(Actor(h),commandId,pageId,ct))).RequireAuthorization("cms.editorial.write");
    }
}
