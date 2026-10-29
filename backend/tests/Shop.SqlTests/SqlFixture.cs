using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.DataProtection.KeyManagement;
using Microsoft.AspNetCore.DataProtection.Repositories;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Cms;
using Shop.Modules.Market;
using Shop.Modules.Credit;
using Shop.Modules.Identity;
using Shop.Modules.Inventory;
using Shop.Modules.Payments;
using Shop.Modules.Sales;
using Xunit;
using IdentityContext = Shop.Modules.Identity.IdentityDbContext;

namespace Shop.SqlTests;
public sealed class SqlFactory(string connection, string password, string keyDirectory, TimeProvider? timeProvider = null,string? contentRoot=null) : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        if(contentRoot is not null)builder.UseContentRoot(contentRoot);
        builder.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?> { ["PhoneDiscovery:AutomaticNotificationsEnabled"] = "false", ["Credit:AutomaticRemindersEnabled"] = "false", ["Sales:ExpiryEnabled"] = "false", ["Inventory:ExpiryEnabled"] = "false", ["Inventory:AllocationExpiryEnabled"] = "false", ["Market:OrderProjectionEnabled"] = "false", ["Files:Storage"] = "Disabled", ["Files:ClamAvHost"] = "", ["Media:Storage"] = "Disabled", ["Media:CleanupEnabled"] = "false", ["Media:ClamAvHost"] = "", ["ConnectionStrings:Shop"] = connection, ["Auth:SigningKey"] = new string('q', 80), ["Bootstrap:AdminPassword"] = password, ["DataProtection:KeyDirectory"] = keyDirectory }));
        // The entry point configures key persistence before late factory configuration.
        // Override the actual options too, so tests never use the owner's key ring.
        builder.ConfigureTestServices(s => { s.AddDataProtection().PersistKeysToFileSystem(new DirectoryInfo(keyDirectory)); if (timeProvider is not null) s.AddSingleton(timeProvider); });
    }
}
public sealed class SqlFixture : IAsyncLifetime
{
    public TimeProvider? TimeProvider { get; init; }
    public string? ContentRoot {get;init;}
    public SqlFactory Factory { get; private set; } = null!;
    public string Password { get; } = "SqlTest!" + Guid.NewGuid().ToString("N");
    public string Connection { get; private set; } = "";
    private string? privateRunDirectory;
    public async Task InitializeAsync()
    {
        var supplied = Environment.GetEnvironmentVariable("SHOP_TEST_SQL_CONNECTION") ?? throw new InvalidOperationException("Real SQL tests require SHOP_TEST_SQL_CONNECTION. They never use an in-memory provider.");
        var connection = new SqlConnectionStringBuilder(supplied) { InitialCatalog = "SaymanTest_" + Guid.NewGuid().ToString("N"), ConnectTimeout = 8 }; Connection = connection.ConnectionString;
        privateRunDirectory=Path.Combine(Path.GetTempPath(),connection.InitialCatalog);
        if(Directory.Exists(privateRunDirectory)||File.Exists(privateRunDirectory))throw new InvalidOperationException("The generated SQL QA directory already exists.");
        Directory.CreateDirectory(privateRunDirectory);
        if(!OperatingSystem.IsWindows())File.SetUnixFileMode(privateRunDirectory,UnixFileMode.UserRead|UnixFileMode.UserWrite|UnixFileMode.UserExecute);
        Factory = new(Connection, Password, Path.Combine(privateRunDirectory, "keys"), TimeProvider,ContentRoot);
        try {
        await using var scope = Factory.Services.CreateAsyncScope(); var services = scope.ServiceProvider;
        var repository = Assert.IsType<FileSystemXmlRepository>(services.GetRequiredService<IOptions<KeyManagementOptions>>().Value.XmlRepository);
        Assert.Equal(Path.GetFullPath(Path.Combine(Path.GetTempPath(), connection.InitialCatalog, "keys")), repository.Directory.FullName);
        foreach (var type in new[] { typeof(IdentityContext), typeof(PaymentsDbContext), typeof(CreditDbContext), typeof(CmsDbContext), typeof(InventoryDbContext), typeof(CatalogDbContext), typeof(SalesDbContext), typeof(MarketDbContext), typeof(Shop.Modules.Reviews.ReviewsDbContext), typeof(Shop.Modules.Support.SupportDbContext),typeof(Shop.Modules.Notifications.NotificationsDbContext),typeof(Shop.Modules.Files.FilesDbContext) }) await ((DbContext)services.GetRequiredService(type)).Database.MigrateAsync();
        var backend = FindBackendRoot();
        await DevelopmentSeed.RunAsync(services, services.GetRequiredService<IConfiguration>(), Path.Combine(backend, "src/Shop.Api"));
        } catch (Exception initialization) {
            try { await DisposeAsync(); }
            catch (Exception cleanup) { throw new AggregateException("SQL fixture initialization and cleanup failed.", initialization, cleanup); }
            throw;
        }
    }
    private static string FindBackendRoot()
    {
        // Private --artifacts-path builds live outside backend/. Locate the same
        // checked-out seed sources from either test output or the runner cwd.
        foreach (var start in new[] { AppContext.BaseDirectory, Directory.GetCurrentDirectory() }) {
            for (var directory = new DirectoryInfo(start); directory is not null; directory = directory.Parent) {
                foreach (var candidate in new[] { directory.FullName, Path.Combine(directory.FullName, "backend") }) {
                    if (File.Exists(Path.Combine(candidate, "Shop.sln"))
                        && File.Exists(Path.Combine(candidate, "src/Shop.Api/Shop.Api.csproj"))) return candidate;
                }
            }
        }
        throw new InvalidOperationException("Cannot find backend/Shop.sln and API sources for development seed.");
    }

    public async Task<(string Username, string Password)> CreateAdministratorAsync()
    {
        await using var scope = Factory.Services.CreateAsyncScope(); var users = scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>(); var name = "sql" + Guid.NewGuid().ToString("N");
        var user = new ShopUser { UserName = name, Email = name + "@example.test", DisplayName = "SQL test", EmailConfirmed = true, RequireMfa = true };
        var result = await users.CreateAsync(user, Password); Assert.True(result.Succeeded, string.Join("; ", result.Errors.Select(e => e.Description))); Assert.True((await users.AddToRoleAsync(user, "Administrator")).Succeeded); return (name, Password);
    }
    public async Task DisposeAsync()
    {
        if (Factory is null) return;
        var deleted=false;
        try { await using var scope = Factory.Services.CreateAsyncScope(); await scope.ServiceProvider.GetRequiredService<CatalogDbContext>().Database.EnsureDeletedAsync(); deleted=true; }
        finally {
            await Factory.DisposeAsync(); using var connection = new SqlConnection(Connection); SqlConnection.ClearPool(connection);
            // Only this fixture's freshly-created directory, after SQL cleanup.
            // Preserve keys if database cleanup fails so recovery remains possible.
            if(deleted&&privateRunDirectory is not null&&Directory.Exists(privateRunDirectory)){
                var expected=Path.Combine(Path.GetTempPath(),new SqlConnectionStringBuilder(Connection).InitialCatalog);
                if(Path.GetFullPath(privateRunDirectory)!=Path.GetFullPath(expected)||new DirectoryInfo(privateRunDirectory).LinkTarget is not null)throw new InvalidOperationException("SQL QA directory ownership changed.");
                Directory.Delete(privateRunDirectory,recursive:true);
            }
        }
    }
}
