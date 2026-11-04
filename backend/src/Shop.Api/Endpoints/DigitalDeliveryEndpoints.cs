using Shop.Modules.Identity;
using Shop.Modules.Sales;

/// <summary>
/// Private manual digital fulfilment. Even reads use the shared owner gate and
/// transaction so the encrypted manifest and immutable dispatch ledger agree.
/// </summary>
public static class DigitalDeliveryEndpoints
{
    public const int MaximumRequestBytes = 524288;

    public static void MapDigitalDeliveries(this WebApplication app, string[] origins, string[] adminOrigins)
    {
        var staff = app.MapGroup("/api/admin/orders/{ownerId}/{orderId}/fulfillment/digital")
            .RequireAuthorization("staff_mfa", "sales.read", "inventory.read")
            .RequireRateLimiting("orders");
        Configure(staff, adminOrigins);
        staff.MapGet("", async (string ownerId, string orderId, HttpContext h, OrderParcelCoordinator c, CancellationToken ct) =>
            !Query(h) ? Results.BadRequest() : Results.Ok(await c.ReadAsync(s => s.ReadDigitalAdminAsync(ownerId, orderId, ct), ct)));
        staff.MapPost("/commands/{commandId}", async (string ownerId, string orderId, string commandId, DigitalDeliveryInput input, HttpContext h, OrderParcelCoordinator c, CancellationToken ct) =>
            !Query(h) ? Results.BadRequest() : Results.Ok(await c.WriteDigitalAsync(CreditApplicationEndpoints.Actor(h), ownerId, orderId, commandId, input, h.Request.Path, h.TraceIdentifier, ct)))
            .RequireAuthorization("sales.write", "inventory.write")
            .WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(MaximumRequestBytes));
        staff.MapGet("/commands/{commandId}", async (string ownerId, string orderId, string commandId, HttpContext h, OrderParcelCoordinator c, CancellationToken ct) =>
            !Query(h) ? Results.BadRequest() : Results.Ok(await c.ReadAsync(s => s.ReadDigitalReceiptAsync(CreditApplicationEndpoints.Actor(h), ownerId, orderId, commandId, ct), ct)))
            .RequireAuthorization("sales.write", "inventory.write");

        foreach (var prefix in new[] { "/api/orders/{orderId}/fulfillment/digital", "/api/orders/v2/{orderId}/fulfillment/digital" })
        {
            var customer = app.MapGroup(prefix).RequireAuthorization("customer").RequireRateLimiting("orders");
            Configure(customer, origins);
            customer.MapGet("", async (string orderId, HttpContext h, OrderParcelCoordinator c, CancellationToken ct) =>
                !Query(h) ? Results.BadRequest() : Results.Ok(await c.ReadAsync(s => s.ReadDigitalCustomerAsync(CreditApplicationEndpoints.Actor(h), orderId, ct), ct)));
            customer.MapGet("/{deliveryId}/content", async (string orderId, string deliveryId, HttpContext h, OrderParcelCoordinator c, CancellationToken ct) =>
                !Query(h) ? Results.BadRequest() : Results.Ok(await c.ReadAsync(s => s.ReadDigitalContentAsync(CreditApplicationEndpoints.Actor(h), orderId, deliveryId, ct), ct)));
        }
    }

    private static bool Query(HttpContext h) => CreditApplicationEndpoints.Query(h);

    private static void Configure(RouteGroupBuilder group, string[] origins)
    {
        CreditApplicationEndpoints.Configure(group, origins);
        group.AddEndpointFilter(async (context, next) =>
        {
            context.HttpContext.Response.Headers["X-Sayman-Fulfillment-Contract"] = "digital-v1";
            return await next(context);
        });
    }
}
