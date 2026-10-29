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

public sealed class StaffProvisioningSqlTests : IAsyncLifetime
{
    private sealed class Clock : TimeProvider
    {
        private DateTimeOffset now = DateTimeOffset.UtcNow;
        public override DateTimeOffset GetUtcNow() => now;
        public void Advance() => now = now.AddSeconds(31);
    }
    private readonly Clock clock = new();
    private readonly SqlFixture sql;
    private const string Initial = "Synthetic-Initial!1234", Changed = "Synthetic-Changed!5678";
    public StaffProvisioningSqlTests() => sql = new() { TimeProvider = clock };
    public Task InitializeAsync() => sql.InitializeAsync();
    public Task DisposeAsync() => sql.DisposeAsync();
    private HttpClient Client(string? token = null)
    {
        var client = sql.Factory.CreateClient(new() { HandleCookies = false });
        client.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:3173");
        client.DefaultRequestHeaders.Add("X-Sayman-Client", "admin");
        client.DefaultRequestHeaders.Add("X-Sayman-Admin", "1");
        if (token is not null) client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        return client;
    }
    private static async Task<JsonNode> Json(HttpResponseMessage response, string? capture = null, string? kind = null, object? binding = null)
    {
        var raw = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, $"HTTP {(int)response.StatusCode}: {raw}");
        await AdminBusinessWireCapture.SaveAsync(response, capture, kind, binding);
        return JsonNode.Parse(raw)!;
    }
    private static string Token(JsonNode node) => node["accessToken"]!.GetValue<string>();
    private async Task<HttpClient> Admin()
    {
        var account = await sql.CreateAdministratorAsync();
        var client = Client();
        var pending = await Json(await client.PostAsJsonAsync("/api/auth/password", new { Identifier = account.Username, account.Password }));
        client.DefaultRequestHeaders.Authorization = new("Bearer", Token(pending));
        var setup = await Json(await client.PostAsJsonAsync("/api/auth/mfa/setup", new { }));
        client.DefaultRequestHeaders.Authorization = new("Bearer", Token(setup));
        clock.Advance();
        var session = await Json(await client.PostAsJsonAsync("/api/auth/mfa/verify", new { Code = Totp.Code(setup["secret"]!.GetValue<string>(), clock.GetUtcNow().ToUnixTimeSeconds() / 30) }));
        client.DefaultRequestHeaders.Authorization = new("Bearer", Token(session));
        return client;
    }
    private static CreateStaffAccountInput Input(string? email = null) => new(Guid.NewGuid().ToString("D"), "newstaff" + Guid.NewGuid().ToString("N"), "همکار نمونهٔ SQL", Initial, ["ContentManager"], email);
    private static string Receipt(string id) => "/api/admin/staff/creation-commands/" + id;

    [Fact]
    public async Task CreateReplayReceiptAndContactTruthAreAtomicAndSecretFree()
    {
        using var admin = await Admin(); var input = Input();
        var created = await Json(await admin.PostAsJsonAsync("/api/admin/staff/accounts", input), "staff-created", "staff-created", new { input.RequestId });
        var id = created["staff"]!["id"]!.GetValue<string>();
        Assert.True(created["staff"]!["requiresPasswordChange"]!.GetValue<bool>());
        Assert.True(created["staff"]!["provisionedByAdministrator"]!.GetValue<bool>());
        Assert.False(created["replayed"]!.GetValue<bool>());
        Assert.DoesNotContain(Initial, created.ToJsonString()); Assert.Null(created["staff"]!["email"]);
        var replay = await Json(await admin.PostAsJsonAsync("/api/admin/staff/accounts", input with { UserName = input.UserName.ToUpperInvariant() }), "staff-replay", "staff-created", new { input.RequestId });
        Assert.True(replay["replayed"]!.GetValue<bool>()); Assert.Equal(id, replay["staff"]!["id"]!.GetValue<string>());
        Assert.Equal(replay.ToJsonString(), (await Json(await admin.GetAsync(Receipt(input.RequestId)), "staff-receipt", "staff-created", new { input.RequestId })).ToJsonString());
        await Json(await admin.GetAsync("/api/admin/staff"), "staff-page", "staff-page", new { Query = "", Active = "all", Role = "all" });
        await Json(await admin.GetAsync("/api/admin/staff/" + id), "staff-detail", "staff-detail", new { Id = id });
        await Json(await admin.GetAsync("/api/admin/staff/" + id + "/history"), "staff-history", "staff-history", new { Id = id });
        await Json(await admin.GetAsync("/api/admin/staff-role-catalog"), "staff-roles", "staff-roles", new { });
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsJsonAsync("/api/admin/staff/accounts", input with { InitialPassword = Changed })).StatusCode);
        using var other = await Admin(); Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync(Receipt(input.RequestId))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await other.PostAsJsonAsync("/api/admin/staff/accounts", input with { RequestId = Guid.NewGuid().ToString("D") })).StatusCode);
        await using var scope = sql.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
        var user = await db.Users.SingleAsync(x => x.Id == id);
        Assert.Null(user.Email); Assert.Null(user.PhoneNumber); Assert.False(user.EmailConfirmed); Assert.False(user.PhoneNumberConfirmed);
        Assert.True(user.MustChangePassword); Assert.True(user.RequireMfa); Assert.False(user.TwoFactorEnabled);
        Assert.False(await db.Sessions.AnyAsync(x => x.UserId == id));
        var command = await db.StaffCreationCommands.SingleAsync(x => x.UserId == id);
        Assert.DoesNotContain(Initial, Encoding.UTF8.GetString(command.ProtectedReceipt));
        Assert.NotEqual(StaffProvisioningRules.Fingerprint(StaffProvisioningRules.Validate(input)), Encoding.UTF8.GetString(command.ProtectedFingerprint));
        Assert.Equal(1, await db.Audit.CountAsync(x => x.Resource == "/staff/" + id && x.Action == "STAFF_CREATED"));
    }

    [Fact]
    public async Task InitialGrantRequiresPasswordChangeThenMfaBeforeAnyOperationalAccess()
    {
        using var admin = await Admin(); var input = Input("unverified@example.test");
        var created = await Json(await admin.PostAsJsonAsync("/api/admin/staff/accounts", input));
        var id = created["staff"]!["id"]!.GetValue<string>();
        using var staff = Client();
        using var response = await staff.PostAsJsonAsync("/api/auth/password", new { Identifier = input.UserName, Password = Initial });
        var pending = await Json(response); Assert.False(response.Headers.Contains("Set-Cookie"));
        Assert.True(pending["requiresPasswordChange"]!.GetValue<bool>()); Assert.False(pending["requiresMfa"]!.GetValue<bool>());
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(Token(pending));
        Assert.Contains(jwt.Claims, x => x.Type == "token_kind" && x.Value == "staff_password_change");
        Assert.DoesNotContain(jwt.Claims, x => x.Type is "role" or "permission"); Assert.Null(pending["user"]!["permissions"]);
        staff.DefaultRequestHeaders.Authorization = new("Bearer", Token(pending));
        foreach (var route in new[] { "/api/admin/catalog", "/api/auth/me" })
            Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync(route)).StatusCode);
        foreach (var route in new[] { "/api/auth/mfa/setup", "/api/auth/mfa/verify" })
            Assert.Equal(HttpStatusCode.Forbidden, (await staff.PostAsJsonAsync(route, new { Code = "123456" })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await staff.PostAsJsonAsync("/api/auth/refresh", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await staff.PostAsJsonAsync("/api/auth/staff/password", new { NewPassword = Initial })).StatusCode);
        using var changed = await staff.PostAsJsonAsync("/api/auth/staff/password", new { NewPassword = Changed });
        var mfa = await Json(changed); Assert.False(changed.Headers.Contains("Set-Cookie"));
        Assert.Null(mfa["requiresPasswordChange"]); Assert.True(mfa["requiresMfa"]!.GetValue<bool>()); Assert.True(mfa["requiresEnrollment"]!.GetValue<bool>());
        Assert.Equal(HttpStatusCode.Unauthorized, (await staff.PostAsJsonAsync("/api/auth/staff/password", new { NewPassword = Changed })).StatusCode);
        staff.DefaultRequestHeaders.Authorization = new("Bearer", Token(mfa));
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync("/api/admin/catalog")).StatusCode);
        var setup = await Json(await staff.PostAsJsonAsync("/api/auth/mfa/setup", new { }));
        staff.DefaultRequestHeaders.Authorization = new("Bearer", Token(setup)); clock.Advance();
        using var verified = await staff.PostAsJsonAsync("/api/auth/mfa/verify", new { Code = Totp.Code(setup["secret"]!.GetValue<string>(), clock.GetUtcNow().ToUnixTimeSeconds() / 30) });
        var session = await Json(verified); Assert.True(verified.Headers.Contains("Set-Cookie"));
        staff.DefaultRequestHeaders.Authorization = new("Bearer", Token(session));
        Assert.Equal(HttpStatusCode.OK, (await staff.GetAsync("/api/admin/catalog")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync("/api/admin/staff")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.PostAsJsonAsync("/api/auth/staff/password", new { NewPassword = Initial })).StatusCode);
        using var oldPassword = Client(); Assert.Equal(HttpStatusCode.Unauthorized, (await oldPassword.PostAsJsonAsync("/api/auth/password", new { Identifier = input.UserName, Password = Initial })).StatusCode);
        await using var scope = sql.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
        var user = await db.Users.SingleAsync(x => x.Id == id); Assert.False(user.MustChangePassword); Assert.True(user.TwoFactorEnabled); Assert.False(user.EmailConfirmed);
        Assert.Equal(1, await db.Audit.CountAsync(x => x.ActorId == id && x.Action == "STAFF_INITIAL_PASSWORD_CHANGED"));
    }

    [Fact]
    public async Task ConcurrentCreationHasOneAccountAndChangedPayloadCannotReplay()
    {
        using var admin = await Admin(); var input = Input();
        var responses = await Task.WhenAll(Enumerable.Range(0, 2).Select(_ => admin.PostAsJsonAsync("/api/admin/staff/accounts", input)));
        var ids = new List<string>();
        foreach (var response in responses) { var body = await Json(response); ids.Add(body["staff"]!["id"]!.GetValue<string>()); }
        Assert.Single(ids.Distinct());
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsJsonAsync("/api/admin/staff/accounts", input with { DisplayName = "نام متفاوت" })).StatusCode);
        await using var scope = sql.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
        Assert.Equal(1, await db.Users.CountAsync(x => x.UserName == input.UserName));
        Assert.Equal(1, await db.StaffCreationCommands.CountAsync(x => x.RequestId == Guid.Parse(input.RequestId)));
        foreach (var response in responses) response.Dispose();
    }

    [Fact]
    public async Task ConcurrentInitialPasswordChangeConsumesGrantOnlyOnce()
    {
        using var admin = await Admin(); var input = Input();
        await Json(await admin.PostAsJsonAsync("/api/admin/staff/accounts", input));
        using var login = Client(); var pending = await Json(await login.PostAsJsonAsync("/api/auth/password", new { Identifier = input.UserName, Password = Initial }));
        using var first = Client(Token(pending)); using var second = Client(Token(pending));
        var responses = await Task.WhenAll(first.PostAsJsonAsync("/api/auth/staff/password", new { NewPassword = Changed }), second.PostAsJsonAsync("/api/auth/staff/password", new { NewPassword = "Another-Synthetic!9876" }));
        Assert.Single(responses, x => x.IsSuccessStatusCode);
        Assert.All(responses.Where(x => !x.IsSuccessStatusCode), x => Assert.Contains(x.StatusCode, new[] { HttpStatusCode.Unauthorized, HttpStatusCode.Conflict }));
        await using var scope = sql.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
        var id = await db.Users.Where(x => x.UserName == input.UserName).Select(x => x.Id).SingleAsync();
        Assert.False(await db.Sessions.AnyAsync(x => x.UserId == id)); Assert.Equal(1, await db.Audit.CountAsync(x => x.ActorId == id && x.Action == "STAFF_INITIAL_PASSWORD_CHANGED"));
        foreach (var response in responses) response.Dispose();
    }

    [Fact]
    public async Task RootAuditFailureRollsBackAccountRolesAndReceipt()
    {
        using var admin = await Admin(); var input = Input();
        await using (var scope = sql.Factory.Services.CreateAsyncScope()) {
            var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>(); Assert.StartsWith("SaymanTest_", db.Database.GetDbConnection().Database);
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] WITH NOCHECK ADD CONSTRAINT [CK_StaffCreateRootFailure] CHECK ([Action]<>N'POST')");
        }
        try { Assert.False((await admin.PostAsJsonAsync("/api/admin/staff/accounts", input)).IsSuccessStatusCode); }
        finally { await using var scope = sql.Factory.Services.CreateAsyncScope(); await scope.ServiceProvider.GetRequiredService<IdentityDbContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] DROP CONSTRAINT [CK_StaffCreateRootFailure]"); }
        await using (var scope = sql.Factory.Services.CreateAsyncScope()) {
            var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>(); Assert.False(await db.Users.AnyAsync(x => x.UserName == input.UserName));
            Assert.False(await db.StaffCreationCommands.AnyAsync(x => x.RequestId == Guid.Parse(input.RequestId)));
            Assert.False(await db.Audit.AnyAsync(x => x.Action == "STAFF_CREATED"));
        }
        await Json(await admin.PostAsJsonAsync("/api/admin/staff/accounts", input));
    }

    [Fact]
    public async Task InvalidRoleContactAndCorruptReceiptNeverBecomeSuccess()
    {
        using var admin = await Admin(); var input = Input();
        foreach (var invalid in new[] { input with { Roles = ["MissingRole"] }, input with { Email = "invalid" }, input with { InitialPassword = "weak" } })
            Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/admin/staff/accounts", invalid)).StatusCode);
        var created = await Json(await admin.PostAsJsonAsync("/api/admin/staff/accounts", input)); var id = created["staff"]!["id"]!.GetValue<string>();
        await using (var scope = sql.Factory.Services.CreateAsyncScope()) {
            var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>(); Assert.StartsWith("SaymanTest_", db.Database.GetDbConnection().Database);
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE [identity].[StaffCreationCommands] SET [ProtectedReceipt]=0x01 WHERE [UserId]={id}");
        }
        var broken = await admin.GetAsync(Receipt(input.RequestId)); Assert.False(broken.IsSuccessStatusCode);
        Assert.Equal("staff_creation_unavailable", JsonNode.Parse(await broken.Content.ReadAsStringAsync())!["title"]!.GetValue<string>());
    }
}
