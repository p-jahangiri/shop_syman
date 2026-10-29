using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Market;
using Xunit;
namespace Shop.SqlTests;
public sealed class MarketSourceCsvMigrationSqlTests(SqlFixture fixture):IClassFixture<SqlFixture>
{
    [Fact] public async Task EmptyReceiptMigrationRollsBackButAnActorReceiptCannotBeDropped()
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<MarketDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);var migrations=db.Database.GetMigrations().ToArray();var receiptMigration=Array.FindIndex(migrations,x=>x.EndsWith("_MarketSourceCsvReceipts",StringComparison.Ordinal));Assert.True(receiptMigration>0);var migrator=db.GetService<IMigrator>();await migrator.MigrateAsync(migrations[receiptMigration-1]);await migrator.MigrateAsync(migrations[receiptMigration]);db.SourceImportReceipts.Add(new(){ActorId="synthetic-qa",RequestId=Guid.NewGuid().ToString("N"),PayloadHash=new string('A',64),ResultJson="{}",RowCount=1,ContainsDemo=true,RecordedAt=DateTimeOffset.UtcNow});await db.SaveChangesAsync();var applied=(await db.Database.GetAppliedMigrationsAsync()).ToArray();var error=await Assert.ThrowsAsync<SqlException>(()=>migrator.MigrateAsync(migrations[receiptMigration-1]));Assert.Equal(51000,error.Number);Assert.Equal(applied,await db.Database.GetAppliedMigrationsAsync());Assert.Single(await db.SourceImportReceipts.ToArrayAsync());await db.Database.MigrateAsync();Assert.Equal(migrations,await db.Database.GetAppliedMigrationsAsync());Assert.Single(await db.SourceImportReceipts.ToArrayAsync());Assert.False(db.Database.HasPendingModelChanges());
    }
}
