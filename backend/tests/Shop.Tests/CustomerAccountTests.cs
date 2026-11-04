using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Shop.Modules.Identity;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class CustomerAccountTests
{
    [Fact]
    public void ProfileNormalizesTheNameAndKeepsTheOpaqueVersion()
    {
        var input = CustomerAccountRules.Validate(new UpdateCustomerProfileInput("  نام مشتری  ", "current-version"));
        Assert.Equal("نام مشتری", input.DisplayName);
        Assert.Equal("current-version", input.Version);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("نام\nمشتری")]
    [InlineData("نام\u202eمشتری")]
    [InlineData("نام\u2066مشتری")]
    public void InvalidDisplayNamesCannotReachSql(string name) =>
        Assert.Equal("invalid_profile", Assert.Throws<BusinessException>(() => CustomerAccountRules.Validate(new UpdateCustomerProfileInput(name, "version"))).Code);

    [Fact]
    public void BoundsNullAndInvalidUtf16CannotReachSql()
    {
        foreach (var input in new[] {
            new UpdateCustomerProfileInput(null!, "version"), new UpdateCustomerProfileInput("name", null!),
            new UpdateCustomerProfileInput(new string('x', 201), "version"),
            new UpdateCustomerProfileInput("name", ""), new UpdateCustomerProfileInput("name", new string('x', 129)),
            new UpdateCustomerProfileInput("name", " version"), new UpdateCustomerProfileInput("name", "version\n"),
            new UpdateCustomerProfileInput(new string((char)0xd800, 1), "version") })
            Assert.Equal("invalid_profile", Assert.Throws<BusinessException>(() => CustomerAccountRules.Validate(input)).Code);
        Assert.Equal(200, CustomerAccountRules.Validate(new UpdateCustomerProfileInput(new string('ن', 200), new string('v', 128))).DisplayName.Length);
    }

    [Fact]
    public void PasswordValidationNeverTrimsOrReturnsExpiredSessionForWrongInput()
    {
        foreach (var input in new[] { new ChangeCustomerPasswordInput("", "New-password-47!"),
            new ChangeCustomerPasswordInput(null!, "New-password-47!"),
            new ChangeCustomerPasswordInput(new string('x', 129), "New-password-47!") })
            Assert.Equal("invalid_current_password", Assert.Throws<BusinessException>(() => CustomerAccountRules.Validate(input)).Code);
        foreach (var password in new[] { "short", new string('x', 129), new string((char)0xd800, 12) })
            Assert.Equal("password_policy", Assert.Throws<BusinessException>(() => CustomerAccountRules.Validate(new ChangeCustomerPasswordInput("old", password))).Code);
        CustomerAccountRules.Validate(new ChangeCustomerPasswordInput(" old ", " New-password-47! "));
    }

    [Fact]
    public void PrivateProfileReturnsExplicitNullContactsWithoutHashesTokensRolesOrStamps()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web) { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };
        var json = JsonNode.Parse(JsonSerializer.Serialize(new CustomerAccountProfile("one", "customer", "نام", null, false, null, false,
            DateTimeOffset.Parse("2026-10-30T00:00:00Z"), true, false, "opaque-version"), options))!.AsObject();
        Assert.True(json.ContainsKey("email")); Assert.Null(json["email"]);
        Assert.True(json.ContainsKey("phoneNumber")); Assert.Null(json["phoneNumber"]);
        Assert.Equal(11, json.Count);
        foreach (var forbidden in new[] { "passwordHash", "securityStamp", "accessToken", "refreshToken", "roles", "permissions", "lockoutEnd" })
            Assert.False(json.ContainsKey(forbidden));
    }

    [Theory]
    [InlineData(null, null, 401)]
    [InlineData("mfa_pending", null, 403)]
    [InlineData("staff_password_change", null, 403)]
    [InlineData("access", "Administrator", 403)]
    [InlineData("access", "SupportAgent", 403)]
    public async Task AccountRoutesRejectAnonymousIncompleteAndStaffBeforeSql(string? kind, string? role, int expected)
    {
        using var factory = new ApiFactory();
        using var client = factory.CreateClient();
        if (kind is not null) client.DefaultRequestHeaders.Add("X-Test-Kind", kind);
        if (role is not null) client.DefaultRequestHeaders.Add("X-Test-Roles", role);
        using var response = await client.GetAsync("/api/account/profile");
        Assert.Equal(expected, (int)response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl!.ToString());
    }

    [Theory]
    [InlineData("{\"displayName\":\"name\",\"version\":\"v\",\"id\":\"other\"}")]
    [InlineData("{\"displayName\":\"name\",\"version\":\"v\",\"email\":\"other@example.invalid\"}")]
    [InlineData("{\"displayName\":\"one\",\"displayName\":\"two\",\"version\":\"v\"}")]
    [InlineData("{\"DisplayName\":\"name\",\"version\":\"v\"}")]
    [InlineData("{\"displayName\":\"name\"}")]
    [InlineData("[]")]
    public async Task UnknownDuplicateAndMissingProfileFieldsAreRejectedBeforeSql(string json)
    {
        using var factory = new ApiFactory(); using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-Kind", "access");
        client.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:3000");
        using var response = await client.PutAsync("/api/account/profile", new StringContent(json, Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl!.ToString());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("https://attacker.example.invalid")]
    public async Task MutationRequiresTheExactBrowserOriginBeforeSql(string? origin)
    {
        using var factory = new ApiFactory(); using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-Kind", "access");
        if (origin is not null) client.DefaultRequestHeaders.Add("Origin", origin);
        using var response = await client.PostAsJsonAsync("/api/account/password", new { currentPassword = "old", newPassword = "New-password-47!" });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task OwnerQueriesOversizedAndNonJsonRequestsAreRejectedBeforeSql()
    {
        using var factory = new ApiFactory(); using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-Kind", "access");
        client.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:3000");
        using var owner = await client.GetAsync("/api/account/profile?ownerId=other");
        Assert.Equal(HttpStatusCode.BadRequest, owner.StatusCode);
        using var oversized = await client.PutAsync("/api/account/profile", new StringContent(new string('x', 4097), Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, oversized.StatusCode);
        using var text = await client.PutAsync("/api/account/profile", new StringContent("{}", Encoding.UTF8, "text/plain"));
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, text.StatusCode);
    }
}
