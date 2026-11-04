using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Identity;
using Xunit;

namespace Shop.SqlTests;

public sealed class CustomerAccountSqlTests : IAsyncLifetime
{
    private readonly SqlFixture sql = new();
    private const string NewPassword = "Customer-New-Password-47!";
    public Task InitializeAsync() => sql.InitializeAsync();
    public Task DisposeAsync() => sql.DisposeAsync();

    private HttpClient Client(string? token = null, string? cookie = null)
    {
        var client = sql.Factory.CreateClient(new() { HandleCookies = false });
        client.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:3000");
        if (token is not null) client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        if (cookie is not null) client.DefaultRequestHeaders.Add("Cookie", cookie);
        return client;
    }

    private async Task<(string Name, string Id)> Customer(bool phoneOnly = false)
    {
        await using var scope = sql.Factory.Services.CreateAsyncScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>();
        var name = "account" + Guid.NewGuid().ToString("N");
        var user = new ShopUser { UserName = name, DisplayName = "مشتری آزمون SQL",
            Email = phoneOnly ? null : name + "@example.invalid", EmailConfirmed = !phoneOnly,
            PhoneNumber = phoneOnly ? "09120000000" : null, PhoneNumberConfirmed = phoneOnly };
        var result = await users.CreateAsync(user, sql.Password);
        Assert.True(result.Succeeded, string.Join(";", result.Errors.Select(error => error.Code)));
        return (name, user.Id);
    }

    private static async Task<JsonNode> Json(HttpResponseMessage response, HttpStatusCode expected = HttpStatusCode.OK)
    {
        using (response) {
            var raw = await response.Content.ReadAsStringAsync();
            Assert.True(response.StatusCode == expected, $"Expected {(int)expected}, got {(int)response.StatusCode}: {raw}");
            return JsonNode.Parse(raw)!;
        }
    }

