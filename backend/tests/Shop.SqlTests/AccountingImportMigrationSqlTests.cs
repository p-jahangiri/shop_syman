using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Infrastructure;
using Xunit;
namespace Shop.SqlTests;
public sealed class AccountingImportMigrationSqlTests
{
    private const string Prior="20261023181031_HolooProductLinks";
    private const string Current="20261024183809_HolooImportStaging";
    [Fact] public async Task EmptyStagingDowngradesAndUpgradesWithoutChangingExistingCatalogRows()
    {
        var fixture=new SqlFixture();await fixture.InitializeAsync();try{
            await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);var before=await Catalog(db);var migrator=db.GetService<IMigrator>();await migrator.MigrateAsync(Prior);Assert.DoesNotContain(Current,await db.Database.GetAppliedMigrationsAsync());await migrator.MigrateAsync(Current);Assert.Contains(Current,await db.Database.GetAppliedMigrationsAsync());Assert.Equal(before,await Catalog(db));Assert.Empty(await db.AccountingImports.ToArrayAsync());Assert.Empty(await db.AccountingImportRows.ToArrayAsync());
        }finally{await fixture.DisposeAsync();}
    }
    [Fact] public async Task StagedHistoryBlocksDownBeforeEitherTableCanDisappear()
    {
        var fixture=new SqlFixture();await fixture.InitializeAsync();try{
            await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);var id=Guid.NewGuid().ToString("N");db.AccountingImports.Add(new(){Id=id,CompanyKey="qa",ExternalWarehouseKey="WH",QuantityMeaning="unknown",PriceCurrency="unknown",ObservedAt=DateTimeOffset.UtcNow.AddMinutes(-1),CreatedAt=DateTimeOffset.UtcNow,CreatedBy="qa",IsDemo=true,RowCount=1,PayloadHash=new string('A',64),Rows=[new(){RowNumber=1,ExternalItemId="00001",ExternalUnitKey="EA",QuantityRaw="1.5"}]});await db.SaveChangesAsync();var before=await Catalog(db);var exception=await Assert.ThrowsAsync<SqlException>(()=>db.GetService<IMigrator>().MigrateAsync(Prior));Assert.Equal(51000,exception.Number);Assert.Contains(Current,await db.Database.GetAppliedMigrationsAsync());Assert.Equal(1,await db.AccountingImports.CountAsync(x=>x.Id==id));Assert.Equal("1.5",await db.AccountingImportRows.Where(x=>x.BatchId==id).Select(x=>x.QuantityRaw).SingleAsync());Assert.Equal(before,await Catalog(db));
        }finally{await fixture.DisposeAsync();}
    }
    private static async Task<string> Catalog(CatalogDbContext db)=>System.Text.Json.JsonSerializer.Serialize(await db.Variants.AsNoTracking().OrderBy(v=>v.Id).Select(v=>new{v.Id,v.Sku,v.PriceRial,v.Version}).ToArrayAsync());
}
