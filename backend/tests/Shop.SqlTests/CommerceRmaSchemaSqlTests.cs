using System.Data;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
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
using Xunit;

namespace Shop.SqlTests;

public sealed class CommerceRmaSchemaSqlTests(SqlFixture fixture) : IClassFixture<SqlFixture>
{
    private static readonly string[] CapturedTables=[
        "sales.CheckoutChargePolicies","sales.CheckoutQuotes","sales.Orders",
        "sales.RmaCaseCommands","sales.RmaCaseEvents","sales.RmaCaseLines","sales.RmaCases","sales.RmaPolicyCommands","sales.RmaPolicyRevisions"
    ];
    private static string Publisher()
    {
        foreach(var start in new[]{AppContext.BaseDirectory,Directory.GetCurrentDirectory()}){
            for(var directory=new DirectoryInfo(start);directory is not null;directory=directory.Parent){
                var path=Path.Combine(directory.FullName,"scripts","publish-local-commerce-rma.py");if(File.Exists(path))return path;
            }
        }
        throw new InvalidOperationException("The exact commerce/RMA publisher metadata source is required.");
    }
    private static string MetadataSql()
    {
        // Execute the actual publisher export verbatim; a second handwritten
        // query could silently capture a weaker/different portable contract.
        var source=File.ReadAllText(Publisher());const string prefix="METADATA_SQL = r\"\"\"";var start=source.IndexOf(prefix,StringComparison.Ordinal);
        Assert.True(start>=0);Assert.Equal(start,source.LastIndexOf(prefix,StringComparison.Ordinal));start+=prefix.Length;var end=source.IndexOf("\"\"\"",start,StringComparison.Ordinal);Assert.True(end>start);
        return source[start..end];
    }

    [Fact]
    public async Task FullyMigratedSchema92HasNoModelDriftAndExportsExactNinePortableTablesWithTrustedChecks()
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var services=scope.ServiceProvider;var sales=services.GetRequiredService<SalesDbContext>();Assert.StartsWith("SaymanTest_",sales.Database.GetDbConnection().Database);
        Type[] types=[typeof(IdentityDbContext),typeof(PaymentsDbContext),typeof(CreditDbContext),typeof(CmsDbContext),typeof(InventoryDbContext),typeof(CatalogDbContext),typeof(SalesDbContext),typeof(MarketDbContext),typeof(ReviewsDbContext),typeof(SupportDbContext),typeof(NotificationsDbContext),typeof(FilesDbContext)];
        var migrationCount=0;
        foreach(var type in types){
            var db=(DbContext)services.GetRequiredService(type);Assert.False(db.Database.HasPendingModelChanges(),type.Name+" model differs from its final migration snapshot.");
            var expected=db.Database.GetMigrations().ToArray();var applied=(await db.Database.GetAppliedMigrationsAsync()).ToArray();Assert.Equal(expected,applied);Assert.Empty(await db.Database.GetPendingMigrationsAsync());migrationCount+=applied.Length;
        }
        Assert.Equal(92,migrationCount);var salesHistory=(await sales.Database.GetAppliedMigrationsAsync()).ToArray();Assert.Contains("20261030190000_PostpaidShipping",salesHistory);Assert.Contains("20261030200000_PrivateReturnRequests",salesHistory);
        var connection=sales.Database.GetDbConnection();var close=connection.State==ConnectionState.Closed;var raw=new StringBuilder();
        if(close)await sales.Database.OpenConnectionAsync();
        try{
            await using var command=connection.CreateCommand();command.CommandText=MetadataSql();command.CommandTimeout=60;
            await using var reader=await command.ExecuteReaderAsync();Assert.Equal(1,reader.FieldCount);
            // FOR JSON may return several chunks; ExecuteScalar would retain
            // only the first chunk for a schema of this size.
            while(await reader.ReadAsync())raw.Append(reader.GetString(0));
        }finally{if(close)await sales.Database.CloseConnectionAsync();}
        using var document=JsonDocument.Parse(raw.ToString());Assert.Equal(JsonValueKind.Array,document.RootElement.ValueKind);var rows=document.RootElement.EnumerateArray().ToArray();Assert.Equal(240,rows.Length);
        var identities=rows.Select(row=>row.GetProperty("schema").GetString()+"."+row.GetProperty("table").GetString()).ToArray();Assert.Equal(240,identities.Distinct(StringComparer.Ordinal).Count());
        foreach(var row in rows)foreach(var check in row.GetProperty("checks").EnumerateArray()){
            Assert.False(check.GetProperty("is_disabled").GetBoolean(),row.GetProperty("table").GetString()+"."+check.GetProperty("name").GetString()+" is disabled.");
            Assert.False(check.GetProperty("is_not_trusted").GetBoolean(),row.GetProperty("table").GetString()+"."+check.GetProperty("name").GetString()+" is untrusted.");
        }
        var selected=rows.Where(row=>CapturedTables.Contains(row.GetProperty("schema").GetString()+"."+row.GetProperty("table").GetString(),StringComparer.Ordinal)).ToArray();
        Assert.Equal(9,selected.Length);Assert.Equal(CapturedTables.Order(StringComparer.Ordinal),selected.Select(row=>row.GetProperty("schema").GetString()+"."+row.GetProperty("table").GetString()).Order(StringComparer.Ordinal));
        if (Environment.GetEnvironmentVariable("SHOP_SMS_WORKSPACE_SCHEMA_CONTRACT") is { Length: > 0 } smsPath) {
            string[] smsTables=["notifications.SmsWorkspace","notifications.SmsConnections","notifications.SmsTemplates","notifications.SmsTemplateParameters","notifications.SmsEventRoutes","notifications.SmsWorkspaceCommands","notifications.SmsMessages","sales.SmsSignals","identity.CustomerOtpChallenges"];
            var smsRows=rows.Where(r=>smsTables.Contains(r.GetProperty("schema").GetString()+"."+r.GetProperty("table").GetString(),StringComparer.Ordinal)).Select(r=>r.Clone()).ToArray();
            Assert.Equal(9,smsRows.Length);
            await File.WriteAllTextAsync(smsPath,JsonSerializer.Serialize(new { schemaVersion=1,status="disposable-schema92-accepted",sourceMigrationCount=92,tableCount=240,metadata=smsRows }));
        }
        var output=new JsonArray(selected.Select(row=>JsonNode.Parse(row.GetRawText())).ToArray());
        if(Environment.GetEnvironmentVariable("SHOP_COMMERCE_RMA_SCHEMA_PATH") is{Length:>0} path){
            var full=Path.GetFullPath(path);Directory.CreateDirectory(Path.GetDirectoryName(full)!);
            // Capture only the nine raw metadata rows. The acceptance runner
            // binds their source/module hashes in its separate frozen wrapper.
            await using var file=new FileStream(full,FileMode.Create,FileAccess.Write,FileShare.None);await JsonSerializer.SerializeAsync(file,output);
        }
    }
}
