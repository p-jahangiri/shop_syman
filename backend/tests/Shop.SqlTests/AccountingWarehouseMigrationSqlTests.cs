using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Inventory;
using Xunit;
namespace Shop.SqlTests;
public sealed class AccountingWarehouseMigrationSqlTests(SqlFixture fixture):IClassFixture<SqlFixture>
{
    [Fact] public async Task EmptyMappingUpgradeAndDownWorkButRecordedMappingsCannotBeDropped()
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<InventoryDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);var migrator=db.GetService<IMigrator>();const string current="20261025200014_HolooWarehouseReconciliation";await migrator.MigrateAsync(current);var previous=(await db.Database.GetAppliedMigrationsAsync()).Reverse().Skip(1).First();await migrator.MigrateAsync(previous);await migrator.MigrateAsync(current);
        db.AccountingWarehouses.Add(new(){Id=Guid.NewGuid().ToString("N"),CompanyKey="qa",ExternalWarehouseKey="WH",NameFa="انبار نمونه",NameEn="Sample warehouse",ChangedAt=DateTimeOffset.UtcNow});await db.SaveChangesAsync();var error=await Assert.ThrowsAsync<SqlException>(()=>migrator.MigrateAsync(previous));Assert.Equal(51000,error.Number);Assert.Single(await db.AccountingWarehouses.ToArrayAsync());Assert.False(db.Database.HasPendingModelChanges());
    }
}
