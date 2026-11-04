using System.Net;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Shop.Tests;

public sealed class DigitalDeliveryBoundaryTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string Order = "11111111111111111111111111111111";
    private const string Command = "22222222222222222222222222222222";
    private const string Staff = "/api/admin/orders/OWNER/" + Order + "/fulfillment/digital";

    [Fact]
    public void DigitalRoutesRequireExplicitReadWritePoliciesAndHaveNoStaffContentReveal()
    {
        using var client = factory.CreateClient();
        var endpoints = factory.Services.GetRequiredService<EndpointDataSource>().Endpoints.OfType<RouteEndpoint>()
            .Where(e => e.RoutePattern.RawText?.Contains("/fulfillment/digital", StringComparison.Ordinal) == true).ToArray();
        Assert.Equal(7, endpoints.Length);
        foreach (var endpoint in endpoints)
        {
            Assert.Null(endpoint.Metadata.GetMetadata<IAllowAnonymous>());
            var policies = endpoint.Metadata.GetOrderedMetadata<IAuthorizeData>().Select(x => x.Policy).ToArray();
            var route = endpoint.RoutePattern.RawText!;
            if (route.StartsWith("/api/admin", StringComparison.Ordinal))
            {
                Assert.Contains("staff_mfa", policies); Assert.Contains("sales.read", policies); Assert.Contains("inventory.read", policies);
                Assert.DoesNotContain("/content", route);
                if (route.Contains("/commands/", StringComparison.Ordinal))
                {
                    Assert.Contains("sales.write", policies); Assert.Contains("inventory.write", policies);
                }
                if (endpoint.Metadata.GetMetadata<HttpMethodMetadata>()!.HttpMethods.Contains("POST"))
                    Assert.Equal(524288, endpoint.Metadata.GetMetadata<IRequestSizeLimitMetadata>()!.MaxRequestBodySize);
            }
            else Assert.Contains("customer", policies);
        }
    }

    [Theory]
    [InlineData("/api/orders/" + Order + "/fulfillment/digital")]
    [InlineData("/api/orders/v2/" + Order + "/fulfillment/digital")]
    [InlineData("/api/orders/v2/" + Order + "/fulfillment/digital/" + Command + "/content")]
    [InlineData(Staff)]
    [InlineData(Staff + "/commands/" + Command)]
    public async Task AnonymousCannotReadMetadataOrContent(string path)
    {
        using var client = factory.CreateClient();
        using var response = await client.GetAsync(path);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl!.ToString());
    }

    [Theory]
    [InlineData("mfa_pending", "sales.read,inventory.read,sales.write,inventory.write")]
    [InlineData("staff_password_change", "sales.read,inventory.read,sales.write,inventory.write")]
    [InlineData("access", "sales.read,inventory.read,sales.write")]
    [InlineData("access", "sales.read,inventory.read,inventory.write")]
    [InlineData("access", "cms.write")]
    public async Task PartialStaffSessionCannotDeliverOrReadReceipt(string kind, string permissions)
    {
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-Kind", kind);
        client.DefaultRequestHeaders.Add("X-Test-Permissions", permissions);
        client.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:3173");
        using var response = await client.PostAsync(Staff + "/commands/" + Command, new StringContent("{}", System.Text.Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        using var receipt = await client.GetAsync(Staff + "/commands/" + Command);
        Assert.Equal(HttpStatusCode.Forbidden, receipt.StatusCode);
    }
}
