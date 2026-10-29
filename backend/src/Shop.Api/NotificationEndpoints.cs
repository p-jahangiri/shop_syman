using System.Security.Claims;
using Shop.Modules.Notifications;
public static class NotificationEndpoints
{
    public static void MapPrivateNotifications(this WebApplication app,string[] origins)
    {
        var group=app.MapGroup("/api/notifications").RequireAuthorization("customer").RequireRateLimiting("support");
        group.AddEndpointFilter(InputValidation.Filter);
        group.AddEndpointFilter(async(context,next)=>{var request=context.HttpContext.Request;var origin=request.Headers.Origin.ToString();if((!HttpMethods.IsGet(request.Method)||origin.Length>0)&&!origins.Contains(origin,StringComparer.Ordinal))return Results.StatusCode(403);return await next(context);});
        group.MapGet("/",async(HttpContext http,PrivateInboxService service,CancellationToken ct)=>{
            if(!Query(http,"unreadOnly","cursor"))return Results.BadRequest();var raw=http.Request.Query["unreadOnly"].ToString();if(raw is not ("" or "true" or "false"))return Results.BadRequest();return Results.Ok(await service.PageAsync(Actor(http),raw=="true",http.Request.Query.ContainsKey("cursor")?http.Request.Query["cursor"].ToString():null,ct));
        });
        group.MapGet("/credit-reminders",async(HttpContext h,CreditInboxService service,CancellationToken ct)=>{if(!Query(h,"unreadOnly","cursor"))return Results.BadRequest();var raw=h.Request.Query["unreadOnly"].ToString();if(raw is not(""or"true"or"false"))return Results.BadRequest();return Results.Ok(await service.PageAsync(Actor(h),raw=="true",h.Request.Query.ContainsKey("cursor")?h.Request.Query["cursor"].ToString():null,ct));});
        group.MapGet("/credit-reminders/unread-count",async(HttpContext h,CreditInboxService service,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await service.CountAsync(Actor(h),ct)));
        group.MapPut("/credit-reminders/{id}/read",async(string id,MarkNotificationReadInput input,HttpContext h,CreditInboxService service,CancellationToken ct)=>!Query(h)?Results.BadRequest():Results.Ok(await service.ReadAsync(Actor(h),id,ct)));
        group.MapGet("/unread-count",async(HttpContext http,PrivateInboxService service,CancellationToken ct)=>{if(!Query(http))return Results.BadRequest();return Results.Ok(await service.CountAsync(Actor(http),ct));});
        group.MapPut("/{id}/read",async(string id,MarkNotificationReadInput input,HttpContext http,PrivateInboxService service,CancellationToken ct)=>{if(!Query(http))return Results.BadRequest();return Results.Ok(await service.ReadAsync(Actor(http),id,ct));});
    }
    private static string Actor(HttpContext http)=>http.User.FindFirstValue("sub")??throw NotificationRules.Invalid();
    private static bool Query(HttpContext http,params string[] allowed)=>http.Request.Query.All(x=>allowed.Contains(x.Key,StringComparer.Ordinal)&&x.Value.Count==1&&x.Value[0] is{Length:>0});
}
