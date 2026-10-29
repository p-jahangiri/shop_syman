using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Identity;
using Shop.Modules.Sales;
using Xunit;
namespace Shop.SqlTests;
public sealed class WishlistSqlTests(OrderFixture fixture):IClassFixture<OrderFixture>
{
    private static async Task<JsonNode> Wire(HttpResponseMessage response)
    {
        using(response){Assert.Equal(HttpStatusCode.OK,response.StatusCode);var raw=await response.Content.ReadAsStringAsync();Assert.Contains("no-store",response.Headers.CacheControl!.ToString());Assert.Contains("noindex",response.Headers.GetValues("X-Robots-Tag").Single());if(Environment.GetEnvironmentVariable("SHOP_WISHLIST_WIRE_DIR")is{Length:>0}dir){Directory.CreateDirectory(dir);var id=Guid.NewGuid().ToString("N");var request=response.RequestMessage!;var body=request.Options.TryGetValue(new HttpRequestOptionsKey<string>("WishlistBody"),out var posted)?JsonNode.Parse(posted):null;await File.WriteAllTextAsync(Path.Combine(dir,id+".json"),raw);await File.WriteAllTextAsync(Path.Combine(dir,id+".meta.json"),JsonSerializer.Serialize(new{actualSqlHttpResponse=true,syntheticQaOnly=true,status=200,method=request.Method.Method,path=request.RequestUri!.PathAndQuery,requestBody=body}));}return JsonNode.Parse(raw)!;}
    }
    private static async Task<JsonNode> Read(HttpClient c)=>await Wire(await c.GetAsync("/api/wishlist"));
    private static string? Version(JsonNode d)=>d["version"]?.GetValue<string>();
    private static string[] Ids(JsonNode d)=>d["productIds"]!.AsArray().Select(x=>x!.GetValue<string>()).ToArray();
    private static async Task<JsonNode> Save(HttpClient c,string[] ids,string? version){var raw=JsonSerializer.Serialize(new WishlistInput(ids,version),new JsonSerializerOptions(JsonSerializerDefaults.Web));var request=new HttpRequestMessage(HttpMethod.Put,"/api/wishlist"){Content=new StringContent(raw,System.Text.Encoding.UTF8,"application/json")};request.Options.Set(new HttpRequestOptionsKey<string>("WishlistBody"),raw);return await Wire(await c.SendAsync(request));}
    private async Task<string[]> Products(int count=2)
    {
        await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();var cat=await db.Categories.Where(x=>x.IsActive).Select(x=>x.Id).FirstAsync();var brand=await db.Brands.Where(x=>x.IsActive).Select(x=>x.Id).FirstAsync();var rows=Enumerable.Range(0,count).Select(_=>new Product{Slug="wish-"+Guid.NewGuid().ToString("N"),CategoryId=cat,BrandId=brand,Status="Published",Variants=[new(){Sku="WISH-"+Guid.NewGuid().ToString("N"),IsActive=true,PriceRial=1}]}).ToArray();db.Products.AddRange(rows);await db.SaveChangesAsync();return rows.Select(x=>x.Id).Order(StringComparer.Ordinal).ToArray();
    }
    [Fact]public async Task PrivateRoutesRejectGuestOriginOwnerQueryAndExtraInputFields()
    {
        using var guest=fixture.Sql.Factory.CreateClient();using var unauthorized=await guest.GetAsync("/api/wishlist");Assert.Equal(HttpStatusCode.Unauthorized,unauthorized.StatusCode);Assert.Contains("no-store",unauthorized.Headers.CacheControl!.ToString());Assert.Contains("noindex",unauthorized.Headers.GetValues("X-Robots-Tag").Single());
        var person=await fixture.Customer();using var c=person.Client;var empty=await Read(c);Assert.True(empty.AsObject().ContainsKey("version"));Assert.Null(empty["version"]);Assert.Empty(Ids(empty));Assert.Equal(person.Owner.ToUpperInvariant(),empty["ownerId"]!.GetValue<string>());
        using var query=await c.GetAsync("/api/wishlist?ownerId=other");Assert.Equal(HttpStatusCode.BadRequest,query.StatusCode);using var extra=await c.PutAsJsonAsync("/api/wishlist",new{productIds=Array.Empty<string>(),version=(string?)null,ownerId="forged"});Assert.Equal(HttpStatusCode.BadRequest,extra.StatusCode);
        c.DefaultRequestHeaders.Remove("Origin");using var noOrigin=await c.PutAsJsonAsync("/api/wishlist",new WishlistInput([],null));Assert.Equal(HttpStatusCode.Forbidden,noOrigin.StatusCode);
    }
    [Fact]public async Task SavedSelectionsAreOwnerScopedAndNoOpReplayPreservesVersionAddedAtAndAudit()
    {
        var a=await fixture.Customer();var b=await fixture.Customer();using var ca=a.Client;using var cb=b.Client;var ids=await Products();var saved=await Save(ca,[ids[0]],null);Assert.Single(Ids(saved));Assert.Empty(Ids(await Read(cb)));var other=await Save(cb,[ids[1]],null);Assert.Equal(new[]{ids[1]},Ids(other));
        DateTimeOffset added;long revision;int audit;
        await using(var scope=fixture.Sql.Factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<SalesDbContext>();added=(await db.WishlistItems.SingleAsync(x=>x.OwnerId==a.Owner)).AddedAt;revision=(await db.WishlistHeads.SingleAsync(x=>x.OwnerId==a.Owner)).Revision;audit=await scope.ServiceProvider.GetRequiredService<IdentityDbContext>().Audit.CountAsync(x=>x.ActorId==a.Owner&&x.Action=="WISHLIST_REPLACE");}
        var replay=await Save(ca,[ids[0]],null);Assert.Equal(Version(saved),Version(replay));Assert.Equal(Ids(saved),Ids(await Read(ca)));
        await using var verify=fixture.Sql.Factory.Services.CreateAsyncScope();Assert.Equal(added,(await verify.ServiceProvider.GetRequiredService<SalesDbContext>().WishlistItems.SingleAsync(x=>x.OwnerId==a.Owner)).AddedAt);Assert.Equal(revision,(await verify.ServiceProvider.GetRequiredService<SalesDbContext>().WishlistHeads.SingleAsync(x=>x.OwnerId==a.Owner)).Revision);Assert.Equal(audit,await verify.ServiceProvider.GetRequiredService<IdentityDbContext>().Audit.CountAsync(x=>x.ActorId==a.Owner&&x.Action=="WISHLIST_REPLACE"));
    }
    [Fact]public async Task ConcurrentFirstWritesHaveOneWinnerAndStaleReplacementCannotLoseAnotherDevicesSelection()
    {
        var person=await fixture.Customer();using var c=person.Client;var ids=await Products();var responses=await Task.WhenAll(ids.Select(id=>c.PutAsJsonAsync("/api/wishlist",new WishlistInput([id],null))));Assert.Single(responses,x=>x.StatusCode==HttpStatusCode.OK);Assert.Single(responses,x=>x.StatusCode==HttpStatusCode.Conflict);foreach(var x in responses)x.Dispose();var current=await Read(c);Assert.Single(Ids(current));var saved=await Save(c,ids,Version(current));using var stale=await c.PutAsJsonAsync("/api/wishlist",new WishlistInput([],Version(current)));Assert.Equal(HttpStatusCode.Conflict,stale.StatusCode);Assert.Equal(ids,Ids(await Read(c)));Assert.NotEqual(Version(current),Version(saved));
    }
    [Fact]public async Task RemovedPublicationIsRetainedAndCanBeRemovedButNeverNewlyAdded()
    {
        var person=await fixture.Customer();using var c=person.Client;var ids=await Products();var saved=await Save(c,[ids[0]],null);
        await using(var scope=fixture.Sql.Factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();var product=await db.Products.SingleAsync(x=>x.Id==ids[0]);product.Status="Hidden";await db.SaveChangesAsync();}
        Assert.Equal(new[]{ids[0]},Ids(await Read(c)));saved=await Save(c,ids,Version(saved));saved=await Save(c,[ids[1]],Version(saved));using var hidden=await c.PutAsJsonAsync("/api/wishlist",new WishlistInput(ids,Version(saved)));Assert.Equal(HttpStatusCode.BadRequest,hidden.StatusCode);Assert.Contains("wishlist_product_unavailable",await hidden.Content.ReadAsStringAsync());Assert.Equal(new[]{ids[1]},Ids(await Read(c)));
    }
    [Fact]public async Task CapacityIsTwoHundredProductsAndClearPreservesTheVersionedHead()
    {
        var person=await fixture.Customer();using var c=person.Client;var ids=await Products(200);var saved=await Save(c,ids,null);Assert.Equal(200,Ids(saved).Length);using var oversized=await c.PutAsJsonAsync("/api/wishlist",new WishlistInput([..ids,"another"],Version(saved)));Assert.Equal(HttpStatusCode.BadRequest,oversized.StatusCode);saved=await Save(c,[],Version(saved));Assert.Empty(Ids(saved));Assert.NotNull(Version(saved));using var invalid=await c.PutAsJsonAsync("/api/wishlist",new WishlistInput(["unknown-product"],Version(saved)));Assert.Equal(HttpStatusCode.BadRequest,invalid.StatusCode);Assert.Equal(Version(saved),Version(await Read(c)));
    }
    [Fact]public async Task AuditFailureRollsBackWishlistHeadAndItemsInTheSameRootTransaction()
    {
        var person=await fixture.Customer();person.Client.Dispose();var ids=await Products();await using(var scope=fixture.Sql.Factory.Services.CreateAsyncScope()){var identity=scope.ServiceProvider.GetRequiredService<IdentityDbContext>();identity.Audit.Add(new AuditEvent{ActorId=new string('x',10000),Action="INVALID_SYNTHETIC_AUDIT_ROW",Resource="/qa",TraceId="qa"});var coordinator=scope.ServiceProvider.GetRequiredService<WishlistCoordinator>();await Assert.ThrowsAsync<DbUpdateException>(()=>coordinator.WriteAsync(person.Owner,new([ids[0]],null),"qa-rollback",CancellationToken.None));}
        await using var verify=fixture.Sql.Factory.Services.CreateAsyncScope();var db=verify.ServiceProvider.GetRequiredService<SalesDbContext>();Assert.False(await db.WishlistHeads.AnyAsync(x=>x.OwnerId==person.Owner));Assert.False(await db.WishlistItems.AnyAsync(x=>x.OwnerId==person.Owner));
    }
}
