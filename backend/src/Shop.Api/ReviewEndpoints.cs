using System.Security.Claims;
using Shop.Modules.Reviews;
public static class ReviewEndpoints
{
    public static void MapReviews(this WebApplication app,string[] origins)
    {
        var group=app.MapGroup("/api/reviews").RequireRateLimiting("reviews");group.AddEndpointFilter(InputValidation.Filter);
        group.AddEndpointFilter(async(context,next)=>{
            var h=context.HttpContext;var origin=h.Request.Headers.Origin.ToString();
            if((!HttpMethods.IsGet(h.Request.Method)||origin.Length>0)&&!origins.Contains(origin,StringComparer.Ordinal))return Results.StatusCode(403);
            var allowed=h.Request.Path.Value?.EndsWith("/mine",StringComparison.Ordinal)==false&&HttpMethods.IsGet(h.Request.Method)?new[]{"cursor"}:Array.Empty<string>();
            if(h.Request.Query.Any(q=>!allowed.Contains(q.Key,StringComparer.Ordinal)||q.Value.Count!=1))return Results.BadRequest(new{title="invalid_review"});
            return await next(context);
        });
        group.MapGet("/products/{productId}",async(string productId,string? cursor,ReviewService service,CancellationToken ct)=>Results.Ok(await service.PublicAsync(productId,cursor,ct))).AllowAnonymous();
        group.MapGet("/products/{productId}/mine",async(string productId,ClaimsPrincipal user,ReviewService service,CancellationToken ct)=>Results.Ok(new OwnReviewResult(1,await service.OwnAsync(user.FindFirstValue("sub")!,productId,ct)))).RequireAuthorization("customer");
        group.MapPut("/products/{productId}/commands/{commandId}",async(string productId,string commandId,SaveReviewInput input,ClaimsPrincipal user,ReviewService service,CancellationToken ct)=>Results.Ok(await service.SaveAsync(user.FindFirstValue("sub")!,productId,commandId,input,ct))).RequireAuthorization("customer");
        group.MapPost("/{reviewId}/reports/{commandId}",async(string reviewId,string commandId,ReportReviewInput input,ClaimsPrincipal user,ReviewService service,CancellationToken ct)=>Results.Ok(await service.ReportAsync(user.FindFirstValue("sub")!,reviewId,commandId,input,ct))).RequireAuthorization("customer");
    }
    public static void MapAdminReviews(this RouteGroupBuilder admin)
    {
        admin.MapGet("/reviews",async(string? state,string? productId,string? cursor,ReviewService service,CancellationToken ct)=>Results.Ok(await service.AdminAsync(state,productId,cursor,ct))).RequireAuthorization("cms.read");
        admin.MapPut("/reviews/{reviewId}/commands/{commandId}",async(string reviewId,string commandId,ModerateReviewInput input,ClaimsPrincipal user,ReviewService service,CancellationToken ct)=>Results.Ok(await service.ModerateAsync(user.FindFirstValue("sub")!,reviewId,commandId,input,ct))).RequireAuthorization("cms.write");
    }
}
