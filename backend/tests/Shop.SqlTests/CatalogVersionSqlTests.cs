using System.Data.Common;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Identity;
using Shop.SharedKernel;
using Xunit;
namespace Shop.SqlTests;
public sealed class CatalogVersionFixture:IAsyncLifetime
{
    public sealed class FrozenClock:TimeProvider{public DateTimeOffset Now=DateTimeOffset.UtcNow;public override DateTimeOffset GetUtcNow()=>Now;}
    public OrderFixture Base {get;}=new();public FrozenClock Clock{get;}=new();public WebApplicationFactory<Program> Factory{get;private set;}=null!;public HttpClient Admin{get;private set;}=null!;
    public async Task InitializeAsync(){await Base.InitializeAsync();Clock.Now=DateTimeOffset.UtcNow;Factory=Base.Sql.Factory.WithWebHostBuilder(b=>b.ConfigureTestServices(s=>s.AddSingleton<TimeProvider>(Clock)));Admin=Factory.CreateClient(new(){HandleCookies=false});foreach(var h in Base.Admin.DefaultRequestHeaders)Admin.DefaultRequestHeaders.TryAddWithoutValidation(h.Key,h.Value);}
    public async Task DisposeAsync(){Admin?.Dispose();if(Factory is not null)await Factory.DisposeAsync();await Base.DisposeAsync();}
}
// Real SQL only. These deterministic concurrency/rollback scenarios must not be accepted from compilation.
public sealed class CatalogVersionSqlTests(CatalogVersionFixture fixture):IClassFixture<CatalogVersionFixture>
{
    private static string Key(string prefix)=>prefix+"-"+Guid.NewGuid().ToString("N");
    private static TranslationInput[] Tr(string name)=>[new("fa",name),new("en",name)];
    private static async Task<JsonNode> Json(HttpResponseMessage response)=>await OrderFixture.Json(response);
    private async Task<string> Create(string route,object input)=>(await Json(await fixture.Admin.PostAsJsonAsync("/api/admin/"+route,input)))["id"]!.GetValue<string>();
    private async Task<JsonNode> Meta()=>await Json(await fixture.Admin.GetAsync("/api/admin/catalog?metadataOnly=true"));
    private static JsonNode Row(JsonNode meta,string collection,string id)=>meta[collection]!.AsArray().Single(n=>n!["id"]!.GetValue<string>()==id)!;
    private static string Ver(JsonNode row)=>row["version"]!.GetValue<string>();
    private async Task<AdminEditableProduct> Detail(string id){using var r=await fixture.Admin.GetAsync("/api/admin/products/"+id);Assert.Equal(HttpStatusCode.OK,r.StatusCode);return (await r.Content.ReadFromJsonAsync<AdminProductDetail>())!.Product;}
    private static AttributeValueInput Value(AdminValue a)=>new(a.AttributeId,a.ValueTextFa,a.ValueTextEn,a.ValueNumber,a.ValueBool,a.ValueOptionId,a.Selections.Length==0?null:a.Selections.Select(s=>s.OptionId).ToArray());
    private static ProductInput Input(AdminEditableProduct p)=>new(p.CategoryId,p.BrandId,p.Slug,p.Status,p.IsDigital,p.Featured,p.Translations.Select(t=>new TranslationInput(t.Locale,t.Name,t.Description,t.Badge)).ToArray(),p.Attributes.Select(Value).ToArray(),p.Variants.Select(v=>new VariantInput(v.Id,v.Sku,v.PriceRial,v.CompareAtPriceRial,v.Color,v.ColorNameFa,v.ColorNameEn,v.LabelFa,v.LabelEn,v.WarrantyFa,v.WarrantyEn,v.IsActive,v.Attributes.Select(Value).ToArray(),v.PurchaseMethods.Select(m=>m.MethodId).ToArray(),v.Version)).ToArray(),p.Media.Select(m=>m.Url).ToArray(),p.PurchaseMethods.Select(m=>m.MethodId).ToArray(),p.CreditPlans.Select(plan=>plan.PlanId).ToArray(),p.Version);
    private sealed record Scenario(string Id,string Category,string Multi,string Select,string[] MultiOptions,string[] SelectOptions,string[] Methods);
    private async Task<Scenario> Make(bool twoVariants=false)
    {
        var multi=await Create("attributes",new AttributeInput(Key("multi"),AttributeDataType.MultiSelect,null,Tr("چندگزینه‌ای آزمون"),[new(null,"one","یک","One",0),new(null,"two","دو","Two",1)],null));
        var select=await Create("attributes",new AttributeInput(Key("axis"),AttributeDataType.Select,null,Tr("محور آزمون"),[new(null,"one","یک","One",0),new(null,"two","دو","Two",1)],null));
        var meta=await Meta();var mo=Row(meta,"attributes",multi)["options"]!.AsArray().OrderBy(n=>n!["sortOrder"]!.GetValue<int>()).Select(n=>n!["id"]!.GetValue<string>()).ToArray();var so=Row(meta,"attributes",select)["options"]!.AsArray().OrderBy(n=>n!["sortOrder"]!.GetValue<int>()).Select(n=>n!["id"]!.GetValue<string>()).ToArray();
        var category=await Create("categories",new CategoryInput(Key("category"),null,"/products/charger.svg",0,true,Tr("دستهٔ نسخه"),[new(multi),new(select,IsVariantAxis:true)],null));
        var brand=await Create("brands",new BrandInput("برند نسخه",Key("brand"),"",true,null));
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var config=scope.ServiceProvider.GetRequiredService<IPurchaseConfiguration>();var methods=(await config.MethodsAsync("fa",CancellationToken.None)).Take(2).Select(m=>m.Id).ToArray();Assert.Equal(2,methods.Length);
        var first=new VariantInput(null,Key("sku"),"9007199254740993",null,"","","","تنوع","Variant","","",true,[new(select,OptionId:so[0])],[],null);VariantInput[] variants=twoVariants?new[]{first,first with{Sku=Key("sku2")}}:[first];
        var id=await Create("products",new ProductInput(category,brand,Key("product"),"Draft",false,false,Tr("کالای نسخه"),[new(multi,OptionIds:[mo[0]])],variants,["/products/charger.svg","/products/phone-silver.svg"],methods,[],null));return new(id,category,multi,select,mo,so,methods);
    }
    [Fact] public async Task CategoryRulesAndOptionLabelsRotateVersionsEvenAtTheSameTimestamp()
    {
        var s=await Make();var meta=await Meta();var category=Row(meta,"categories",s.Category);var oldVersion=Ver(category);var stamp=category["updatedAt"]!.GetValue<string>();var categoryInput=new CategoryInput(category["slug"]!.GetValue<string>(),null,"/products/charger.svg",0,true,Tr("دستهٔ نسخه"),[new(s.Multi,IsComparable:false),new(s.Select,IsVariantAxis:true)],oldVersion);
        await Json(await fixture.Admin.PutAsJsonAsync("/api/admin/categories/"+s.Category,categoryInput));var fresh=Row(await Meta(),"categories",s.Category);Assert.NotEqual(oldVersion,Ver(fresh));Assert.Equal(stamp,fresh["updatedAt"]!.GetValue<string>());using var stale=await fixture.Admin.PutAsJsonAsync("/api/admin/categories/"+s.Category,categoryInput);Assert.Equal(HttpStatusCode.Conflict,stale.StatusCode);
        var definition=Row(await Meta(),"attributes",s.Select);var old=Ver(definition);var attr=new AttributeInput(definition["key"]!.GetValue<string>(),AttributeDataType.Select,null,Tr("محور آزمون"),[new(s.SelectOptions[0],"one","برچسب تازه","New label",0),new(s.SelectOptions[1],"two","دو","Two",1)],old);await Json(await fixture.Admin.PutAsJsonAsync("/api/admin/attributes/"+s.Select,attr));var changed=Row(await Meta(),"attributes",s.Select);Assert.NotEqual(old,Ver(changed));Assert.Equal(definition["updatedAt"]!.GetValue<string>(),changed["updatedAt"]!.GetValue<string>());
    }
    [Fact] public async Task ProductAndVariantRelationsRejectOldVersionsWithoutPhantomPriceHistory()
    {
        var s=await Make();var before=await Detail(s.Id);var input=Input(before);var edited=input with{Attributes=[new(s.Multi,OptionIds:[s.MultiOptions[1]])],ImageUrls=input.ImageUrls.Reverse().ToArray(),Variants=[input.Variants[0] with{Attributes=[new(s.Select,OptionId:s.SelectOptions[1])],PurchaseMethodIds=[s.Methods[0]]}]};await Json(await fixture.Admin.PutAsJsonAsync("/api/admin/products/"+s.Id,edited));var after=await Detail(s.Id);Assert.NotEqual(before.Version,after.Version);Assert.NotEqual(before.Variants[0].Version,after.Variants[0].Version);Assert.Equal(s.MultiOptions[1],after.Attributes[0].Selections[0].OptionId);Assert.Equal(s.SelectOptions[1],after.Variants[0].Attributes[0].ValueOptionId);Assert.Equal(input.ImageUrls[1],after.Media[0].Url);Assert.Equal("9007199254740993",after.Variants[0].PriceRial);
        using var staleProduct=await fixture.Admin.PutAsJsonAsync("/api/admin/products/"+s.Id,edited);Assert.Equal(HttpStatusCode.Conflict,staleProduct.StatusCode);var staleVariant=Input(after) with{Variants=[Input(after).Variants[0] with{Version=before.Variants[0].Version}]};using var stale=await fixture.Admin.PutAsJsonAsync("/api/admin/products/"+s.Id,staleVariant);Assert.Equal(HttpStatusCode.Conflict,stale.StatusCode);Assert.Equal(after.Version,(await Detail(s.Id)).Version);
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();Assert.False(await db.PriceHistory.AnyAsync(h=>h.VariantId==after.Variants[0].Id));var product=await db.Products.AsNoTracking().SingleAsync(p=>p.Id==s.Id);Assert.Equal(fixture.Clock.Now,product.UpdatedAt);Assert.Equal(product.CreatedAt,product.UpdatedAt);
    }
    [Fact] public async Task PriceChangeAndOmittedVariantStampCorrectlyWithExactRialHistory()
    {
        var s=await Make(true);var before=await Detail(s.Id);var input=Input(before);var kept=input.Variants[0];var omitted=before.Variants[1];await Json(await fixture.Admin.PutAsJsonAsync("/api/admin/products/"+s.Id,input with{Variants=[kept with{PriceRial="9007199254740994"}]}));await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();var removed=await db.Variants.AsNoTracking().SingleAsync(v=>v.Id==omitted.Id);Assert.False(removed.IsActive);Assert.NotEqual(omitted.Version,Convert.ToBase64String(removed.Version));Assert.Equal(fixture.Clock.Now,removed.UpdatedAt);var history=await db.PriceHistory.SingleAsync(h=>h.VariantId==kept.Id);Assert.Equal(9007199254740993,history.OldPrice);Assert.Equal(9007199254740994,history.NewPrice);Assert.Equal(fixture.Clock.Now,history.CreatedAt);Assert.False(await db.PriceHistory.AnyAsync(h=>h.VariantId==omitted.Id));
    }
    [Fact] public async Task TwoSameVersionRelationshipWritesCannotBothCommitAndAudit()
    {
        var s=await Make();var input=Input(await Detail(s.Id));var route="/api/admin/products/"+s.Id;var first=input with{Attributes=[new(s.Multi,OptionIds:[s.MultiOptions[1]])]};var second=input with{ImageUrls=input.ImageUrls.Reverse().ToArray()};var replies=await Task.WhenAll(fixture.Admin.PutAsJsonAsync(route,first),fixture.Admin.PutAsJsonAsync(route,second));Assert.Single(replies,r=>r.StatusCode==HttpStatusCode.OK);Assert.Single(replies,r=>r.StatusCode==HttpStatusCode.Conflict);foreach(var r in replies)r.Dispose();var after=await Detail(s.Id);var firstWon=after.Attributes[0].Selections[0].OptionId==s.MultiOptions[1];Assert.Equal(firstWon?input.ImageUrls[0]:input.ImageUrls[1],after.Media[0].Url);await using var scope=fixture.Factory.Services.CreateAsyncScope();Assert.Equal(1,await scope.ServiceProvider.GetRequiredService<IdentityDbContext>().Audit.CountAsync(a=>a.Resource==route&&a.Action=="PUT"));
    }
    private sealed class DuringRead(string marker,Func<Task> change,Func<DbCommand,bool>? predicate=null):DbCommandInterceptor
    {
        public int Calls;
        public override async ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command,CommandEventData eventData,InterceptionResult<DbDataReader> result,CancellationToken cancellationToken=default){if((predicate?.Invoke(command)??command.CommandText.Contains(marker,StringComparison.Ordinal))&&Interlocked.CompareExchange(ref Calls,1,0)==0)await change();return result;}
    }
    private CatalogDbContext Context(DbCommandInterceptor intercept)=>new(new DbContextOptionsBuilder<CatalogDbContext>().UseSqlServer(fixture.Base.Sql.Connection).AddInterceptors(intercept).Options);
    [Fact] public async Task ProductSplitReadRejectsMixedParentAndIndependentlyChangedVariantVersions()
    {
        foreach(var variantOnly in new[]{false,true}){var s=await Make();var input=Input(await Detail(s.Id));string marker;await using(var scope=fixture.Factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();marker="["+db.Model.FindEntityType(typeof(ProductMedia))!.GetTableName()+"]";}var hook=new DuringRead(marker,async()=>{if(variantOnly){await using var scope=fixture.Factory.Services.CreateAsyncScope();await scope.ServiceProvider.GetRequiredService<CatalogDbContext>().Variants.Where(v=>v.Id==input.Variants[0].Id).ExecuteUpdateAsync(s=>s.SetProperty(v=>v.LabelEn,"Controlled external label change"));}else await Json(await fixture.Admin.PutAsJsonAsync("/api/admin/products/"+s.Id,input with{ImageUrls=input.ImageUrls.Reverse().ToArray()}));},variantOnly?command=>command.CommandText.Contains("[Products]",StringComparison.Ordinal)&&command.CommandText.Contains("[Version]",StringComparison.Ordinal)&&!command.CommandText.Contains("[UpdatedAt]",StringComparison.Ordinal)&&!command.CommandText.Contains("[ProductId]",StringComparison.Ordinal):null);await using var reading=Context(hook);var problem=await Assert.ThrowsAsync<BusinessException>(()=>new AdminProducts(reading).DetailAsync(s.Id,CancellationToken.None));Assert.Equal("version_conflict",problem.Code);Assert.Equal(1,hook.Calls);}
    }
    [Fact] public async Task MetadataSplitReadRejectsCategoryRuleAndAttributeOptionRaces()
    {
        foreach(var categoryRace in new[]{true,false}){var s=await Make();var meta=await Meta();var category=Row(meta,"categories",s.Category);var attr=Row(meta,"attributes",s.Select);string marker;await using(var scope=fixture.Factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();marker="["+db.Model.FindEntityType(categoryRace?typeof(CategoryAttribute):typeof(AttributeOption))!.GetTableName()+"]";}
            var hook=new DuringRead(marker,async()=>{if(categoryRace)await Json(await fixture.Admin.PutAsJsonAsync("/api/admin/categories/"+s.Category,new CategoryInput(category["slug"]!.GetValue<string>(),null,"/products/charger.svg",0,true,Tr("دستهٔ نسخه"),[new(s.Multi,IsFilterable:false),new(s.Select,IsVariantAxis:true)],Ver(category))));else await Json(await fixture.Admin.PutAsJsonAsync("/api/admin/attributes/"+s.Select,new AttributeInput(attr["key"]!.GetValue<string>(),AttributeDataType.Select,null,Tr("محور آزمون"),[new(s.SelectOptions[0],"one","تازه","Fresh",0),new(s.SelectOptions[1],"two","دو","Two",1)],Ver(attr))));});await using var reading=Context(hook);await using var services=fixture.Factory.Services.CreateAsyncScope();var catalog=new CatalogService(reading,services.ServiceProvider.GetRequiredService<IInventoryReader>(),services.ServiceProvider.GetRequiredService<IPurchaseConfiguration>(),fixture.Clock,services.ServiceProvider.GetRequiredService<IInventorySerialGuard>());Assert.Equal("version_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>catalog.AdminMetadataAsync(CancellationToken.None))).Code);Assert.Equal(1,hook.Calls);}
    }
    [Fact] public async Task AuditFailureRollsBackVersionsRelationsPriceAndHistoryTogether()
    {
        var s=await Make();var before=await Detail(s.Id);var input=Input(before);await using(var scope=fixture.Factory.Services.CreateAsyncScope()){var identity=scope.ServiceProvider.GetRequiredService<IdentityDbContext>();Assert.StartsWith("SaymanTest_",identity.Database.GetDbConnection().Database);await identity.Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] WITH NOCHECK ADD CONSTRAINT [CK_CatalogVersionAuditFailure] CHECK (1=0);");}
        try{using var failed=await fixture.Admin.PutAsJsonAsync("/api/admin/products/"+s.Id,input with{Attributes=[new(s.Multi,OptionIds:[s.MultiOptions[1]])],Variants=[input.Variants[0] with{PriceRial="9007199254740994"}]});Assert.Equal(HttpStatusCode.Conflict,failed.StatusCode);var after=await Detail(s.Id);Assert.Equal(before.Version,after.Version);Assert.Equal(before.Variants[0].Version,after.Variants[0].Version);Assert.Equal(before.Variants[0].PriceRial,after.Variants[0].PriceRial);Assert.Equal(s.MultiOptions[0],after.Attributes[0].Selections[0].OptionId);await using var check=fixture.Factory.Services.CreateAsyncScope();Assert.False(await check.ServiceProvider.GetRequiredService<CatalogDbContext>().PriceHistory.AnyAsync(h=>h.VariantId==after.Variants[0].Id));}finally{await using var cleanup=fixture.Factory.Services.CreateAsyncScope();await cleanup.ServiceProvider.GetRequiredService<IdentityDbContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] DROP CONSTRAINT [CK_CatalogVersionAuditFailure];");}
    }
}
