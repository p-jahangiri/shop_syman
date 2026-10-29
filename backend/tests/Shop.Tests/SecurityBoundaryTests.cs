using System.Buffers.Binary;
using System.Net;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Shop.Modules.Identity;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class SecurityBoundaryTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact] public void ProductionCookiesAreHostBoundAndBrowserOnly()
    {
        var options = AuthHttpSecurity.Cookie(false);
        Assert.True(options.Secure); Assert.True(options.HttpOnly); Assert.Equal(SameSiteMode.Strict, options.SameSite);
        Assert.Equal("/", options.Path); Assert.Null(options.Domain); Assert.Equal(TimeSpan.FromDays(7), options.MaxAge);
        Assert.Equal("__Host-sayman_refresh", AuthHttpSecurity.CookieName(false, false));
        Assert.Equal("__Host-sayman_admin_refresh", AuthHttpSecurity.CookieName(true, false));
        Assert.Equal("/api/auth", AuthHttpSecurity.Cookie(true).Path);
    }
    [Theory]
    [InlineData("sayman_refresh=short")]
    [InlineData("sayman_admin_refresh=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")]
    [InlineData("sayman_refresh=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; sayman_refresh=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")]
    public void AmbiguousMalformedOrOtherClientCookiesCannotAuthenticate(string raw)
    {
        var http = new DefaultHttpContext(); http.Request.Headers.Cookie = raw;
        Assert.Null(AuthHttpSecurity.ReadCookie(http, true));
    }
    [Fact] public void CookieParserSelectsOnlyTheExpectedClient()
    {
        var http = new DefaultHttpContext(); var customer = new string('a', 64); var admin = new string('b', 64);
        http.Request.Headers.Cookie = $"other=private; sayman_refresh={customer}; sayman_admin_refresh={admin}";
        Assert.Equal(customer, AuthHttpSecurity.ReadCookie(http, true));
        http.Request.Headers["X-Sayman-Client"] = "admin";
        Assert.Equal(admin, AuthHttpSecurity.ReadCookie(http, true));
    }
    [Theory]
    [InlineData(null, null)] [InlineData("https://evil.test", null)]
    [InlineData("http://127.0.0.1:3000", "cross-site")]
    public void BrowserMutationRequiresExactOriginAndSafeFetchMetadata(string? origin, string? site)
    {
        var http = new DefaultHttpContext(); http.Request.Headers.Origin = origin; http.Request.Headers["Sec-Fetch-Site"] = site;
        Assert.Throws<BusinessException>(() => AuthHttpSecurity.CheckBrowserOrigin(http, ["http://127.0.0.1:3000"]));
    }
    [Theory]
    [InlineData("http://shop.example")] [InlineData("https://shop.example/path")]
    [InlineData("https://user:password@shop.example")] [InlineData("https://shop.example/")]
    [InlineData("*")] [InlineData("https://*.example")]
    public void ProductionRejectsUnsafeOrNoncanonicalOrigins(string origin) =>
        Assert.Throws<InvalidOperationException>(() => AuthHttpSecurity.ValidateProductionOrigins([origin], [origin]));
    [Fact] public void ProductionRequiresExplicitOriginsIncludingTheAdmin()
    {
        Assert.Throws<InvalidOperationException>(() => AuthHttpSecurity.ValidateProductionOrigins([], []));
        Assert.Throws<InvalidOperationException>(() => AuthHttpSecurity.ValidateProductionOrigins(["https://shop.example"], ["https://admin.example"]));
        AuthHttpSecurity.ValidateProductionOrigins(["https://shop.example", "https://admin.example"], ["https://admin.example"]);
    }
    [Fact] public void PasswordHasherUsesCurrentWorkFactorAndUpgradesOldHashes()
    {
        using var client = factory.CreateClient(); using var scope = factory.Services.CreateScope();
        var hasher = scope.ServiceProvider.GetRequiredService<IPasswordHasher<ShopUser>>();
        var user = new ShopUser(); const string password = "Synthetic!Password1234";
        var hash = hasher.HashPassword(user, password); var bytes = Convert.FromBase64String(hash);
        Assert.Equal(2u, BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(1, 4)));
        Assert.Equal(220_000u, BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(5, 4)));
        var old = new PasswordHasher<ShopUser>(Options.Create(new PasswordHasherOptions { IterationCount = 100_000 })).HashPassword(user, password);
        Assert.Equal(PasswordVerificationResult.SuccessRehashNeeded, hasher.VerifyHashedPassword(user, old, password));
    }
    [Fact] public void EveryAdminEndpointHasAnExplicitAuthorizationPolicy()
    {
        using var client = factory.CreateClient();
        var endpoints = factory.Services.GetRequiredService<EndpointDataSource>().Endpoints.OfType<RouteEndpoint>()
            .Where(e => e.RoutePattern.RawText?.StartsWith("/api/admin", StringComparison.Ordinal) == true).ToArray();
        Assert.True(endpoints.Length > 100);
        foreach (var endpoint in endpoints) {
            Assert.Null(endpoint.Metadata.GetMetadata<IAllowAnonymous>());
            Assert.Contains(endpoint.Metadata.GetOrderedMetadata<IAuthorizeData>(), policy => !string.IsNullOrWhiteSpace(policy.Policy));
        }
    }
    [Theory] [InlineData("mfa_pending")] [InlineData("staff_password_change")]
    public async Task PartialAuthenticationNeverAuthorizesPrivateCustomerReads(string kind)
    {
        using var client = factory.CreateClient(); client.DefaultRequestHeaders.Add("X-Test-Kind", kind);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/auth/me")).StatusCode);
    }
    [Fact] public async Task AuthRejectsCrossSiteEvenWithAnAllowedOrigin()
    {
        using var client = factory.CreateClient(); client.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:3000");
        client.DefaultRequestHeaders.Add("Sec-Fetch-Site", "cross-site");
        var response = await client.PostAsync("/api/auth/refresh", new StringContent("{}", System.Text.Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl!.ToString());
        Assert.Equal("DENY", response.Headers.GetValues("X-Frame-Options").Single());
    }
}
