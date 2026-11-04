using Microsoft.EntityFrameworkCore;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Cms;
using Shop.Modules.Credit;
using Shop.Modules.Files;
using Shop.Modules.Inventory;
using Shop.Modules.Market;
using Shop.Modules.Notifications;
using Shop.Modules.Payments;
using Shop.Modules.Reviews;
using Shop.Modules.Sales;
using Shop.Modules.Support;
using IdentityDbContext = Shop.Modules.Identity.IdentityDbContext;

internal static class HealthEndpoints
{
    private static readonly Type[] RequiredContexts =
    [
        typeof(IdentityDbContext), typeof(PaymentsDbContext), typeof(CreditDbContext),
        typeof(CmsDbContext), typeof(InventoryDbContext), typeof(CatalogDbContext),
        typeof(SalesDbContext), typeof(MarketDbContext), typeof(ReviewsDbContext),
        typeof(SupportDbContext), typeof(NotificationsDbContext), typeof(FilesDbContext)
    ];

    internal static void MapShopHealth(this WebApplication app)
    {
        app.MapGet("/health/live", (HttpContext context) =>
        {
            SetHealthHeaders(context);
            return Results.Ok(new { Status = "alive" });
        }).AllowAnonymous();

        app.MapGet("/health/ready", async (HttpContext context, IServiceProvider services, CancellationToken ct) =>
        {
            SetHealthHeaders(context);
            try
            {
                var catalogDatabase = services.GetRequiredService<CatalogDbContext>().Database;
                if (!await catalogDatabase.CanConnectAsync(ct))
                    return Results.StatusCode(503);

                foreach (var type in RequiredContexts)
                {
                    var database = ((DbContext)services.GetRequiredService(type)).Database;
                    // Match the full history to detect both missing and newer migrations.
                    var applied = await database.GetAppliedMigrationsAsync(ct);
                    if (!database.GetMigrations().SequenceEqual(applied, StringComparer.Ordinal))
                        return Results.StatusCode(503);
                }

                if (!await services.GetRequiredService<ICatalogService>().SearchFieldsReadyAsync(ct))
                    return Results.StatusCode(503);

                return Results.Ok(new { Status = "ready" });
            }
            catch (System.Data.Common.DbException)
            {
                return Results.StatusCode(503);
            }
        }).AllowAnonymous();
    }

    private static void SetHealthHeaders(HttpContext context)
    {
        context.Response.Headers.CacheControl = "no-store";
        context.Response.Headers["X-Robots-Tag"] = "noindex, nofollow";
    }
}
