using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Identity;
using Xunit;

namespace Shop.SqlTests;

public sealed class StaffPasswordSqlTests : IAsyncLifetime
{
    private readonly PasswordClock clock = new();
    private readonly SqlFixture sql;
    private const string Path = "/api/auth/staff/change-password";
    private const string NewPassword = "New-personal-password-47!";
    public StaffPasswordSqlTests() => sql = new() { TimeProvider = clock };
    public Task InitializeAsync() => sql.InitializeAsync();
    public Task DisposeAsync() => sql.DisposeAsync();
    private sealed class PasswordClock : TimeProvider
    {
        private DateTimeOffset now = DateTimeOffset.UtcNow;
        public override DateTimeOffset GetUtcNow() => now;
        public void Advance() => now = now.AddSeconds(31);
    }
    private string Code(string key) => Totp.Code(key, clock.GetUtcNow().ToUnixTimeSeconds() / 30);
    private HttpClient Client(string? token = null)
    {
        var client = sql.Factory.CreateClient(new() { HandleCookies = false });
        client.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:3173"); client.DefaultRequestHeaders.Add("X-Sayman-Client", "admin");
        client.DefaultRequestHeaders.Add("X-Sayman-Admin", "1");
        if (token is not null) client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        return client;
    }
    private static async Task<JsonNode> Json(HttpResponseMessage response)
    {
        using (response) { var text = await response.Content.ReadAsStringAsync(); Assert.True(response.IsSuccessStatusCode, $"HTTP {(int)response.StatusCode}: {text}"); return JsonNode.Parse(text)!; }
    }
    private static string Token(JsonNode response) => response["accessToken"]!.GetValue<string>();
    private async Task<(HttpClient Client, string Id, string Name, string Key, string Access, string Refresh)> SignIn()
    {
        var account = await sql.CreateAdministratorAsync(); var client = Client();
        var pending = await Json(await client.PostAsJsonAsync("/api/auth/password", new { Identifier = account.Username, sql.Password }));
        client.DefaultRequestHeaders.Authorization = new("Bearer", Token(pending));
        var setup = await Json(await client.PostAsJsonAsync("/api/auth/mfa/setup", new { }));
        client.DefaultRequestHeaders.Authorization = new("Bearer", Token(setup));
        var key = setup["secret"]!.GetValue<string>();
        using var response = await client.PostAsJsonAsync("/api/auth/mfa/verify", new { Code = Code(key) });
        var refresh = response.Headers.GetValues("Set-Cookie").Single(x => x.StartsWith("sayman_admin_refresh=", StringComparison.Ordinal)).Split(';')[0];
        var session = JsonNode.Parse(await response.Content.ReadAsStringAsync())!; Assert.True(response.IsSuccessStatusCode);
        var access = Token(session); client.DefaultRequestHeaders.Authorization = new("Bearer", access);
        return (client, session["user"]!["id"]!.GetValue<string>(), account.Username, key, access, refresh);
    }
    private ChangeStaffPasswordInput Input(string key, string? current = null, string? next = null) => new(current ?? sql.Password, next ?? NewPassword, Code(key));

    [Fact]
    public async Task PasswordChangesAtomicallyRevokesAllSessionsAndRetainsAuthenticatorAndRecoveryCodes()
    {
        var account = await SignIn(); using var client = account.Client;
        clock.Advance(); await Json(await client.PostAsJsonAsync("/api/auth/mfa/recovery-codes", new { sql.Password, Code = Code(account.Key) }));
        await using var scope = sql.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
        var before = await db.Users.AsNoTracking().SingleAsync(x => x.Id == account.Id);
        var recovery = await db.MfaRecoveryCodes.Where(x => x.UserId == account.Id).Select(x => x.CodeHash).OrderBy(x => x).ToArrayAsync();
        clock.Advance(); using var response = await client.PostAsJsonAsync(Path, Input(account.Key));
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Contains(response.Headers.GetValues("Set-Cookie"), x => x.StartsWith("sayman_admin_refresh=;", StringComparison.Ordinal));
        var after = await db.Users.AsNoTracking().SingleAsync(x => x.Id == account.Id);
        Assert.NotEqual(before.PasswordHash, after.PasswordHash); Assert.NotEqual(before.SecurityStamp, after.SecurityStamp);
        Assert.True(after.TwoFactorEnabled); Assert.True(after.RequireMfa); Assert.False(after.MfaRecoveryPending);
        Assert.Equal(0, after.AccessFailedCount); Assert.Equal(0, await db.Sessions.CountAsync(x => x.UserId == account.Id && x.RevokedAt == null));
        Assert.Equal(recovery, await db.MfaRecoveryCodes.Where(x => x.UserId == account.Id).Select(x => x.CodeHash).OrderBy(x => x).ToArrayAsync());
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>(); Assert.Equal(account.Key, await users.GetAuthenticatorKeyAsync(after));
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/admin/catalog/summary")).StatusCode);
        using var refresh = Client(); refresh.DefaultRequestHeaders.Add("Cookie", account.Refresh);
        Assert.Equal(HttpStatusCode.Unauthorized, (await refresh.PostAsJsonAsync("/api/auth/refresh", new { })).StatusCode);
        using var login = Client();
        Assert.Equal(HttpStatusCode.Unauthorized, (await login.PostAsJsonAsync("/api/auth/password", new { Identifier = account.Name, sql.Password })).StatusCode);
        var pending = await Json(await login.PostAsJsonAsync("/api/auth/password", new { Identifier = account.Name, Password = NewPassword }));
        Assert.True(pending["requiresMfa"]!.GetValue<bool>()); Assert.False(pending["requiresEnrollment"]!.GetValue<bool>());
        login.DefaultRequestHeaders.Authorization = new("Bearer", Token(pending)); clock.Advance();
        var session = await Json(await login.PostAsJsonAsync("/api/auth/mfa/verify", new { Code = Code(account.Key) }));
        Assert.False(session["requiresMfa"]!.GetValue<bool>());
        Assert.Equal(1, await db.Audit.CountAsync(x => x.ActorId == account.Id && x.Action == "STAFF_PASSWORD_CHANGED"));
    }

