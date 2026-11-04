using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Identity;
using Shop.Modules.Inventory;
using Xunit;

namespace Shop.SqlTests;
public sealed class AdminStockSqlTests(SqlFixture fixture) : IClassFixture<SqlFixture>
{
    [Fact] public async Task VariantSeekPagesIncludeUnstockedDraftAndInactiveVariantsWithoutFinancialGraph()
    {
        var key=Guid.NewGuid().ToString("N");var expected=Enumerable.Range(0,101).Select(i=>key+i.ToString("D3")).ToArray();
        await using(var scope=fixture.Factory.Services.CreateAsyncScope()){
            var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);
            var category=await db.Categories.Select(x=>x.Id).FirstAsync();var brand=await db.Brands.Select(x=>x.Id).FirstAsync();
            db.Products.Add(new(){Id=key,Slug="stock-"+key,CategoryId=category,BrandId=brand,Status="Draft",Translations=[new(){Locale="fa",Name="کیبورد 12 "+key},new(){Locale="en",Name="Keyboard 12 "+key}],Variants=expected.Select((id,i)=>new ProductVariant{Id=id,Sku="STOCK-"+key+"-"+i,PriceRial=long.MaxValue,WarrantyFa="must-not-read",IsActive=i<100}).ToList()});await db.SaveChangesAsync();
            var inventory=scope.ServiceProvider.GetRequiredService<InventoryDbContext>();inventory.Stock.AddRange(expected.Skip(1).Select(id=>new StockItem{VariantId=id,OnHand=10,Reserved=2}));await inventory.SaveChangesAsync();
        }
        var ids=new List<string>();var sizes=new List<int>();string? cursor=null;
        do{await using var scope=fixture.Factory.Services.CreateAsyncScope();var page=await scope.ServiceProvider.GetRequiredService<AdminStockService>().PageAsync(AdminStockQuery.Create(key),cursor,CancellationToken.None);sizes.Add(page.Items.Length);ids.AddRange(page.Items.Select(x=>x.VariantId));cursor=page.NextCursor;var json=JsonSerializer.Serialize(page);Assert.DoesNotContain("PriceRial",json);Assert.DoesNotContain("must-not-read",json);}while(cursor is not null);
        Assert.Equal(new[]{50,50,1},sizes);Assert.Equal(expected,ids);
        await using var final=fixture.Factory.Services.CreateAsyncScope();var service=final.ServiceProvider.GetRequiredService<AdminStockService>();var empty=await service.FindAsync(expected[0],CancellationToken.None);Assert.Null(empty.Version);Assert.Equal(0,empty.OnHand);Assert.Equal(0,empty.Reserved);var saved=await service.FindAsync(expected[1],CancellationToken.None);Assert.NotNull(saved.Version);Assert.Equal(8,saved.Available);
        var inactive=await service.PageAsync(AdminStockQuery.Create("كيبورد ۱۲ "+key,"false"),null,CancellationToken.None);var last=Assert.Single(inactive.Items);Assert.Equal(expected[100],last.VariantId);Assert.Equal("Draft",last.ProductStatus);
        Assert.Equal(100,await final.ServiceProvider.GetRequiredService<InventoryDbContext>().Stock.CountAsync(x=>expected.Contains(x.VariantId)));

