using System.Data;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Sales;
using Xunit;

namespace Shop.SqlTests;

public sealed class CommercePolicyMigrationSqlTests : IAsyncLifetime
{
    private readonly OrderFixture fixture=new();
    public Task InitializeAsync()=>fixture.InitializeAsync();
    public Task DisposeAsync()=>fixture.DisposeAsync();
    private static string Id()=>Guid.NewGuid().ToString("N");
    private static string Text(JsonNode value,string key)=>value[key]!.GetValue<string>();
    private async Task<JsonNode> Policy(string shipping,string tax)
    {
        var current=await OrderFixture.Json(await fixture.Admin.GetAsync("/api/admin/checkout-charges"));
        return await OrderFixture.Json(await fixture.Admin.PutAsJsonAsync("/api/admin/checkout-charges",new CheckoutChargePolicyInput(shipping,"ارسال مصنوعی QA","Synthetic QA shipping","فقط آزمون نرم‌افزار","Software QA only",shipping=="flat"?"7":null,null,tax,null,"goods_shipping","half_up",Text(current,"version"))));
    }
    private static async Task<JsonNode> Quote(HttpClient client,string variant,string method)
    {
        var head=await OrderFixture.Json(await client.GetAsync("/api/cart/en"));
        var cart=await OrderFixture.Json(await client.PutAsJsonAsync("/api/cart/en",new CartInput([new(variant,1)],head["version"]?.GetValue<string>())));
        return await OrderFixture.Json(await client.PostAsJsonAsync("/api/cart/en/quote",new CheckoutQuoteInput(Text(cart,"version"),method,null,Id())));
    }
    private static async Task<string> Raw(SalesDbContext db,string query)
    {
        var connection=db.Database.GetDbConnection();if(connection.State!=ConnectionState.Open)await connection.OpenAsync();
        await using var command=connection.CreateCommand();command.CommandText=query;command.CommandTimeout=30;
        command.Transaction=db.Database.CurrentTransaction?.GetDbTransaction();
        await using var reader=await command.ExecuteReaderAsync();var result=new StringBuilder();
        while(await reader.ReadAsync())result.Append(reader.GetString(0));return result.ToString();
    }
    private static readonly string[] Tables=["CheckoutChargePolicies","CheckoutOrderSettings","CheckoutQuotes","Orders","OrderLines","OrderEvents"];
    private static async Task<string> OldData(SalesDbContext db)
    {
        var result=new Dictionary<string,string>(StringComparer.Ordinal);
        foreach(var table in Tables) {
            // Exclude exactly the newly added disclosure column; all historical
            // data, rowversions, quote/receipt JSON and integer amounts remain.
            var columns=await Raw(db,$"SELECT STRING_AGG(QUOTENAME(c.[name]),',') WITHIN GROUP (ORDER BY c.column_id) FROM sys.columns c JOIN sys.tables t ON t.object_id=c.object_id JOIN sys.schemas s ON s.schema_id=t.schema_id WHERE s.[name]='sales' AND t.[name]='{table}' AND c.[name]<>'TaxBreakdownKnown'");
            result[table]=await Raw(db,$"SELECT {columns} FROM [sales].[{table}] ORDER BY {columns} FOR JSON PATH, INCLUDE_NULL_VALUES");
        }
        return JsonSerializer.Serialize(result);
    }
    private static Task<string> Indexes(SalesDbContext db)=>Raw(db,"SELECT t.[name] AS [Table],i.[name],i.[type],i.is_unique,i.is_primary_key,i.filter_definition,ic.key_ordinal,ic.is_included_column,c.[name] AS [Column] FROM sys.schemas s JOIN sys.tables t ON t.schema_id=s.schema_id JOIN sys.indexes i ON i.object_id=t.object_id JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id WHERE s.[name]='sales' AND t.[name] IN ('CheckoutChargePolicies','CheckoutOrderSettings','CheckoutQuotes','Orders','OrderLines','OrderEvents') ORDER BY t.[name],i.[name],ic.index_column_id FOR JSON PATH, INCLUDE_NULL_VALUES");
    private static async Task<(string Own,string Previous)> Boundary(SalesDbContext db)
    {
        var migrations=(await db.Database.GetAppliedMigrationsAsync()).ToArray();
        var own=Assert.Single(migrations,name=>name.EndsWith("_PostpaidShipping",StringComparison.Ordinal));var index=Array.IndexOf(migrations,own);Assert.True(index>0);return(own,migrations[index-1]);
    }
    [Fact]
    public async Task EmptyFeatureRoundTripPreservesEveryExistingFinancialColumnValueRowVersionJsonAndIndex()
    {
        await fixture.Settings(minutes:60,max:2);var person=await fixture.Customer();using var customer=person.Client;var item=await fixture.Product();var quote=await Quote(customer,item.Variant,item.Method);
        var created=await OrderFixture.Json(await customer.PostAsJsonAsync("/api/orders",new CreateOrderInput(Text(quote,"quoteId"),Id(),"Synthetic migration QA","09100000000",new("IR","تهران","تهران","نشانی کاملاً ساختگی آزمون نرم‌افزار","1234567890"),"Software migration QA only",true)),HttpStatusCode.Created);
        Assert.False(created["order"]!.AsObject().ContainsKey("taxBreakdownKnown"));Assert.False(created["order"]!.AsObject().ContainsKey("shippingMode"));
        await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<SalesDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);
        var applied=(await db.Database.GetAppliedMigrationsAsync()).ToArray();var boundary=await Boundary(db);var assembly=db.GetService<IMigrationsAssembly>();var generator=db.GetService<IMigrationsSqlGenerator>();
        var own=assembly.CreateMigration(assembly.Migrations[boundary.Own],db.Database.ProviderName!);
        var previous=assembly.CreateMigration(assembly.Migrations[boundary.Previous],db.Database.ProviderName!);
        // Run only this historical migration's operations. A newer migration
        // intentionally blocks global downgrade when the order emits SMS signals.
        await using var rollback=await db.Database.BeginTransactionAsync();
        async Task Execute(IReadOnlyList<Microsoft.EntityFrameworkCore.Migrations.Operations.MigrationOperation> operations, Microsoft.EntityFrameworkCore.Metadata.IModel model)
        {
            foreach(var command in generator.Generate(operations,db.GetService<Microsoft.EntityFrameworkCore.Infrastructure.IModelRuntimeInitializer>().Initialize(model, designTime: true)))
            {
                Assert.False(command.TransactionSuppressed);
                await db.Database.ExecuteSqlRawAsync(command.CommandText);
            }
        }
        try {
            var before=await OldData(db);var indexes=await Indexes(db);
            Assert.Equal("1",await Raw(db,"SELECT CONVERT(varchar(1),[TaxBreakdownKnown]) FROM [sales].[Orders]"));
            await Execute(own.DownOperations,previous.TargetModel);
            Assert.Equal(before,await OldData(db));Assert.Equal(indexes,await Indexes(db));
            Assert.Equal("0",await Raw(db,"SELECT CONVERT(varchar(1),COUNT(*)) FROM sys.columns WHERE object_id=OBJECT_ID('[sales].[Orders]') AND [name]='TaxBreakdownKnown'"));
            Assert.Equal("0",await Raw(db,"SELECT CONVERT(varchar(1),is_nullable) FROM sys.columns WHERE object_id=OBJECT_ID('[sales].[Orders]') AND [name]='TaxRial'"));
            await Execute(own.UpOperations,own.TargetModel);Assert.Equal(before,await OldData(db));Assert.Equal(indexes,await Indexes(db));
            Assert.Equal("1",await Raw(db,"SELECT CONVERT(varchar(1),[TaxBreakdownKnown]) FROM [sales].[Orders]"));
            Assert.Equal("24",await Raw(db,"SELECT CONVERT(varchar(2),max_length) FROM sys.columns WHERE object_id=OBJECT_ID('[sales].[CheckoutChargePolicies]') AND [name]='TaxMode'"));
            Assert.Equal("1",await Raw(db,"SELECT CONVERT(varchar(1),is_nullable) FROM sys.columns WHERE object_id=OBJECT_ID('[sales].[Orders]') AND [name]='TaxRial'"));
        }
        finally { await rollback.RollbackAsync(); }
        Assert.Equal(applied,await db.Database.GetAppliedMigrationsAsync());Assert.False(db.Database.HasPendingModelChanges());
    }
    [Theory][InlineData("postpaid","exempt")][InlineData("flat","included_unitemized")]
    public async Task DownRejectsCurrentFeaturePolicyAndRetainedQuoteEvenAfterCurrentPolicyIsReverted(string shipping,string tax)
    {
        await Policy(shipping,tax);
        await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<SalesDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);
        var applied=(await db.Database.GetAppliedMigrationsAsync()).ToArray();var boundary=await Boundary(db);var migrator=db.GetService<IMigrator>();
        try {
            await migrator.MigrateAsync(boundary.Own);var pinned=(await db.Database.GetAppliedMigrationsAsync()).ToArray();var before=await OldData(db);
            var active=await Assert.ThrowsAsync<SqlException>(()=>migrator.MigrateAsync(boundary.Previous));Assert.Equal(51000,active.Number);Assert.Equal(pinned,await db.Database.GetAppliedMigrationsAsync());Assert.Equal(before,await OldData(db));
            var person=await fixture.Customer();using var customer=person.Client;var item=await fixture.Product();var quote=await Quote(customer,item.Variant,item.Method);Assert.Equal(shipping,Text(quote["chargeRules"]!,"shippingMode"));Assert.Equal(tax,Text(quote["chargeRules"]!,"taxMode"));
            await Policy("flat","exempt");before=await OldData(db);
            var historical=await Assert.ThrowsAsync<SqlException>(()=>migrator.MigrateAsync(boundary.Previous));Assert.Equal(51000,historical.Number);Assert.Equal(pinned,await db.Database.GetAppliedMigrationsAsync());Assert.Equal(before,await OldData(db));
            Assert.Single(await db.Quotes.Where(row=>row.Id==Text(quote,"quoteId")).ToArrayAsync());
        }
        finally { await db.Database.MigrateAsync(); }
        Assert.Equal(applied,await db.Database.GetAppliedMigrationsAsync());Assert.False(db.Database.HasPendingModelChanges());
    }
}
