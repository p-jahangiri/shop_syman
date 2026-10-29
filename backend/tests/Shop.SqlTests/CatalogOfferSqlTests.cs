using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Inventory;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;

public sealed class CatalogOfferSqlTests(SqlFixture fixture):IClassFixture<SqlFixture>
{
    private sealed record Sample(string Product,string Category,string Brand,string[] Variants,string SkuPrefix,string Text,string Number,string Flag,string Select,string Multi,string Option,string MultiOne,string MultiTwo);
    private async Task<Sample> Seed(int variants=1)
    {
        string Id()=>Guid.NewGuid().ToString("N");var product=Id();var category=Id();var brand=Id();var text=Id();var number=Id();var flag=Id();var select=Id();var multi=Id();var option=Id();var multiOne=Id();var multiTwo=Id();var sku="QA-OFFER-"+Id();var variantIds=Enumerable.Range(0,variants).Select(_=>Id()).Order(StringComparer.Ordinal).ToArray();
        AttributeDefinition Definition(string id,AttributeDataType type)=>new(){Id=id,Key="qa-offer-"+id,DataType=type,Unit="unit",Translations=[new(){Locale="fa",Name="ویژگی نمونه "+type,Unit="واحد نمونه"},new(){Locale="en",Name="Sample attribute "+type,Unit="Sample unit"}]};
        var definitions=new[]{Definition(text,AttributeDataType.Text),Definition(number,AttributeDataType.Number),Definition(flag,AttributeDataType.Bool),Definition(select,AttributeDataType.Select),Definition(multi,AttributeDataType.MultiSelect)};
        definitions[3].Options.Add(new(){Id=option,Value="black",LabelFa="مشکی نمونه",LabelEn="Sample black"});
        definitions[4].Options.AddRange([new(){Id=multiOne,Value="usb",LabelFa="یو‌اس‌بی نمونه",LabelEn="Sample USB"},new(){Id=multiTwo,Value="typec",LabelFa="تایپ سی نمونه",LabelEn="Sample Type-C"}]);
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();
        db.AttributeDefinitions.AddRange(definitions);db.Categories.Add(new(){Id=category,Slug="offer-"+category,Translations=[new(){Locale="fa",Name="دسته نمونه"},new(){Locale="en",Name="Sample category"}],Attributes=definitions.Select(d=>new CategoryAttribute{AttributeId=d.Id,ShowInSpecs=true,IsComparable=true}).ToList()});
        db.Brands.Add(new(){Id=brand,Slug="offer-"+brand,Name="Sample brand"});
        db.Products.Add(new(){Id=product,CategoryId=category,BrandId=brand,Slug="offer-"+product,Status="Published",PublishAt=DateTimeOffset.UtcNow.AddMinutes(-1),SellerId="sayman",Translations=[new(){Locale="fa",Name="گوشی پیشنهاد نمونه",Description="مشخصات ساختگی QA؛ موجودی بازار نیست."},new(){Locale="en",Name="Sample offer phone",Description="Synthetic QA specifications; no assertion of market stock."}],Media=[new(){Url="/products/phone-green.svg"}],PurchaseMethods=[new(){MethodId="online"}],Attributes=[new(){AttributeId=text,ValueTextFa="متن نمونه",ValueTextEn="Sample text"},new(){AttributeId=number,ValueNumber=0},new(){AttributeId=flag,ValueBool=false},new(){AttributeId=select,ValueOptionId=option},new(){AttributeId=multi,Selections=[new(){OptionId=multiTwo},new(){OptionId=multiOne}]}],Variants=variantIds.Select((id,i)=>new ProductVariant{Id=id,Sku=sku+"-"+i.ToString("D2",CultureInfo.InvariantCulture),PriceRial=9007199254740993,LabelFa="مشکی ۱۲۸ نمونه",LabelEn="Sample black 128",Color="#000000",ColorNameFa="مشکی",ColorNameEn="Black",WarrantyFa="گارانتی نمونه QA",WarrantyEn="Synthetic QA warranty",Attributes=[new(){AttributeId=select,ValueOptionId=option}]}).ToList()});
        await db.SaveChangesAsync();return new(product,category,brand,variantIds,sku,text,number,flag,select,multi,option,multiOne,multiTwo);
    }
    private async Task<IReadOnlyDictionary<string,OfferSkuSnapshot>> Read(params string[] ids)
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();return await new CatalogOfferReader(scope.ServiceProvider.GetRequiredService<CatalogDbContext>(),TimeProvider.System).ReadAsync(ids,CancellationToken.None);
    }
    private async Task<OfferSkuPage> Lookup(string model,string? query=null,string? cursor=null)
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();return await new CatalogOfferReader(scope.ServiceProvider.GetRequiredService<CatalogDbContext>(),TimeProvider.System).LookupAsync(model,query,cursor,CancellationToken.None);
    }
    [Fact] public async Task ARealPublishedPhysicalSkuNeedsNoStockAndCarriesExactTypedBilingualTerms()
    {
        var sample=await Seed();var value=(await Read(sample.Variants))[sample.Variants[0]];
        Assert.Equal(sample.Product,value.ProductId);Assert.Equal(sample.Product,value.Model.Id);Assert.Equal("9007199254740993",value.PublicPriceRial);Assert.Equal("گوشی پیشنهاد نمونه",value.Model.NameFa);Assert.Equal("Sample offer phone",value.Model.NameEn);Assert.Equal("گارانتی نمونه QA",value.WarrantyFa);Assert.Equal("Synthetic QA warranty",value.WarrantyEn);Assert.Null(value.VariantMethodIds);Assert.Equal(new[]{"online"},value.ProductMethodIds);
        Assert.Equal(5,value.Model.Attributes.Length);var number=Assert.Single(value.Model.Attributes,a=>a.AttributeId==sample.Number);Assert.Equal(0,number.Number);Assert.Equal("واحد نمونه",number.UnitFa);Assert.Equal("Sample unit",number.UnitEn);Assert.False(Assert.Single(value.Model.Attributes,a=>a.AttributeId==sample.Flag).Bool);
        Assert.Equal("متن نمونه",Assert.Single(value.Model.Attributes,a=>a.AttributeId==sample.Text).TextFa);Assert.Equal("Sample black",Assert.Single(Assert.Single(value.Model.Attributes,a=>a.AttributeId==sample.Select).Options).LabelEn);Assert.Equal(2,Assert.Single(value.Model.Attributes,a=>a.AttributeId==sample.Multi).Options.Length);Assert.Equal("Sample black",Assert.Single(Assert.Single(value.Attributes).Options).LabelEn);
        using var json=JsonDocument.Parse(JsonSerializer.Serialize(value,new JsonSerializerOptions(JsonSerializerDefaults.Web)));Assert.Equal(JsonValueKind.String,json.RootElement.GetProperty("publicPriceRial").ValueKind);var numeric=json.RootElement.GetProperty("model").GetProperty("attributes").EnumerateArray().Single(a=>a.GetProperty("attributeId").GetString()==sample.Number).GetProperty("number");Assert.Equal(JsonValueKind.String,numeric.ValueKind);Assert.Equal(0,decimal.Parse(numeric.GetString()!,CultureInfo.InvariantCulture));
        await using var scope=fixture.Factory.Services.CreateAsyncScope();Assert.False(await scope.ServiceProvider.GetRequiredService<InventoryDbContext>().Stock.AnyAsync(s=>sample.Variants.Contains(s.VariantId)));Assert.Empty(scope.ServiceProvider.GetRequiredService<CatalogDbContext>().ChangeTracker.Entries());
    }
    [Fact] public async Task PublicPriceAndVersionChangesPreserveConsentButWarrantyAndOptionsChangeIt()
    {
        var sample=await Seed();var id=sample.Variants[0];var original=(await Read(id))[id];
        await using(var scope=fixture.Factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();var v=await db.Variants.SingleAsync(v=>v.Id==id);v.PriceRial=long.MaxValue;await db.SaveChangesAsync();}
        var repriced=(await Read(id))[id];Assert.Equal("9223372036854775807",repriced.PublicPriceRial);Assert.Equal(original.MaterialFingerprint,repriced.MaterialFingerprint);Assert.NotEqual(original.CurrentFingerprint,repriced.CurrentFingerprint);Assert.NotEqual(original.Version,repriced.Version);
        await using(var scope=fixture.Factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();var v=await db.Variants.SingleAsync(v=>v.Id==id);v.WarrantyEn="Changed synthetic QA warranty";await db.SaveChangesAsync();}
        var warranty=(await Read(id))[id];Assert.NotEqual(repriced.MaterialFingerprint,warranty.MaterialFingerprint);
        await using(var scope=fixture.Factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();var option=await db.AttributeOptions.SingleAsync(o=>o.AttributeId==sample.Select&&o.Id==sample.Option);option.LabelFa="گزینه تغییرکرده";await db.SaveChangesAsync();}
        var optionChanged=(await Read(id))[id];Assert.NotEqual(warranty.MaterialFingerprint,optionChanged.MaterialFingerprint);Assert.Equal("گزینه تغییرکرده",Assert.Single(Assert.Single(optionChanged.Attributes).Options).LabelFa);
    }
    [Fact] public async Task FutureHiddenDigitalAndInactiveParentsOrSkuAreNeverOfferCandidates()
    {
        var sample=await Seed();var id=sample.Variants[0];Assert.Single(await Read(id));
        foreach(var state in new[]{"future","draft","hidden","digital","category","brand","variant","methods"}){
            await using(var scope=fixture.Factory.Services.CreateAsyncScope()){
                var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();var p=await db.Products.Include(p=>p.PurchaseMethods).SingleAsync(p=>p.Id==sample.Product);var v=await db.Variants.SingleAsync(v=>v.Id==id);var c=await db.Categories.SingleAsync(c=>c.Id==sample.Category);var b=await db.Brands.SingleAsync(b=>b.Id==sample.Brand);
                p.Status="Published";p.PublishAt=DateTimeOffset.UtcNow.AddMinutes(-1);p.IsDigital=false;v.IsActive=true;c.IsActive=true;b.IsActive=true;if(p.PurchaseMethods.Count==0)p.PurchaseMethods.Add(new(){MethodId="online"});
                switch(state){case "future":p.PublishAt=DateTimeOffset.UtcNow.AddHours(1);break;case "draft":p.Status="Draft";break;case "hidden":p.Status="Hidden";break;case "digital":p.IsDigital=true;break;case "category":c.IsActive=false;break;case "brand":b.IsActive=false;break;case "variant":v.IsActive=false;break;case "methods":db.RemoveRange(p.PurchaseMethods);break;}
                await db.SaveChangesAsync();
            }
            Assert.Empty(await Read(id));Assert.Empty((await Lookup(sample.Product)).Items);
        }
    }
    [Fact] public async Task LookupIsTwentyRowsWithModelAndSearchBoundCursorAndNoTruncation()
    {
        var sample=await Seed(23);var other=await Seed(2);var first=await Lookup(sample.Product,sample.SkuPrefix);Assert.Equal(20,first.PageSize);Assert.Equal(20,first.Items.Length);Assert.NotNull(first.NextCursor);Assert.True(first.NextCursor.Length<=200);Assert.All(first.Items,v=>Assert.Equal(sample.Product,v.ProductId));
        var next=await Lookup(sample.Product,sample.SkuPrefix,first.NextCursor);Assert.Equal(3,next.Items.Length);Assert.Null(next.NextCursor);Assert.Equal(23,first.Items.Concat(next.Items).Select(v=>v.VariantId).Distinct().Count());
        Assert.Equal("invalid_offer_cursor",(await Assert.ThrowsAsync<BusinessException>(()=>Lookup(other.Product,sample.SkuPrefix,first.NextCursor))).Code);Assert.Equal("invalid_offer_cursor",(await Assert.ThrowsAsync<BusinessException>(()=>Lookup(sample.Product,"different",first.NextCursor))).Code);
        var exact=await Lookup(sample.Product,sample.SkuPrefix+"-12");Assert.Single(exact.Items);Assert.Equal(sample.Variants[12],exact.Items[0].VariantId);
        var selected=await Read(sample.Variants);Assert.Equal(23,selected.Count);Assert.All(selected.Values,v=>Assert.Equal(sample.Product,v.Model.Id));
    }
    [Fact] public async Task EmptyWarrantyIsHonestAndVariantMethodsRetainInheritanceOrAnActualSubset()
    {
        var sample=await Seed(2);await using(var scope=fixture.Factory.Services.CreateAsyncScope()){
            var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();var rows=await db.Variants.Where(v=>sample.Variants.Contains(v.Id)).OrderBy(v=>v.Id).ToArrayAsync();rows[0].WarrantyFa="";rows[0].WarrantyEn="";rows[1].PurchaseMethods.Add(new(){MethodId="online"});await db.SaveChangesAsync();
        }
        var read=await Read(sample.Variants);Assert.Equal("",read[sample.Variants[0]].WarrantyFa);Assert.Equal("",read[sample.Variants[0]].WarrantyEn);Assert.Null(read[sample.Variants[0]].VariantMethodIds);Assert.Equal(new[]{"online"},read[sample.Variants[1]].VariantMethodIds);
    }
    [Fact] public async Task MalformedPersistedTypedValuesFailClosedAndCannotBeDisplayedAsText()
    {
        var sample=await Seed();await using(var scope=fixture.Factory.Services.CreateAsyncScope()){
            var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();var number=await db.Set<ProductAttributeValue>().SingleAsync(a=>a.ProductId==sample.Product&&a.AttributeId==sample.Number);number.ValueBool=false;await db.SaveChangesAsync();
        }
        Assert.Equal("catalog_unavailable",(await Assert.ThrowsAsync<BusinessException>(()=>Read(sample.Variants))).Code);
    }
    [Fact] public async Task AnOversizedImageGraphFailsWithoutDroppingImagesOrWritingInventory()
    {
        var sample=await Seed();await using(var scope=fixture.Factory.Services.CreateAsyncScope()){
            var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();var p=await db.Products.Include(p=>p.Media).SingleAsync(p=>p.Id==sample.Product);p.Media.AddRange(Enumerable.Range(0,24).Select(i=>new ProductMedia{Url="/products/qa-extra-"+i+".svg",SortOrder=i+1}));await db.SaveChangesAsync();
        }
        Assert.Equal("catalog_unavailable",(await Assert.ThrowsAsync<BusinessException>(()=>Read(sample.Variants))).Code);
        await using var check=fixture.Factory.Services.CreateAsyncScope();Assert.Equal(25,await check.ServiceProvider.GetRequiredService<CatalogDbContext>().Set<ProductMedia>().CountAsync(m=>m.ProductId==sample.Product));Assert.False(await check.ServiceProvider.GetRequiredService<InventoryDbContext>().Stock.AnyAsync(s=>sample.Variants.Contains(s.VariantId)));
    }
    [Fact] public async Task UnselectedOptionsAreNotRequiredButMissingBilingualMaterialMetadataIsUnavailable()
    {
        var sample=await Seed();await using(var scope=fixture.Factory.Services.CreateAsyncScope()){
            var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();var definition=await db.AttributeDefinitions.Include(d=>d.Options).SingleAsync(d=>d.Id==sample.Select);definition.Options.AddRange(Enumerable.Range(0,128).Select(i=>new AttributeOption{Value="unused-"+i,LabelFa="انتخاب‌نشده "+i,LabelEn="Unselected "+i}));await db.SaveChangesAsync();
        }
        var value=(await Read(sample.Variants))[sample.Variants[0]];Assert.Single(Assert.Single(value.Attributes).Options);
        await using(var scope=fixture.Factory.Services.CreateAsyncScope()){
            var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();var translation=await db.Set<AttributeTranslation>().SingleAsync(t=>t.AttributeId==sample.Select&&t.Locale=="en");db.Remove(translation);await db.SaveChangesAsync();
        }
        Assert.Equal("catalog_unavailable",(await Assert.ThrowsAsync<BusinessException>(()=>Read(sample.Variants))).Code);
    }
}
