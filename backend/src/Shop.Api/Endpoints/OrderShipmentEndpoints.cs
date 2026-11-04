using System.Security.Claims;
using Shop.Modules.Sales;

public static class OrderShipmentEndpoints
{
    public static void MapAdminOrderShipments(this RouteGroupBuilder admin)
    {
        admin.MapGet("/orders/{ownerId}/{id}/shipment", async (string ownerId, string id, HttpContext http, OrderShipmentCoordinator service, CancellationToken ct) => {
            Private(http); return Results.Ok(await service.ReadAdminAsync(ownerId, id, ct));
        }).RequireAuthorization("sales.read", "inventory.read");
        admin.MapPost("/orders/{id}/shipment/commands", async (string id, ShipmentCommandInput input, HttpContext http, OrderShipmentCoordinator service, CancellationToken ct) => {
            Private(http); return Results.Ok(await service.ApplyAsync(http.User.FindFirstValue("sub")!, id, input, ct));
        }).RequireAuthorization("sales.write", "inventory.write");
        admin.MapGet("/orders/{id}/shipment/commands/{commandId}", async (string id, string commandId, HttpContext http, OrderShipmentService service, CancellationToken ct) => {
            Private(http); return Results.Ok(await service.ReadReceiptAsync(http.User.FindFirstValue("sub")!, id, commandId, ct));
        }).RequireAuthorization("sales.write", "inventory.write");
    }
    public static void MapCustomerOrderShipments(this RouteGroupBuilder orders)
    {
        // Same owner check and reader for original and snapshot2 order lines.
        foreach (var path in new[] { "/{id}/shipment", "/v2/{id}/shipment" })
            orders.MapGet(path, async (string id, HttpContext http, OrderShipmentCoordinator service, CancellationToken ct) => {
                Private(http); return Results.Ok(await service.ReadCustomerAsync(http.User.FindFirstValue("sub")!, id, ct));
            });
    }
    private static void Private(HttpContext http) { http.Response.Headers.CacheControl = "private, no-store"; http.Response.Headers["X-Robots-Tag"] = "noindex, nofollow"; http.Response.Headers.Vary = "Cookie, Authorization"; }
}