        var workspace = final.ServiceProvider.GetRequiredService<IAdminStockWorkspace>();
        var low = await workspace.ReadAsync(AdminStockWorkspaceQuery.Create("كيبورد ۱۲ "+key, "all", 0, 3, "available", "asc", 0, 25), CancellationToken.None);
        Assert.Equal(1, low.Total);
        Assert.Equal(expected[0], Assert.Single(low.Items).Id);
        var ascending = await workspace.ReadAsync(AdminStockWorkspaceQuery.Create(key, "true", null, null, "available", "asc", 0, 25), CancellationToken.None);
        var next = await workspace.ReadAsync(AdminStockWorkspaceQuery.Create(key, "true", null, null, "available", "asc", 1, 25), CancellationToken.None);
        var descending = await workspace.ReadAsync(AdminStockWorkspaceQuery.Create(key, "true", null, null, "available", "desc", 0, 25), CancellationToken.None);
        Assert.Equal(100, ascending.Total);
        Assert.Equal(expected.Take(25), ascending.Items.Select(i => i.Id));
        Assert.Equal(expected.Skip(25).Take(25), next.Items.Select(i => i.Id));
        Assert.Equal(expected.Skip(1).Take(25), descending.Items.Select(i => i.Id));
    }
    private static async Task<JsonNode> Json(HttpResponseMessage result){using(result){Assert.True(result.IsSuccessStatusCode,await result.Content.ReadAsStringAsync());Assert.Contains("no-store",result.Headers.CacheControl!.ToString());return JsonNode.Parse(await result.Content.ReadAsStringAsync())!;}}
    private async Task<HttpClient> Staff(string role)
    {
        var account=await fixture.CreateAdministratorAsync();await using(var scope=fixture.Factory.Services.CreateAsyncScope()){var users=scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>();var user=(await users.FindByNameAsync(account.Username))!;Assert.True((await users.RemoveFromRoleAsync(user,"Administrator")).Succeeded);Assert.True((await users.AddToRoleAsync(user,role)).Succeeded);}
        var client=fixture.Factory.CreateClient(new(){HandleCookies=false});client.DefaultRequestHeaders.Add("Origin","http://127.0.0.1:3173");client.DefaultRequestHeaders.Add("X-Sayman-Client","admin");client.DefaultRequestHeaders.Add("X-Sayman-Admin","1");
        var pending=await Json(await client.PostAsJsonAsync("/api/auth/password",new{Identifier=account.Username,account.Password}));client.DefaultRequestHeaders.Authorization=new("Bearer",pending["accessToken"]!.GetValue<string>());Assert.Equal(HttpStatusCode.Forbidden,(await client.GetAsync("/api/admin/inventory/variants")).StatusCode);
        var setup=await Json(await client.PostAsJsonAsync("/api/auth/mfa/setup",new{}));client.DefaultRequestHeaders.Authorization=new("Bearer",setup["accessToken"]!.GetValue<string>());var signed=await Json(await client.PostAsJsonAsync("/api/auth/mfa/verify",new{Code=Totp.Code(setup["secret"]!.GetValue<string>(),DateTimeOffset.UtcNow.ToUnixTimeSeconds()/30)}));client.DefaultRequestHeaders.Authorization=new("Bearer",signed["accessToken"]!.GetValue<string>());return client;
    }
    [Fact] public async Task RealMfaRoleReadsSummaryAndOneVariantWhileContentRoleCannotReadInventory()
    {
        using var manager=await Staff("InventoryManager");var page=await Json(await manager.GetAsync("/api/admin/inventory/variants"));var row=page["items"]!.AsArray()[0]!;Assert.True(page["items"]!.AsArray().Count<=50);var one=await Json(await manager.GetAsync("/api/admin/inventory/variants/"+row["variantId"]!.GetValue<string>()));Assert.Equal(row["variantId"]!.GetValue<string>(),one["variantId"]!.GetValue<string>());
        var summary=await Json(await manager.GetAsync("/api/admin/inventory/summary"));foreach(var key in new[]{"stockRecords","availableVariants","reservedVariants"})Assert.True(long.Parse(summary[key]!.GetValue<string>(),CultureInfo.InvariantCulture)>=0);
        var catalog=await Json(await manager.GetAsync("/api/admin/catalog/summary"));Assert.True(long.Parse(catalog["products"]!.GetValue<string>(),CultureInfo.InvariantCulture)>0);Assert.Equal(HttpStatusCode.NotFound,(await manager.GetAsync("/api/admin/inventory/variants/missing-variant")).StatusCode);
        var workspace = await Json(await manager.GetAsync("/api/admin/inventory/workspace/variants?pageSize=25&sort=sku"));
        Assert.True(workspace["total"]!.GetValue<int>() > 0);
        Assert.Equal(25, workspace["pageSize"]!.GetValue<int>());
        Assert.Equal(HttpStatusCode.BadRequest, (await manager.GetAsync("/api/admin/inventory/workspace/variants?minAvailable=4&maxAvailable=2")).StatusCode);
        using var content=await Staff("ContentManager");Assert.Equal(HttpStatusCode.Forbidden,(await content.GetAsync("/api/admin/inventory/variants")).StatusCode);Assert.Equal(HttpStatusCode.Forbidden,(await content.GetAsync("/api/admin/inventory/summary")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await content.GetAsync("/api/admin/inventory/workspace/variants")).StatusCode);
    }
}
