using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Identity;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;
public sealed class MfaRecoveryTests
{
    [Fact] public void CodesHave128RandomBitsAndPersistOnlyUserBoundDigests()
    {
        var codes = Enumerable.Range(0, 100).Select(_ => RecoveryCodes.NewCode()).ToArray();
        Assert.Equal(100, codes.Distinct().Count());
        foreach (var code in codes) {
            Assert.Matches("^[0-9A-F]{8}(-[0-9A-F]{8}){3}$", code);
            var normalized = RecoveryCodes.Normalize(code)!; Assert.Equal(32, normalized.Length);
            Assert.Equal(normalized, RecoveryCodes.Normalize(" " + code.ToLowerInvariant() + " "));
            var hash = RecoveryCodes.Hash("one", normalized); Assert.Matches("^[0-9a-f]{64}$", hash);
            Assert.DoesNotContain(normalized, hash); Assert.NotEqual(hash, RecoveryCodes.Hash("two", normalized));
        }
    }
    [Theory]
    [InlineData(null)][InlineData("")][InlineData("123456")][InlineData("AAAAAAAA-AAAAAAAAAAAAAAAA-AAAAAAAA-")]
    [InlineData("AAAAAAAA-AAAAAAAA-AAAAAAAA-AAAAAAAＧ")][InlineData("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA ")]
    public void MalformedCodesAreNeverNormalized(string? input) => Assert.Null(RecoveryCodes.Normalize(input));
    [Fact] public void RecoveryInputBoundsAndFreshTotpShapeRejectBeforeSql()
    {
        Assert.Throws<BusinessException>(() => RecoveryCodes.Validate(new GenerateRecoveryCodesInput(new string('p', 129), "123456")));
        Assert.Throws<BusinessException>(() => RecoveryCodes.Validate(new GenerateRecoveryCodesInput("password", "۱۲۳۴۵۶")));
        Assert.Throws<BusinessException>(() => RecoveryCodes.Validate(new RecoverMfaInput("", RecoveryCodes.NewCode())));
        Assert.Throws<BusinessException>(() => RecoveryCodes.Validate(new RecoverMfaInput("password", new string('A', 65))));
    }
    [Fact] public void RecoveryModelUsesOwnedUserForeignKeyAndBoundedAsciiDigest()
    {
        using var db = new IdentityDbContext(DesignTimeOptions.Create<IdentityDbContext>("identity"));
        var entity = db.Model.FindEntityType(typeof(MfaRecoveryCode))!;
        Assert.Equal(new[] { "UserId", "CodeHash" }, entity.FindPrimaryKey()!.Properties.Select(x => x.Name));
        Assert.Contains("CONSTRAINT [PK_MfaRecoveryCodes] PRIMARY KEY NONCLUSTERED", db.Database.GenerateCreateScript());
        Assert.Equal(64, entity.FindProperty("CodeHash")!.GetMaxLength()); Assert.False(entity.FindProperty("CodeHash")!.IsUnicode());
        Assert.Single(entity.GetForeignKeys()); Assert.NotNull(db.Model.FindEntityType(typeof(ShopUser))!.FindProperty("MfaRecoveryPending"));
        var sql = db.MfaRecoveryCodes.Where(x => x.UserId == "own-user" && x.ConsumedAt == null).Select(x => x.CodeHash).ToQueryString();
        Assert.Contains("[identity].[MfaRecoveryCodes]", sql); Assert.Contains("[ConsumedAt] IS NULL", sql); Assert.DoesNotContain("PasswordHash", sql);
    }

