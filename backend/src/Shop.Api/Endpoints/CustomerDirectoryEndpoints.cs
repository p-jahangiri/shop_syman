using System.Security.Claims;
using System.Text.Json.Serialization;
using System.Text.Json;
using Shop.Modules.Identity;
using Shop.Modules.Sales;
using Shop.Modules.Support;
using Shop.SharedKernel;

public static class CustomerDirectoryEndpoints
{
    public sealed record CustomerWorkspaceRow(CustomerIdentityRow Account,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] CustomerOrderOverview? Orders,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] CustomerSupportOverview? Support);
    public sealed record CustomerWorkspacePage(int SchemaVersion, int PageSize, bool CanReadOrders, bool CanReadSupport,
        CustomerWorkspaceRow[] Items, [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? NextCursor);
    public sealed record CustomerWorkspaceDetail(int SchemaVersion, CustomerIdentityDetail Identity,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] CustomerOrderOverview? Orders,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] CustomerSupportOverview? Support);
    public sealed record CustomerOrderPage(int SchemaVersion, string CustomerId, OrderSummaryV2Data[] Items,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? NextCursor);
    public sealed record CustomerTicketPage(int SchemaVersion, string CustomerId, TicketSummary[] Items,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? NextCursor);

    public sealed record CustomerMessagePage(int SchemaVersion, string CustomerId, string TicketId, TicketMessageData[] Items,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? NextCursor);

    public static void MapCustomerDirectory(this RouteGroupBuilder admin, string[] origins)
    {
        var group = admin.MapGroup("/customers").RequireAuthorization("staff_mfa", "customers.read").RequireRateLimiting("orders");
        group.AddEndpointFilter(async (context, next) => {
            var http = context.HttpContext; http.Response.Headers.CacheControl = "private, no-store";
            http.Response.Headers["X-Robots-Tag"] = "noindex, nofollow"; http.Response.Headers.Vary = "Cookie, Authorization";
            var origin = http.Request.Headers.Origin.ToString();
            if (origin.Length > 0 && !origins.Contains(origin, StringComparer.Ordinal)) return Results.StatusCode(403);
            return await next(context);
        });
        group.MapGet("", async (string? query, string? active, string? kind, string? cursor, HttpContext http,
            ICustomerDirectory identity, ICustomerOrderOverview orders, ICustomerSupportOverview support, CancellationToken ct) => {
            if (!Query(http, "query", "active", "kind", "cursor")) return Results.BadRequest();
            var page = await identity.PageAsync(CustomerDirectoryFilter.Create(query, active, kind), cursor, ct);
            var owners = page.Items.Select(x => x.Id).ToArray();
            var canOrders = Has(http.User, "sales.read"); var canSupport = Has(http.User, "support.read");
            var orderRows = canOrders ? await orders.ReadAsync(owners, ct) : [];
            var supportRows = canSupport ? await support.ReadAsync(owners, ct) : [];
            return Results.Ok(new CustomerWorkspacePage(1, 50, canOrders, canSupport,
                page.Items.Select(account => new CustomerWorkspaceRow(account, orderRows.SingleOrDefault(x => x.OwnerId == account.Id),
                    supportRows.SingleOrDefault(x => x.OwnerId == account.Id))).ToArray(), page.NextCursor));
        });
        group.MapGet("/{id}", async (string id, HttpContext http, ICustomerDirectory identity,
            ICustomerOrderOverview orders, ICustomerSupportOverview support, CancellationToken ct) => {
            if (!Query(http)) return Results.BadRequest();
            var account = await identity.DetailAsync(id, ct);
            var order = Has(http.User, "sales.read") ? (await orders.ReadAsync([id], ct)).Single() : null;
            var tickets = Has(http.User, "support.read") ? (await support.ReadAsync([id], ct)).Single() : null;
            return Results.Ok(new CustomerWorkspaceDetail(1, account, order, tickets));
        });
        group.MapGet("/{id}/orders", async (string id, string? cursor, HttpContext http, ICustomerDirectory identity,
            OrderV2Service orders, CancellationToken ct) => {
            if (!Query(http, "cursor")) return Results.BadRequest();
            await identity.DetailAsync(id, ct);
            var page = await orders.ListAsync(id, CustomerHistoryPaging.Decode(cursor, id, "orders"), ct);
            return Results.Ok(new CustomerOrderPage(1, id, page.Items.Select(x => x with { OwnerId = id }).ToArray(),
                CustomerHistoryPaging.Encode(page.NextCursor, id, "orders")));
        }).RequireAuthorization("sales.read");
        group.MapGet("/{id}/orders/{orderId}", async (string id, string orderId, HttpContext http, ICustomerDirectory identity,
            OrderV2Service orders, CancellationToken ct) => {
            if (!Query(http)) return Results.BadRequest();
            await identity.DetailAsync(id, ct);
            return Results.Ok(await orders.ReadAsync(id, orderId, ct));
        }).RequireAuthorization("sales.read");
        group.MapGet("/{id}/tickets", async (string id, string? cursor, HttpContext http, ICustomerDirectory identity,
            TicketService tickets, CancellationToken ct) => {
            if (!Query(http, "cursor")) return Results.BadRequest();
            await identity.DetailAsync(id, ct);
            var page = await tickets.PageAsync(id, false, null, CustomerHistoryPaging.Decode(cursor, id, "tickets"), ct);
            return Results.Ok(new CustomerTicketPage(1, id, page.Items, CustomerHistoryPaging.Encode(page.NextCursor, id, "tickets")));
        }).RequireAuthorization("support.read");
        group.MapGet("/{id}/tickets/{ticketId}/messages", async (string id, string ticketId, string? cursor, HttpContext http,
            ICustomerDirectory identity, TicketService tickets, CancellationToken ct) => {
            if (!Query(http, "cursor")) return Results.BadRequest();
            await identity.DetailAsync(id, ct);
            var page = await tickets.MessagesAsync(id, false, ticketId, CustomerHistoryPaging.Decode(cursor, id, "ticket:" + ticketId), ct);
            return Results.Ok(new CustomerMessagePage(1, id, page.TicketId, page.Items,
                CustomerHistoryPaging.Encode(page.NextCursor, id, "ticket:" + ticketId)));
        }).RequireAuthorization("support.read");
    }
    private static bool Has(ClaimsPrincipal user, string permission) => user.HasClaim("permission", permission);
    private static bool Query(HttpContext http, params string[] keys) => http.Request.Query.All(pair => keys.Contains(pair.Key, StringComparer.Ordinal) && pair.Value.Count == 1);
}

