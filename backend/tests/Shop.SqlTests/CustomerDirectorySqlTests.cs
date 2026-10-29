using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using Shop.Modules.Identity;
using Shop.Modules.Sales;
using Xunit;

namespace Shop.SqlTests;

public sealed class CustomerDirectorySqlTests(OrderFixture fixture) : IClassFixture<OrderFixture>
{
    private HttpClient Scoped(params string[] permissions)
    {
        var source = new JwtSecurityTokenHandler().ReadJwtToken(fixture.Admin.DefaultRequestHeaders.Authorization!.Parameter);
        var claims = source.Claims.Where(x => x.Type is not ("permission" or "exp" or "nbf" or "iat")).ToList();
        claims.AddRange(permissions.Select(value => new Claim("permission", value)));
        var token = new JwtSecurityToken(source.Issuer, source.Audiences.Single(), claims, DateTime.UtcNow.AddSeconds(-5), DateTime.UtcNow.AddMinutes(5),
            new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(new string('q', 80))), SecurityAlgorithms.HmacSha256));
        var client = fixture.Sql.Factory.CreateClient(new() { HandleCookies = false });
        client.DefaultRequestHeaders.Authorization = new("Bearer", new JwtSecurityTokenHandler().WriteToken(token));
        client.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:3173");
        return client;
    }
    private static string Path(string owner) => "/api/admin/customers/" + owner;
    private static async Task<JsonNode> Json(HttpResponseMessage response, string? capture = null, string? kind = null, object? binding = null)
    {
        var raw = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, $"HTTP {(int)response.StatusCode}: {raw}");
        Assert.Contains("no-store", response.Headers.CacheControl!.ToString());
        await AdminBusinessWireCapture.SaveAsync(response, capture, kind, binding);
        return JsonNode.Parse(raw)!;
    }
    private async Task<JsonNode> Order(HttpClient customer)
    {
        var product = await fixture.Product();
        var before = await Json(await customer.GetAsync("/api/cart/en"));
        var cart = await Json(await customer.PutAsJsonAsync("/api/cart/en", new CartInput([new(product.Variant, 1)], before["version"]?.GetValue<string>())));
        var quote = await Json(await customer.PostAsJsonAsync("/api/cart/en/quote", new CheckoutQuoteInput(cart["version"]!.GetValue<string>(), product.Method, null, Guid.NewGuid().ToString())));
        var input = new CreateOrderInput(quote["quoteId"]!.GetValue<string>(), Guid.NewGuid().ToString(), "مشتری نمونهٔ تست", "09121234567",
            new("IR", "استان آزمون", "شهر آزمون", "نشانی ساختگی مخصوص SQL", "1234567890"), "SQL only", true);
        return await Json(await customer.PostAsJsonAsync("/api/orders", input));
    }

    [Fact]
    public async Task DirectoryComposesActualOrdersAndTicketsWithoutMixingAnotherCustomer()
    {
        await fixture.Settings(max: 2); var person = await fixture.Customer(); using var customer = person.Client;
        var other = await fixture.Customer(); using var otherCustomer = other.Client;
        var order = await Order(customer); var orderId = order["order"]!["summary"]!["id"]!.GetValue<string>();
        var ticket = await Json(await customer.PostAsJsonAsync("/api/support/tickets/commands/" + Guid.NewGuid().ToString("N"), new { Subject = "پیگیری نمونهٔ مشتری", Body = "متن تألیفی مخصوص بررسی SQL", Locale = "fa" }));
        var ticketId = ticket["ticket"]!["id"]!.GetValue<string>();
        var profile = await Json(await fixture.Admin.GetAsync(Path(person.Owner)), "customer-profile", "customer-profile", new { Id = person.Owner });
        Assert.Equal("1", profile["orders"]!["totalOrders"]!.GetValue<string>());
        Assert.Equal("0", profile["orders"]!["confirmedPurchases"]!.GetValue<string>());
        Assert.Equal("1", profile["orders"]!["awaitingPaymentOrders"]!.GetValue<string>());
        Assert.Equal("1", profile["support"]!["totalTickets"]!.GetValue<string>());
        Assert.True(profile["identity"]!["account"]!["emailVerified"]!.GetValue<bool>());
        Assert.DoesNotContain("securityStamp", profile.ToJsonString()); Assert.DoesNotContain("passwordHash", profile.ToJsonString());
        var orders = await Json(await fixture.Admin.GetAsync(Path(person.Owner) + "/orders"), "customer-orders", "customer-orders", new { Id = person.Owner });
        Assert.Equal(person.Owner, orders["items"]![0]!["ownerId"]!.GetValue<string>()); Assert.Equal(orderId, orders["items"]![0]!["id"]!.GetValue<string>());
        var detail = await Json(await fixture.Admin.GetAsync(Path(person.Owner) + "/orders/" + orderId), "customer-order-detail", "customer-order-detail", new { Id = person.Owner, OrderId = orderId }); Assert.Equal(orderId, detail["summary"]!["id"]!.GetValue<string>());
        Assert.Equal(HttpStatusCode.NotFound, (await fixture.Admin.GetAsync(Path(other.Owner) + "/orders/" + orderId)).StatusCode);
        await Json(await fixture.Admin.GetAsync(Path(person.Owner) + "/tickets"), "customer-tickets", "customer-tickets", new { Id = person.Owner });
        var messages = await Json(await fixture.Admin.GetAsync(Path(person.Owner) + "/tickets/" + ticketId + "/messages"), "customer-messages", "customer-messages", new { Id = person.Owner, TicketId = ticketId });
        Assert.Equal(person.Owner, messages["customerId"]!.GetValue<string>()); Assert.Single(messages["items"]!.AsArray()); Assert.Null(messages["nextCursor"]);
        Assert.Equal(HttpStatusCode.NotFound, (await fixture.Admin.GetAsync(Path(other.Owner) + "/tickets/" + ticketId + "/messages")).StatusCode);
        var empty = await Json(await fixture.Admin.GetAsync(Path(other.Owner)), "customer-empty", "customer-profile", new { Id = other.Owner }); Assert.Equal("0", empty["orders"]!["totalOrders"]!.GetValue<string>()); Assert.Equal("0", empty["support"]!["totalTickets"]!.GetValue<string>());
    }

    [Fact]
    public async Task ReadPermissionsHideUnavailableSectionsAndProtectEveryHistory()
    {
        var person = await fixture.Customer(); using var customer = person.Client;
        using var none = Scoped("sales.read", "support.read");
        Assert.Equal(HttpStatusCode.Forbidden, (await none.GetAsync("/api/admin/customers")).StatusCode);
        using var baseOnly = Scoped("customers.read");
        var profile = await Json(await baseOnly.GetAsync(Path(person.Owner)), "customer-base-permission", "customer-profile", new { Id = person.Owner }); Assert.Null(profile["orders"]); Assert.Null(profile["support"]);
        Assert.Equal(HttpStatusCode.Forbidden, (await baseOnly.GetAsync(Path(person.Owner) + "/orders")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await baseOnly.GetAsync(Path(person.Owner) + "/tickets")).StatusCode);
        using var sales = Scoped("customers.read", "sales.read"); var salesProfile = await Json(await sales.GetAsync(Path(person.Owner)));
        Assert.NotNull(salesProfile["orders"]); Assert.Null(salesProfile["support"]);
        Assert.Equal(HttpStatusCode.Forbidden, (await sales.GetAsync(Path(person.Owner) + "/tickets")).StatusCode);
        using var support = Scoped("customers.read", "support.read"); var supportProfile = await Json(await support.GetAsync(Path(person.Owner)));
        Assert.Null(supportProfile["orders"]); Assert.NotNull(supportProfile["support"]);
        Assert.Equal(HttpStatusCode.Forbidden, (await support.GetAsync(Path(person.Owner) + "/orders")).StatusCode);
        using var unauthorized = fixture.Sql.Factory.CreateClient(); Assert.Equal(HttpStatusCode.Unauthorized, (await unauthorized.GetAsync(Path(person.Owner))).StatusCode);
    }

    [Fact]
    public async Task BoundedDirectoryHasFilterBoundPagingAndPersianSearch()
    {
        var prefix = "crm" + Guid.NewGuid().ToString("N")[..12];
        await using (var scope = fixture.Sql.Factory.Services.CreateAsyncScope()) {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>();
            for (var i = 0; i < 51; i++) Assert.True((await users.CreateAsync(new ShopUser { UserName = prefix + i.ToString("D3"), DisplayName = i == 12 ? "کارمَند ۱۲ " + prefix : "مشتری " + prefix, Email = null })).Succeeded);
        }
        var first = await Json(await fixture.Admin.GetAsync("/api/admin/customers?kind=customer&query=" + prefix), "customer-page", "customer-page", new { Query = prefix, Active = "all", Kind = "customer" });
        Assert.Equal(50, first["items"]!.AsArray().Count);
        var cursor = first["nextCursor"]!.GetValue<string>();
        var next = await Json(await fixture.Admin.GetAsync("/api/admin/customers?kind=customer&query=" + prefix + "&cursor=" + Uri.EscapeDataString(cursor)), "customer-next", "customer-page", new { Query = prefix, Active = "all", Kind = "customer" });
        Assert.Single(next["items"]!.AsArray()); Assert.Null(next["nextCursor"]);
        var ids = first["items"]!.AsArray().Concat(next["items"]!.AsArray()).Select(x => x!["account"]!["id"]!.GetValue<string>()).ToArray(); Assert.Equal(51, ids.Distinct().Count());
        Assert.Equal(HttpStatusCode.BadRequest, (await fixture.Admin.GetAsync("/api/admin/customers?kind=staff&query=" + prefix + "&cursor=" + Uri.EscapeDataString(cursor))).StatusCode);
        var search = await Json(await fixture.Admin.GetAsync("/api/admin/customers?query=" + Uri.EscapeDataString("كارمند 12 " + prefix)));
        Assert.Single(search["items"]!.AsArray()); Assert.DoesNotContain("email", first["items"]![0]!["account"]!.AsObject().Select(x => x.Key));
        Assert.Equal(HttpStatusCode.BadRequest, (await fixture.Admin.GetAsync("/api/admin/customers?query=a&query=b")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await fixture.Admin.GetAsync("/api/admin/customers?owner=another")).StatusCode);
    }
}
