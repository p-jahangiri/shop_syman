using Shop.Modules.Cms;
public static class SupportContentEndpoints
{
    public static void MapPublicSupportContent(this WebApplication app)
    {
        app.MapGet("/api/content/support/{locale}", async (string locale, HttpContext http, SupportContentReader service, CancellationToken ct) => {
            http.Response.Headers.CacheControl = "no-store";
            if (http.Request.Query.Count != 0) return Results.BadRequest();
            return Results.Ok(await service.ReadAsync(locale, ct));
        }).AllowAnonymous();
    }
    public static void MapAdminSupportContent(this RouteGroupBuilder admin)
    {
        admin.MapGet("/content/support/{locale}/revisions/{revisionId}", async (string locale, string revisionId, HttpContext http, SupportContentReader service, CancellationToken ct) => {
            http.Response.Headers.CacheControl = "private, no-store"; http.Response.Headers["X-Robots-Tag"] = "noindex, nofollow";
            if (http.Request.Query.Count != 0) return Results.BadRequest();
            return Results.Ok(await service.RevisionAsync(locale, revisionId, ct));
        }).RequireAuthorization("staff_mfa", "cms.read");
    }

}
