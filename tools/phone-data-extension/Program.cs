using System.Text.Json;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Credit;
using Shop.Modules.Identity;
using Shop.Modules.Inventory;
using Shop.Modules.Market;
using Shop.Modules.Payments;
using Shop.SharedKernel;

// Offline, one-shot Development data command. No host, endpoints, migration or account changes.
if (args.Length != 2 || args[0] != "--apply-main-development") throw new InvalidOperationException("Explicit --apply-main-development <repository-root> is required.");
var root = Path.GetFullPath(args[1]);
var connection = Environment.GetEnvironmentVariable("ConnectionStrings__Shop") ?? throw new InvalidOperationException("Connection is required.");
var sql = new SqlConnectionStringBuilder(connection);
if (sql.InitialCatalog != "Sayman" || sql.DataSource != "127.0.0.1,11433" || Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT") != "Development") throw new InvalidOperationException("Only the canonical local Development database is allowed.");
var builder = Host.CreateApplicationBuilder(new HostApplicationBuilderSettings { EnvironmentName = "Development", ContentRootPath = root });
builder.Logging.ClearProviders();
void Configure(DbContextOptionsBuilder options) => options.UseSqlServer(connection);
builder.Services.AddDbContext<CatalogDbContext>(Configure);
builder.Services.AddDbContext<MarketDbContext>(Configure);
builder.Services.AddDbContext<IdentityDbContext>(Configure);
builder.Services.AddDbContext<InventoryDbContext>(Configure);
builder.Services.AddDbContext<PaymentsDbContext>(Configure);
builder.Services.AddDbContext<CreditDbContext>(Configure);
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddScoped<IInventoryReader, InventoryService>();
builder.Services.AddScoped<PurchaseMethodService>();
builder.Services.AddScoped<CreditPlanService>();
builder.Services.AddScoped<IPurchaseConfiguration, PurchaseConfiguration>();
builder.Services.AddScoped(sp => new StockReservationService(sp.GetRequiredService<InventoryDbContext>(), sp.GetRequiredService<TimeProvider>(), true));
builder.Services.AddScoped<IInventorySerialGuard, SerialInventoryService>();
builder.Services.AddScoped<ICatalogService, CatalogService>();
builder.Services.AddScoped<IMarketModelCatalog>(sp => (IMarketModelCatalog)sp.GetRequiredService<ICatalogService>());
builder.Services.AddScoped<ICatalogSourcingReader, CatalogSourcingReader>();
builder.Services.AddScoped<ICatalogOfferReader, CatalogOfferReader>();
builder.Services.AddSingleton(new PhoneDiscoveryOptions());
builder.Services.AddScoped(sp => new MarketService(sp.GetRequiredService<MarketDbContext>(), sp.GetRequiredService<IMarketModelCatalog>(), sp.GetRequiredService<TimeProvider>(), true));
builder.Services.AddScoped(sp => new PhoneDiscoveryService(sp.GetRequiredService<MarketDbContext>(), sp.GetRequiredService<IMarketModelCatalog>(), sp.GetRequiredService<ICatalogSourcingReader>(), sp.GetRequiredService<ICatalogOfferReader>(), sp.GetRequiredService<IInventoryReader>(), sp.GetRequiredService<TimeProvider>(), sp.GetRequiredService<PhoneDiscoveryOptions>(), true));
using var host = builder.Build(); // Intentionally never Start/Run.
async Task<DevelopmentPhoneExtensionSeed.Result> Import() {
    await using var scope = host.Services.CreateAsyncScope();
    return await DevelopmentPhoneExtensionSeed.RunAsync(scope.ServiceProvider, builder.Environment, Path.Combine(root,"backend"), default);
}
async Task<Dictionary<string,string>> ProtectedData() {
    await using var db = new SqlConnection(connection); await db.OpenAsync();
    var names = new List<(string Schema,string Table)>();
    await using (var command = db.CreateCommand()) {
        command.CommandText = "SELECT s.name,t.name FROM sys.tables t JOIN sys.schemas s ON t.schema_id=s.schema_id WHERE s.name IN ('inventory','sales','payments','credit','identity') AND t.name NOT IN ('Audit','__EFMigrationsHistory') ORDER BY s.name,t.name";
        await using var rows = await command.ExecuteReaderAsync(); while(await rows.ReadAsync()) names.Add((rows.GetString(0),rows.GetString(1)));
    }
    var result = new Dictionary<string,string>();
    foreach(var name in names) {
        await using var command = db.CreateCommand(); command.CommandText=$"SELECT * FROM [{name.Schema.Replace("]","]]")}].[{name.Table.Replace("]","]]")}]";
        var serialized = new List<string>();
        await using var rows = await command.ExecuteReaderAsync();
        while(await rows.ReadAsync()) { var values=new object[rows.FieldCount]; rows.GetValues(values); serialized.Add(JsonSerializer.Serialize(values)); }
        serialized.Sort(StringComparer.Ordinal);
        result[name.Schema+"."+name.Table]=Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(string.Join("\n",serialized))));
    }
    return result;
}
var before = await ProtectedData();
var first = await Import();
var repeat = await Import();
if (repeat.Created != 0 || repeat.Preserved != 4 || repeat.ConfigurationsCreated != 0) throw new InvalidOperationException("Idempotent import verification failed.");
var after = await ProtectedData();
var unchanged = JsonSerializer.Serialize(before)==JsonSerializer.Serialize(after);
Console.WriteLine(JsonSerializer.Serialize(new { first, repeat, protectedTables = before.Count, protectedDataUnchanged=unchanged, noHostStarted = true, migrations = 0, pricesCreated = 0, inventoryCreated = 0 }));
if(!unchanged) throw new InvalidOperationException("Protected data changed during the import window. Inspect concurrent operations before repeating.");
