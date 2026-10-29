using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using Shop.Modules.Identity;
using Xunit;

namespace Shop.SqlTests;

// Real signatures, real SQL and HTTP; each case owns and cleans its database.
public sealed class AuthSessionSecuritySqlTests : IAsyncLifetime
{
    private readonly SqlFixture sql = new();
    public Task InitializeAsync() => sql.InitializeAsync();
    public Task DisposeAsync() => sql.DisposeAsync();
    private HttpClient Client(string? token = null, string? cookie = null, bool admin = false)
    {
        var client = sql.Factory.CreateClient(new() { HandleCookies = false });
        client.DefaultRequestHeaders.Add("Origin", admin ? "http://127.0.0.1:3173" : "http://127.0.0.1:3000");
        if (admin) client.DefaultRequestHeaders.Add("X-Sayman-Client", "admin");
        if (token is not null) client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        if (cookie is not null) client.DefaultRequestHeaders.Add("Cookie", cookie);
        return client;
    }
    private async Task<(string Name, string Id)> Customer()
    {
        await using var scope = sql.Factory.Services.CreateAsyncScope(); var users = scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>();
        var name = "security" + Guid.NewGuid().ToString("N"); var user = new ShopUser { UserName = name, Email = name + "@example.test", EmailConfirmed = true };
        Assert.True((await users.CreateAsync(user, sql.Password)).Succeeded); return (name, user.Id);
    }
    private static async Task<(string Access, string Cookie)> Session(HttpResponseMessage response, bool admin = false)
    {
        using (response) {
            var raw = await response.Content.ReadAsStringAsync(); Assert.True(response.IsSuccessStatusCode, $"HTTP {(int)response.StatusCode}: {raw}");
            var body = JsonNode.Parse(raw)!; Assert.Null(body["refreshToken"]); Assert.Null(body["refreshExpiresAt"]);
            return (body["accessToken"]!.GetValue<string>(), response.Headers.GetValues("Set-Cookie").Single(c => c.StartsWith(admin ? "sayman_admin_refresh=" : "sayman_refresh=", StringComparison.Ordinal)).Split(';')[0]);
        }
    }
    private async Task<(string Access, string Cookie)> Login(string name)
    {
        using var client = Client(); return await Session(await client.PostAsJsonAsync("/api/auth/password", new { Identifier = name, sql.Password }));
    }
    private async Task<HttpStatusCode> Me(string token)
    {
        using var client = Client(token); using var response = await client.GetAsync("/api/auth/me"); return response.StatusCode;
    }
    private static JwtSecurityToken Jwt(string token) => new JwtSecurityTokenHandler().ReadJwtToken(token);
    private static string Resign(string token, Func<IEnumerable<Claim>, IEnumerable<Claim>> claims, string? issuer = null, string? audience = null, DateTime? expiry = null)
    {
        var original = Jwt(token);
        var signed = new JwtSecurityToken(issuer ?? original.Issuer, audience ?? original.Audiences.Single(),
            claims(original.Claims.Where(c => c.Type is not ("exp" or "nbf" or "iss" or "aud"))), DateTime.UtcNow.AddMinutes(-20), expiry ?? DateTime.UtcNow.AddMinutes(5),
            new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(new string('q', 80))), SecurityAlgorithms.HmacSha256));
        return new JwtSecurityTokenHandler().WriteToken(signed);
    }
    [Fact] public async Task LogoutImmediatelyRejectsAccessButKeepsIndependentSession()
    {
        var user = await Customer(); var one = await Login(user.Name); var two = await Login(user.Name);
        Assert.NotEqual(Jwt(one.Access).Claims.Single(c => c.Type == "sid").Value, Jwt(two.Access).Claims.Single(c => c.Type == "sid").Value);
        Assert.Equal(HttpStatusCode.OK, await Me(one.Access));
        using var logout = Client(one.Access, one.Cookie); Assert.Equal(HttpStatusCode.NoContent, (await logout.PostAsJsonAsync("/api/auth/logout", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, await Me(one.Access)); Assert.Equal(HttpStatusCode.OK, await Me(two.Access));
    }
    [Fact] public async Task RotationKeepsFamilyAndAbsoluteExpiryWhileReplayRevokesBothAccessTokens()
    {
        var user = await Customer(); var original = await Login(user.Name);
        using var client = Client(cookie: original.Cookie); var next = await Session(await client.PostAsJsonAsync("/api/auth/refresh", new { }));
        Assert.NotEqual(original.Cookie, next.Cookie);
        Assert.Equal(Jwt(original.Access).Claims.Single(c => c.Type == "sid").Value, Jwt(next.Access).Claims.Single(c => c.Type == "sid").Value);
        await using (var scope = sql.Factory.Services.CreateAsyncScope()) {
            var rows = await scope.ServiceProvider.GetRequiredService<IdentityDbContext>().Sessions.Where(s => s.UserId == user.Id).ToArrayAsync();
            Assert.Equal(2, rows.Length); Assert.Equal(rows[0].ExpiresAt, rows[1].ExpiresAt); Assert.Single(rows, s => s.RevokedAt is null);
        }
        Assert.Equal(HttpStatusCode.OK, await Me(original.Access)); Assert.Equal(HttpStatusCode.OK, await Me(next.Access));
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/auth/refresh", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, await Me(original.Access)); Assert.Equal(HttpStatusCode.Unauthorized, await Me(next.Access));
    }
    [Fact] public async Task AmbiguousAndCrossClientCookiesDoNotConsumeTheCustomerSession()
    {
        var user = await Customer(); var original = await Login(user.Name);
        using var duplicate = Client(cookie: original.Cookie + "; " + original.Cookie);
        Assert.Equal(HttpStatusCode.Unauthorized, (await duplicate.PostAsJsonAsync("/api/auth/refresh", new { })).StatusCode);
        using var admin = Client(cookie: original.Cookie.Replace("sayman_refresh=", "sayman_admin_refresh="), admin: true);
        Assert.Equal(HttpStatusCode.Unauthorized, (await admin.PostAsJsonAsync("/api/auth/refresh", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, await Me(original.Access));
        using var valid = Client(cookie: original.Cookie); await Session(await valid.PostAsJsonAsync("/api/auth/refresh", new { }));
    }
    [Fact] public async Task SignedButInvalidClaimsCannotBypassSessionOrPermissionValidation()
    {
        var user = await Customer(); var original = await Login(user.Name);
        var tokens = new[] {
            Resign(original.Access, c => c.Where(x => x.Type != "sid")),
            Resign(original.Access, c => c.Where(x => x.Type != "sid").Append(new("sid", Guid.NewGuid().ToString("N")))),
            Resign(original.Access, c => c.Append(new("role", "Administrator"))),
            Resign(original.Access, c => c.Append(new("permission", "catalog.write"))),
            Resign(original.Access, c => c.Where(x => x.Type != "token_kind").Append(new("token_kind", "unknown"))),
            Resign(original.Access, c => c, issuer: "evil-issuer"), Resign(original.Access, c => c, audience: "evil-audience"),
            Resign(original.Access, c => c, expiry: DateTime.UtcNow.AddMinutes(-1)),
            Resign(original.Access, c => c.Append(new("sub", user.Id)))
        };
        foreach (var token in tokens) Assert.Equal(HttpStatusCode.Unauthorized, await Me(token));
        Assert.Equal(HttpStatusCode.OK, await Me(original.Access));
    }
    [Fact] public async Task DirectRoleChangesInvalidateExistingClaimsWithoutRelyingOnStampChanges()
    {
        var user = await Customer(); var original = await Login(user.Name);
        await using (var scope = sql.Factory.Services.CreateAsyncScope()) {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>(); var entity = (await users.FindByIdAsync(user.Id))!;
            var stamp = entity.SecurityStamp; Assert.True((await users.AddToRoleAsync(entity, "SupportAgent")).Succeeded); Assert.Equal(stamp, entity.SecurityStamp);
        }
        Assert.Equal(HttpStatusCode.Unauthorized, await Me(original.Access));
    }
    [Fact] public async Task StaffAccessRequiresBothSignedMfaProofAndTheVerifiedSqlSession()
    {
        var account = await sql.CreateAdministratorAsync(); using var client = Client(admin: true);
        client.DefaultRequestHeaders.Add("X-Sayman-Admin", "1");
        using var password = await client.PostAsJsonAsync("/api/auth/password", new { Identifier = account.Username, sql.Password });
        Assert.Equal(HttpStatusCode.OK, password.StatusCode);
        var pending = (await password.Content.ReadFromJsonAsync<JsonNode>())!;
        var pendingToken = pending["accessToken"]!.GetValue<string>();
        client.DefaultRequestHeaders.Authorization = new("Bearer", pendingToken);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/admin/catalog/summary")).StatusCode);
        using var enrollment = await client.PostAsJsonAsync("/api/auth/mfa/setup", new { });
        Assert.Equal(HttpStatusCode.OK, enrollment.StatusCode);
        var setup = (await enrollment.Content.ReadFromJsonAsync<JsonNode>())!;
        client.DefaultRequestHeaders.Authorization = new("Bearer", setup["accessToken"]!.GetValue<string>());
        var code = Totp.Code(setup["secret"]!.GetValue<string>(), DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 30);
        var session = await Session(await client.PostAsJsonAsync("/api/auth/mfa/verify", new { Code = code }), true);
        Assert.Equal(HttpStatusCode.OK, await Me(session.Access));
        Assert.Equal(HttpStatusCode.Unauthorized, await Me(Resign(session.Access, claims => claims.Where(c => c.Type != "amr"))));
        await using (var scope = sql.Factory.Services.CreateAsyncScope()) {
            var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
            var id = Jwt(session.Access).Subject;
            await db.Sessions.Where(s => s.UserId == id && s.RevokedAt == null).ExecuteUpdateAsync(s => s.SetProperty(x => x.MfaVerified, false));
        }
        Assert.Equal(HttpStatusCode.Unauthorized, await Me(session.Access));
        using var refresh = Client(cookie: session.Cookie, admin: true);
        Assert.Equal(HttpStatusCode.Unauthorized, (await refresh.PostAsJsonAsync("/api/auth/refresh", new { })).StatusCode);
    }
    [Fact] public async Task OldestFamilyDeadlinePreventsLegacySlidingExpiry()
    {
        var user = await Customer(); var original = await Login(user.Name);
        using var client = Client(cookie: original.Cookie); var next = await Session(await client.PostAsJsonAsync("/api/auth/refresh", new { }));
        await using (var scope = sql.Factory.Services.CreateAsyncScope()) {
            var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
            await db.Sessions.Where(s => s.UserId == user.Id && s.RevokedAt != null).ExecuteUpdateAsync(s => s.SetProperty(x => x.ExpiresAt, DateTimeOffset.UtcNow.AddMinutes(-1)));
        }
        using var refresh = Client(cookie: next.Cookie); Assert.Equal(HttpStatusCode.Unauthorized, (await refresh.PostAsJsonAsync("/api/auth/refresh", new { })).StatusCode);
    }
}
