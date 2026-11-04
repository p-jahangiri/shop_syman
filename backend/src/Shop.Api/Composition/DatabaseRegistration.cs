using Microsoft.EntityFrameworkCore;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Cms;
using Shop.Modules.Credit;
using Shop.Modules.Files;
using Shop.Modules.Identity;
using Shop.Modules.Inventory;
using Shop.Modules.Market;
using Shop.Modules.Notifications;
using Shop.Modules.Payments;
using Shop.Modules.Reviews;
using Shop.Modules.Sales;
using Shop.Modules.Support;

namespace Shop.Api.Composition;

internal static class DatabaseRegistration
{
    internal static void AddCommerceDatabaseContexts(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddSqlContext<CatalogDbContext>(configuration, "catalog");
        services.AddSqlContext<InventoryDbContext>(configuration, "inventory");
        services.AddSqlContext<SalesDbContext>(configuration, "sales");
        services.AddSqlContext<PaymentsDbContext>(configuration, "payments");
        services.AddSqlContext<CreditDbContext>(configuration, "credit");
        services.AddSqlContext<CmsDbContext>(configuration, "cms");
        services.AddSqlContext<IdentityDbContext>(configuration, "identity");
        services.AddSqlContext<MarketDbContext>(configuration, "market");
        services.AddSqlContext<ReviewsDbContext>(configuration, "reviews");
    }

    internal static void AddCommunicationDatabaseContexts(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddSqlContext<SupportDbContext>(configuration, "support");
        services.AddSqlContext<NotificationsDbContext>(configuration, "notifications");
        services.AddSqlContext<FilesDbContext>(configuration, "files");
    }

    private static void AddSqlContext<TContext>(this IServiceCollection services, IConfiguration configuration, string schema)
        where TContext : DbContext
    {
        services.AddDbContext<TContext>(options =>
        {
            var connectionString = configuration.GetConnectionString("Shop")
                ?? throw new InvalidOperationException("ConnectionStrings__Shop is required.");

            options.UseSqlServer(connectionString, sql => sql
                .MigrationsAssembly(typeof(Program).Assembly.FullName)
                .MigrationsHistoryTable("__EFMigrationsHistory", schema));
        });
    }
}
