using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;
public sealed class CatalogQueryTests
{
    [Theory][InlineData(0,12,"selected")][InlineData(10001,12,"selected")][InlineData(1,0,"selected")][InlineData(1,49,"selected")][InlineData(1,12,"script")]
    public void RejectsUnboundedPagingAndUnknownSorting(int page, int size, string sort) => Assert.Throws<BusinessException>(() => CatalogSearchQuery.Create(new(Page: page, PageSize: size, Sort: sort)));
    [Fact] public void ValidatesTypedInputsAndPreservesMoneyAndPersianTokens()
    {
        var query = CatalogSearchQuery.Create(new(Query: "كِيف ۱۲٣", MaxPriceRial: "9223372036854775807"));
        Assert.Equal(["کیف", "123"], query.Tokens); Assert.Equal(long.MaxValue, query.MaxPriceRial);
        Assert.Equal(12.125m, CatalogQuery.Number("۱۲.۱۲۵"));
        foreach (var invalid in new[] { "1e2", "0.000000001", "100000000000000000000", "NaN" }) Assert.Throws<BusinessException>(() => CatalogQuery.Number(invalid));
        Assert.Throws<BusinessException>(() => CatalogSearchQuery.Create(new(Attributes: [new("ram", ["8"])])));
        Assert.Throws<BusinessException>(() => CatalogSearchQuery.Create(new(CategoryId: "c", Attributes: [new("ram", ["8"]), new("ram", ["16"])])));
        Assert.Throws<BusinessException>(() => CatalogSearchQuery.ValidateLookup(new(ProductIds: Enumerable.Repeat("p",65).ToArray())));
        Assert.Throws<BusinessException>(() => CatalogSearchQuery.ValidateLookup(new()));
    }
    [Theory][InlineData("selected")][InlineData("price-asc")][InlineData("price-desc")][InlineData("newest")]
    public void SqlServerTranslatesAllTypedFiltersAvailabilityGroupingAndPagination(string sort)
    {
        using var db = new CatalogDbContext(DesignTimeOptions.Create<CatalogDbContext>("catalog"));
        var definitions = new[] { Definition("text", AttributeDataType.Text), Definition("number", AttributeDataType.Number), Definition("bool", AttributeDataType.Bool), Definition("select", AttributeDataType.Select), Definition("multi", AttributeDataType.MultiSelect) };
        var query = CatalogSearchQuery.Create(new(CategoryId: "phones", Query: "كِيف ۱۲٣", MinPriceRial: "10", MaxPriceRial: "9223372036854775807", AvailableOnly: true, Sort: sort,
            Attributes: [new("text", ["پشتیبانی"]),new("number",["8"]),new("bool",["true"]),new("select",["choice"]),new("multi",["choice"])]));
        var matching = CatalogQuery.Match(db, query, "fa", ["phones"], definitions, DateTimeOffset.Parse("2026-01-01T00:00:00Z"));
        var sql = CatalogQuery.Order(CatalogQuery.Keys(matching),sort).Skip(12).Take(12).ToQueryString();
        Assert.Contains("[inventory].[AvailableStockV1]", sql); Assert.DoesNotContain("[inventory].[Stock]", sql);
        Assert.Contains("GROUP BY", sql); Assert.Contains("OFFSET", sql); Assert.Contains("FETCH NEXT", sql); Assert.Contains("[PriceRial]", sql); Assert.Contains("[IsActive]", sql); Assert.Contains("[PublishAt]", sql); Assert.Contains("[IsFilterable]",sql);
        Assert.Contains("[VariantAttributeValue]", sql); Assert.Contains("[ProductAttributeValue]", sql); Assert.Contains("[ProductAttributeSelection]",sql); Assert.Contains("[SearchName]", sql); Assert.DoesNotContain("float", sql, StringComparison.OrdinalIgnoreCase);
        var winnerSql = matching.Where(x=>new[]{"p"}.Contains(x.Product.Id)).GroupBy(x=>x.Product.Id).Select(g=>new {Id=g.Key,VariantId=g.OrderByDescending(x=>x.Available>0).ThenBy(x=>x.Variant.PriceRial).ThenBy(x=>x.Variant.Id).Select(x=>x.Variant.Id).First()}).ToQueryString();
        Assert.Contains("ORDER BY",winnerSql); Assert.Contains("[AvailableStockV1]",winnerSql);
        var textFacet = CatalogQuery.TextValues(db,db.Products.Select(p=>p.Id),"text","en").OrderBy(v=>v.Value).Take(61).ToQueryString();
        Assert.Contains("UNION",textFacet); Assert.Contains("GROUP BY",textFacet); Assert.Contains("MIN(",textFacet);
        var numberFacet = CatalogQuery.NumberValues(db,db.Products.Select(p=>p.Id),"number").OrderBy(v=>v).Take(61).ToQueryString();
        Assert.Contains("UNION",numberFacet); Assert.DoesNotContain("float",numberFacet,StringComparison.OrdinalIgnoreCase);
    }
    [Fact] public void RejectsInvalidAttributeOptionsBeforeSqlExecution()
    {
        using var db = new CatalogDbContext(DesignTimeOptions.Create<CatalogDbContext>("catalog"));
        foreach (var (type,value) in new[]{(AttributeDataType.Number,"1e2"),(AttributeDataType.Bool,"yes"),(AttributeDataType.Select,"unknown"),(AttributeDataType.MultiSelect,"unknown")}) {
            var query = CatalogSearchQuery.Create(new(CategoryId:"c",Attributes:[new("key",[value])]));
            Assert.Throws<BusinessException>(()=>CatalogQuery.Match(db,query,"fa",["c"],[Definition("key",type)],DateTimeOffset.UtcNow));
        }
    }
    [Fact] public void SortingUsesTheLowestMatchingAvailablePriceWithAStableTieBreaker()
    {
        var a = new Product {Id="a",CreatedAt=DateTimeOffset.Parse("2026-01-01T00:00:00Z")}; var b = new Product {Id="b",CreatedAt=a.CreatedAt};
        var source = new[] {new CatalogCandidate {Product=a,Variant=new(){PriceRial=1},Available=0},new CatalogCandidate {Product=a,Variant=new(){PriceRial=long.MaxValue},Available=1},new CatalogCandidate {Product=b,Variant=new(){PriceRial=long.MaxValue},Available=1}}.AsQueryable();
        var keys = CatalogQuery.Order(CatalogQuery.Keys(source),"price-asc").ToArray(); Assert.Equal(["a","b"],keys.Select(k=>k.Id)); Assert.All(keys,k=>Assert.Equal(long.MaxValue,k.PriceRial));
    }
    [Theory][InlineData(0,20)][InlineData(10001,20)][InlineData(1,0)][InlineData(1,61)]
    public void FacetPagingRejectsUnboundedRequests(int page,int size)=>Assert.Throws<BusinessException>(()=>FacetValuesQuery.Create(new("c","key",Page:page,PageSize:size)));
    [Fact] public void FacetInputKeepsCanonicalSelectionsAndNormalizesSearch()
    {
        var query=FacetValuesQuery.Create(new("c","storage"," كِيف ۱۲٣ ",SelectedValues:["canonical-id"]));
        Assert.Equal(["کیف","123"],query.Tokens);Assert.Equal(["canonical-id"],query.SelectedValues);
        foreach(var input in new[]{new FacetValuesInput("","key"),new("c",""),new("c","key",new string('a',101)),new("c","key",SelectedValues:["same","same"]),new("c","key",SelectedValues:Enumerable.Range(0,21).Select(i=>i.ToString()).ToArray())})Assert.Throws<BusinessException>(()=>FacetValuesQuery.Create(input));
    }
    [Fact] public void SqlServerTranslatesSearchAndPagingWithoutLoadingEveryFacetValue()
    {
        using var db=new CatalogDbContext(DesignTimeOptions.Create<CatalogDbContext>("catalog"));var ids=db.Products.Select(p=>p.Id);
        var text=CatalogQuery.TextValues(db,ids,"text","en",["کیف","123"]).OrderBy(v=>v.Value).Skip(20).Take(20).ToQueryString();
        Assert.Contains("FacetSearch",text);Assert.Contains("OFFSET",text);Assert.Contains("FETCH NEXT",text);Assert.Contains("GROUP BY",text);
        var options=db.AttributeOptions.Where(o=>o.AttributeId=="a"&&o.FacetSearch.Contains("کیف")).OrderBy(o=>o.SortOrder).ThenBy(o=>o.Id).Skip(20).Take(20).ToQueryString();Assert.Contains("OFFSET",options);Assert.Contains("FacetSearch",options);
        var numeric=CatalogFacetQuery.Numbers(CatalogQuery.NumberValues(db,ids,"number"),["25.5"]).OrderBy(v=>v).Skip(20).Take(20).ToQueryString();Assert.Contains("CONVERT",numeric);Assert.Contains("OFFSET",numeric);Assert.DoesNotContain("float",numeric,StringComparison.OrdinalIgnoreCase);
    }
    [Fact] public void SavingTextAndOptionLabelsAlwaysRebuildsNormalizedFacetSearch()
    {
        var options=new DbContextOptionsBuilder<CatalogDbContext>().UseSqlServer("Server=unused;Database=unused").AddInterceptors(new SuppressDatabaseSave()).Options;
        using var db=new CatalogDbContext(options);var option=new AttributeOption{AttributeId="a",Id="o",Value="case",LabelFa="كِيف ۱۲٣",LabelEn="CASE"};var product=new ProductAttributeValue{ProductId="p",AttributeId="a",ValueTextFa="كِيف ۱۲٣",ValueTextEn="Case"};var variant=new VariantAttributeValue{VariantId="v",AttributeId="a",ValueTextFa="ِ"};
        db.AddRange(option,product,variant);db.SaveChanges();Assert.Equal("case کیف 123 case",option.FacetSearch);Assert.Equal("کیف 123 case",product.FacetSearch);Assert.Equal("",variant.FacetSearch);Assert.DoesNotContain("FacetSearch",System.Text.Json.JsonSerializer.Serialize(option));Assert.DoesNotContain("FacetSearch",System.Text.Json.JsonSerializer.Serialize(product));
        option.LabelFa="جدید";product.ValueTextFa=null;product.ValueTextEn=null;db.SaveChanges();Assert.Equal("case جدید case",option.FacetSearch);Assert.Null(product.FacetSearch);
    }
    private sealed class SuppressDatabaseSave:SaveChangesInterceptor {public override InterceptionResult<int> SavingChanges(DbContextEventData data,InterceptionResult<int> result)=>InterceptionResult<int>.SuppressWithResult(0);}
    private static AttributeDefinition Definition(string key, AttributeDataType type) => new() {Id=key,Key=key,DataType=type,Options=[new(){Id="choice",Value="choice",LabelFa="گزینه",LabelEn="Choice"}]};
}
