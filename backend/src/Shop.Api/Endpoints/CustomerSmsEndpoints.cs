using System.Security.Claims;
using Shop.SharedKernel;

public static class CustomerSmsEndpoints
{
    public static void MapCustomerSmsSettings(this RouteGroupBuilder admin, string[] origins)
    {
        var group = admin.MapGroup("/sms").RequireAuthorization("staff_mfa", "staff.write").RequireRateLimiting("orders");
        group.AddEndpointFilter(async (context, next) =>
        {
            var http = context.HttpContext;
            var origin = http.Request.Headers.Origin.ToString();
            if ((!HttpMethods.IsGet(http.Request.Method) || origin.Length > 0)
                && !origins.Contains(origin, StringComparer.Ordinal)) return Results.StatusCode(403);
            if (http.Request.Query.Count != 0) return Results.BadRequest();
            return await next(context);
        });
        group.MapGet("/settings", async (HttpContext http, ICustomerSmsSettings service, CancellationToken ct) =>
            Results.Ok(await service.GetAsync(Actor(http), Stamp(http), ct)));
        group.MapPut("/settings", async (CustomerSmsSettingsInput input, HttpContext http,
            ICustomerSmsSettings service, CancellationToken ct) =>
            Results.Ok(await service.SaveAsync(Actor(http), Stamp(http), input, http.TraceIdentifier, ct)));
    }

    private static string Actor(HttpContext http) => http.User.FindFirstValue("sub")
        ?? throw new BusinessException("invalid_credentials", "The account is unavailable.");
    private static string Stamp(HttpContext http) => http.User.FindFirstValue("sst") ?? "";
}
