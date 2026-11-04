using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Identity;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class StaffPasswordTests
{
    [Theory]
    [InlineData(null)][InlineData("")][InlineData("۱۲۳۴۵۶")][InlineData("12345")][InlineData("1234567")]
    public void MalformedCodeCannotReachSql(string? code) => Assert.Equal("invalid_staff_confirmation",
        Assert.Throws<BusinessException>(() => StaffPasswordRules.Validate(new("old", "New-password-47!", code!))).Code);

    [Fact]
    public void PasswordBoundsAndUtf16AreCheckedWithoutTrimming()
    {
        foreach (var password in new[] { "", new string('x', 129), new string((char)0xd800, 12) })
            Assert.Throws<BusinessException>(() => StaffPasswordRules.Validate(new(password, "New-password-47!", "123456")));
        foreach (var password in new[] { "short", new string('x', 129), new string((char)0xd800, 12) })
            Assert.Throws<BusinessException>(() => StaffPasswordRules.Validate(new("old", password, "123456")));
        StaffPasswordRules.Validate(new(" old ", " New-password-47! ", "123456"));
    }

    [Theory]
    [InlineData(null, null, 401)]
    [InlineData("mfa_pending", "Administrator", 403)]
    [InlineData("staff_password_change", "Administrator", 403)]
    [InlineData("access", null, 403)]
    [InlineData("access", "Customer", 403)]
    public async Task IncompleteAndCustomerAccessCannotChangeStaffPassword(string? kind, string? role, int expected)
    {
        var fake = new FakePassword(); using var factory = Host(fake); using var client = factory.CreateClient();
        if (kind is not null) client.DefaultRequestHeaders.Add("X-Test-Kind", kind);
        if (role is not null) client.DefaultRequestHeaders.Add("X-Test-Roles", role);
        client.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:3173");
        client.DefaultRequestHeaders.Add("X-Sayman-Client", "admin");
        using var response = await client.PostAsJsonAsync("/api/auth/staff/change-password", Input());
        Assert.Equal(expected, (int)response.StatusCode); Assert.Equal(0, fake.Calls);
    }

    [Theory]
    [InlineData(null, true, "")]
    [InlineData("http://127.0.0.1:3000", true, "")]
    [InlineData("http://127.0.0.1:3173", false, "")]
    [InlineData("http://127.0.0.1:3173", true, "?userId=other")]
    public async Task ExactAdminOriginClientAndNoQueryAreRequired(string? origin, bool admin, string query)
    {
        var fake = new FakePassword(); using var factory = Host(fake); using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-Kind", "access"); client.DefaultRequestHeaders.Add("X-Test-Roles", "Administrator");
        if (origin is not null) client.DefaultRequestHeaders.Add("Origin", origin);
        if (admin) client.DefaultRequestHeaders.Add("X-Sayman-Client", "admin");
        using var response = await client.PostAsJsonAsync("/api/auth/staff/change-password" + query, Input());
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode); Assert.Equal(0, fake.Calls);
    }

    [Fact]
    public async Task SuccessUsesOwnSubjectIsPrivateAndClearsOnlyAdminCookie()
    {
        var fake = new FakePassword(); using var factory = Host(fake); using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-Kind", "access"); client.DefaultRequestHeaders.Add("X-Test-Roles", "SupportAgent");
        client.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:3173"); client.DefaultRequestHeaders.Add("X-Sayman-Client", "admin");
        using var response = await client.PostAsJsonAsync("/api/auth/staff/change-password", Input());
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode); Assert.Equal("", await response.Content.ReadAsStringAsync());
        Assert.Equal("test-user", fake.Subject); Assert.Equal("test-security-stamp", fake.Stamp); Assert.Equal(1, fake.Calls);
        Assert.Contains("no-store", response.Headers.CacheControl!.ToString());
        Assert.Contains(response.Headers.GetValues("Set-Cookie"), x => x.StartsWith("__Host-sayman_admin_refresh=;", StringComparison.Ordinal));
        Assert.DoesNotContain(response.Headers.GetValues("Set-Cookie"), x => x.StartsWith("__Host-sayman_refresh=;", StringComparison.Ordinal));
    }

    private static ChangeStaffPasswordInput Input() => new("current", "New-password-47!", "123456");
    private static Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactory<Program> Host(FakePassword fake) =>
        new ApiFactory().WithWebHostBuilder(builder => builder.ConfigureTestServices(services => services.AddSingleton<IStaffPassword>(fake)));
    public sealed class FakePassword : IStaffPassword
    {
        public int Calls; public string? Subject; public string? Stamp;
        public Task ChangeAsync(string userId, string stamp, string family, ChangeStaffPasswordInput input, string traceId, CancellationToken ct)
        { Calls++; Subject = userId; Stamp = stamp; return Task.CompletedTask; }
    }
}
