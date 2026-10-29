using System.Security.Claims;
using Shop.Modules.Sales;

public static class OrderEndpoints
{
    public static void MapOrders(this WebApplication app, string[] origins)
    {
        var group = app.MapGroup("/api/orders").RequireAuthorization("customer").RequireRateLimiting("orders"); group.AddEndpointFilter(InputValidation.Filter);
        group.AddEndpointFilter(async (context, next) => {
            var http = context.HttpContext; var supplied = http.Request.Headers.Origin.ToString();
            if ((!HttpMethods.IsGet(http.Request.Method) || supplied.Length > 0) && !origins.Contains(supplied, StringComparer.Ordinal)) return Results.StatusCode(403);
            return await next(context);
        });
        group.MapOrdersV2();
        group.MapCustomerOrderShipments();
        group.MapPost("", async (CreateOrderInput input, HttpContext http, OrderService service, CancellationToken ct) => {
            var result = await service.CreateAsync(http.User.FindFirstValue("sub")!, input, ct); http.Response.Headers.Location = "/api/orders/" + result.Order.Summary.Id; return Results.Json(result, statusCode: result.Replayed ? 200 : 201);
        }).AddEndpointFilter<CheckoutTransactionFilter>();
        group.MapGet("", async (string? cursor, ClaimsPrincipal user, OrderService service, CancellationToken ct) => Results.Ok(await service.ListAsync(user.FindFirstValue("sub")!, cursor, ct)));
        group.MapGet("/{id}", async (string id, ClaimsPrincipal user, OrderService service, CancellationToken ct) => Results.Ok(await service.ReadAsync(user.FindFirstValue("sub")!, id, ct)));
        group.MapPost("/{id}/cancel", async (string id, CancelOrderInput input, ClaimsPrincipal user, OrderService service, CancellationToken ct) => Results.Ok(await service.CancelAsync(user.FindFirstValue("sub")!, id, input.Version, user.FindFirstValue("sub")!, ct))).AddEndpointFilter<CheckoutTransactionFilter>();
    }
}
