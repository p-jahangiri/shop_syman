using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Reviews;
using Xunit;
namespace Shop.SqlTests;
public sealed class ReviewsMigrationSqlTests(SqlFixture fixture):IClassFixture<SqlFixture>
{
    [Fact]public async Task EmptyRollbackAndReapplyWorkButReceiptsBlockDestructiveDowngrade()
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<ReviewsDbContext>();var migrator=db.GetService<IMigrator>();
        await migrator.MigrateAsync("0");await migrator.MigrateAsync();
        db.Commands.Add(new(){ActorId="synthetic-qa",CommandId=Guid.NewGuid().ToString("N"),PayloadHash=new string('a',64),ResultJson="{}",At=DateTimeOffset.UtcNow});await db.SaveChangesAsync();
        var failure=await Assert.ThrowsAsync<SqlException>(()=>migrator.MigrateAsync("0"));Assert.Equal(51000,failure.Number);Assert.Single(await db.Commands.ToArrayAsync());Assert.Single(await db.Database.GetAppliedMigrationsAsync());
    }
}
