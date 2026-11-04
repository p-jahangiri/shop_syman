using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.IdentityModel.Tokens.Jwt;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Identity;
using Shop.Modules.Inventory;
using Xunit;
using IdentityContext=Shop.Modules.Identity.IdentityDbContext;

namespace Shop.SqlTests;

public sealed class AuditSqlTests(SqlFixture fixture):IClassFixture<SqlFixture>
{
    private static async Task<JsonNode> Json(HttpResponseMessage response){var body=await response.Content.ReadAsStringAsync();Assert.True(response.IsSuccessStatusCode,$"HTTP {(int)response.StatusCode}: {body}");return JsonNode.Parse(body)!;}
    private async Task<(HttpClient Client,string Actor)> SignIn(string role = "Administrator", WebApplicationFactory<Program>? factory = null)
    {
        var account=await fixture.CreateAdministratorAsync();
        if (role != "Administrator")
        {
            await using var scope = fixture.Factory.Services.CreateAsyncScope();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>();
            var user = (await users.FindByNameAsync(account.Username))!;
            Assert.True((await users.RemoveFromRoleAsync(user, "Administrator")).Succeeded);
            Assert.True((await users.AddToRoleAsync(user, role)).Succeeded);
        }
        var client=(factory ?? fixture.Factory).CreateClient(new(){HandleCookies=false});client.DefaultRequestHeaders.Add("Origin","http://127.0.0.1:3173");client.DefaultRequestHeaders.Add("X-Sayman-Client","admin");client.DefaultRequestHeaders.Add("X-Sayman-Admin","1");
        var pending=await Json(await client.PostAsJsonAsync("/api/auth/password",new{Identifier=account.Username,account.Password}));client.DefaultRequestHeaders.Authorization=new("Bearer",pending["accessToken"]!.GetValue<string>());
        var setup=await Json(await client.PostAsJsonAsync("/api/auth/mfa/setup",new{}));client.DefaultRequestHeaders.Authorization=new("Bearer",setup["accessToken"]!.GetValue<string>());
        var signedIn=await Json(await client.PostAsJsonAsync("/api/auth/mfa/verify",new{Code=Totp.Code(setup["secret"]!.GetValue<string>(),DateTimeOffset.UtcNow.ToUnixTimeSeconds()/30)}));var token=signedIn["accessToken"]!.GetValue<string>();client.DefaultRequestHeaders.Authorization=new("Bearer",token);
        return(client,new JwtSecurityTokenHandler().ReadJwtToken(token).Subject);
    }
    [Theory][InlineData("brands")][InlineData("categories")][InlineData("inventory")]
    public async Task FailedAuditWriteRollsBackTheDomainMutation(string kind)
    {
        var session=await SignIn();using var client=session.Client;var key=Guid.NewGuid().ToString("N");var requestId=Guid.NewGuid().ToString();string? variantId=null;var balance=0;string? version=null;
        await using(var scope=fixture.Factory.Services.CreateAsyncScope()){
            var catalog=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();Assert.StartsWith("SaymanTest_",catalog.Database.GetDbConnection().Database);
            variantId=await catalog.Variants.OrderBy(v=>v.Id).Select(v=>v.Id).FirstAsync();var stock=await scope.ServiceProvider.GetRequiredService<InventoryDbContext>().Stock.AsNoTracking().SingleAsync(s=>s.VariantId==variantId);balance=stock.OnHand;version=Convert.ToBase64String(stock.Version);
            // NOCHECK retains existing audit rows while the check rejects new
            // mutation events. No trigger/OUTPUT interaction obscures the fault.
            await catalog.Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] WITH NOCHECK ADD CONSTRAINT [CK_TestAuditFailure] CHECK ([Action] = N'GET');");
        }
        try{
            HttpResponseMessage response;
            if(kind=="brands")response=await client.PostAsJsonAsync("/api/admin/brands",new{Name="Rollback brand",Slug="audit-"+key,LogoUrl="",IsActive=true,Version=(string?)null});
            else if(kind=="categories")response=await client.PostAsJsonAsync("/api/admin/categories",new{Slug="audit-"+key,ParentId=(string?)null,ImageUrl="/products/charger.svg",SortOrder=0,IsActive=true,Translations=new[]{new{Locale="fa",Name="دستهٔ آزمون",Description=""},new{Locale="en",Name="Audit test category",Description=""}},Attributes=Array.Empty<object>(),Version=(string?)null});
            else response=await client.PostAsJsonAsync($"/api/admin/inventory/{variantId}/adjust",new{Delta=1,Reason="Audit rollback test",RequestId=requestId,Version=version});
            using(response)Assert.Equal(HttpStatusCode.Conflict,response.StatusCode);
            await using var verify=fixture.Factory.Services.CreateAsyncScope();var db=verify.ServiceProvider.GetRequiredService<CatalogDbContext>();Assert.False(await db.Brands.AnyAsync(b=>b.Slug=="audit-"+key));Assert.False(await db.Categories.AnyAsync(c=>c.Slug=="audit-"+key));
            var inventory=verify.ServiceProvider.GetRequiredService<InventoryDbContext>();var unchanged=await inventory.Stock.AsNoTracking().SingleAsync(s=>s.VariantId==variantId);Assert.Equal(balance,unchanged.OnHand);Assert.Equal(version,Convert.ToBase64String(unchanged.Version));Assert.False(await inventory.Movements.AnyAsync(m=>m.RequestId==requestId));Assert.False(await verify.ServiceProvider.GetRequiredService<IdentityContext>().Audit.AnyAsync(a=>a.ActorId==session.Actor));
        }finally{
            await using var cleanup=fixture.Factory.Services.CreateAsyncScope();await cleanup.ServiceProvider.GetRequiredService<IdentityContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] DROP CONSTRAINT [CK_TestAuditFailure];");
        }
    }
    [Fact] public async Task SuccessWritesOneAuditWhileStaleVersionAndPublicReadsWriteNone()
    {
        var session=await SignIn();using var client=session.Client;var key=Guid.NewGuid().ToString("N");
        var created=await Json(await client.PostAsJsonAsync("/api/admin/brands",new{Name="Audited brand",Slug="audited-"+key,LogoUrl="",IsActive=true,Version=(string?)null}));var id=created["id"]!.GetValue<string>();
        await Json(await client.GetAsync("/api/admin/catalog"));await Json(await client.GetAsync("/api/storefront/en?metadataOnly=true"));
        using var stale=await client.PutAsJsonAsync("/api/admin/brands/"+id,new{Name="Must not save",Slug="audited-"+key,LogoUrl="",IsActive=true,Version="AAAAAAAAAAA="});Assert.Equal(HttpStatusCode.Conflict,stale.StatusCode);
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var row=Assert.Single(await scope.ServiceProvider.GetRequiredService<IdentityContext>().Audit.AsNoTracking().Where(a=>a.ActorId==session.Actor).ToListAsync());Assert.Equal("POST",row.Action);Assert.Equal("/api/admin/brands",row.Resource);Assert.False(string.IsNullOrWhiteSpace(row.TraceId));Assert.Equal("Audited brand",(await scope.ServiceProvider.GetRequiredService<CatalogDbContext>().Brands.AsNoTracking().SingleAsync(b=>b.Id==id)).Name);
    }

    [Fact]
    public async Task AuditWorkspaceFiltersAndPagesTheStoredHistoryWithoutExposingContacts()
    {
        var session = await SignIn();
        using var client = session.Client;
        using var anonymous = fixture.Factory.CreateClient();
        const string route = "/api/admin/audit/events";
        using var denied = await anonymous.GetAsync(route);
        Assert.Equal(HttpStatusCode.Unauthorized, denied.StatusCode);
        using var supportHost = fixture.Factory.WithWebHostBuilder(_ => {});
        var supportSession = await SignIn("SupportAgent", supportHost);
        using var support = supportSession.Client;
        using var forbidden = await support.GetAsync(route);
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);
        var key = Guid.NewGuid().ToString("N");
        var trace = "Request-" + key;
        var time = new DateTimeOffset(2026, 10, 25, 9, 0, 0, TimeSpan.Zero);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<IdentityContext>();
            db.Audit.AddRange(Enumerable.Range(0, 53).Select(index => new AuditEvent
            {
                ActorId = session.Actor, Action = "STAFF_ROLE_ADDED:ContentEditor",
                Resource = "/staff/" + supportSession.Actor, TraceId = trace, At = time.AddSeconds(index),
            }));
            db.Audit.Add(new AuditEvent
            {
                ActorId = session.Actor, Action = "STAFF_SESSIONS_REVOKED",
                Resource = "/staff/" + supportSession.Actor, TraceId = trace.ToLowerInvariant(), At = time,
            });
            await db.SaveChangesAsync();
        }
        var filters = $"?actor={session.Actor}&resource=/staff/{supportSession.Actor}&trace={trace}&from=2026-10-25T09:00:00Z&before=2026-10-25T09:01:00.000Z";
        using var first = await client.GetAsync(route + filters);
        Assert.Contains("no-store", first.Headers.CacheControl!.ToString());
        var firstPage = await Json(first);
        var firstItems = firstPage["items"]!.AsArray();
        Assert.Equal(50, firstItems.Count);
        var next = firstPage["nextCursor"]!.GetValue<string>();
        Assert.Equal(firstItems[^1]!["id"]!.GetValue<string>(), next);
        Assert.Equal("SQL test", firstItems[0]!["staffDisplayName"]!.GetValue<string>());
        Assert.Equal(supportSession.Actor, firstItems[0]!["staffTargetId"]!.GetValue<string>());
        Assert.Equal("SQL test", firstItems[0]!["staffTargetDisplayName"]!.GetValue<string>());
        Assert.DoesNotContain("@example.test", firstPage.ToJsonString());
        var second = await Json(await client.GetAsync(route + filters + "&cursor=" + next));
        Assert.Equal(3, second["items"]!.AsArray().Count);
        Assert.Null(second["nextCursor"]);
        Assert.All(second["items"]!.AsArray(), row => Assert.True(long.Parse(row!["id"]!.GetValue<string>()) < long.Parse(next)));
        var searched = await Json(await client.GetAsync(route + filters + "&q=SQL%20test&action=STAFF_ROLE"));
        Assert.Equal(50, searched["items"]!.AsArray().Count);
        foreach (var invalid in new[] { "?cursor=0001", "?from=2026-10-25", "?q=a&q=b", "?other=value" })
        {
            using var response = await client.GetAsync(route + invalid);
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        }
    }
}
