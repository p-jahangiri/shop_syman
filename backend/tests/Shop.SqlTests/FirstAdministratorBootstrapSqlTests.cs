using Microsoft.AspNetCore.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Identity;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;

// A fresh, identity-only database deliberately has no development seed/admin.
public sealed class FirstAdministratorBootstrapSqlTests : IAsyncLifetime
{
    private SqlFactory factory = null!;
    private string connection = "";
    private string keyDirectory = "";
    private const string InitialPassword = "Synthetic-Bootstrap-Secret-47!";

    public async Task InitializeAsync()
    {
        var supplied = Environment.GetEnvironmentVariable("SHOP_TEST_SQL_CONNECTION")
            ?? throw new InvalidOperationException("Bootstrap SQL tests require SHOP_TEST_SQL_CONNECTION.");
        var options = new SqlConnectionStringBuilder(supplied) {
            InitialCatalog = "SaymanTest_bootstrap_" + Guid.NewGuid().ToString("N"), ConnectTimeout = 8
        };
        connection = options.ConnectionString;
        keyDirectory = Path.Combine(Path.GetTempPath(), options.InitialCatalog, "keys");
        factory = new(connection, InitialPassword, keyDirectory);
        try {
            await using var scope = factory.Services.CreateAsyncScope();
            await scope.ServiceProvider.GetRequiredService<IdentityDbContext>().Database.MigrateAsync();
        } catch {
            await DisposeAsync();
            throw;
        }
    }

    [Fact]
    public async Task FirstCreationRequiresPasswordChangeThenMfaAndNeverResetsAnExistingAdministrator()
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var auth = scope.ServiceProvider.GetRequiredService<AuthService>();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>();
        var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
        Assert.True(await auth.BootstrapFirstAdministratorAsync("Owner", InitialPassword, null, default));
        var user = await users.FindByNameAsync("owner");
        Assert.NotNull(user);
        Assert.Null(user.Email);
        Assert.False(user.EmailConfirmed);
        Assert.True(user.RequireMfa && user.MustChangePassword && user.ProvisionedByAdministrator);
        Assert.True(await users.IsInRoleAsync(user, "Administrator"));
        var hash = user.PasswordHash;
        var stamp = user.SecurityStamp;
        Assert.False(await auth.BootstrapFirstAdministratorAsync("different-owner", "Different-Synthetic-Secret-74!", null, default));
        await db.Entry(user).ReloadAsync();
        Assert.Equal(hash, user.PasswordHash);
        Assert.Equal(stamp, user.SecurityStamp);
        Assert.Null(await users.FindByNameAsync("different-owner"));
        Assert.Single(await db.Audit.Where(x => x.Action == "FIRST_ADMINISTRATOR_BOOTSTRAPPED").ToArrayAsync());
        var login = await auth.PasswordAsync(new("owner", InitialPassword), true, true, true, default);
        Assert.True(login.RequiresPasswordChange);
        Assert.Null(login.RefreshToken);
        var changed = await auth.ChangeInitialStaffPasswordAsync(user.Id, stamp!, new("Changed-Synthetic-Secret-83!"), "bootstrap-sql-test", default);
        Assert.True(changed.RequiresMfa && changed.RequiresEnrollment);
        Assert.Null(changed.RefreshToken);
    }

    [Fact]
    public async Task ConcurrentCommandsCreateOnlyOneAdministrator()
    {
        async Task<bool> Run(string name)
        {
            await using var scope = factory.Services.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<AuthService>()
                .BootstrapFirstAdministratorAsync(name, InitialPassword, null, default);
        }
        var results = await Task.WhenAll(Run("first-owner"), Run("second-owner"));
        Assert.Single(results, x => x);
        await using var check = factory.Services.CreateAsyncScope();
        var users = check.ServiceProvider.GetRequiredService<UserManager<ShopUser>>();
        Assert.Single(await users.GetUsersInRoleAsync("Administrator"));
        Assert.Single(await check.ServiceProvider.GetRequiredService<IdentityDbContext>().Audit
            .Where(x => x.Action == "FIRST_ADMINISTRATOR_BOOTSTRAPPED").ToArrayAsync());
    }

    [Fact]
    public async Task AnExistingUsernameIsNeverElevatedOrReset()
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>();
        var user = new ShopUser { UserName = "existing", DisplayName = "Existing account" };
        Assert.True((await users.CreateAsync(user, InitialPassword)).Succeeded);
        var hash = user.PasswordHash;
        var auth = scope.ServiceProvider.GetRequiredService<AuthService>();
        var error = await Assert.ThrowsAsync<BusinessException>(() => auth.BootstrapFirstAdministratorAsync("existing", "Different-Synthetic-Secret-74!", null, default));
        Assert.Equal("bootstrap_username_conflict", error.Code);
        await scope.ServiceProvider.GetRequiredService<IdentityDbContext>().Entry(user).ReloadAsync();
        Assert.Equal(hash, user.PasswordHash);
        Assert.Empty(await users.GetRolesAsync(user));
    }

    public async Task DisposeAsync()
    {
        if (factory is null) return;
        var deleted = false;
        try {
            await using var scope = factory.Services.CreateAsyncScope();
            await scope.ServiceProvider.GetRequiredService<IdentityDbContext>().Database.EnsureDeletedAsync();
            deleted = true;
        } finally {
            await factory.DisposeAsync();
            using var sql = new SqlConnection(connection);
            SqlConnection.ClearPool(sql);
            var root = Path.GetDirectoryName(keyDirectory)!;
            if (deleted && Directory.Exists(root) && new DirectoryInfo(root).LinkTarget is null)
                Directory.Delete(root, recursive: true);
        }
    }
}
