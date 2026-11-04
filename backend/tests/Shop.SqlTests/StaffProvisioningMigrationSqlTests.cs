using System.Net.Http.Json;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Identity;
using Shop.Modules.Sales;
using Xunit;

namespace Shop.SqlTests;

public sealed class StaffProvisioningMigrationSqlTests : IAsyncLifetime
{
    private readonly OrderFixture fixture = new();
    public Task InitializeAsync() => fixture.InitializeAsync();
    public Task DisposeAsync() => fixture.DisposeAsync();
    [Fact]
    public async Task LatestEmptyHistoriesCanDowngradeAndRestoreWithoutDeletingExistingAccounts()
    {
        await using var scope = fixture.Sql.Factory.Services.CreateAsyncScope();
        var identity = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
        var sales = scope.ServiceProvider.GetRequiredService<SalesDbContext>();
        Assert.StartsWith("SaymanTest_", identity.Database.GetDbConnection().Database);
        var accounts = await identity.Users.AsNoTracking().Select(x => x.Id).OrderBy(x => x).ToArrayAsync();
        foreach (var db in new DbContext[] { identity, sales }) {
            var previous = db.Database.GetMigrations().Reverse().Skip(1).First();
            try { await db.GetService<IMigrator>().MigrateAsync(previous); }
            finally { await db.Database.MigrateAsync(); }
            Assert.False(db.Database.HasPendingModelChanges());
        }
        Assert.Equal(accounts, await identity.Users.AsNoTracking().Select(x => x.Id).OrderBy(x => x).ToArrayAsync());
    }
    [Fact]
    public async Task ProvisionedAccountsBlockDestructiveDownAndSqlRejectsInvalidFlagsOrUnboundedReceipt()
    {
        var input = new CreateStaffAccountInput(Guid.NewGuid().ToString("D"), "guardstaff" + Guid.NewGuid().ToString("N"), "همکار نمونهٔ محافظ migration", "Synthetic-Guard!123", ["ContentManager"]);
        using var response = await fixture.Admin.PostAsJsonAsync("/api/admin/staff/accounts", input);
        Assert.True(response.IsSuccessStatusCode);
        await using var scope = fixture.Sql.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
        Assert.StartsWith("SaymanTest_", db.Database.GetDbConnection().Database);
        var user = await db.Users.AsNoTracking().SingleAsync(x => x.UserName == input.UserName);
        var applied = (await db.Database.GetAppliedMigrationsAsync()).ToArray();
        var assembly = db.GetService<IMigrationsAssembly>();
        var migration = assembly.CreateMigration(assembly.Migrations["20261028222547_AdministratorProvisionedStaff"], db.Database.ProviderName!);
        var guard = Assert.IsType<Microsoft.EntityFrameworkCore.Migrations.Operations.SqlOperation>(migration.DownOperations[0]);
        var error = await Assert.ThrowsAsync<SqlException>(() => db.Database.ExecuteSqlRawAsync(guard.Sql));
        Assert.Equal(51000, error.Number);
        Assert.Equal(applied, await db.Database.GetAppliedMigrationsAsync());
        Assert.True((await db.Users.AsNoTracking().SingleAsync(x => x.Id == user.Id)).MustChangePassword);
        Assert.Single(await db.StaffCreationCommands.AsNoTracking().Where(x => x.UserId == user.Id).ToArrayAsync());
        var flags = await Assert.ThrowsAsync<SqlException>(() => db.Database.ExecuteSqlInterpolatedAsync($"UPDATE [identity].[AspNetUsers] SET [ProvisionedByAdministrator]=0 WHERE [Id]={user.Id}")); Assert.Equal(547, flags.Number);
        var bytes = Enumerable.Repeat((byte)1, 16385).ToArray();
        var oversized = await Assert.ThrowsAsync<SqlException>(() => db.Database.ExecuteSqlInterpolatedAsync($"UPDATE [identity].[StaffCreationCommands] SET [ProtectedReceipt]={bytes} WHERE [UserId]={user.Id}")); Assert.Equal(547, oversized.Number);
    }
}
