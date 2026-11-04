using System.Security.Claims;
using Shop.Modules.Payments;

public static class CashPaymentReadEndpoints
{
    public static void MapCashPaymentReads(this WebApplication app, RouteGroupBuilder admin, string[] origins)
    {
        var customer = app.MapGroup("/api/payments").RequireAuthorization("customer").RequireRateLimiting("orders");
        customer.AddEndpointFilter(async (context, next) =>
        {
            var http = context.HttpContext;
            Private(http);
            var origin = http.Request.Headers.Origin.ToString();
            if (origin.Length > 0 && !origins.Contains(origin, StringComparer.Ordinal))
                return Results.StatusCode(403);
            return await next(context);
        });
        customer.MapGet("/orders/{id}", async (string id, string? cursor, HttpContext http, CashPaymentReadService service, CancellationToken ct) =>
        {
            if (!HasOnlySingleQueryValues(http.Request, "cursor")) return Results.BadRequest();
            return Results.Ok(await service.PageAsync(http.User.FindFirstValue("sub")!, new(null, id), cursor, ct));
        });
        customer.MapGet("/attempts/{id}", async (string id, HttpContext http, CashPaymentReadService service, CancellationToken ct) =>
        {
            if (http.Request.Query.Count != 0) return Results.BadRequest();
            return Results.Ok(await service.DetailAsync(http.User.FindFirstValue("sub")!, id, ct));
        });
        admin.MapGet("/payments/attempts", async (string? state, string? orderId, string? cursor, HttpContext http, CashPaymentReadService service, CancellationToken ct) =>
        {
            Private(http);
            if (!HasOnlySingleQueryValues(http.Request, "state", "orderId", "cursor")) return Results.BadRequest();
            return Results.Ok(await service.PageAsync(null, new(state, orderId), cursor, ct));
        }).RequireAuthorization("staff_mfa", "finance.read", "sales.read");
    }

    private static bool HasOnlySingleQueryValues(HttpRequest request, params string[] allowed) =>
        request.Query.All(pair => pair.Value.Count == 1 && allowed.Contains(pair.Key, StringComparer.Ordinal));

    private static void Private(HttpContext http)
    {
        http.Response.Headers.CacheControl = "private, no-store";
        http.Response.Headers.Vary = "Cookie, Authorization";
        http.Response.Headers["X-Robots-Tag"] = "noindex, nofollow";
    }
}
