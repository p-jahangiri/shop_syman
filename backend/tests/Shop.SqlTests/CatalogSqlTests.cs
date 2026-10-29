using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Inventory;
using Shop.Modules.Credit;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;
public sealed class CatalogSqlTests(SqlFixture fixture) : IClassFixture<SqlFixture>
{
    private static async Task<JsonNode> Json(HttpResponseMessage response) {var text=await response.Content.ReadAsStringAsync();Assert.True(response.IsSuccessStatusCode,$"HTTP {(int)response.StatusCode}: {text}");return JsonNode.Parse(text)!;}
    [Fact] public async Task PublicPagesRespectVariantInheritancePublicationTypedFiltersAndLegacyReindex()
    {
        var key=Guid.NewGuid().ToString("N");var categoryId="c"+key;var childId="child"+key;var brandId="b"+key;
        await using var setup=fixture.Factory.Services.CreateAsyncScope();var db=setup.ServiceProvider.GetRequiredService<CatalogDbContext>();var stock=setup.ServiceProvider.GetRequiredService<InventoryDbContext>();
        AttributeDefinition Definition(string suffix,AttributeDataType type)=>new(){Id=key+suffix,Key="query-"+suffix+"-"+key,DataType=type,Translations=[new(){Locale="fa",Name=suffix},new(){Locale="en",Name=suffix}],Options=type is AttributeDataType.Select or AttributeDataType.MultiSelect?[new(){Id="eight",Value="eight",LabelFa="هشت",LabelEn="Eight"},new(){Id="sixteen",Value="sixteen",LabelFa="شانزده",LabelEn="Sixteen"}]:[]};
        var storage=Definition("storage",AttributeDataType.Select);var text=Definition("text",AttributeDataType.Text);var number=Definition("number",AttributeDataType.Number);var flag=Definition("flag",AttributeDataType.Bool);var multi=Definition("multi",AttributeDataType.MultiSelect);var definitions=new[]{storage,text,number,flag,multi};for(var i=0;i<80;i++)storage.Options.Add(new(){Id="extra"+i.ToString("D2"),Value="case-"+i,LabelFa="كِيف "+i,LabelEn="Case "+i,SortOrder=i+1});
        db.AttributeDefinitions.AddRange(definitions);
        db.Brands.AddRange(new Brand{Id=brandId,Name="Query brand "+key,Slug="brand-"+key},new Brand{Id="inactive"+key,Name="Inactive "+key,Slug="inactive-"+key,IsActive=false});
        Category Category(string id,string slug,string? parent,bool active=true)=>new(){Id=id,Slug=slug,ParentId=parent,IsActive=active,ImageUrl="/products/charger.svg",Translations=[new(){Locale="fa",Name="دسته"},new(){Locale="en",Name="Category"}],Attributes=definitions.Select(d=>new CategoryAttribute{AttributeId=d.Id,IsFilterable=id==categoryId}).ToList()};
        db.Categories.AddRange(Category(categoryId,"cat-"+key,null),Category(childId,"child-"+key,categoryId),Category("inactivecat"+key,"inactivecat-"+key,null,false));
        Product Product(string suffix,long price,string? category=null,string? brand=null,string status="Published",DateTimeOffset? future=null)=>new(){Id=key+suffix,Slug="product-"+suffix+"-"+key,CategoryId=category??categoryId,BrandId=brand??brandId,Status=status,PublishAt=future,PurchaseMethods=[new(){MethodId="online"}],Translations=[new(){Locale="fa",Name="گوشی كِيف ۱۲٣ "+key},new(){Locale="en",Name="Catalog query "+key}],Media=[new(){Url="/products/charger.svg"}],Attributes=[new(){AttributeId=storage.Id,ValueOptionId=suffix=="a"?"eight":"sixteen"},new(){AttributeId=text.Id,ValueTextFa="آبی",ValueTextEn="Blue"},new(){AttributeId=number.Id,ValueNumber=25.5m},new(){AttributeId=flag.Id,ValueBool=false},new(){AttributeId=multi.Id,Selections=[new(){OptionId="eight"}]}],Variants=[new(){Id=key+suffix+"v",Sku="QUERY-"+suffix+"-"+key,PriceRial=price,LabelFa="نمونه",LabelEn="Sample"}]};
        var a=Product("a",100);a.Variants[0].Attributes.Add(new(){AttributeId=storage.Id,ValueOptionId="sixteen"});a.Variants.Add(new(){Id=key+"blue",Sku="BLUE-"+key,PriceRial=200});
        var b=Product("b",300);b.Variants.Add(new(){Id=key+"disabled",Sku="DISABLED-"+key,PriceRial=1,IsActive=false});
        b.Variants.Add(new(){Id=key+"extra",Sku="EXTRA-"+key,PriceRial=500,Attributes=[new(){AttributeId=storage.Id,ValueOptionId="extra79"},new(){AttributeId=text.Id,ValueTextFa="صورتی",ValueTextEn="Pink"}]});
        var child=Product("child",400,childId);child.Attributes.Single(v=>v.AttributeId==text.Id).ValueTextFa="فقط مشخصات";child.Attributes.Single(v=>v.AttributeId==text.Id).ValueTextEn="Not a child filter";var draft=Product("draft",1,status:"Draft");var hidden=Product("hidden",1,status:"Hidden");var future=Product("future",1,future:DateTimeOffset.UtcNow.AddDays(2));var inactiveBrand=Product("brand",1,brand:"inactive"+key);var inactiveCategory=Product("category",1,category:"inactivecat"+key);
        db.Products.AddRange(a,b,child,draft,hidden,future,inactiveBrand,inactiveCategory);await db.SaveChangesAsync();
        foreach(var product in new[]{a,b,child,draft,hidden,future,inactiveBrand,inactiveCategory})foreach(var variant in product.Variants)stock.Stock.Add(new(){VariantId=variant.Id,OnHand=variant.Id==a.Variants[0].Id?0:2});await stock.SaveChangesAsync();
        using var client=fixture.Factory.CreateClient();
        async Task<JsonNode> Search(CatalogSearchInput input)=>await Json(await client.PostAsJsonAsync("/api/catalog/en/search",input));
        var page=await Search(new(CategoryId:categoryId,Sort:"price-asc",PageSize:1));Assert.Equal(3,page["total"]!.GetValue<int>());Assert.Equal(a.Id,page["products"]![0]!["id"]!.GetValue<string>());Assert.Equal(key+"blue",page["matchingVariantIds"]![a.Id]!.GetValue<string>());
        var second=await Search(new(CategoryId:categoryId,Sort:"price-asc",Page:2,PageSize:1));Assert.Equal(b.Id,second["products"]![0]!["id"]!.GetValue<string>());
        var third=await Search(new(CategoryId:categoryId,Sort:"price-asc",Page:3,PageSize:1));Assert.Equal(child.Id,third["products"]![0]!["id"]!.GetValue<string>());
        var available=await Search(new(CategoryId:categoryId,AvailableOnly:true,MaxPriceRial:"150",Attributes:[new(storage.Key,["sixteen"])]));Assert.Empty(available["products"]!.AsArray());
        var fallback=await Search(new(CategoryId:categoryId,MaxPriceRial:"150",Attributes:[new(storage.Key,["sixteen"])]));Assert.Single(fallback["products"]!.AsArray());Assert.Equal(a.Variants[0].Id,fallback["matchingVariantIds"]![a.Id]!.GetValue<string>());
        var inherited=await Search(new(CategoryId:categoryId,AvailableOnly:true,Attributes:[new(storage.Key,["eight"])]));Assert.Single(inherited["products"]!.AsArray());Assert.Equal(key+"blue",inherited["matchingVariantIds"]![a.Id]!.GetValue<string>());
        var typed=await Search(new(CategoryId:categoryId,AvailableOnly:true,MaxPriceRial:"9223372036854775807",Query:"كيف ١٢٣",Attributes:[new(storage.Key,["sixteen"]),new(text.Key,["Blue"]),new(number.Key,["۲۵.۵"]),new(flag.Key,["false"]),new(multi.Key,["eight"])]));Assert.Single(typed["products"]!.AsArray());Assert.Equal(b.Id,typed["products"]![0]!["id"]!.GetValue<string>());
        var crossLanguage=await Search(new(CategoryId:categoryId,AvailableOnly:true,Attributes:[new(text.Key,["آبی"]),new(storage.Key,["sixteen"])]));Assert.Single(crossLanguage["products"]!.AsArray());
        var filters=await Json(await client.GetAsync("/api/catalog/en/filters?categoryId="+categoryId));Assert.Equal(5,filters["attributes"]!.AsArray().Count);Assert.Contains(filters["attributes"]!.AsArray(),f=>f!["key"]!.GetValue<string>()==number.Key&&f["values"]!.AsArray().Any(v=>v!["value"]!.GetValue<string>()=="25.5"));
        Assert.Contains(filters["attributes"]!.AsArray(),f=>f!["key"]!.GetValue<string>()==text.Key&&f["values"]!.AsArray().Any(v=>v!["value"]!.GetValue<string>()=="آبی"&&v["label"]!.GetValue<string>()=="Blue"));
        Assert.DoesNotContain(filters["attributes"]!.AsArray().Single(f=>f!["key"]!.GetValue<string>()==text.Key)!["values"]!.AsArray(),v=>v!["label"]!.GetValue<string>()=="Not a child filter");
        var firstFacet=filters["attributes"]!.AsArray().Single(v=>v!["key"]!.GetValue<string>()==storage.Key)!;Assert.Equal(82,firstFacet["total"]!.GetValue<int>());Assert.True(firstFacet["truncated"]!.GetValue<bool>());Assert.Equal(20,firstFacet["values"]!.AsArray().Count);
        async Task<JsonNode> Facet(FacetValuesInput input)=>await Json(await client.PostAsJsonAsync("/api/catalog/en/facet-values",input));
        var fourth=await Facet(new(categoryId,storage.Key,Page:4,SelectedValues:["extra79"]));Assert.Equal(5,fourth["totalPages"]!.GetValue<int>());Assert.Equal(20,fourth["values"]!.AsArray().Count);Assert.Equal("Case 79",fourth["selectedValues"]![0]!["label"]!.GetValue<string>());
        var fifth=await Facet(new(categoryId,storage.Key,Page:5));Assert.Equal(2,fifth["values"]!.AsArray().Count);Assert.DoesNotContain(fifth["values"]!.AsArray(),v=>fourth["values"]!.AsArray().Any(o=>o!["value"]!.GetValue<string>()==v!["value"]!.GetValue<string>()));
        var found=await Facet(new(categoryId,storage.Key,Query:"كِيف ۷۹",SelectedValues:["eight"]));Assert.Single(found["values"]!.AsArray());Assert.Equal("extra79",found["values"]![0]!["value"]!.GetValue<string>());Assert.Equal("eight",found["selectedValues"]![0]!["value"]!.GetValue<string>());
        var beyondLimit=await Search(new(CategoryId:categoryId,Attributes:[new(storage.Key,["extra79"])]));Assert.Single(beyondLimit["products"]!.AsArray());Assert.Equal(b.Id,beyondLimit["products"]![0]!["id"]!.GetValue<string>());
        var translated=await Facet(new(categoryId,text.Key,Query:"Blue",SelectedValues:["صورتی"]));Assert.Equal("آبی",translated["values"]![0]!["value"]!.GetValue<string>());Assert.Equal("Pink",translated["selectedValues"]![0]!["label"]!.GetValue<string>());
        var numbers=await Facet(new(categoryId,number.Key,Query:"۲۵.۵"));Assert.Equal("25.5",numbers["values"]![0]!["value"]!.GetValue<string>());
        Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsJsonAsync("/api/catalog/en/facet-values",new FacetValuesInput(childId,storage.Key))).StatusCode);
        await db.AttributeOptions.Where(o=>o.AttributeId==storage.Id&&o.Id=="extra79").ExecuteUpdateAsync(x=>x.SetProperty(o=>o.FacetSearch,""));
        Assert.Equal(HttpStatusCode.ServiceUnavailable,(await client.PostAsJsonAsync("/api/catalog/en/facet-values",new FacetValuesInput(categoryId,storage.Key))).StatusCode);
        var lookup=await Json(await client.PostAsJsonAsync("/api/catalog/fa/lookup",new ProductLookupInput(ProductIds:[a.Id,draft.Id,hidden.Id,future.Id,inactiveBrand.Id,inactiveCategory.Id])));Assert.Single(lookup["products"]!.AsArray());
        var settings=await Json(await client.GetAsync("/api/storefront/fa?metadataOnly=true"));Assert.Empty(settings["products"]!.AsArray());Assert.NotEmpty(settings["categories"]!.AsArray());
        var planId=await setup.ServiceProvider.GetRequiredService<CreditPlanService>().SaveAsync(null,new("طرح دقیق","Exact plan",6,1234,3025,2,true,null,null,[],null,1),default);
        var terms=await Json(await client.GetAsync("/api/storefront/en?metadataOnly=true"));var plan=terms["chequePlans"]!.AsArray().Single(p=>p!["id"]!.GetValue<string>()==planId)!;Assert.Equal("1",plan["roundingUnitRial"]!.GetValue<string>());Assert.Equal(12.34m,plan["markupPercent"]!.GetValue<decimal>());
        await db.Set<ProductTranslation>().Where(t=>t.ProductId==a.Id&&t.Locale=="fa").ExecuteUpdateAsync(s=>s.SetProperty(t=>t.SearchName,""));
        Assert.Equal(HttpStatusCode.ServiceUnavailable,(await client.PostAsJsonAsync("/api/catalog/fa/search",new CatalogSearchInput(CategoryId:categoryId))).StatusCode);
        await using(var maintenance=fixture.Factory.Services.CreateAsyncScope()){var service=maintenance.ServiceProvider.GetRequiredService<ICatalogService>();Assert.False(await service.SearchFieldsReadyAsync(default));await service.RepairSearchFieldsAsync(default);Assert.True(await service.SearchFieldsReadyAsync(default));}
        var repaired=await Search(new(CategoryId:categoryId,Query:"کیف ۱۲۳"));Assert.Equal(3,repaired["total"]!.GetValue<int>());
    }
}
