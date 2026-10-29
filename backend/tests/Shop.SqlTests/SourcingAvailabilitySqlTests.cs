using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Inventory;
using Shop.Modules.Market;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;
public sealed class SourcingAvailabilitySqlTests(MarketFixture fixture):IClassFixture<MarketFixture>
{
    private async Task<(string Listing,string Model,string Variant,string Term)> Create()
    {
        var term="stock"+Guid.NewGuid().ToString("N");
        var input=new CreateMarketModelInput(new("phones","samsung",term,[new("fa","گوشی نمونه "+term,"مشخصات مصنوعی QA"),new("en","Sample "+term,"Synthetic QA model")],[new("battery",TextFa:"نمونه",TextEn:"Sample")],["/products/phone-green.svg"],null),new("Published","qa-stock",term,"منبع نمونه","Sample source",null,"unknown",null,null,null,true));
        var saved=await MarketFixture.Json(await fixture.Writer.PostAsJsonAsync("/api/admin/market/models",input));var id=saved["id"]!.GetValue<string>();var detail=await MarketFixture.Json(await fixture.Writer.GetAsync("/api/admin/market/"+id));return(id,detail["modelId"]!.GetValue<string>(),Guid.NewGuid().ToString("N"),term);
    }
    private async Task PublishOffer((string Listing,string Model,string Variant,string Term) item,DateTimeOffset? publishAt=null,bool active=true)
    {
        await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();var catalog=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();var product=await catalog.Products.Include(p=>p.Variants).Include(p=>p.PurchaseMethods).SingleAsync(p=>p.Id==item.Model);
        product.Status="Published";product.PublishAt=publishAt;product.PurchaseMethods.Add(new(){ProductId=item.Model,MethodId="online"});product.Variants.Add(new(){Id=item.Variant,ProductId=item.Model,Sku="QA-"+item.Variant,PriceRial=100000,IsActive=active,LabelFa="نمونه",LabelEn="Sample"});await catalog.SaveChangesAsync();
        var inventory=scope.ServiceProvider.GetRequiredService<InventoryDbContext>();inventory.Stock.Add(new(){VariantId=item.Variant,OnHand=2});await inventory.SaveChangesAsync();
    }
    private async Task<JsonNode> Page(string term)=>await MarketFixture.Json(await fixture.Writer.PostAsJsonAsync("/api/market/en/search",new MarketSearchInput(Query:term)));
    [Fact] public async Task AnAvailablePublicOfferLeavesMarketAndReservationsMakeItEligibleForInquiryAgain()
    {
        var item=await Create();Assert.Single((await Page(item.Term))["items"]!.AsArray());await PublishOffer(item);
        Assert.Equal(HttpStatusCode.NotFound,(await fixture.Writer.GetAsync("/api/market/en/"+item.Listing)).StatusCode);Assert.Empty((await Page(item.Term))["items"]!.AsArray());
        var lookup=await MarketFixture.Json(await fixture.Writer.PostAsJsonAsync("/api/catalog/en/lookup",new{ProductIds=new[]{item.Model}}));Assert.Single(lookup["products"]!.AsArray());
        await using(var scope=fixture.Sql.Factory.Services.CreateAsyncScope()){
            var model=(await scope.ServiceProvider.GetRequiredService<ICatalogSourcingReader>().ReadAsync([item.Model],CancellationToken.None))[item.Model];Assert.True(model.HasAvailableStoreOffer);
            var db=scope.ServiceProvider.GetRequiredService<InventoryDbContext>();var stock=await db.Stock.SingleAsync(s=>s.VariantId==item.Variant);stock.Reserved=2;await db.SaveChangesAsync();
        }
        await MarketFixture.Json(await fixture.Writer.GetAsync("/api/market/en/"+item.Listing));Assert.Single((await Page(item.Term))["items"]!.AsArray());
        await using var check=fixture.Sql.Factory.Services.CreateAsyncScope();var candidate=(await check.ServiceProvider.GetRequiredService<ICatalogSourcingReader>().ReadAsync([item.Model],CancellationToken.None))[item.Model];Assert.False(candidate.HasAvailableStoreOffer);
    }
    [Fact] public async Task FuturePublicationOrAnInactiveVariantDoesNotPretendToBeAvailableStoreSupply()
    {
        var item=await Create();await PublishOffer(item,DateTimeOffset.UtcNow.AddHours(1));await MarketFixture.Json(await fixture.Writer.GetAsync("/api/market/en/"+item.Listing));Assert.Single((await Page(item.Term))["items"]!.AsArray());
        await using(var scope=fixture.Sql.Factory.Services.CreateAsyncScope()){
            var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();var product=await db.Products.SingleAsync(p=>p.Id==item.Model);product.PublishAt=DateTimeOffset.UtcNow.AddHours(-1);var variant=await db.Variants.SingleAsync(v=>v.Id==item.Variant);variant.IsActive=false;await db.SaveChangesAsync();
        }
        await MarketFixture.Json(await fixture.Writer.GetAsync("/api/market/en/"+item.Listing));Assert.Single((await Page(item.Term))["items"]!.AsArray());
        await using(var scope=fixture.Sql.Factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();var variant=await db.Variants.SingleAsync(v=>v.Id==item.Variant);variant.IsActive=true;await db.SaveChangesAsync();}
        Assert.Equal(HttpStatusCode.NotFound,(await fixture.Writer.GetAsync("/api/market/en/"+item.Listing)).StatusCode);Assert.Empty((await Page(item.Term))["items"]!.AsArray());
    }
}