    [Theory]
    [InlineData(true)][InlineData(false)]
    public async Task WrongPasswordOrReusedCodeCountsOnceWithoutChangingPasswordOrSessions(bool wrongPassword)
    {
        var account = await SignIn(); using var client = account.Client;
        await using var scope = sql.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
        var before = await db.Users.AsNoTracking().SingleAsync(x => x.Id == account.Id);
        if (wrongPassword) clock.Advance();
        using var response = await client.PostAsJsonAsync(Path, Input(account.Key, wrongPassword ? "Wrong-password-47!" : null));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var after = await db.Users.AsNoTracking().SingleAsync(x => x.Id == account.Id);
        Assert.Equal(before.PasswordHash, after.PasswordHash); Assert.Equal(before.SecurityStamp, after.SecurityStamp); Assert.Equal(before.LastMfaCounter, after.LastMfaCounter);
        Assert.Equal(1, after.AccessFailedCount); Assert.Equal(1, await db.Audit.CountAsync(x => x.ActorId == account.Id && x.Action == "STAFF_PASSWORD_FAILED"));
        Assert.Equal(0, await db.Sessions.CountAsync(x => x.UserId == account.Id && x.RevokedAt != null));
    }

    [Theory]
    [InlineData("same")][InlineData("weak")]
    public async Task ReusedOrWeakPasswordDoesNotConsumeFreshCode(string kind)
    {
        var account = await SignIn(); using var client = account.Client; clock.Advance();
        using var response = await client.PostAsJsonAsync(Path, Input(account.Key, next: kind == "same" ? sql.Password : "longbutweakpassword"));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var accepted = await client.PostAsJsonAsync(Path, Input(account.Key)); Assert.Equal(HttpStatusCode.NoContent, accepted.StatusCode);
    }

    [Fact]
    public async Task ConcurrentChangesHaveOneWinnerAndOneAudit()
    {
        var account = await SignIn(); using var client = account.Client; clock.Advance();
        using var other = Client(account.Access);
        var results = await Task.WhenAll(client.PostAsJsonAsync(Path, Input(account.Key)), other.PostAsJsonAsync(Path, Input(account.Key)));
        Assert.Single(results, x => x.StatusCode == HttpStatusCode.NoContent); Assert.Single(results, x => x.StatusCode == HttpStatusCode.Unauthorized);
        foreach (var result in results) result.Dispose();
        await using var scope = sql.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
        Assert.Equal(1, await db.Audit.CountAsync(x => x.ActorId == account.Id && x.Action == "STAFF_PASSWORD_CHANGED"));
    }

    [Fact]
    public async Task AuditFailureRollsBackPasswordCounterStampAndSessions()
    {
        var account = await SignIn(); using var client = account.Client; clock.Advance();
        await using var scope = sql.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
        Assert.StartsWith("SaymanTest_", db.Database.GetDbConnection().Database);
        var before = await db.Users.AsNoTracking().SingleAsync(x => x.Id == account.Id);
        await db.Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] WITH NOCHECK ADD CONSTRAINT [CK_StaffPasswordAuditFailure] CHECK ([Action]<>N'STAFF_PASSWORD_CHANGED')");
        try { Assert.False((await client.PostAsJsonAsync(Path, Input(account.Key))).IsSuccessStatusCode); }
        finally { await db.Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] DROP CONSTRAINT [CK_StaffPasswordAuditFailure]"); }
        var after = await db.Users.AsNoTracking().SingleAsync(x => x.Id == account.Id);
        Assert.Equal(before.PasswordHash, after.PasswordHash); Assert.Equal(before.SecurityStamp, after.SecurityStamp); Assert.Equal(before.LastMfaCounter, after.LastMfaCounter);
        Assert.Equal(0, await db.Sessions.CountAsync(x => x.UserId == account.Id && x.RevokedAt != null));
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsJsonAsync(Path, Input(account.Key))).StatusCode);
    }

    [Fact]
    public async Task RevokedSessionCannotChangePasswordEvenWithValidCurrentProof()
    {
        var account = await SignIn(); using var client = account.Client; clock.Advance();
        await using var scope = sql.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
        await db.Sessions.Where(x => x.UserId == account.Id).ExecuteUpdateAsync(s => s.SetProperty(x => x.RevokedAt, clock.GetUtcNow()));
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync(Path, Input(account.Key))).StatusCode);
        Assert.Equal(0, await db.Audit.CountAsync(x => x.ActorId == account.Id && x.Action == "STAFF_PASSWORD_CHANGED"));
    }
}
