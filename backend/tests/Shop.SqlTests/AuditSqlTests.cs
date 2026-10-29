using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.IdentityModel.Tokens.Jwt;
using System.Text.Json.Nodes;
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
    private async Task<(HttpClient Client,string Actor)> SignIn()
    {
        var account=await fixture.CreateAdministratorAsync();var client=fixture.Factory.CreateClient(new(){HandleCookies=false});client.DefaultRequestHeaders.Add("Origin","http://127.0.0.1:3173");client.DefaultRequestHeaders.Add("X-Sayman-Client","admin");client.DefaultRequestHeaders.Add("X-Sayman-Admin","1");
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
}
