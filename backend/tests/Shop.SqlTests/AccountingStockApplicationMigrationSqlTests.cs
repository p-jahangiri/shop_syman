using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Inventory;
using Xunit;
namespace Shop.SqlTests;
public sealed class AccountingStockApplicationMigrationSqlTests(SqlFixture fixture):IClassFixture<SqlFixture>
{
    [Fact] public async Task EmptyApplicationSchemaCanRollBackButRecordedHistoryCannotBeDropped()
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<InventoryDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);var migrator=db.GetService<IMigrator>();const string current="20261025203601_HolooManualStockApplications";await migrator.MigrateAsync(current);var previous=(await db.Database.GetAppliedMigrationsAsync()).Reverse().Skip(1).First();await migrator.MigrateAsync(previous);await migrator.MigrateAsync(current);
        var warehouse=new AccountingWarehouseLink{Id=Guid.NewGuid().ToString("N"),CompanyKey="qa",ExternalWarehouseKey="WH",NameFa="انبار نمونه",NameEn="Sample warehouse",ChangedAt=DateTimeOffset.UtcNow};db.AccountingWarehouses.Add(warehouse);await db.SaveChangesAsync();db.AccountingStockApplications.Add(new(){Id=Guid.NewGuid().ToString("N"),ActorId="synthetic",CommandId=Guid.NewGuid().ToString("N"),BatchId=Guid.NewGuid().ToString("N"),PayloadHash=new string('A',64),BatchPayloadHash=new string('A',64),PreviewFingerprint=new string('A',64),CompanyKey="qa",ExternalWarehouseKey="WH",WarehouseId=warehouse.Id,WarehouseVersion=Convert.ToBase64String(warehouse.Version),ObservedAt=DateTimeOffset.UtcNow.AddMinutes(-1),AppliedAt=DateTimeOffset.UtcNow,Reason="Synthetic retention guard",IsDemo=true,AcknowledgeWholeStorePhysical=true,AcknowledgeUnpostedSalesReconciled=true,RowCount=1});await db.SaveChangesAsync();var error=await Assert.ThrowsAsync<SqlException>(()=>migrator.MigrateAsync(previous));Assert.Equal(51000,error.Number);Assert.Single(await db.AccountingStockApplications.ToArrayAsync());Assert.False(db.Database.HasPendingModelChanges());
    }
}
