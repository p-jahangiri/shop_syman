using System.Net;
using System.Data.Common;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Market;
using Shop.Modules.Inventory;
using Shop.Modules.Catalog.Application;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;
public sealed class MarketAttributeSqlTests(MarketFixture fixture):IClassFixture<MarketFixture>
{
    private readonly string prefix="typed"+Guid.NewGuid().ToString("N")[..12];
    private const decimal Huge=99999999999999999999.12345678m;
    private string Category=>prefix+"c";
    private string Attr(string key)=>prefix+key;
    private async Task Seed()
    {
        await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();var market=scope.ServiceProvider.GetRequiredService<MarketDbContext>();
        var fields=new[]{("memory",AttributeDataType.Number),("ram",AttributeDataType.Select),("chip",AttributeDataType.Text),("5g",AttributeDataType.Bool),("ports",AttributeDataType.MultiSelect),("weight",AttributeDataType.Number),("os",AttributeDataType.Text),("wireless",AttributeDataType.Bool),("internal",AttributeDataType.Text)};
        foreach(var (key,type) in fields){db.AttributeDefinitions.Add(new(){Id=Attr(key),Key=Attr(key),DataType=type,Unit=key=="memory"?"GB":null,Translations=[new(){Locale="fa",Name="ویژگی نمونه "+key},new(){Locale="en",Name="Sample "+key}],Options=type is AttributeDataType.Select or AttributeDataType.MultiSelect?Enumerable.Range(0,3).Select(i=>new AttributeOption{Id=Attr(key)+i,Value="v"+i,LabelFa="گزینه "+i,LabelEn="Option "+i,SortOrder=i}).ToList():[]});}
        db.Categories.Add(new(){Id=Category,Slug=Category,Translations=[new(){Locale="fa",Name="دسته نمونه"},new(){Locale="en",Name="Sample category"}],Attributes=fields.Select(f=>new CategoryAttribute{AttributeId=Attr(f.Item1),IsFilterable=f.Item1!="internal"}).ToList()});
        for(var i=0;i<4;i++){
            var values=new List<ProductAttributeValue>{new(){AttributeId=Attr("memory"),ValueNumber=i is 0 or 3?Huge:i==1?0:0.00000001m},new(){AttributeId=Attr("ram"),ValueOptionId=Attr("ram")+(i%2)},new(){AttributeId=Attr("chip"),ValueTextFa=i%2==0?"تراشه الف":"تراشه ب",ValueTextEn=i%2==0?"Chip A":"Chip B"},new(){AttributeId=Attr("ports"),Selections=i==3?[new(){OptionId=Attr("ports")+0},new(){OptionId=Attr("ports")+1}]:[new(){OptionId=Attr("ports")+(i%2)}]},new(){AttributeId=Attr("internal"),ValueTextFa="داخلی",ValueTextEn="Internal"}};
            if(i!=2)values.Add(new(){AttributeId=Attr("5g"),ValueBool=i==1});
            var id=prefix+i;db.Products.Add(new(){Id=id,CategoryId=Category,BrandId=i==1?"apple":"samsung",Slug=id,Translations=[new(){Locale="fa",Name="گوشی نمونه ۱۲ "+prefix+" "+i},new(){Locale="en",Name="Sample phone 12 "+prefix+" "+i}],Attributes=values,Media=[new(){Url="/products/phone-green.svg"}]});
            market.Listings.Add(new(){Id=id,ModelId=id,Status="Published",SourceKey="qa-typed",SourceItemKey=id,SourceNameFa="منبع نمونه",SourceNameEn="Sample source",IsDemo=true});
        }
        await db.SaveChangesAsync();await market.SaveChangesAsync();
    }
    private MarketSearchInput Search(params MarketAttributeSelection[] attributes)=>new(Query:prefix,CategoryId:Category,Attributes:attributes.Length==0?null:attributes);
    private static async Task<JsonNode> Body(HttpResponseMessage response,string name,string kind)
    {
        using(response){var bytes=await response.Content.ReadAsByteArrayAsync();Assert.True(response.IsSuccessStatusCode,$"HTTP {(int)response.StatusCode}: {System.Text.Encoding.UTF8.GetString(bytes)}");Assert.Contains("no-store",response.Headers.CacheControl!.ToString());
            if(Environment.GetEnvironmentVariable("SHOP_MARKET_ATTRIBUTES_WIRE_DIR") is {Length:>0} dir){Assert.True(Path.IsPathFullyQualified(dir));Directory.CreateDirectory(dir);using(var f=new FileStream(Path.Combine(dir,name+".json"),FileMode.CreateNew))f.Write(bytes);var path=Path.Combine(dir,"manifest.json");var entries=File.Exists(path)?JsonNode.Parse(File.ReadAllText(path))!["entries"]!.AsArray():new JsonArray();entries.Add(new JsonObject{["file"]=name+".json",["kind"]=kind,["sha256"]=Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant()});File.WriteAllText(path,new JsonObject{["actualSqlHttpBodies"]=true,["entries"]=entries.DeepClone()}.ToJsonString(new(){WriteIndented=true}));}return JsonNode.Parse(bytes)!;}
    }
    private async Task<JsonNode> Page(string name,params MarketAttributeSelection[] attrs)=>await Body(await fixture.Writer.PostAsJsonAsync("/api/market/fa/search",Search(attrs)),name,"page");
    private async Task<JsonNode> Values(string key,string name,MarketSearchInput? search=null,string[]? selected=null,string? query=null,int page=1,int size=20,string locale="fa")=>await Body(await fixture.Writer.PostAsJsonAsync("/api/market/"+locale+"/facet-values",new MarketValuesInput(search??Search(),Attr(key),query,page,size,selected)),name,"values");
    [Fact] public async Task TypedModelFiltersUseAndAcrossKeysOrWithinKeysWithoutLosingDecimalOrFalse()
    {
        await Seed();var huge=await Page("decimal-search",new MarketAttributeSelection(Attr("memory"),[Huge.ToString(System.Globalization.CultureInfo.InvariantCulture)]));Assert.Equal(2,huge["total"]!.GetValue<int>());Assert.Equal(Attr("memory"),huge["appliedAttributes"]![0]!["key"]!.GetValue<string>());
        var fraction=await Page("fraction-search",new MarketAttributeSelection(Attr("memory"),["0.00000001"]));Assert.Equal(1,fraction["total"]!.GetValue<int>());Assert.Equal(prefix+2,fraction["items"]![0]!["id"]!.GetValue<string>());
        var zero=await Page("zero-search",new MarketAttributeSelection(Attr("memory"),["۰"]));Assert.Equal(1,zero["total"]!.GetValue<int>());Assert.Equal(prefix+1,zero["items"]![0]!["id"]!.GetValue<string>());
        var boolean=await Page("false-search",new MarketAttributeSelection(Attr("5g"),["false"]));Assert.Equal(2,boolean["total"]!.GetValue<int>());Assert.DoesNotContain(boolean["items"]!.AsArray(),v=>v!["id"]!.GetValue<string>()==prefix+2);
        var intersection=await Page("intersection-search",new MarketAttributeSelection(Attr("5g"),["false"]),new MarketAttributeSelection(Attr("chip"),["Chip A"]));Assert.Single(intersection["items"]!.AsArray());Assert.Equal(prefix+0,intersection["items"]![0]!["id"]!.GetValue<string>());
        var multi=await Page("multi-search",new MarketAttributeSelection(Attr("ports"),[Attr("ports")+"0",Attr("ports")+"1"]));Assert.Equal(4,multi["total"]!.GetValue<int>());
    }
    [Fact] public async Task ValuesAreModelCountsDisjunctiveLocalizedPagedAndKeepSelectedValues()
    {
        await Seed();var filtered=Search(new MarketAttributeSelection(Attr("memory"),["0"]));var memory=await Values("memory","decimal-values",filtered,[Huge.ToString(System.Globalization.CultureInfo.InvariantCulture)],size:1,locale:"en");Assert.Equal(3,memory["total"]!.GetValue<int>());Assert.Single(memory["values"]!.AsArray());Assert.Equal("0",memory["values"]![0]!["value"]!.GetValue<string>());Assert.Equal(2,memory["selectedValues"]![0]!["count"]!.GetValue<int>());Assert.Equal("99999999999999999999.12345678",memory["selectedValues"]![0]!["value"]!.GetValue<string>());
        var next=await Values("memory","decimal-values-next",page:2,size:1);Assert.Equal("0.00000001",next["values"]![0]!["value"]!.GetValue<string>());
        var ports=await Values("ports","multi-values",selected:[Attr("ports")+"2"],locale:"en");Assert.Equal(2,ports["total"]!.GetValue<int>());Assert.Equal(3,ports["values"]![0]!["count"]!.GetValue<int>());Assert.Equal(0,ports["selectedValues"]![0]!["count"]!.GetValue<int>());Assert.Equal("Option 2",ports["selectedValues"]![0]!["label"]!.GetValue<string>());
        var text=await Values("chip","text-values",query:"تراشه الف",locale:"en");Assert.Single(text["values"]!.AsArray());Assert.Equal("Chip A",text["values"]![0]!["label"]!.GetValue<string>());Assert.Equal("تراشه الف",text["values"]![0]!["value"]!.GetValue<string>());
        var flags=await Values("5g","boolean-values",query:"خیر");Assert.Single(flags["values"]!.AsArray());Assert.Equal("false",flags["values"]![0]!["value"]!.GetValue<string>());
        var facets=await Body(await fixture.Writer.PostAsJsonAsync("/api/market/fa/facets",Search(new MarketAttributeSelection(Attr("5g"),["false"]))),"filtered-facets","facets");Assert.Equal(2,facets["categories"]![0]!["count"]!.GetValue<int>());Assert.Single(facets["brands"]!.AsArray());Assert.Equal("samsung",facets["brands"]![0]!["id"]!.GetValue<string>());
    }
    [Fact] public async Task DefinitionChangesAreDynamicAndNonFilterableOrMalformedSelectionsFailClosed()
    {
        await Seed();var before=await Body(await fixture.Writer.PostAsJsonAsync("/api/market/en/filters",new MarketFiltersInput(Category)),"definitions-before","filters");Assert.Equal(8,before["filters"]!.AsArray().Count);Assert.DoesNotContain(before["filters"]!.AsArray(),f=>f!["key"]!.GetValue<string>()==Attr("internal"));
        await using(var scope=fixture.Sql.Factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();var category=await db.Categories.Include(c=>c.Attributes).SingleAsync(c=>c.Id==Category);category.Attributes.Single(a=>a.AttributeId==Attr("memory")).IsFilterable=false;category.UpdatedAt=DateTimeOffset.UtcNow;await db.SaveChangesAsync();}
        var after=await Body(await fixture.Writer.PostAsJsonAsync("/api/market/fa/filters",new MarketFiltersInput(Category)),"definitions-after","filters");Assert.Equal(7,after["filters"]!.AsArray().Count);Assert.NotEqual(before["version"]!.GetValue<string>(),after["version"]!.GetValue<string>());
        foreach(var selection in new[]{new MarketAttributeSelection(Attr("memory"),["0"]),new MarketAttributeSelection(Attr("internal"),["Internal"]),new MarketAttributeSelection(Attr("5g"),["False"]),new MarketAttributeSelection(Attr("ram"),["unknown-option"]),new("unknown",["x"])})Assert.Equal(HttpStatusCode.BadRequest,(await fixture.Writer.PostAsJsonAsync("/api/market/fa/search",Search(selection))).StatusCode);
        foreach(var input in new object[]{new{Attributes=new[]{new{Key=Attr("ram"),Values=new[]{"x"}}}},new{CategoryId=Category,Attributes=new[]{new{Key=Attr("5g"),Values=new[]{"false","false"}}}},new{CategoryId=Category,Attributes=new[]{new{Key=Attr("ram"),Values=new[]{"x"},Stock=1}}}})Assert.Equal(HttpStatusCode.BadRequest,(await fixture.Writer.PostAsJsonAsync("/api/market/fa/search",input)).StatusCode);
    }
    [Fact] public async Task TypedViewsPreserveExistingDataAcrossDownAndReapplyAndNeverNeedMarketModelChanges()
    {
        await Seed();await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();var market=scope.ServiceProvider.GetRequiredService<MarketDbContext>();var before=await db.Products.Where(p=>p.CategoryId==Category).Select(p=>new{p.Id,p.Version}).OrderBy(p=>p.Id).ToArrayAsync();
        var all=db.Database.GetMigrations().ToArray();var latest=all.Last();Assert.EndsWith("_MarketAttributeReadViews",latest);var migrator=db.GetService<IMigrator>();await migrator.MigrateAsync(all[^2]);await migrator.MigrateAsync(latest);
        var after=await db.Products.Where(p=>p.CategoryId==Category).Select(p=>new{p.Id,p.Version}).OrderBy(p=>p.Id).ToArrayAsync();Assert.Equal(before.Select(p=>(p.Id,Convert.ToBase64String(p.Version))),after.Select(p=>(p.Id,Convert.ToBase64String(p.Version))));Assert.False(db.Database.HasPendingModelChanges());Assert.False(market.Database.HasPendingModelChanges());
        using var anonymous=fixture.Sql.Factory.CreateClient();Assert.Equal(HttpStatusCode.OK,(await anonymous.PostAsJsonAsync("/api/market/fa/filters",new MarketFiltersInput(Category))).StatusCode);
        var page=await Values("memory","after-migration-values");Assert.Equal(3,page["total"]!.GetValue<int>());
    }
    [Fact] public async Task EligibilityAndModelOnlyFactsExcludeStoreStockHiddenRowsAndProductionDemo()
    {
        await Seed();await using(var scope=fixture.Sql.Factory.Services.CreateAsyncScope()){
            var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();var market=scope.ServiceProvider.GetRequiredService<MarketDbContext>();
            var store=await db.Products.SingleAsync(p=>p.Id==prefix+0);store.Status="Published";store.Variants.Add(new(){Id=prefix+"store-v",Sku=prefix+"store",PriceRial=12345});
            (await db.Products.SingleAsync(p=>p.Id==prefix+1)).Status="Hidden";(await market.Listings.SingleAsync(l=>l.Id==prefix+2)).Status="Hidden";
            var remaining=await db.Products.SingleAsync(p=>p.Id==prefix+3);remaining.Variants.Add(new(){Id=prefix+"override-v",Sku=prefix+"override",PriceRial=12345,Attributes=[new(){AttributeId=Attr("memory"),ValueNumber=0}]});
            await db.SaveChangesAsync();await market.SaveChangesAsync();var inventory=scope.ServiceProvider.GetRequiredService<InventoryDbContext>();inventory.Stock.Add(new(){VariantId=prefix+"store-v",OnHand=1});await inventory.SaveChangesAsync();
        }
        var page=await Page("eligibility-search",new MarketAttributeSelection(Attr("memory"),[Huge.ToString(System.Globalization.CultureInfo.InvariantCulture)]));Assert.Equal(prefix+3,Assert.Single(page["items"]!.AsArray())!["id"]!.GetValue<string>());
        var zero=await Page("variant-override-excluded",new MarketAttributeSelection(Attr("memory"),["0"]));Assert.Empty(zero["items"]!.AsArray());
        var values=await Values("memory","eligibility-values");Assert.Single(values["values"]!.AsArray());Assert.Equal(1,values["values"]![0]!["count"]!.GetValue<int>());
        await using var check=fixture.Sql.Factory.Services.CreateAsyncScope();var production=new MarketService(check.ServiceProvider.GetRequiredService<MarketDbContext>(),check.ServiceProvider.GetRequiredService<IMarketModelCatalog>(),TimeProvider.System,false);
        Assert.Empty((await production.ValuesAsync("en",new(Search(),Attr("memory")),CancellationToken.None)).Values);Assert.Empty((await production.PageAsync("en",Search(new MarketAttributeSelection(Attr("5g"),["false"])),CancellationToken.None)).Items);
    }
    [Fact] public async Task MetadataIsBoundedButAValidSelectedAttributeBeyondTheFirstPageStillWorks()
    {
        await Seed();await using(var scope=fixture.Sql.Factory.Services.CreateAsyncScope()){
            var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();var category=await db.Categories.Include(c=>c.Attributes).SingleAsync(c=>c.Id==Category);
            for(var i=0;i<66;i++){var key=Attr("a"+i.ToString("D2"));db.AttributeDefinitions.Add(new(){Id=key,Key=key,DataType=AttributeDataType.Text,Translations=[new(){Locale="fa",Name="نمونه "+i},new(){Locale="en",Name="Sample "+i}]});category.Attributes.Add(new(){AttributeId=key,IsFilterable=true});}category.UpdatedAt=DateTimeOffset.UtcNow;await db.SaveChangesAsync();
        }
        var metadata=await Body(await fixture.Writer.PostAsJsonAsync("/api/market/fa/filters",new MarketFiltersInput(Category)),"bounded-definitions","filters");Assert.Equal(64,metadata["filters"]!.AsArray().Count);Assert.True(metadata["moreFilters"]!.GetValue<bool>());
        var selected=await Page("beyond-metadata-page",new MarketAttributeSelection(Attr("memory"),["0"]));Assert.Single(selected["items"]!.AsArray());
    }
    private sealed class DuringTotal(Func<int,Task> change,int limit):DbCommandInterceptor
    {
        public int Hits;
        public override async ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command,CommandEventData eventData,InterceptionResult<DbDataReader> result,CancellationToken cancellationToken=default)
        {
            if(command.CommandText.TrimStart().StartsWith("SELECT COUNT(*)",StringComparison.OrdinalIgnoreCase)&&command.CommandText.Contains("MarketAttributeValuesV1",StringComparison.Ordinal)){
                var hit=Interlocked.Increment(ref Hits);if(hit<=limit)await change(hit);
            }
            return result;
        }
    }
    private async Task ChangeUnit(string unit)
    {
        await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();var definition=await scope.ServiceProvider.GetRequiredService<CatalogDbContext>().AttributeDefinitions.AsNoTracking().Include(d=>d.Translations).Include(d=>d.Options).SingleAsync(d=>d.Id==Attr("memory"));
        await MarketFixture.Json(await fixture.Writer.PutAsJsonAsync("/api/admin/attributes/"+definition.Id,new AttributeInput(definition.Key,definition.DataType,unit,definition.Translations.Select(t=>new TranslationInput(t.Locale,t.Name)).ToArray(),[],Convert.ToBase64String(definition.Version))));
    }
    [Fact] public async Task ADefinitionChangingDuringTheCountRestartsTheReadBeforeFormattingValues()
    {
        await Seed();var hook=new DuringTotal(_=>ChangeUnit("fresh-unit"),1);await using var db=new MarketDbContext(new DbContextOptionsBuilder<MarketDbContext>().UseSqlServer(fixture.Sql.Connection).AddInterceptors(hook).Options);await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();var service=new MarketService(db,scope.ServiceProvider.GetRequiredService<IMarketModelCatalog>(),TimeProvider.System,true);
        var page=await service.ValuesAsync("en",new(Search(),Attr("memory")),CancellationToken.None);Assert.Equal(2,hook.Hits);Assert.All(page.Values,value=>Assert.EndsWith(" fresh-unit",value.Label));
    }
    [Fact] public async Task RepeatedDefinitionChangesExhaustTheBoundedReadBudgetWithUnavailable()
    {
        await Seed();var hook=new DuringTotal(n=>ChangeUnit("round-"+n),2);await using var db=new MarketDbContext(new DbContextOptionsBuilder<MarketDbContext>().UseSqlServer(fixture.Sql.Connection).AddInterceptors(hook).Options);await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();var service=new MarketService(db,scope.ServiceProvider.GetRequiredService<IMarketModelCatalog>(),TimeProvider.System,true);
        var error=await Assert.ThrowsAsync<BusinessException>(()=>service.ValuesAsync("en",new(Search(),Attr("memory")),CancellationToken.None));Assert.Equal("market_unavailable",error.Code);Assert.Equal(2,hook.Hits);
    }

}
