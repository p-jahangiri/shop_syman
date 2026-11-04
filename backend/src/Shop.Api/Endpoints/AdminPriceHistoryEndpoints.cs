using Shop.Modules.Catalog.Application;
using Shop.SharedKernel;

public static class AdminPriceHistoryEndpoints
{
    private static readonly HashSet<string> Allowed = new(StringComparer.Ordinal) { "variantId", "direction", "fromAt", "toAt", "cursor" };

    public static void MapAdminPriceHistory(this RouteGroupBuilder admin)
    {
        admin.MapGet("/products/{productId}/price-history", async (string productId, HttpContext http, IAdminPriceHistory service, CancellationToken ct) => {
            if (http.Request.Query.Any(q => !Allowed.Contains(q.Key) || q.Value.Count != 1)) throw new BusinessException("invalid_price_history_filter", "Use only a single value for each supported price history filter.");
            string? Value(string key) => http.Request.Query.TryGetValue(key, out var values) ? values[0] : null;
            var filter = AdminPriceHistoryFilter.Create(productId, Value("variantId"), Value("direction"), Value("fromAt"), Value("toAt"));
            var cursor = Value("cursor");
            AdminPriceHistoryPaging.Decode(cursor, filter);
            return Results.Ok(await service.ReadAsync(filter, cursor, ct));
        }).RequireAuthorization("staff_mfa", "catalog.read");
    }
}
