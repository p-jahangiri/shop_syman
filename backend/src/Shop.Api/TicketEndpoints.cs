using System.Security.Claims;
using Shop.Modules.Support;
public static class TicketEndpoints
{
    public static void MapSupportTickets(this WebApplication app, RouteGroupBuilder admin, string[] origins, string[] adminOrigins)
    {
        var customer = app.MapGroup("/api/support").RequireAuthorization("customer").RequireRateLimiting("support");
        customer.AddEndpointFilter(InputValidation.Filter);
        customer.AddEndpointFilter(async (context, next) => {
            var request = context.HttpContext.Request; var origin = request.Headers.Origin.ToString();
            if ((!HttpMethods.IsGet(request.Method) || origin.Length > 0) && !origins.Contains(origin, StringComparer.Ordinal)) return Results.StatusCode(403);
            return await next(context);
        });
        MapReads(customer, false, false);
        customer.MapPost("/tickets/commands/{commandId}", async (string commandId, CreateTicketInput input, HttpContext http, TicketService service, CancellationToken ct) => {
            if (!Query(http)) return Results.BadRequest(); return Results.Ok(await service.CreateAsync(Actor(http), commandId, input, ct));
        });
        MapWrites(customer, false);
        var staff = admin.MapGroup("/support").RequireAuthorization("staff_mfa", "support.read").RequireRateLimiting("support");
        staff.AddEndpointFilter(InputValidation.Filter);
        staff.AddEndpointFilter(async (context, next) => {
            var request = context.HttpContext.Request; var origin = request.Headers.Origin.ToString();
            if ((!HttpMethods.IsGet(request.Method) || origin.Length > 0) && !adminOrigins.Contains(origin, StringComparer.Ordinal)) return Results.StatusCode(403);
            return await next(context);
        });
        MapReads(staff, true, true);
        MapWrites(staff, true);
    }
    private static void MapReads(RouteGroupBuilder group, bool staff, bool requireWriteReceipt)
    {
        group.MapGet("/tickets", async (string? state, string? cursor, HttpContext http, TicketService service, CancellationToken ct) => {
            if (!Query(http, "state", "cursor")) return Results.BadRequest(); return Results.Ok(await service.PageAsync(Actor(http), staff, state, cursor, ct));
        });
        group.MapGet("/tickets/{id}", async (string id, HttpContext http, TicketService service, CancellationToken ct) => {
            if (!Query(http)) return Results.BadRequest(); return Results.Ok(await service.DetailAsync(Actor(http), staff, id, ct));
        });
        group.MapGet("/tickets/{id}/messages", async (string id, string? cursor, HttpContext http, TicketService service, CancellationToken ct) => {
            if (!Query(http, "cursor")) return Results.BadRequest(); return Results.Ok(await service.MessagesAsync(Actor(http), staff, id, cursor, ct));
        });
        var receipt = group.MapGet("/commands/{commandId}", async (string commandId, HttpContext http, TicketService service, CancellationToken ct) => {
            if (!Query(http)) return Results.BadRequest(); return Results.Ok(await service.ReceiptAsync(Actor(http), staff, commandId, ct));
        });
        if (requireWriteReceipt) receipt.RequireAuthorization("support.write");
    }
    private static void MapWrites(RouteGroupBuilder group, bool staff)
    {
        var reply = group.MapPost("/tickets/{id}/replies/{commandId}", async (string id, string commandId, ReplyTicketInput input, HttpContext http, TicketService service, CancellationToken ct) => {
            if (!Query(http)) return Results.BadRequest(); return Results.Ok(await service.ReplyAsync(Actor(http), staff, id, commandId, input, ct));
        });
        var state = group.MapPut("/tickets/{id}/state/{commandId}", async (string id, string commandId, ChangeTicketStateInput input, HttpContext http, TicketService service, CancellationToken ct) => {
            if (!Query(http)) return Results.BadRequest(); return Results.Ok(await service.StateAsync(Actor(http), staff, id, commandId, input, ct));
        });
        if (staff) { reply.RequireAuthorization("support.write"); state.RequireAuthorization("support.write"); }
    }
    public static bool IsScope(string path) => path.StartsWith("/api/support/", StringComparison.OrdinalIgnoreCase) || path.StartsWith("/api/admin/support/", StringComparison.OrdinalIgnoreCase);
    private static string Actor(HttpContext http) => http.User.FindFirstValue("sub")!;
    private static bool Query(HttpContext http, params string[] allowed) => http.Request.Query.All(x => allowed.Contains(x.Key, StringComparer.Ordinal) && x.Value.Count == 1);
}
