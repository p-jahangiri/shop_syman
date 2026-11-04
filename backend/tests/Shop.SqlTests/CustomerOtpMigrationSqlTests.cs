using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Cms;
using Shop.Modules.Credit;
using Shop.Modules.Files;
using Shop.Modules.Identity;
using Shop.Modules.Inventory;
using Shop.Modules.Market;
using Shop.Modules.Notifications;
using Shop.Modules.Payments;
using Shop.Modules.Reviews;
using Shop.Modules.Sales;
using Shop.Modules.Support;
using Xunit;

namespace Shop.SqlTests;

// Each case owns a GUID fixture, including deliberate migration failure cases.
// No owner contact or credential is read and no provider is invoked.
public sealed class CustomerOtpMigrationSqlTests : IAsyncLifetime
{
    private const string Previous = "20261028222547_AdministratorProvisionedStaff";
    private const string Current = "20261031172618_CustomerSmsOtp";
    private readonly SqlFixture fixture = new();
    public Task InitializeAsync() => fixture.InitializeAsync();
    public Task DisposeAsync() => fixture.DisposeAsync();

    [Fact]
    public async Task SupportedLegacyContactsBackfillWithoutChangingCredentialsConfirmationRolesOrSessions()
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
        await db.GetService<IMigrator>().MigrateAsync(Previous);
        string[] phones = ["+989120000001", "09120000002", "00989120000003", "989120000004",
            " ۰۹۱۲۰۰۰۰۰۰۵ ", "٠٩١٢٠٠٠٠٠٠٦", "\u00a0+989120000007\u3000", "0912-000-0000", "not a number", new string(' ', 24) + "09120000008"];
        var expected = new Dictionary<string, string?>();
        for (var i = 0; i < phones.Length; i++)
        {
            var id = await InsertAsync(db, phones[i], active: i % 2 == 0, confirmed: i % 3 == 0, staff: i == 3);
            expected[id] = CustomerOtpRules.TryNormalizePhone(phones[i], out var normalized) ? normalized : null;
        }
        var before = await IdentityStateAsync(db);
        await db.GetService<IMigrator>().MigrateAsync(Current);
        var after = await IdentityStateAsync(db);
        Assert.True(before.AsSpan().SequenceEqual(after), "Migration changed unrelated identity fields or relation counts.");
        var ids = expected.Keys.ToArray();
        var actual = await db.Users.AsNoTracking().Where(x => ids.Contains(x.Id))
            .Select(x => new { x.Id, x.CanonicalPhone }).ToArrayAsync();
        Assert.Equal(expected.Count, actual.Length);
        foreach (var user in actual) Assert.Equal(expected[user.Id], user.CanonicalPhone);
        Assert.Equal(0, await db.CustomerSmsSettings.CountAsync());
        Assert.Equal(0, await db.CustomerOtpChallenges.CountAsync());
        Assert.Equal(0, await db.CustomerSmsSettingsCommands.CountAsync());
    }

    [Theory]
    [InlineData("staff")]
    [InlineData("inactive")]
    [InlineData("unconfirmed")]
    public async Task AnyCanonicalCollisionAbortsTheWholeMigrationWithoutMergingOrConfirming(string shadow)
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
        await db.GetService<IMigrator>().MigrateAsync(Previous);
        await InsertAsync(db, "+989120000001", active: true, confirmed: true);
        await InsertAsync(db, "09120000001", active: shadow != "inactive", confirmed: shadow != "unconfirmed", staff: shadow == "staff");
        var before = await IdentityStateAsync(db);
        var error = await Assert.ThrowsAsync<SqlException>(() => db.GetService<IMigrator>().MigrateAsync(Current));
        Assert.Equal(51067, error.Number);
        Assert.DoesNotContain("09120000001", error.Message);
        Assert.DoesNotContain("+989120000001", error.Message);
        var after = await IdentityStateAsync(db);
        Assert.True(before.AsSpan().SequenceEqual(after), "Failed migration changed identity data.");
        Assert.DoesNotContain(Current, await db.Database.GetAppliedMigrationsAsync());
        Assert.Equal(0, await ScalarAsync(db, "SELECT COUNT(*) FROM sys.columns WHERE object_id=OBJECT_ID(N'identity.AspNetUsers') AND name=N'CanonicalPhone';"));
        Assert.Equal(0, await ScalarAsync(db, "SELECT COUNT(*) FROM sys.tables WHERE schema_id=SCHEMA_ID(N'identity') AND name IN (N'CustomerOtpChallenges',N'CustomerSmsSettings',N'CustomerSmsSettingsCommands');"));
    }

    [Fact]
    public async Task Schema92HasNoModelDriftAndExportsExactFourPortableMetadataTables()
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var services = scope.ServiceProvider;
        var identity = services.GetRequiredService<IdentityDbContext>();
        Assert.StartsWith("SaymanTest_", identity.Database.GetDbConnection().Database);
        Type[] types = [typeof(IdentityDbContext), typeof(PaymentsDbContext), typeof(CreditDbContext),
            typeof(CmsDbContext), typeof(InventoryDbContext), typeof(CatalogDbContext), typeof(SalesDbContext),
            typeof(MarketDbContext), typeof(ReviewsDbContext), typeof(SupportDbContext), typeof(NotificationsDbContext), typeof(FilesDbContext)];
        var count = 0;
        foreach (var type in types)
        {
            var db = (DbContext)services.GetRequiredService(type);
            Assert.False(db.Database.HasPendingModelChanges(), type.Name + " has model drift.");
            var applied = (await db.Database.GetAppliedMigrationsAsync()).ToArray();
            Assert.Equal(db.Database.GetMigrations().ToArray(), applied);
            Assert.Empty(await db.Database.GetPendingMigrationsAsync());
            count += applied.Length;
        }
        Assert.Equal(92, count);
        Assert.Contains(Current, await identity.Database.GetAppliedMigrationsAsync());
        var sql = MetadataSql();
        var raw = await ReadJsonAsync(identity, sql);
        using var document = JsonDocument.Parse(raw);
        var rows = document.RootElement.EnumerateArray().ToArray();
        Assert.Equal(240, rows.Length);
        string Name(JsonElement row) => row.GetProperty("schema").GetString() + "." + row.GetProperty("table").GetString();
        string[] added = ["identity.CustomerOtpChallenges", "identity.CustomerSmsSettings", "identity.CustomerSmsSettingsCommands"];
        var selected = rows.Where(row => added.Contains(Name(row), StringComparer.Ordinal) || Name(row) == "identity.AspNetUsers").ToArray();
        Assert.Equal(4, selected.Length);
        foreach (var row in selected)
        {
            foreach (var property in new[] { "columns", "indexes", "foreignKeys", "checks" })
                Assert.Equal(JsonValueKind.Array, row.GetProperty(property).ValueKind);
            foreach (var check in row.GetProperty("checks").EnumerateArray())
            {
                Assert.False(check.GetProperty("is_disabled").GetBoolean());
                Assert.False(check.GetProperty("is_not_trusted").GetBoolean());
            }
        }
        var commands = selected.Single(row => Name(row) == "identity.CustomerSmsSettingsCommands");
        var commandKey = commands.GetProperty("indexes").EnumerateArray().Where(x => x.GetProperty("is_primary_key").GetBoolean()).ToArray();
        Assert.Equal(2, commandKey.Length);
        Assert.All(commandKey, index => Assert.Equal(2, index.GetProperty("type").GetInt32()));
        var users = selected.Single(row => Name(row) == "identity.AspNetUsers");
        var phone = users.GetProperty("columns").EnumerateArray().Single(x => x.GetProperty("name").GetString() == "CanonicalPhone");
        Assert.Equal(13, phone.GetProperty("max_length").GetInt32());
        Assert.Equal("Latin1_General_100_BIN2", phone.GetProperty("collation_name").GetString());
        Assert.True(phone.GetProperty("is_nullable").GetBoolean());
        Assert.Contains(users.GetProperty("indexes").EnumerateArray(), x => x.GetProperty("name").GetString() == "IX_AspNetUsers_CanonicalPhone"
            && x.GetProperty("is_unique").GetBoolean() && x.GetProperty("has_filter").GetBoolean());
        if (Environment.GetEnvironmentVariable("SHOP_CUSTOMER_OTP_SCHEMA_CONTRACT") is { Length: > 0 } path)
        {
            var full = Path.GetFullPath(path);
            Directory.CreateDirectory(Path.GetDirectoryName(full)!);
            var contract = new
            {
                schemaVersion = 1, status = "disposable-schema92-accepted", sourceMigrationCount = 92,
                newTablesMetadata = selected.Where(row => added.Contains(Name(row), StringComparer.Ordinal)).Select(row => row.Clone()).ToArray(),
                changedTablesMetadata = new[] { users.Clone() },
                metadataSqlSource = new { path = "scripts/publish-local-commerce-rma.py",
                    sqlStringSha256 = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(sql))) },
                testResultName = "Shop.SqlTests.CustomerOtpMigrationSqlTests.Schema92HasNoModelDriftAndExportsExactFourPortableMetadataTables"
            };
            await using var file = new FileStream(full, FileMode.CreateNew, FileAccess.Write, FileShare.None);
            await JsonSerializer.SerializeAsync(file, contract);
        }
    }

    private static async Task<string> InsertAsync(IdentityDbContext db, string phone, bool active, bool confirmed, bool staff = false)
    {
        var id = Guid.NewGuid().ToString("N");
        var name = "migration_" + id;
        var stamp = Guid.NewGuid().ToString("N");
        var concurrency = Guid.NewGuid().ToString("N");
        var now = DateTimeOffset.UtcNow;
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO [identity].[AspNetUsers]
              ([Id],[UserName],[NormalizedUserName],[PhoneNumber],[PhoneNumberConfirmed],[EmailConfirmed],
               [TwoFactorEnabled],[LockoutEnabled],[AccessFailedCount],[DisplayName],[IsActive],[RequireMfa],
               [ProvisionedByAdministrator],[MustChangePassword],[MfaRecoveryPending],[CreatedAt],[SecurityStamp],[ConcurrencyStamp])
            VALUES ({id},{name},{name.ToUpperInvariant()},{phone},{confirmed},0,0,1,0,N'Synthetic migration contact',
                    {active},{staff},0,0,0,{now},{stamp},{concurrency});
            """);
        if (staff) await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO [identity].[AspNetUserRoles] ([UserId],[RoleId])
            SELECT {id},[Id] FROM [identity].[AspNetRoles] WHERE [NormalizedName]=N'SUPPORTAGENT';
            """);
        return id;
    }

    // Only a digest and relation counts leave SQL, never a password or stamp.
    private static async Task<byte[]> IdentityStateAsync(IdentityDbContext db)
    {
        var raw = await ReadJsonAsync(db, """
            SELECT CONVERT(varchar(64),HASHBYTES('SHA2_256',(SELECT [Id],[UserName],[NormalizedUserName],
              [Email],[NormalizedEmail],[EmailConfirmed],[PasswordHash],[SecurityStamp],[ConcurrencyStamp],
              [PhoneNumber],[PhoneNumberConfirmed],[TwoFactorEnabled],[LockoutEnd],[LockoutEnabled],[AccessFailedCount],
              [DisplayName],[IsActive],[RequireMfa],[LastMfaCounter],[MfaRecoveryPending],[CreatedAt],
              [ProvisionedByAdministrator],[MustChangePassword] FROM [identity].[AspNetUsers] ORDER BY [Id]
              FOR JSON PATH,INCLUDE_NULL_VALUES)),2) AS [identityDigest],
              (SELECT COUNT_BIG(*) FROM [identity].[AspNetRoles]) AS [roles],
              (SELECT COUNT_BIG(*) FROM [identity].[AspNetUserRoles]) AS [memberships],
              (SELECT COUNT_BIG(*) FROM [identity].[Sessions]) AS [sessions],
              (SELECT COUNT_BIG(*) FROM [identity].[Audit]) AS [audit]
            FOR JSON PATH,WITHOUT_ARRAY_WRAPPER;
            """);
        return SHA256.HashData(Encoding.UTF8.GetBytes(raw));
    }

    private static async Task<int> ScalarAsync(IdentityDbContext db, string sql)
    {
        var connection = db.Database.GetDbConnection();
        var close = connection.State == ConnectionState.Closed;
        if (close) await db.Database.OpenConnectionAsync();
        try
        {
            await using var command = connection.CreateCommand(); command.CommandText = sql;
            return Convert.ToInt32(await command.ExecuteScalarAsync(), System.Globalization.CultureInfo.InvariantCulture);
        }
        finally { if (close) await db.Database.CloseConnectionAsync(); }
    }

    private static async Task<string> ReadJsonAsync(IdentityDbContext db, string sql)
    {
        var connection = db.Database.GetDbConnection();
        var close = connection.State == ConnectionState.Closed;
        if (close) await db.Database.OpenConnectionAsync();
        try
        {
            await using var command = connection.CreateCommand(); command.CommandText = sql; command.CommandTimeout = 60;
            var text = new StringBuilder();
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync()) text.Append(reader.GetString(0));
            return text.ToString();
        }
        finally { if (close) await db.Database.CloseConnectionAsync(); }
    }

    private static string MetadataSql()
    {
        foreach (var start in new[] { AppContext.BaseDirectory, Directory.GetCurrentDirectory() })
            for (var directory = new DirectoryInfo(start); directory is not null; directory = directory.Parent)
            {
                var path = Path.Combine(directory.FullName, "scripts", "publish-local-commerce-rma.py");
                if (!File.Exists(path)) continue;
                var source = File.ReadAllText(path);
                const string marker = "METADATA_SQL = r\"\"\"";
                var index = source.IndexOf(marker, StringComparison.Ordinal);
                Assert.True(index >= 0);
                Assert.Equal(index, source.LastIndexOf(marker, StringComparison.Ordinal));
                var begin = index + marker.Length;
                var end = source.IndexOf("\"\"\"", begin, StringComparison.Ordinal);
                Assert.True(end > begin);
                return source[begin..end];
            }
        throw new InvalidOperationException("The publisher metadata SQL source is required.");
    }
}