    private static WebApplicationFactory<Program> Host(FakeRecovery fake) => new ApiFactory().WithWebHostBuilder(b => {
        b.UseEnvironment("Development");
        b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?> { ["Cors:AdminOrigins:0"] = "http://127.0.0.1:3173" }));
        b.ConfigureTestServices(s => s.AddSingleton<IMfaRecovery>(fake));
    });
    private static HttpClient Client(WebApplicationFactory<Program> factory, string? kind = "access", string? role = "Administrator", string? origin = "http://127.0.0.1:3173", bool admin = true)
    {
        var client = factory.CreateClient();
        if (kind is not null) client.DefaultRequestHeaders.Add("X-Test-Kind", kind);
        if (role is not null) client.DefaultRequestHeaders.Add("X-Test-Roles", role);
        if (origin is not null) client.DefaultRequestHeaders.Add("Origin", origin);
        if (admin) client.DefaultRequestHeaders.Add("X-Sayman-Client", "admin");
        return client;
    }
    [Theory][InlineData("GET", "/api/auth/mfa/recovery-codes")][InlineData("POST", "/api/auth/mfa/recovery-codes")][InlineData("POST", "/api/auth/mfa/recover")]
    public async Task AnonymousIsRejectedBeforeRecoveryService(string method, string path)
    {
        var fake = new FakeRecovery(); using var host = Host(fake); using var client = Client(host, null);
        using var response = await client.SendAsync(new(new HttpMethod(method), path) { Content = JsonContent.Create(new { Password = "unit", Code = "123456", RecoveryCode = RecoveryCodes.NewCode() }) });
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode); Assert.Equal(0, fake.Calls);
    }
    [Theory][InlineData("mfa_pending", "Administrator", "/api/auth/mfa/recovery-codes")][InlineData("access", "Customer", "/api/auth/mfa/recovery-codes")][InlineData("access", null, "/api/auth/mfa/recovery-codes")][InlineData("access", "Administrator", "/api/auth/mfa/recover")]
    public async Task TokenKindsAndStaffRoleAreAuthoritative(string kind, string? role, string path)
    {
        var fake = new FakeRecovery(); using var host = Host(fake); using var client = Client(host, kind, role);
        var response = await client.PostAsJsonAsync(path, new { Password = "unit", Code = "123456", RecoveryCode = RecoveryCodes.NewCode() });
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode); Assert.Equal(0, fake.Calls);
    }
    [Theory][InlineData(null, true)][InlineData("http://127.0.0.1:3000", true)][InlineData("http://127.0.0.1:3173", false)]
    public async Task AllowedAdminClientAndExactOriginAreRequired(string? origin, bool admin)
    {
        var fake = new FakeRecovery(); using var host = Host(fake); using var client = Client(host, origin: origin, admin: admin);
        var response = await client.PostAsJsonAsync("/api/auth/mfa/recovery-codes", new { Password = "unit", Code = "123456" });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode); Assert.Equal(0, fake.Calls);
    }
    [Theory][InlineData("/api/auth/mfa/recovery-codes", "{\"password\":null,\"code\":\"123456\"}", "access")][InlineData("/api/auth/mfa/recover", "{\"password\":\"unit\",\"recoveryCode\":null}", "mfa_pending")]
    public async Task NullRequiredInputsAreRejectedBeforeService(string path, string json, string kind)
    {
        var fake = new FakeRecovery(); using var host = Host(fake); using var client = Client(host, kind);
        var response = await client.PostAsync(path, new StringContent(json, System.Text.Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode); Assert.Equal(0, fake.Calls);
    }
    [Fact] public async Task StatusAndGenerationOnlyUseOwnSubjectAndReturnNoStore()
    {
        var fake = new FakeRecovery(); using var host = Host(fake); using var client = Client(host);
        using var status = await client.GetAsync("/api/auth/mfa/recovery-codes"); Assert.Equal(HttpStatusCode.OK, status.StatusCode);
        var json = JsonNode.Parse(await status.Content.ReadAsStringAsync())!; Assert.Equal(0, json["remainingCodes"]!.GetValue<int>()); Assert.Null(json["codes"]);
        await ContractWireCapture.SaveAsync("mfa-recovery-status", await status.Content.ReadAsStringAsync());
        using var generated = await client.PostAsJsonAsync("/api/auth/mfa/recovery-codes", new { Password = "unit", Code = "123456" }); Assert.Equal(HttpStatusCode.OK, generated.StatusCode);
        Assert.Contains("no-store", generated.Headers.CacheControl!.ToString()); Assert.Equal("test-user", fake.Subject); Assert.Equal("test-security-stamp", fake.Stamp);
        Assert.False(generated.Headers.Contains("Set-Cookie")); Assert.Equal(2, fake.Calls);
        await ContractWireCapture.SaveAsync("mfa-recovery-batch", await generated.Content.ReadAsStringAsync());
    }
    [Fact] public async Task RecoveryOnlyReturnsEnrollmentChallengeAndDeletesOldRefreshCookie()
    {
        var fake = new FakeRecovery(); using var host = Host(fake); using var client = Client(host, "mfa_pending", null);
        using var response = await client.PostAsJsonAsync("/api/auth/mfa/recover", new { Password = "unit", RecoveryCode = RecoveryCodes.NewCode() });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode); var json = JsonNode.Parse(await response.Content.ReadAsStringAsync())!;
        Assert.True(json["requiresMfa"]!.GetValue<bool>()); Assert.True(json["requiresEnrollment"]!.GetValue<bool>()); Assert.False(json["requiresRecovery"]!.GetValue<bool>());
        Assert.Null(json["refreshToken"]); Assert.Null(json["user"]!["permissions"]); Assert.Equal("test-user", fake.Subject);
        await ContractWireCapture.SaveAsync("mfa-recovery-challenge", await response.Content.ReadAsStringAsync());
        Assert.Contains(response.Headers.GetValues("Set-Cookie"), x => x.StartsWith("sayman_admin_refresh=;", StringComparison.Ordinal));
    }
    public sealed class FakeRecovery : IMfaRecovery
    {
        public int Calls; public string? Subject; public string? Stamp;
        public Task<RecoveryCodeStatus> StatusAsync(string userId, CancellationToken ct) { Calls++; Subject = userId; return Task.FromResult(new RecoveryCodeStatus(1, 0)); }
        public Task<RecoveryCodeBatch> GenerateAsync(string userId, string stamp, GenerateRecoveryCodesInput input, string traceId, CancellationToken ct) { Calls++; Subject = userId; Stamp = stamp; return Task.FromResult(new RecoveryCodeBatch(1, Enumerable.Range(0, 10).Select(_ => RecoveryCodes.NewCode()).ToArray(), DateTimeOffset.UtcNow)); }
        public Task<AuthResult> RecoverAsync(string userId, string stamp, RecoverMfaInput input, string traceId, CancellationToken ct) { Calls++; Subject = userId; Stamp = stamp; return Task.FromResult(new AuthResult("unit-test-challenge-never-a-real-token", 300, null, true, true, new { Id = userId, DisplayName = "Synthetic", UserName = "synthetic" })); }
    }
}
