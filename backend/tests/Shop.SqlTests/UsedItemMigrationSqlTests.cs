using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Inventory;
using Xunit;
namespace Shop.SqlTests;
public sealed class UsedItemMigrationSqlTests(SqlFixture fixture):IClassFixture<SqlFixture>
{
    [Fact]public async Task EmptyCatalogRollbackReapplyWorksButInspectionReceiptsPreventLoss()
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();var migrator=db.GetService<IMigrator>();
        // This test owns the inspection migration's data-loss guard. Later
        // read-only views have an independently tested rollback boundary.
        const string inspected="20261025141500_UsedItemInspections";
        await migrator.MigrateAsync(inspected);var previous=(await db.Database.GetAppliedMigrationsAsync()).Reverse().Skip(1).First();await migrator.MigrateAsync(previous);await migrator.MigrateAsync(inspected);
        db.Add(new UsedItemCommand{ActorId="qa",CommandId=Guid.NewGuid().ToString("N"),PayloadHash=new string('a',64),ResultJson="{}",At=DateTimeOffset.UtcNow});await db.SaveChangesAsync();var ex=await Assert.ThrowsAsync<SqlException>(()=>migrator.MigrateAsync(previous));Assert.Equal(51000,ex.Number);Assert.Single(await db.Set<UsedItemCommand>().ToArrayAsync());
    }
    [Fact]public async Task EmptyStockRollbackReapplyWorksButSingleDeviceFlagsPreventLoss()
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<InventoryDbContext>();var migrator=db.GetService<IMigrator>();const string current="20261025141527_SingleUnitUsedStock";await migrator.MigrateAsync(current);var previous=(await db.Database.GetAppliedMigrationsAsync()).Reverse().Skip(1).First();await migrator.MigrateAsync(previous);await migrator.MigrateAsync(current);
        db.Stock.Add(new(){VariantId="qa-"+Guid.NewGuid().ToString("N"),IsSingleUnit=true,OnHand=1});await db.SaveChangesAsync();var ex=await Assert.ThrowsAsync<SqlException>(()=>migrator.MigrateAsync(previous));Assert.Equal(51000,ex.Number);Assert.Equal(1,await db.Stock.CountAsync(s=>s.IsSingleUnit));
    }
}
