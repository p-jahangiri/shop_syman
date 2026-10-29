using System.Text.Json;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Market;
using Xunit;
namespace Shop.SqlTests;
public sealed class MarketSourcesMigrationSqlTests(SqlFixture fixture):IClassFixture<SqlFixture>
{
    [Fact] public async Task EmptyDowngradeWorksBaselineIsHonestAndAnyRetainedHistoryPreventsLoss()
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<MarketDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);var migrator=db.GetService<IMigrator>();
        // Later empty imports have their own retention boundary. Exercise this
        // historical source migration against exactly its own schema.
        await migrator.MigrateAsync("20261025180711_MarketMultipleSources");var all=(await db.Database.GetAppliedMigrationsAsync()).ToArray();Assert.EndsWith("_MarketMultipleSources",all[^1]);Assert.Empty(await db.SourceObservations.ToArrayAsync());await migrator.MigrateAsync(all[^2]);
        // Simulate an actual legacy row while its new history tables do not
        // exist. Do not call the current writer against an older SQL schema.
        var id=Guid.NewGuid().ToString("N");await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO market.Listings (Id,ModelId,Status,SourceKey,SourceItemKey,SourceNameFa,SourceNameEn,Availability,IsDemo,CreatedAt,UpdatedAt) VALUES ({id},N'p1',N'Draft',N'qa-legacy',{id},N'نمونهٔ قدیمی',N'Legacy synthetic source',N'unknown',1,SYSUTCDATETIME(),SYSUTCDATETIME())");var legacy=JsonSerializer.Serialize(await db.Listings.AsNoTracking().OrderBy(x=>x.Id).ToArrayAsync());var start=DateTimeOffset.UtcNow;await migrator.MigrateAsync(all[^1]);var end=DateTimeOffset.UtcNow;
        Assert.Equal(legacy,JsonSerializer.Serialize(await db.Listings.AsNoTracking().OrderBy(x=>x.Id).ToArrayAsync()));var history=Assert.Single(await db.SourceObservations.AsNoTracking().ToArrayAsync());Assert.Equal(id,history.ListingId);Assert.Equal(id,history.SourceId);Assert.True(history.IsPrimary);Assert.Equal("migrationBaseline",history.Origin);Assert.Null(history.ObservedAt);Assert.Null(history.ValidUntil);Assert.Null(history.ReferencePriceRial);Assert.InRange(history.RecordedAt,start.AddSeconds(-1),end.AddSeconds(1));Assert.Empty(await db.Sources.ToArrayAsync());Assert.Empty(await db.SourceCommands.ToArrayAsync());Assert.False(db.Database.HasPendingModelChanges());
        var before=JsonSerializer.Serialize(history);var applied=(await db.Database.GetAppliedMigrationsAsync()).ToArray();var error=await Assert.ThrowsAsync<SqlException>(()=>migrator.MigrateAsync(all[^2]));Assert.Equal(51000,error.Number);Assert.Equal(applied,await db.Database.GetAppliedMigrationsAsync());Assert.Equal(before,JsonSerializer.Serialize(Assert.Single(await db.SourceObservations.AsNoTracking().ToArrayAsync())));Assert.Equal(legacy,JsonSerializer.Serialize(await db.Listings.AsNoTracking().OrderBy(x=>x.Id).ToArrayAsync()));
    }
}
