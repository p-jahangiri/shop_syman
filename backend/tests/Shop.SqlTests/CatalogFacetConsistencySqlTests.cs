using System.Data.Common;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;

// Must run against this fixture's temporary SQL database; discovery is not execution.
public sealed class CatalogFacetConsistencySqlTests(CatalogVersionFixture fixture):IClassFixture<CatalogVersionFixture>
{
    private sealed record Item(string Category,string Attribute,string Key,string Product);
    private static string Key(string prefix)=>prefix+"-"+Guid.NewGuid().ToString("N");
    private async Task<Item> Make(AttributeDataType type=AttributeDataType.Select)
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();var definition=new AttributeDefinition{Key=Key("facet"),DataType=type,Unit="old-unit",Translations=[new(){Locale="fa",Name="عنوان اولیه"},new(){Locale="en",Name="Old heading"}],Options=type==AttributeDataType.Select?[new(){Id="one",Value="one",LabelFa="اول",LabelEn="Old one",SortOrder=0},new(){Id="two",Value="two",LabelFa="دوم",LabelEn="Old two",SortOrder=1}]:[]};
        var category=new Category{Slug=Key("category"),ImageUrl="/products/charger.svg",Translations=[new(){Locale="fa",Name="دستهٔ فیلتر"},new(){Locale="en",Name="Facet category"}],Attributes=[new(){AttributeId=definition.Id,IsFilterable=true}]};var brand=new Brand{Name="Facet brand",Slug=Key("brand")};db.AddRange(definition,category,brand);
        var product=new Product{CategoryId=category.Id,BrandId=brand.Id,Slug=Key("product"),Status="Published",Translations=[new(){Locale="fa",Name="کالای فیلتر"},new(){Locale="en",Name="Facet product"}],Variants=[new(){Sku=Key("sku"),PriceRial=100,IsActive=true}],Attributes=[new(){AttributeId=definition.Id,ValueOptionId=type==AttributeDataType.Select?"one":null,ValueNumber=type==AttributeDataType.Number?25.5m:null,ValueTextFa=type==AttributeDataType.Text?"   ":null}]};db.Products.Add(product);await db.SaveChangesAsync();return new(category.Id,definition.Id,definition.Key,product.Id);
    }
    private async Task<AttributeInput> Input(Item item)
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var d=await scope.ServiceProvider.GetRequiredService<CatalogDbContext>().AttributeDefinitions.AsNoTracking().Include(d=>d.Translations).Include(d=>d.Options).SingleAsync(d=>d.Id==item.Attribute);
        return new(d.Key,d.DataType,d.Unit,d.Translations.Select(t=>new TranslationInput(t.Locale,t.Name)).ToArray(),d.Options.OrderBy(o=>o.SortOrder).Select(o=>new OptionInput(o.Id,o.Value,o.LabelFa,o.LabelEn,o.SortOrder)).ToArray(),Convert.ToBase64String(d.Version));
    }
    private async Task Write(Item item,AttributeInput input)=>await OrderFixture.Json(await fixture.Admin.PutAsJsonAsync("/api/admin/attributes/"+item.Attribute,input));
    private sealed class DuringCount(string table,Func<int,Task> change,int limit=1):DbCommandInterceptor
    {
        public int Hits;
        public override async ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command,CommandEventData eventData,InterceptionResult<DbDataReader> result,CancellationToken cancellationToken=default)
        {
            if(command.CommandText.Contains(table,StringComparison.Ordinal)&&command.CommandText.Contains("COUNT(",StringComparison.OrdinalIgnoreCase)){var hit=Interlocked.Increment(ref Hits);if(hit<=limit)await change(hit);}return result;
        }
    }
    private CatalogDbContext Context(IInterceptor hook)=>new(new DbContextOptionsBuilder<CatalogDbContext>().UseSqlServer(fixture.Base.Sql.Connection).AddInterceptors(hook).Options);
    private CatalogService Service(CatalogDbContext db,IServiceProvider sp)=>new(db,sp.GetRequiredService<IInventoryReader>(),sp.GetRequiredService<IPurchaseConfiguration>(),fixture.Clock,sp.GetRequiredService<IInventorySerialGuard>());
    private async Task<string> Table<T>() where T:class{await using var scope=fixture.Factory.Services.CreateAsyncScope();return "["+scope.ServiceProvider.GetRequiredService<CatalogDbContext>().Model.FindEntityType(typeof(T))!.GetTableName()+"]";}

    [Fact] public async Task OptionCountPageAndOutOfPageSelectionRestartTogetherAfterAnEdit()
    {
        var item=await Make();var input=await Input(item);var hook=new DuringCount(await Table<AttributeOption>(),_=>Write(item,input with{Options=[input.Options[0] with{LabelEn="Fresh one"},input.Options[1] with{LabelEn="Fresh two"},new(null,"three","سوم","Fresh third",-1)]}));await using var db=Context(hook);await using var scope=fixture.Factory.Services.CreateAsyncScope();var page=await Service(db,scope.ServiceProvider).FacetValuesAsync("en",new(item.Category,item.Key,PageSize:1,SelectedValues:["two"]),CancellationToken.None);
        Assert.Equal(2,hook.Hits);Assert.Equal(3,page.Total);Assert.Equal(3,page.TotalPages);Assert.Equal("Fresh third",Assert.Single(page.Values).Label);Assert.Equal("two",Assert.Single(page.SelectedValues).Value);Assert.Equal("Fresh two",page.SelectedValues[0].Label);
    }
    [Fact] public async Task FilterHeadingUnitAndOptionLabelsAreFromTheSuccessfulAttempt()
    {
        var item=await Make();var input=await Input(item);var hook=new DuringCount(await Table<AttributeOption>(),_=>Write(item,input with{Unit="new-unit",Translations=[new("fa","عنوان تازه"),new("en","Fresh heading")],Options=input.Options.Select(o=>o with{LabelEn="Fresh "+o.Value}).ToArray()}));await using var db=Context(hook);await using var scope=fixture.Factory.Services.CreateAsyncScope();var result=await Service(db,scope.ServiceProvider).FiltersAsync("en",item.Category,CancellationToken.None);var facet=Assert.Single(result.Attributes);Assert.Equal(2,hook.Hits);Assert.Equal("Fresh heading",facet.Label);Assert.Equal("new-unit",facet.Unit);Assert.All(facet.Values,v=>Assert.StartsWith("Fresh ",v.Label));Assert.Equal("100",result.MaxPriceRial);
    }
    [Fact] public async Task RemovingTheCategoryRuleDuringReadCannotReturnTheOldFacet()
    {
        var item=await Make();var hook=new DuringCount(await Table<AttributeOption>(),async _=>{await using var scope=fixture.Factory.Services.CreateAsyncScope();var category=await scope.ServiceProvider.GetRequiredService<CatalogDbContext>().Categories.AsNoTracking().Include(c=>c.Translations).SingleAsync(c=>c.Id==item.Category);await OrderFixture.Json(await fixture.Admin.PutAsJsonAsync("/api/admin/categories/"+item.Category,new CategoryInput(category.Slug,category.ParentId,category.ImageUrl,category.SortOrder,true,category.Translations.Select(t=>new TranslationInput(t.Locale,t.Name,t.Description)).ToArray(),[],Convert.ToBase64String(category.Version))));});await using var db=Context(hook);await using var scope=fixture.Factory.Services.CreateAsyncScope();Assert.Equal("unknown_catalog_filter",(await Assert.ThrowsAsync<BusinessException>(()=>Service(db,scope.ServiceProvider).FacetValuesAsync("en",new(item.Category,item.Key),CancellationToken.None))).Code);Assert.Equal(1,hook.Hits);
    }
    [Fact] public async Task AFacetChangingInBothAttemptsFailsWithUnavailable()
    {
        var item=await Make();var hook=new DuringCount(await Table<AttributeOption>(),async count=>{var current=await Input(item);await Write(item,current with{Options=current.Options.Select(o=>o with{LabelEn="Round "+count+" "+o.Value}).ToArray()});},2);await using var db=Context(hook);await using var scope=fixture.Factory.Services.CreateAsyncScope();Assert.Equal("catalog_unavailable",(await Assert.ThrowsAsync<BusinessException>(()=>Service(db,scope.ServiceProvider).FacetValuesAsync("en",new(item.Category,item.Key),CancellationToken.None))).Code);Assert.Equal(2,hook.Hits);
    }
    [Fact] public async Task NumericFacetDoesNotFormatNewValuesWithAnOldUnit()
    {
        var item=await Make(AttributeDataType.Number);var input=await Input(item);var hook=new DuringCount(await Table<ProductAttributeValue>(),_=>Write(item,input with{Unit="new-unit"}));await using var db=Context(hook);await using var scope=fixture.Factory.Services.CreateAsyncScope();var page=await Service(db,scope.ServiceProvider).FacetValuesAsync("en",new(item.Category,item.Key,SelectedValues:["25.5"]),CancellationToken.None);Assert.Equal(2,hook.Hits);Assert.Equal("25.5 new-unit",Assert.Single(page.Values).Label);Assert.Equal(page.Values[0],Assert.Single(page.SelectedValues));
    }
    [Fact] public async Task MaintenanceRejectsAParentSqlTransactionWithoutDetachingOrCommittingIt()
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();var tracked=await db.Brands.FirstAsync();await using var parent=await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.RepeatableRead);var failure=await Assert.ThrowsAsync<InvalidOperationException>(()=>Service(db,scope.ServiceProvider).RepairSearchFieldsAsync(CancellationToken.None));Assert.Contains("own transactions",failure.Message);Assert.Same(parent,db.Database.CurrentTransaction);Assert.Same(tracked,Assert.Single(db.ChangeTracker.Entries()).Entity);await parent.RollbackAsync();
    }
    private sealed class FailSecondSave:SaveChangesInterceptor
    {
        public int Saves;
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData,InterceptionResult<int> result,CancellationToken cancellationToken=default){if(Interlocked.Increment(ref Saves)==2)throw new InvalidOperationException("Controlled second maintenance batch failure.");return new(result);}
    }
    [Fact] public async Task MaintenanceCommitsBoundedBatchesAndCanResumeAfterARolledBackBatch()
    {
        string[] ids;await using(var setup=fixture.Factory.Services.CreateAsyncScope()){var db=setup.ServiceProvider.GetRequiredService<CatalogDbContext>();var brands=Enumerable.Range(0,251).Select(i=>new Brand{Name="كِيف ۱۲٣ batch "+i,Slug=Key("batch")}).ToArray();db.Brands.AddRange(brands);await db.SaveChangesAsync();ids=brands.Select(b=>b.Id).ToArray();await db.Brands.Where(b=>ids.Contains(b.Id)).ExecuteUpdateAsync(s=>s.SetProperty(b=>b.SearchName,""));}
        var failure=new FailSecondSave();await using(var services=fixture.Factory.Services.CreateAsyncScope()){await using var db=Context(failure);await Assert.ThrowsAsync<InvalidOperationException>(()=>Service(db,services.ServiceProvider).RepairSearchFieldsAsync(CancellationToken.None));Assert.Equal(2,failure.Saves);}
        await using(var check=fixture.Factory.Services.CreateAsyncScope()){var db=check.ServiceProvider.GetRequiredService<CatalogDbContext>();Assert.Equal(1,await db.Brands.CountAsync(b=>ids.Contains(b.Id)&&b.SearchName==""));Assert.Equal(250,await db.Brands.CountAsync(b=>ids.Contains(b.Id)&&b.SearchName!=""));var service=check.ServiceProvider.GetRequiredService<ICatalogService>();Assert.False(await service.SearchFieldsReadyAsync(CancellationToken.None));await service.RepairSearchFieldsAsync(CancellationToken.None);Assert.True(await service.SearchFieldsReadyAsync(CancellationToken.None));var rows=await db.Brands.AsNoTracking().Where(b=>ids.Contains(b.Id)).ToArrayAsync();Assert.Equal(251,rows.Length);Assert.All(rows,b=>Assert.Equal(PersianText.Normalize(b.Name),b.SearchName));}
    }
    [Fact] public async Task EmptyNormalizedTextIsRepairedOnceAndDoesNotKeepReadinessUnavailable()
    {
        var item=await Make(AttributeDataType.Text);await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();await db.Set<ProductAttributeValue>().Where(v=>v.ProductId==item.Product).ExecuteUpdateAsync(s=>s.SetProperty(v=>v.FacetSearch,(string?)null));var service=scope.ServiceProvider.GetRequiredService<ICatalogService>();Assert.False(await service.SearchFieldsReadyAsync(CancellationToken.None));using var deadline=new CancellationTokenSource(TimeSpan.FromSeconds(20));await service.RepairSearchFieldsAsync(deadline.Token);Assert.True(await service.SearchFieldsReadyAsync(deadline.Token));Assert.Equal("",(await db.Set<ProductAttributeValue>().AsNoTracking().SingleAsync(v=>v.ProductId==item.Product)).FacetSearch);await service.RepairSearchFieldsAsync(deadline.Token);
    }
}
