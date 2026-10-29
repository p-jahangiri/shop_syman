using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Inventory;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;
public sealed class InventoryAvailabilityIdentitySqlTests(SqlFixture fixture):IClassFixture<SqlFixture>
{
    [Fact]
    public async Task CanonicalUppercaseSkuIdentitySurvivesCartNormalizationAndDoesNotReserveStock()
    {
        var id=Guid.NewGuid().ToString("N").ToUpperInvariant();var normalized=id.ToLowerInvariant();
        await using(var setup=fixture.Factory.Services.CreateAsyncScope()){
            var catalog=setup.ServiceProvider.GetRequiredService<CatalogDbContext>();
            catalog.Variants.Add(new ProductVariant{Id=id,ProductId="p1",Sku="CASE-"+id,PriceRial=9007199254740993L,LabelFa="نمونهٔ case",LabelEn="Case sample"});await catalog.SaveChangesAsync();
            var inventory=setup.ServiceProvider.GetRequiredService<InventoryDbContext>();inventory.Stock.Add(new(){VariantId=id,OnHand=3});await inventory.SaveChangesAsync();
        }
        await using(var read=fixture.Factory.Services.CreateAsyncScope()){
            var availability=await read.ServiceProvider.GetRequiredService<IInventoryReader>().AvailableAsync([normalized,id],CancellationToken.None);
            Assert.Single(availability);Assert.Equal(3,availability.GetValueOrDefault(normalized));Assert.Equal(3,availability.GetValueOrDefault(id));
        }
        using var client=fixture.Factory.CreateClient(new(){HandleCookies=false});client.DefaultRequestHeaders.Add("Origin","http://127.0.0.1:3000");
        using var response=await client.PutAsJsonAsync("/api/cart/en",new{Lines=new[]{new{VariantId=normalized,Quantity=2}},Version=(string?)null});Assert.Equal(HttpStatusCode.OK,response.StatusCode);
        var body=JsonNode.Parse(await response.Content.ReadAsStringAsync())!;Assert.Equal("18014398509481986",body["subtotalRial"]!.GetValue<string>());var line=Assert.Single(body["lines"]!.AsArray())!;Assert.Equal(normalized,line["variantId"]!.GetValue<string>());Assert.Equal("9007199254740993",line["unitPriceRial"]!.GetValue<string>());Assert.Equal(3,line["available"]!.GetValue<int>());
        var cookie=response.Headers.GetValues("Set-Cookie").Single().Split(';')[0];client.DefaultRequestHeaders.Add("Cookie",cookie);
        using var replay=await client.PutAsJsonAsync("/api/cart/en",new{Lines=new[]{new{VariantId=id,Quantity=2}},Version=(string?)null});Assert.Equal(HttpStatusCode.OK,replay.StatusCode);var current=JsonNode.Parse(await replay.Content.ReadAsStringAsync())!;Assert.Equal(body["version"]!.GetValue<string>(),current["version"]!.GetValue<string>());
        await using var final=fixture.Factory.Services.CreateAsyncScope();var stock=await final.ServiceProvider.GetRequiredService<InventoryDbContext>().Stock.SingleAsync(s=>s.VariantId==id);Assert.Equal(3,stock.OnHand);Assert.Equal(0,stock.Reserved);Assert.Equal(0,stock.SourcingReserved);
    }
}
