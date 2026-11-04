using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Cms;
using Shop.Modules.Credit;
using Shop.Modules.Inventory;
using Shop.Modules.Payments;
using Shop.Modules.Sales;
using Shop.Modules.Market;
using Shop.Modules.Reviews;
using IdentityContext = Shop.Modules.Identity.IdentityDbContext;

public static class DesignTimeOptions
{
    public static DbContextOptions<T> Create<T>(string schema) where T : DbContext => new DbContextOptionsBuilder<T>().UseSqlServer("Server=127.0.0.1,11433;Database=Sayman;User Id=design-time;Password=unused-design-time-only;TrustServerCertificate=True", s => s.MigrationsAssembly(typeof(Program).Assembly.FullName).MigrationsHistoryTable("__EFMigrationsHistory", schema)).Options;
}
public sealed class CatalogFactory : IDesignTimeDbContextFactory<CatalogDbContext> { public CatalogDbContext CreateDbContext(string[] args) => new(DesignTimeOptions.Create<CatalogDbContext>("catalog")); }
public sealed class InventoryFactory : IDesignTimeDbContextFactory<InventoryDbContext> { public InventoryDbContext CreateDbContext(string[] args) => new(DesignTimeOptions.Create<InventoryDbContext>("inventory")); }
public sealed class SalesFactory : IDesignTimeDbContextFactory<SalesDbContext> { public SalesDbContext CreateDbContext(string[] args) => new(DesignTimeOptions.Create<SalesDbContext>("sales")); }
public sealed class PaymentsFactory : IDesignTimeDbContextFactory<PaymentsDbContext> { public PaymentsDbContext CreateDbContext(string[] args) => new(DesignTimeOptions.Create<PaymentsDbContext>("payments")); }
public sealed class CreditFactory : IDesignTimeDbContextFactory<CreditDbContext> { public CreditDbContext CreateDbContext(string[] args) => new(DesignTimeOptions.Create<CreditDbContext>("credit")); }
public sealed class CmsFactory : IDesignTimeDbContextFactory<CmsDbContext> { public CmsDbContext CreateDbContext(string[] args) => new(DesignTimeOptions.Create<CmsDbContext>("cms")); }
public sealed class IdentityFactory : IDesignTimeDbContextFactory<IdentityContext> { public IdentityContext CreateDbContext(string[] args) => new(DesignTimeOptions.Create<IdentityContext>("identity")); }
public sealed class MarketFactory : IDesignTimeDbContextFactory<MarketDbContext> { public MarketDbContext CreateDbContext(string[] args) => new(DesignTimeOptions.Create<MarketDbContext>("market")); }
public sealed class ReviewsFactory : IDesignTimeDbContextFactory<ReviewsDbContext> { public ReviewsDbContext CreateDbContext(string[] args)=>new(DesignTimeOptions.Create<ReviewsDbContext>("reviews")); }

public sealed class SupportFactory : IDesignTimeDbContextFactory<Shop.Modules.Support.SupportDbContext> { public Shop.Modules.Support.SupportDbContext CreateDbContext(string[] args) => new(DesignTimeOptions.Create<Shop.Modules.Support.SupportDbContext>("support")); }

public sealed class NotificationsFactory : IDesignTimeDbContextFactory<Shop.Modules.Notifications.NotificationsDbContext> { public Shop.Modules.Notifications.NotificationsDbContext CreateDbContext(string[] args)=>new(DesignTimeOptions.Create<Shop.Modules.Notifications.NotificationsDbContext>("notifications")); }

public sealed class FilesFactory : IDesignTimeDbContextFactory<Shop.Modules.Files.FilesDbContext> { public Shop.Modules.Files.FilesDbContext CreateDbContext(string[] args)=>new(DesignTimeOptions.Create<Shop.Modules.Files.FilesDbContext>("files")); }
