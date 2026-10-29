using System.Net;
using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Xunit;

namespace Shop.Tests;
public sealed class ApiFactory : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        // Program captures browser origins before late test app-configuration
        // callbacks. Supply these as host settings as well as runtime options.
        builder.UseSetting("Cors:Origins:0", "http://127.0.0.1:3000");
        builder.UseSetting("Cors:Origins:1", "http://127.0.0.1:3173");
        builder.UseSetting("Cors:AdminOrigins:0", "http://127.0.0.1:3173");
        builder.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?> { ["Cors:Origins:0"] = "http://127.0.0.1:3000", ["Cors:Origins:1"] = "http://127.0.0.1:3173", ["Cors:AdminOrigins:0"] = "http://127.0.0.1:3173", ["Sales:ExpiryEnabled"] = "false", ["Inventory:ExpiryEnabled"]="false",["Files:Storage"] = "Disabled", ["Files:ClamAvHost"] = "", ["Media:Storage"] = "Disabled", ["Media:CleanupEnabled"] = "false", ["Media:ClamAvHost"] = "", ["ConnectionStrings:Shop"] = "Server=127.0.0.1,1;Database=unused;User Id=unused;Password=unused;Connect Timeout=1", ["Auth:SigningKey"] = new string('t', 80) }));
        builder.ConfigureTestServices(s => {
            s.AddAuthentication(o => { o.DefaultAuthenticateScheme = "Test"; o.DefaultChallengeScheme = "Test"; o.DefaultForbidScheme = "Test"; }).AddScheme<AuthenticationSchemeOptions, TestAuthentication>("Test", _ => { });
        });
    }
}
public sealed class TestAuthentication(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Headers.TryGetValue("X-Test-Kind", out var kind)) return Task.FromResult(AuthenticateResult.NoResult());
        var claims = new List<Claim> { new("sub", "test-user"), new("token_kind", kind.ToString()) };
        claims.Add(new("sst", "test-security-stamp"));
        claims.AddRange(Request.Headers["X-Test-Roles"].ToString().Split(',', StringSplitOptions.RemoveEmptyEntries).Select(r => new Claim("role", r)));
        claims.AddRange(Request.Headers["X-Test-Permissions"].ToString().Split(',', StringSplitOptions.RemoveEmptyEntries).Select(p => new Claim("permission", p)));
        return Task.FromResult(AuthenticateResult.Success(new(new ClaimsPrincipal(new ClaimsIdentity(claims, "Test", "name", "role")), "Test")));
    }
}
public sealed class AuthorizationTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Theory][InlineData("/api/admin/catalog")][InlineData("/api/admin/inventory")][InlineData("/api/admin/content")][InlineData("/api/admin/purchase-methods")][InlineData("/api/admin/cheque-plans")][InlineData("/api/admin/audit")][InlineData("/api/admin/checkout-charges")]
    public async Task AnonymousCannotReadAdminData(string path) { using var client = factory.CreateClient(); Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(path)).StatusCode); }
    [Theory][InlineData("mfa_pending", "catalog.write")][InlineData("access", "cms.write")][InlineData("access", "")]
    public async Task MissingPermissionOrPendingMfaCannotMutateProducts(string kind, string permissions)
    {
        using var client = factory.CreateClient(); client.DefaultRequestHeaders.Add("X-Test-Kind", kind); client.DefaultRequestHeaders.Add("X-Test-Permissions", permissions);
        using var response = await client.PostAsync("/api/admin/products", new StringContent("{}", System.Text.Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }
    [Theory][InlineData("mfa_pending", "finance.write")][InlineData("access", "cms.write")][InlineData("access", "finance.read")]
    public async Task CheckoutPolicyRequiresCompleteFinanceWriteSession(string kind, string permissions)
    {
        using var client = factory.CreateClient(); client.DefaultRequestHeaders.Add("X-Test-Kind", kind); client.DefaultRequestHeaders.Add("X-Test-Permissions", permissions);
        using var response = await client.PutAsync("/api/admin/checkout-charges", new StringContent("{}", System.Text.Encoding.UTF8, "application/json")); Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }
    [Fact] public async Task PendingMfaCannotReadCustomerProfile() { using var client = factory.CreateClient(); client.DefaultRequestHeaders.Add("X-Test-Kind", "mfa_pending"); Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/auth/me")).StatusCode); }
    [Fact] public async Task AuthenticatedProfileExposesOnlyOwnClaims() { using var client = factory.CreateClient(); client.DefaultRequestHeaders.Add("X-Test-Kind", "access"); var response = await client.GetAsync("/api/auth/me"); Assert.Equal(HttpStatusCode.OK, response.StatusCode); Assert.Contains("test-user", await response.Content.ReadAsStringAsync()); }
    [Fact] public async Task OtpWithoutProviderFailsClosed() { using var client = factory.CreateClient(); client.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:3000"); var response = await client.PostAsync("/api/auth/otp", new StringContent("{}", System.Text.Encoding.UTF8, "application/json")); Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode); }
    [Fact] public async Task NullRequiredInputReturnsValidationErrorBeforeDatabaseAccess() { using var client = factory.CreateClient(); var response = await client.PostAsync("/api/auth/password", new StringContent("{\"identifier\":null,\"password\":\"test\"}", System.Text.Encoding.UTF8, "application/json")); Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode); }
    [Fact] public async Task StorefrontOriginCannotRefreshAdminSession() { using var client = factory.CreateClient(); client.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:3000"); client.DefaultRequestHeaders.Add("X-Sayman-Client", "admin"); var response = await client.PostAsync("/api/auth/refresh", new StringContent("{}", System.Text.Encoding.UTF8, "application/json")); Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode); }
    [Theory]
    [InlineData("/api/catalog/fa/search", "{\"pageSize\":49}")]
    [InlineData("/api/catalog/en/search", "{\"sort\":\"script\"}")]
    [InlineData("/api/catalog/fa/search", "{\"categoryId\":\"c\",\"attributes\":[{\"key\":\"ram\",\"values\":null}]}")]
    [InlineData("/api/catalog/en/lookup", "{\"productIds\":[null]}")]
    [InlineData("/api/catalog/en/lookup", "{}")]
    public async Task PublicCatalogRejectsMalformedOrUnboundedQueriesBeforeDatabaseAccess(string path,string json)
    {
        using var client=factory.CreateClient(); var response=await client.PostAsync(path,new StringContent(json,System.Text.Encoding.UTF8,"application/json"));
        Assert.Equal(HttpStatusCode.BadRequest,response.StatusCode); Assert.Contains("no-store",response.Headers.CacheControl!.ToString());
    }
}
