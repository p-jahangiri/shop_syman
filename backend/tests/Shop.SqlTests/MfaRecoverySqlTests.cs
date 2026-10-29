using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using System.Text;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using Shop.Modules.Identity;
using Xunit;

namespace Shop.SqlTests;

// Each case owns its SQL database and key ring; never run against the owner's account.
public sealed class MfaRecoverySqlTests : IAsyncLifetime
{
    private readonly MfaClock clock = new();
    private readonly SqlFixture sql;
    public MfaRecoverySqlTests() => sql = new() { TimeProvider = clock };
    public Task InitializeAsync() => sql.InitializeAsync();
    public Task DisposeAsync() => sql.DisposeAsync();
    private sealed class MfaClock : TimeProvider
    {
        private DateTimeOffset now = DateTimeOffset.UtcNow;
        public override DateTimeOffset GetUtcNow() => now;
        public void Advance() => now = now.AddSeconds(31);
    }
    private HttpClient Client(string? token = null)
    {
        var client = sql.Factory.CreateClient(new() { HandleCookies = false });
        client.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:3173"); client.DefaultRequestHeaders.Add("X-Sayman-Client", "admin"); client.DefaultRequestHeaders.Add("X-Sayman-Admin", "1");
        if (token is not null) client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        return client;
    }
    private static async Task<JsonNode> Json(HttpResponseMessage response)
    {
        var body = await response.Content.ReadAsStringAsync(); Assert.True(response.IsSuccessStatusCode, $"HTTP {(int)response.StatusCode}: {body}"); return JsonNode.Parse(body)!;
    }
    private static string Token(JsonNode body) => body["accessToken"]!.GetValue<string>();
    private string Code(string secret) => Totp.Code(secret, clock.GetUtcNow().ToUnixTimeSeconds() / 30);
    private async Task<JsonNode> Password(HttpClient client, string username) => await Json(await client.PostAsJsonAsync("/api/auth/password", new { Identifier = username, sql.Password }));
    private async Task<(HttpClient Client, string Name, string UserId, string Secret, string Access, string Refresh)> SignIn()
    {
        var account = await sql.CreateAdministratorAsync(); var client = Client();
        var pending = await Password(client, account.Username); client.DefaultRequestHeaders.Authorization = new("Bearer", Token(pending));
        var setup = await Json(await client.PostAsJsonAsync("/api/auth/mfa/setup", new { })); client.DefaultRequestHeaders.Authorization = new("Bearer", Token(setup));
        var secret = setup["secret"]!.GetValue<string>(); using var response = await client.PostAsJsonAsync("/api/auth/mfa/verify", new { Code = Code(secret) }); var session = await Json(response);
        var refresh = response.Headers.GetValues("Set-Cookie").Single(x => x.StartsWith("sayman_admin_refresh=", StringComparison.Ordinal)).Split(';')[0];
        var access = Token(session); client.DefaultRequestHeaders.Authorization = new("Bearer", access);
        return (client, account.Username, session["user"]!["id"]!.GetValue<string>(), secret, access, refresh);
    }
    private async Task<string[]> Generate(HttpClient client, string secret)
    {
        clock.Advance(); var batch = await Json(await client.PostAsJsonAsync("/api/auth/mfa/recovery-codes", new { sql.Password, Code = Code(secret) }));
        Assert.Contains("codes", batch.AsObject().Select(x => x.Key)); return batch["codes"]!.AsArray().Select(x => x!.GetValue<string>()).ToArray();
    }
    [Fact] public async Task RecoveryInvalidatesSessionsAndPasswordOnlyCannotEnrollUntilProven()
    {
        var account = await SignIn(); using var client = account.Client; var codes = await Generate(client, account.Secret);
        var pending = await Password(client, account.Name); var oldPending = Token(pending); client.DefaultRequestHeaders.Authorization = new("Bearer", oldPending);
        var recovered = await Json(await client.PostAsJsonAsync("/api/auth/mfa/recover", new { sql.Password, RecoveryCode = codes[0] })); var proof = Token(recovered);
        Assert.True(recovered["requiresMfa"]!.GetValue<bool>()); Assert.True(recovered["requiresEnrollment"]!.GetValue<bool>()); Assert.Null(recovered["user"]!["permissions"]);
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(proof); Assert.Contains(jwt.Claims, x => x.Type == "mfa_recovery" && x.Value == "verified"); Assert.DoesNotContain(jwt.Claims, x => x.Type is "role" or "permission"); Assert.InRange(jwt.ValidTo, DateTime.UtcNow.AddSeconds(290), DateTime.UtcNow.AddSeconds(305));
        using var oldAccess = Client(account.Access); Assert.Equal(HttpStatusCode.Unauthorized, (await oldAccess.GetAsync("/api/admin/catalog/summary")).StatusCode);
        using var obsolete = Client(oldPending); Assert.Equal(HttpStatusCode.Unauthorized, (await obsolete.PostAsJsonAsync("/api/auth/mfa/setup", new { })).StatusCode);
        using var oldRefresh = Client(); oldRefresh.DefaultRequestHeaders.Add("Cookie", account.Refresh); Assert.Equal(HttpStatusCode.Unauthorized, (await oldRefresh.PostAsJsonAsync("/api/auth/refresh", new { })).StatusCode);
        var passwordOnly = await Password(client, account.Name); Assert.True(passwordOnly["requiresRecovery"]!.GetValue<bool>()); Assert.False(passwordOnly["requiresEnrollment"]!.GetValue<bool>());
        client.DefaultRequestHeaders.Authorization = new("Bearer", Token(passwordOnly)); Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/auth/mfa/setup", new { })).StatusCode); Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/auth/mfa/verify", new { Code = Code(account.Secret) })).StatusCode);
        // Shorten this isolated test's signed proof to expose accidental deadline extension by setup.
        var shortProof = new JwtSecurityToken(jwt.Issuer, jwt.Audiences.Single(), jwt.Claims.Where(x => x.Type is not ("exp" or "nbf")), DateTime.UtcNow.AddSeconds(-5), DateTime.UtcNow.AddSeconds(90), new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(new string('q', 80))), SecurityAlgorithms.HmacSha256));
        client.DefaultRequestHeaders.Authorization = new("Bearer", new JwtSecurityTokenHandler().WriteToken(shortProof)); var setup = await Json(await client.PostAsJsonAsync("/api/auth/mfa/setup", new { })); Assert.NotEqual(account.Secret, setup["secret"]!.GetValue<string>()); Assert.Equal(shortProof.ValidTo, new JwtSecurityTokenHandler().ReadJwtToken(Token(setup)).ValidTo);
        client.DefaultRequestHeaders.Authorization = new("Bearer", Token(setup)); var session = await Json(await client.PostAsJsonAsync("/api/auth/mfa/verify", new { Code = Code(setup["secret"]!.GetValue<string>()) })); Assert.False(session["requiresMfa"]!.GetValue<bool>());
        client.DefaultRequestHeaders.Authorization = new("Bearer", Token(session)); var status = await Json(await client.GetAsync("/api/auth/mfa/recovery-codes")); Assert.Equal(0, status["remainingCodes"]!.GetValue<int>());
        await using var scope = sql.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>(); Assert.False((await db.Users.SingleAsync(x => x.Id == account.UserId)).MfaRecoveryPending); Assert.Equal(0, await db.MfaRecoveryCodes.CountAsync(x => x.UserId == account.UserId)); Assert.Equal(1, await db.Audit.CountAsync(x => x.ActorId == account.UserId && x.Action == "MFA_RECOVERY_COMPLETED"));
    }
    [Fact] public async Task GenerationRotatesHashedCodesAndRequiresPasswordAndUnusedTotp()
    {
        var account = await SignIn(); using var client = account.Client; var codes = await Generate(client, account.Secret);
        await using (var scope = sql.Factory.Services.CreateAsyncScope()) {
            var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>(); var rows = await db.MfaRecoveryCodes.Where(x => x.UserId == account.UserId).ToListAsync(); Assert.Equal(10, rows.Count);
            Assert.All(rows, row => { Assert.DoesNotContain(row.CodeHash, codes); Assert.Contains(codes, code => row.CodeHash == RecoveryCodes.Hash(account.UserId, RecoveryCodes.Normalize(code)!)); Assert.Null(row.ConsumedAt); });
        }
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/auth/mfa/recovery-codes", new { sql.Password, Code = Code(account.Secret) })).StatusCode);
        clock.Advance(); Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/auth/mfa/recovery-codes", new { Password = "WrongPassword!1234", Code = Code(account.Secret) })).StatusCode);
        var fresh = await Generate(client, account.Secret); Assert.Empty(codes.Intersect(fresh));
        await using var check = sql.Factory.Services.CreateAsyncScope(); var identity = check.ServiceProvider.GetRequiredService<IdentityDbContext>(); var hashes = await identity.MfaRecoveryCodes.Where(x => x.UserId == account.UserId).Select(x => x.CodeHash).ToArrayAsync(); Assert.Equal(10, hashes.Length); Assert.All(codes, code => Assert.DoesNotContain(RecoveryCodes.Hash(account.UserId, RecoveryCodes.Normalize(code)!), hashes));
        Assert.Equal(2, await identity.Audit.CountAsync(x => x.ActorId == account.UserId && x.Action == "MFA_CODES_GENERATED")); var audit = await identity.Audit.Where(x => x.ActorId == account.UserId).ToArrayAsync(); Assert.All(audit, row => { Assert.DoesNotContain(sql.Password, row.Resource); Assert.All(codes, code => Assert.DoesNotContain(code, row.Resource)); });
    }
    [Fact] public async Task ConcurrentRecoveryConsumesOneCodeAndLostProofCanUseAnotherCode()
    {
        var account = await SignIn(); using var client = account.Client; var codes = await Generate(client, account.Secret); var pending = await Password(client, account.Name);
        using var one = Client(Token(pending)); using var two = Client(Token(pending)); var responses = await Task.WhenAll(one.PostAsJsonAsync("/api/auth/mfa/recover", new { sql.Password, RecoveryCode = codes[0] }), two.PostAsJsonAsync("/api/auth/mfa/recover", new { sql.Password, RecoveryCode = codes[0] }));
        Assert.Single(responses, x => x.StatusCode == HttpStatusCode.OK); Assert.Single(responses, x => x.StatusCode == HttpStatusCode.Unauthorized); var firstProof = Token(await Json(responses.Single(x => x.IsSuccessStatusCode))); foreach (var response in responses) response.Dispose();
        var retry = await Password(client, account.Name); client.DefaultRequestHeaders.Authorization = new("Bearer", Token(retry)); Assert.True(retry["requiresRecovery"]!.GetValue<bool>());
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/auth/mfa/recover", new { sql.Password, RecoveryCode = codes[0] })).StatusCode);
        var next = await Json(await client.PostAsJsonAsync("/api/auth/mfa/recover", new { sql.Password, RecoveryCode = codes[1] })); Assert.NotEqual(firstProof, Token(next));
        using var old = Client(firstProof); Assert.Equal(HttpStatusCode.Unauthorized, (await old.PostAsJsonAsync("/api/auth/mfa/setup", new { })).StatusCode);
        await using var scope = sql.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>(); Assert.Equal(2, await db.MfaRecoveryCodes.CountAsync(x => x.UserId == account.UserId && x.ConsumedAt != null)); Assert.Equal(2, await db.Audit.CountAsync(x => x.ActorId == account.UserId && x.Action == "MFA_RECOVERY_STARTED"));
    }
    [Fact] public async Task AuditFailureRollsBackCodeClaimAuthenticatorStampAndSessionRevocation()
    {
        var account = await SignIn(); using var client = account.Client; var codes = await Generate(client, account.Secret); var pending = await Password(client, account.Name); client.DefaultRequestHeaders.Authorization = new("Bearer", Token(pending));
        await using var scope = sql.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>(); Assert.StartsWith("SaymanTest_", db.Database.GetDbConnection().Database); var before = await db.Users.AsNoTracking().SingleAsync(x => x.Id == account.UserId);
        await db.Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] WITH NOCHECK ADD CONSTRAINT [CK_RecoveryAuditFailure] CHECK ([Action]<>N'MFA_RECOVERY_STARTED')");
        try { Assert.False((await client.PostAsJsonAsync("/api/auth/mfa/recover", new { sql.Password, RecoveryCode = codes[0] })).IsSuccessStatusCode); }
        finally { await db.Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] DROP CONSTRAINT [CK_RecoveryAuditFailure]"); }
        var after = await db.Users.AsNoTracking().SingleAsync(x => x.Id == account.UserId); Assert.Equal(before.SecurityStamp, after.SecurityStamp); Assert.Equal(before.LastMfaCounter, after.LastMfaCounter); Assert.True(after.TwoFactorEnabled); Assert.False(after.MfaRecoveryPending); Assert.Equal(0, await db.MfaRecoveryCodes.CountAsync(x => x.UserId == account.UserId && x.ConsumedAt != null)); Assert.Equal(0, await db.Sessions.CountAsync(x => x.UserId == account.UserId && x.RevokedAt != null));
        var recovered = await Json(await client.PostAsJsonAsync("/api/auth/mfa/recover", new { sql.Password, RecoveryCode = codes[0] })); Assert.True(recovered["requiresEnrollment"]!.GetValue<bool>());
    }
    [Fact] public async Task WrongRecoveryCodesLockAccountWithoutConsumingValidCode()
    {
        var account = await SignIn(); using var client = account.Client; var codes = await Generate(client, account.Secret); var pending = await Password(client, account.Name); client.DefaultRequestHeaders.Authorization = new("Bearer", Token(pending));
        for (var i = 0; i < 5; i++) {
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/auth/mfa/recover", new { sql.Password, RecoveryCode = "00000000000000000000000000000000" })).StatusCode);
            if (i < 4) client.DefaultRequestHeaders.Authorization = new("Bearer", Token(await Password(client, account.Name)));
        }
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/auth/mfa/recover", new { sql.Password, RecoveryCode = codes[0] })).StatusCode);
        await using var scope = sql.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>(); var user = await db.Users.SingleAsync(x => x.Id == account.UserId); Assert.True(user.LockoutEnd > DateTimeOffset.UtcNow); Assert.False(user.MfaRecoveryPending); Assert.Equal(0, await db.MfaRecoveryCodes.CountAsync(x => x.UserId == account.UserId && x.ConsumedAt != null)); Assert.Equal(5, await db.Audit.CountAsync(x => x.ActorId == account.UserId && x.Action == "MFA_RECOVERY_FAILED"));
    }
}
