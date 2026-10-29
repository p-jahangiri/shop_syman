using System.Net;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;
public sealed class CartTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Theory] [InlineData("quantity-zero")] [InlineData("duplicate")] [InlineData("too-many")] [InlineData("invalid-variant")] [InlineData("invalid-identity")]
    public async Task InvalidCartInputFailsBeforeDatabaseAccess(string kind)
    {
        await using var db = new SalesDbContext(DesignTimeOptions.Create<SalesDbContext>("sales")); var identity = new CartIdentity("owner", null);
        CartLineInput[] lines = kind switch {
            "quantity-zero" => [new("variant", 0)], "duplicate" => [new("variant", 1), new("VARIANT", 1)],
            "too-many" => Enumerable.Range(0, 65).Select(x => new CartLineInput("v" + x, 1)).ToArray(), "invalid-variant" => [new("bad/id", 1)], _ => []
        };
        if (kind == "invalid-identity") identity = new("owner", CartService.CreateGuestToken());
        await Assert.ThrowsAsync<BusinessException>(() => new CartService(db, null!, null!, TimeProvider.System).ReplaceAsync(identity, "en", new(lines, null), CancellationToken.None));
        Assert.Equal(System.Data.ConnectionState.Closed, db.Database.GetDbConnection().State);
    }
    [Fact] public async Task EmptyGuestCartDoesNotCreateCookieOrRequireDatabase()
    {
        using var client = factory.CreateClient(); using var response = await client.GetAsync("/api/cart/en"); Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl!.ToString()); Assert.False(response.Headers.Contains("Set-Cookie"));
    }
    [Theory] [InlineData(null)] [InlineData("https://untrusted.example")]
    public async Task CartMutationsRequireAllowedOrigin(string? origin)
    {
        using var client = factory.CreateClient(); if (origin is not null) client.DefaultRequestHeaders.Add("Origin", origin);
        using var response = await client.PutAsync("/api/cart/en", new StringContent("{\"lines\":[],\"version\":null}", System.Text.Encoding.UTF8, "application/json")); Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }
    [Fact] public async Task GuestCannotMergeIntoCustomerCart()
    {
        using var client = factory.CreateClient(); client.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:3000"); using var response = await client.PostAsync("/api/cart/en/merge", null); Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
    [Fact] public async Task PendingMfaCannotReadCustomerCart()
    {
        using var client = factory.CreateClient(); client.DefaultRequestHeaders.Add("X-Test-Kind", "mfa_pending"); using var response = await client.GetAsync("/api/cart/en"); Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
    [Fact] public async Task InvalidBearerDoesNotFallBackToGuestCart()
    {
        using var client = factory.CreateClient(); client.DefaultRequestHeaders.Authorization = new("Bearer", "invalid"); using var response = await client.GetAsync("/api/cart/en"); Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
    [Theory] [InlineData("empty", 400)] [InlineData("bearer", 401)] [InlineData("mfa", 401)] [InlineData("origin", 403)]
    public async Task QuoteRejectsInvalidSessionAndOriginBeforeDatabase(string kind, int status)
    {
        await using var quoteFactory = factory.WithWebHostBuilder(b => b.UseEnvironment("Development")); using var client = quoteFactory.CreateClient(); client.DefaultRequestHeaders.Add("Origin", kind == "origin" ? "https://untrusted.example" : "http://127.0.0.1:3000");
        if (kind == "bearer") client.DefaultRequestHeaders.Authorization = new("Bearer", "invalid"); if (kind == "mfa") client.DefaultRequestHeaders.Add("X-Test-Kind", "mfa_pending");
        using var response = await client.PostAsync("/api/cart/en/quote", new StringContent("{}", System.Text.Encoding.UTF8, "application/json")); Assert.Equal(status, (int)response.StatusCode);
    }
}