    private async Task<(string Token, string Cookie)> Login(string name, string? password = null)
    {
        using var client = Client();
        using var response = await client.PostAsJsonAsync("/api/auth/password", new { identifier = name, password = password ?? sql.Password });
        var raw = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, raw);
        var value = JsonNode.Parse(raw)!;
        return (value["accessToken"]!.GetValue<string>(), response.Headers.GetValues("Set-Cookie")
            .Single(cookie => cookie.StartsWith("sayman_refresh=", StringComparison.Ordinal)).Split(';')[0]);
    }

    private static string Version(JsonNode profile) => profile["version"]!.GetValue<string>();
    private static string Stamp(string token) => new JwtSecurityTokenHandler().ReadJwtToken(token).Claims.Single(claim => claim.Type == "sst").Value;

    [Fact]
    public async Task RealStaffMfaAndAdminClientCannotUseCustomerAccountSettings()
    {
        var account = await sql.CreateAdministratorAsync();
        using var staff = Client();
        staff.DefaultRequestHeaders.Remove("Origin");
        staff.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:3173");
        staff.DefaultRequestHeaders.Add("X-Sayman-Admin", "1");
        staff.DefaultRequestHeaders.Add("X-Sayman-Client", "admin");
        var pending = await Json(await staff.PostAsJsonAsync("/api/auth/password", new { identifier = account.Username, password = account.Password }));
        var pendingToken = pending["accessToken"]!.GetValue<string>();
        staff.DefaultRequestHeaders.Authorization = new("Bearer", pendingToken);
        using var incomplete = await staff.GetAsync("/api/account/profile");
        Assert.Equal(HttpStatusCode.Forbidden, incomplete.StatusCode);
        var setup = await Json(await staff.PostAsJsonAsync("/api/auth/mfa/setup", new { }));
        staff.DefaultRequestHeaders.Authorization = new("Bearer", setup["accessToken"]!.GetValue<string>());
        var code = Totp.Code(setup["secret"]!.GetValue<string>(), DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 30);
        var session = await Json(await staff.PostAsJsonAsync("/api/auth/mfa/verify", new { code }));
        var staffToken = session["accessToken"]!.GetValue<string>();
        using var customerEntry = Client(staffToken);
        using var rejected = await customerEntry.GetAsync("/api/account/profile");
        Assert.Equal(HttpStatusCode.Forbidden, rejected.StatusCode);
        var customer = await Customer(); var member = await Login(customer.Name);
        using var adminClient = Client(member.Token); adminClient.DefaultRequestHeaders.Add("X-Sayman-Client", "admin");
        using var wrongClient = await adminClient.GetAsync("/api/account/profile");
        Assert.Equal(HttpStatusCode.Forbidden, wrongClient.StatusCode);
    }

    [Fact]
    public async Task ProfileIsOwnedHasTruthfulNullableContactsAndCannotAcceptAnOwner()
    {
        var one = await Customer(phoneOnly: true); var two = await Customer();
        var session = await Login(one.Name);
        using var client = Client(session.Token);
        using var response = await client.GetAsync("/api/account/profile");
        var raw = await response.Content.ReadAsStringAsync();
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("private", response.Headers.CacheControl!.ToString());
        Assert.Contains("no-store", response.Headers.CacheControl!.ToString());
        Assert.Contains("noindex", response.Headers.GetValues("X-Robots-Tag").Single());
        var value = JsonNode.Parse(raw)!.AsObject();
        Assert.Equal(one.Id, value["id"]!.GetValue<string>());
        Assert.Equal(one.Name, value["userName"]!.GetValue<string>());
        Assert.Equal("مشتری آزمون SQL", value["displayName"]!.GetValue<string>());
        Assert.True(value.ContainsKey("email")); Assert.Null(value["email"]);
        Assert.False(value["emailConfirmed"]!.GetValue<bool>());
        Assert.Equal("09120000000", value["phoneNumber"]!.GetValue<string>());
        Assert.True(value["phoneNumberConfirmed"]!.GetValue<bool>());
        Assert.True(value["passwordEnabled"]!.GetValue<bool>());
        Assert.False(value["twoFactorEnabled"]!.GetValue<bool>());
        Assert.InRange(DateTimeOffset.Parse(value["createdAt"]!.GetValue<string>()), DateTimeOffset.UtcNow.AddMinutes(-5), DateTimeOffset.UtcNow);
        Assert.NotEqual(Stamp(session.Token), Version(value));
        Assert.DoesNotContain(sql.Password, raw); Assert.DoesNotContain(two.Id, raw);
        foreach (var key in new[] { "passwordHash", "securityStamp", "roles", "permissions", "refreshToken" }) Assert.False(value.ContainsKey(key));
        using var ownerQuery = await client.GetAsync("/api/account/profile?ownerId=" + two.Id);
        Assert.Equal(HttpStatusCode.BadRequest, ownerQuery.StatusCode);
        using var injection = await client.PutAsJsonAsync("/api/account/profile", new { displayName = "نام دیگر", version = Version(value), id = two.Id });
        Assert.Equal(HttpStatusCode.BadRequest, injection.StatusCode);
        using var foreignPath = await client.GetAsync("/api/account/profile/" + two.Id);
        Assert.Equal(HttpStatusCode.NotFound, foreignPath.StatusCode);
    }

    [Fact]
    public async Task ConcurrentProfileEditsUseCasAndAuditExactlyOneNameOnlyChange()
    {
        var one = await Customer(); var two = await Customer(); var session = await Login(one.Name);
        using var first = Client(session.Token); using var second = Client(session.Token);
        var original = await Json(await first.GetAsync("/api/account/profile")); var version = Version(original);
        var results = await Task.WhenAll(
            first.PutAsJsonAsync("/api/account/profile", new { displayName = "نام نخست", version }),
            second.PutAsJsonAsync("/api/account/profile", new { displayName = "نام دوم", version }));
        Assert.Single(results, result => result.StatusCode == HttpStatusCode.OK);
        var conflict = Assert.Single(results, result => result.StatusCode == HttpStatusCode.Conflict);
        Assert.Equal("profile_conflict", JsonNode.Parse(await conflict.Content.ReadAsStringAsync())!["title"]!.GetValue<string>());
        foreach (var response in results) response.Dispose();
        var current = await Json(await first.GetAsync("/api/account/profile"));
        Assert.NotEqual(version, Version(current));
        Assert.Contains(current["displayName"]!.GetValue<string>(), new[] { "نام نخست", "نام دوم" });
        using var noOp = await first.PutAsJsonAsync("/api/account/profile", new { displayName = current["displayName"]!.GetValue<string>(), version = Version(current) });
        Assert.Equal(HttpStatusCode.OK, noOp.StatusCode);
        await using var scope = sql.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
        var user = await db.Users.SingleAsync(user => user.Id == one.Id);
        Assert.Equal(Stamp(session.Token), user.SecurityStamp);
        Assert.Equal(original["email"]!.GetValue<string>(), user.Email);
        Assert.Null(user.PhoneNumber);
        Assert.Equal("مشتری آزمون SQL", (await db.Users.SingleAsync(user => user.Id == two.Id)).DisplayName);
        var audit = await db.Audit.Where(item => item.ActorId == one.Id && item.Action == "ACCOUNT_PROFILE_UPDATED").ToArrayAsync();
        Assert.Single(audit); Assert.Equal("/api/account/profile", audit[0].Resource);
        Assert.DoesNotContain(user.DisplayName, audit[0].Resource + audit[0].Action + audit[0].TraceId);
        Assert.True(await db.Sessions.AnyAsync(item => item.UserId == one.Id && item.RevokedAt == null));
    }

    [Fact]
    public async Task WrongPasswordPolicyAndReuseAreRejectedWithoutChangingOtherAccountsOrSessions()
    {
        var one = await Customer(); var other = await Customer(); var session = await Login(one.Name);
        using var client = Client(session.Token);
        var wrong = await Json(await client.PostAsJsonAsync("/api/account/password", new { currentPassword = "Wrong-password-47!", newPassword = NewPassword }), HttpStatusCode.BadRequest);
        Assert.Equal("invalid_current_password", wrong["title"]!.GetValue<string>());
        var weak = await Json(await client.PostAsJsonAsync("/api/account/password", new { currentPassword = sql.Password, newPassword = new string('a', 12) }), HttpStatusCode.BadRequest);
        Assert.Equal("password_policy", weak["title"]!.GetValue<string>());
        var same = await Json(await client.PostAsJsonAsync("/api/account/password", new { currentPassword = sql.Password, newPassword = sql.Password }), HttpStatusCode.BadRequest);
        Assert.Equal("password_unchanged", same["title"]!.GetValue<string>());
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/account/profile")).StatusCode);
        await using var scope = sql.Factory.Services.CreateAsyncScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>(); var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
        var user = (await users.FindByIdAsync(one.Id))!; var otherUser = (await users.FindByIdAsync(other.Id))!;
        Assert.True(await users.CheckPasswordAsync(user, sql.Password)); Assert.Equal(Stamp(session.Token), user.SecurityStamp);
        Assert.Equal(1, user.AccessFailedCount); Assert.Equal(0, otherUser.AccessFailedCount);
        Assert.True(await users.CheckPasswordAsync(otherUser, sql.Password));
        Assert.Equal(1, await db.Audit.CountAsync(item => item.ActorId == one.Id && item.Action == "ACCOUNT_PASSWORD_FAILED"));
        Assert.False(await db.Audit.AnyAsync(item => item.Action == "ACCOUNT_PASSWORD_CHANGED"));
    }

    [Fact]
    public async Task PasswordChangeRevokesEveryOwnedAccessAndRefreshSessionAndRequiresFreshLogin()
    {
        var one = await Customer(); var other = await Customer();
        var first = await Login(one.Name); var second = await Login(one.Name); var independent = await Login(other.Name);
        using var client = Client(first.Token, first.Cookie);
        using var changed = await client.PostAsJsonAsync("/api/account/password", new { currentPassword = sql.Password, newPassword = NewPassword });
        Assert.Equal(HttpStatusCode.NoContent, changed.StatusCode);
        Assert.Equal("", await changed.Content.ReadAsStringAsync());
        Assert.Contains(changed.Headers.GetValues("Set-Cookie"), cookie => cookie.StartsWith("sayman_refresh=;", StringComparison.Ordinal));
        foreach (var old in new[] { first, second }) {
            using var access = Client(old.Token); using var rejected = await access.GetAsync("/api/auth/me");
            Assert.Equal(HttpStatusCode.Unauthorized, rejected.StatusCode);
            using var refresh = Client(cookie: old.Cookie); using var replay = await refresh.PostAsJsonAsync("/api/auth/refresh", new { });
            Assert.Equal(HttpStatusCode.Unauthorized, replay.StatusCode);
        }
        using var otherClient = Client(independent.Token);
        Assert.Equal(HttpStatusCode.OK, (await otherClient.GetAsync("/api/account/profile")).StatusCode);
        await using (var scope = sql.Factory.Services.CreateAsyncScope()) {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>(); var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
            var user = (await users.FindByIdAsync(one.Id))!;
            Assert.NotEqual(Stamp(first.Token), user.SecurityStamp);
            Assert.False(await users.CheckPasswordAsync(user, sql.Password)); Assert.True(await users.CheckPasswordAsync(user, NewPassword));
            Assert.False(await db.Sessions.AnyAsync(item => item.UserId == one.Id && item.RevokedAt == null));
            Assert.True(await db.Sessions.AnyAsync(item => item.UserId == other.Id && item.RevokedAt == null));
            Assert.Equal(1, await db.Audit.CountAsync(item => item.ActorId == one.Id && item.Action == "ACCOUNT_PASSWORD_CHANGED"));
        }
        var fresh = await Login(one.Name, NewPassword);
        using var freshClient = Client(fresh.Token);
        Assert.Equal(HttpStatusCode.OK, (await freshClient.GetAsync("/api/account/profile")).StatusCode);
    }

    [Fact]
    public async Task FiveWrongCurrentPasswordsApplyIdentityLockoutAndNeverReturnRetryable401()
    {
        var user = await Customer(); var session = await Login(user.Name); using var client = Client(session.Token);
        for (var attempt = 0; attempt < 5; attempt++) {
            var rejected = await Json(await client.PostAsJsonAsync("/api/account/password", new { currentPassword = "Wrong-password-47!", newPassword = NewPassword }), HttpStatusCode.BadRequest);
            Assert.Equal("invalid_current_password", rejected["title"]!.GetValue<string>());
        }
        using var profile = await client.GetAsync("/api/account/profile");
        Assert.Equal(HttpStatusCode.Unauthorized, profile.StatusCode);
        await using var scope = sql.Factory.Services.CreateAsyncScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>(); var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
        Assert.True(await users.IsLockedOutAsync((await users.FindByIdAsync(user.Id))!));
        Assert.Equal(5, await db.Audit.CountAsync(item => item.ActorId == user.Id && item.Action == "ACCOUNT_PASSWORD_FAILED"));
        Assert.False(await db.Audit.AnyAsync(item => item.Action == "ACCOUNT_PASSWORD_CHANGED"));
    }

    [Fact]
    public async Task AuditFailureRollsBackNamePasswordStampAndSessionRevocationTogether()
    {
        var user = await Customer(); var session = await Login(user.Name); using var client = Client(session.Token);
        var before = await Json(await client.GetAsync("/api/account/profile"));
        await using (var scope = sql.Factory.Services.CreateAsyncScope()) {
            var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>(); Assert.StartsWith("SaymanTest_", db.Database.GetDbConnection().Database);
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] WITH NOCHECK ADD CONSTRAINT [CK_CustomerAccountAuditFailure] CHECK ([Action] NOT IN ('ACCOUNT_PROFILE_UPDATED','ACCOUNT_PASSWORD_CHANGED'))");
        }
        using var nameFailure = await client.PutAsJsonAsync("/api/account/profile", new { displayName = "نباید ذخیره شود", version = Version(before) });
        Assert.Equal(HttpStatusCode.ServiceUnavailable, nameFailure.StatusCode);
        using var passwordFailure = await client.PostAsJsonAsync("/api/account/password", new { currentPassword = sql.Password, newPassword = NewPassword });
        Assert.Equal(HttpStatusCode.ServiceUnavailable, passwordFailure.StatusCode);
        Assert.False(passwordFailure.Headers.Contains("Set-Cookie"));
        var after = await Json(await client.GetAsync("/api/account/profile"));
        Assert.Equal(before["displayName"]!.GetValue<string>(), after["displayName"]!.GetValue<string>());
        Assert.Equal(Version(before), Version(after));
        await using var finalScope = sql.Factory.Services.CreateAsyncScope();
        var users = finalScope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>(); var database = finalScope.ServiceProvider.GetRequiredService<IdentityDbContext>();
        var entity = (await users.FindByIdAsync(user.Id))!;
        Assert.Equal(Stamp(session.Token), entity.SecurityStamp);
        Assert.True(await users.CheckPasswordAsync(entity, sql.Password)); Assert.False(await users.CheckPasswordAsync(entity, NewPassword));
        Assert.True(await database.Sessions.AnyAsync(item => item.UserId == user.Id && item.RevokedAt == null));
        Assert.False(await database.Audit.AnyAsync(item => item.ActorId == user.Id && item.Action.StartsWith("ACCOUNT_")));
    }
}
