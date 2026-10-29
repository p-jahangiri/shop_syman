using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Market;
using Shop.SharedKernel;
using System.Text.Json;
using Xunit;

namespace Shop.SqlTests;

public sealed class DevelopmentPhoneSeedSqlTests(SqlFixture fixture):IClassFixture<SqlFixture>
{
    [Fact]public async Task ReviewedPhoneSamplesHaveTypedSpecificationsNoSellableOffersAndPreserveAllExistingAdminValuesOnRepeat()
    {
        var environment=fixture.Factory.Services.GetRequiredService<IHostEnvironment>();
        string listingId,configurationId,modelId;byte[] listingVersion,configurationVersion,categoryVersion;
        string originalAxisRules,ramOptions;
        await using(var scope=fixture.Factory.Services.CreateAsyncScope()){
            var catalog=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();var ram=await catalog.AttributeDefinitions.Include(row=>row.Translations).SingleAsync(row=>row.Key=="ram");
            ram.Translations.Single(row=>row.Locale=="fa").Name="حافظهٔ رم با عنوان مدیر";ram.Translations.Single(row=>row.Locale=="fa").Unit="واحد فارسی مدیر";ram.Translations.Single(row=>row.Locale=="en").Unit="Admin locale unit";await catalog.SaveChangesAsync();
            originalAxisRules=JsonSerializer.Serialize((await catalog.Categories.Include(row=>row.Attributes).SingleAsync(row=>row.Id=="phones")).Attributes.Where(row=>row.AttributeId is"ram"or"storage").OrderBy(row=>row.AttributeId).ToArray());
        }
        await using(var scope=fixture.Factory.Services.CreateAsyncScope()){
            var result=await DevelopmentPhoneDiscoverySeed.RunAsync(scope.ServiceProvider,environment,environment.ContentRootPath,default);
            Assert.Equal(8,result.Created);Assert.Equal(0,result.Preserved);Assert.Equal(67,result.ConfigurationsCreated);Assert.Equal(14,result.DefinitionsCreated);Assert.Equal(2,result.RamOptionsAdded);Assert.True(result.IsDemo);Assert.Equal(DevelopmentPhoneDiscoverySeed.DatasetSha256,result.DatasetSha256);
        }
        await using(var scope=fixture.Factory.Services.CreateAsyncScope()){
            var market=scope.ServiceProvider.GetRequiredService<MarketDbContext>();var catalog=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();
            Assert.StartsWith("SaymanTest_",market.Database.GetDbConnection().Database);
            var listings=await market.Listings.Where(row=>row.SourceKey==DevelopmentPhoneDiscoverySeed.SourceKey).OrderBy(row=>row.Id).ToArrayAsync();Assert.Equal(8,listings.Length);
            Assert.All(listings,row=>{Assert.True(row.IsDemo);Assert.Null(row.ReferencePriceRial);Assert.Null(row.SourceUrl);Assert.Equal("unknown",row.Availability);});
            var modelIds=listings.Select(row=>row.ModelId).ToArray();var products=await catalog.Products.Include(row=>row.Variants).Include(row=>row.Attributes).Where(row=>modelIds.Contains(row.Id)).ToArrayAsync();Assert.Equal(8,products.Length);Assert.All(products,row=>{Assert.Equal("Draft",row.Status);Assert.Empty(row.Variants);Assert.DoesNotContain(row.Attributes,value=>value.AttributeId is"ram"or"storage");});
            var definitions=await catalog.AttributeDefinitions.Where(row=>row.Key.StartsWith("phone-")).ToDictionaryAsync(row=>row.Key);
            Assert.Equal(AttributeDataType.Number,definitions["phone-screen-size"].DataType);Assert.Equal("mAh",definitions["phone-battery-capacity"].Unit);Assert.Equal(AttributeDataType.Text,definitions["phone-chipset"].DataType);
            var configurationRows=await market.PhoneConfigurations.Where(row=>listings.Select(item=>item.Id).Contains(row.ListingId)).ToArrayAsync();Assert.Equal(67,configurationRows.Length);Assert.All(configurationRows,row=>{Assert.Null(row.LinkedVariantId);Assert.True(row.Enabled);});
            var ram=await catalog.AttributeDefinitions.Include(row=>row.Options).Include(row=>row.Translations).SingleAsync(row=>row.Key=="ram");Assert.Equal("حافظهٔ رم با عنوان مدیر",ram.Translations.Single(row=>row.Locale=="fa").Name);Assert.Equal("واحد فارسی مدیر",ram.Translations.Single(row=>row.Locale=="fa").Unit);Assert.Equal("Admin locale unit",ram.Translations.Single(row=>row.Locale=="en").Unit);
            ramOptions=JsonSerializer.Serialize(ram.Options.OrderBy(row=>row.Id).ToArray());
            foreach(var wanted in new[]{(Slug:"samsung-galaxy-a16-4g",Ram:4),(Slug:"samsung-galaxy-a26-5g",Ram:6)}){
                var product=products.Single(row=>row.Slug==wanted.Slug);var phone=listings.Single(row=>row.ModelId==product.Id);Assert.Contains(configurationRows,row=>row.ListingId==phone.Id&&row.RamGb==wanted.Ram);
                var option=Assert.Single(ram.Options,row=>PhoneDiscoveryRules.MemoryGb(new(ram.Id,"ram","select","","",ram.Unit,null,null,null,null,null,null,[new(row.Id,row.LabelFa,row.LabelEn)]))==wanted.Ram);
                CatalogRules.AttributeValue(ram,new(ram.Id,OptionId:option.Id));
            }
            // Simulate later admin choices without calling the importer to edit them.
            var listing=listings[0];listing.Status="Hidden";listing.SourceNameFa="عنوان خصوصی تنظیم‌شدهٔ مدیر";listingId=listing.Id;modelId=listing.ModelId;
            var configuration=configurationRows.First(row=>row.ListingId==listingId);configuration.Enabled=false;configuration.ColorNameFa="رنگ تنظیم‌شدهٔ مدیر";configurationId=configuration.Id;
            await market.SaveChangesAsync();listingVersion=listing.Version.ToArray();configurationVersion=configuration.Version.ToArray();
            var category=await catalog.Categories.SingleAsync(row=>row.Id=="phones");category.SortOrder=37;await catalog.SaveChangesAsync();categoryVersion=category.Version.ToArray();
            Assert.Equal(originalAxisRules,JsonSerializer.Serialize((await catalog.Categories.Include(row=>row.Attributes).SingleAsync(row=>row.Id=="phones")).Attributes.Where(row=>row.AttributeId is"ram"or"storage").OrderBy(row=>row.AttributeId).ToArray()));
        }
        await using(var scope=fixture.Factory.Services.CreateAsyncScope()){
            var result=await DevelopmentPhoneDiscoverySeed.RunAsync(scope.ServiceProvider,environment,environment.ContentRootPath,default);
            Assert.Equal(0,result.Created);Assert.Equal(8,result.Preserved);Assert.Equal(0,result.ConfigurationsCreated);Assert.Equal(0,result.DefinitionsCreated);Assert.Equal(0,result.CategoryAttributesAdded);Assert.Equal(0,result.RamOptionsAdded);
        }
        await using(var scope=fixture.Factory.Services.CreateAsyncScope()){
            var market=scope.ServiceProvider.GetRequiredService<MarketDbContext>();var catalog=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();
            var listing=await market.Listings.AsNoTracking().SingleAsync(row=>row.Id==listingId);Assert.Equal("Hidden",listing.Status);Assert.Equal("عنوان خصوصی تنظیم‌شدهٔ مدیر",listing.SourceNameFa);Assert.Equal(modelId,listing.ModelId);Assert.Equal(listingVersion,listing.Version);
            var configuration=await market.PhoneConfigurations.AsNoTracking().SingleAsync(row=>row.Id==configurationId);Assert.False(configuration.Enabled);Assert.Equal("رنگ تنظیم‌شدهٔ مدیر",configuration.ColorNameFa);Assert.Equal(configurationVersion,configuration.Version);
            var category=await catalog.Categories.AsNoTracking().SingleAsync(row=>row.Id=="phones");Assert.Equal(37,category.SortOrder);Assert.Equal(categoryVersion,category.Version);
            Assert.Equal(ramOptions,JsonSerializer.Serialize((await catalog.AttributeDefinitions.AsNoTracking().Include(row=>row.Options).SingleAsync(row=>row.Key=="ram")).Options.OrderBy(row=>row.Id).ToArray()));
            var page=await scope.ServiceProvider.GetRequiredService<PhoneDiscoveryService>().PageAsync("fa",new(),default);Assert.Equal(7,page.Total);Assert.All(page.Items,item=>{Assert.True(item.IsDemo);Assert.All(item.Configurations,choice=>{Assert.False(choice.AvailableInStore);Assert.True(choice.CanNotify);Assert.True(choice.CanRequest);});});
        }
    }
}