public static class CustomerHistoryPaging
{
    private sealed record Cursor(string Owner, string Domain, string Inner);
    private static readonly JsonSerializerOptions Options = new() { MaxDepth = 4, UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow };
    public static string? Encode(string? inner, string owner, string domain)
    {
        if (inner is null) return null;
        return Convert.ToBase64String(JsonSerializer.SerializeToUtf8Bytes(new Cursor(StaffFilter.Id(owner), domain, inner)))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }
    public static string? Decode(string? cursor, string owner, string domain)
    {
        StaffFilter.Id(owner); if (cursor is null) return null;
        try {
            if (cursor.Length is < 1 or > 4096 || cursor.Any(x => !char.IsAsciiLetterOrDigit(x) && x is not ('-' or '_'))) throw Invalid();
            var raw = cursor.Replace('-', '+').Replace('_', '/');
            var value = JsonSerializer.Deserialize<Cursor>(Convert.FromBase64String(raw.PadRight((raw.Length + 3) / 4 * 4, '=')), Options);
            if (value is null || value.Owner != owner || value.Domain != domain || string.IsNullOrEmpty(value.Inner) || value.Inner.Length > 2048) throw Invalid();
            return value.Inner;
        } catch (Exception error) when (error is FormatException or JsonException or ArgumentException) { throw Invalid(); }
    }
    private static BusinessException Invalid() => new("invalid_customer_cursor", "This history page belongs to another customer or section.");
}
