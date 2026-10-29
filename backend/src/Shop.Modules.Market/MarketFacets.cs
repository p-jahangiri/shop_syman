using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Market;

public sealed record MarketCategoryFacet(string Id,int Count);
public sealed record MarketBrandFacet(string Id,string Name,int Count);
public sealed record MarketFacetScope(string Query,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? CategoryId,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? BrandId,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.WhenWritingNull)]MarketAttributeSelection[]? Attributes=null);
public sealed record MarketFacets(int SchemaVersion,string Locale,MarketFacetScope Scope,
    MarketCategoryFacet[] Categories,MarketBrandFacet[] Brands,bool MoreCategories,bool MoreBrands);

public sealed partial class MarketService
{
    public const int FacetLimit=200;

    // Both reads use Catalog's owned publication/stock view. An unlisted model,
    // hidden source or available store offer cannot contribute to a facet.
    private IQueryable<CatalogMarketModelV1> SearchableModels(string search)
    {
        var models=db.CatalogModels.AsNoTracking().Where(m=>m.IsEligible&&!m.HasAvailableStoreOffer);
        foreach(var token in search.Split(' ',StringSplitOptions.RemoveEmptyEntries))
            models=models.Where(m=>m.SearchFa.Contains(token)||m.SearchEn.Contains(token)||m.Brand.Contains(token));
        return models;
    }

    public Task<MarketFacets> FacetsAsync(string locale,MarketSearchInput input,CancellationToken ct)=>AttributeReadAsync<MarketFacets>(async()=>
    {
        if(locale is not ("fa" or "en"))throw new BusinessException("invalid_market_input","Use fa or en.");
        var search=MarketRules.Search(input);
        var definitions=await AttributeDefinitionsAsync(input,ct);
        var models=ApplyAttributes(SearchableModels(search),input,definitions).Where(m=>PublicListings.Any(l=>l.ModelId==m.ModelId));
        // Disjunctive counts: each selector ignores its own selection, but keeps
        // the other selector and search. Paging never limits facet membership.
        var categoryModels=input.BrandId is null?models:models.Where(m=>m.BrandId==input.BrandId);
        var brandModels=input.CategoryId is null?models:models.Where(m=>m.CategoryId==input.CategoryId);
        var categories=await categoryModels.GroupBy(m=>m.CategoryId).Select(g=>new{Id=g.Key,Count=g.Count()})
            .OrderByDescending(g=>g.Id==input.CategoryId).ThenBy(g=>g.Id).Take(FacetLimit+1).ToArrayAsync(ct);
        var brands=await brandModels.GroupBy(m=>new{m.BrandId,m.Brand}).Select(g=>new{Id=g.Key.BrandId,Name=g.Key.Brand,Count=g.Count()})
            .OrderByDescending(g=>g.Id==input.BrandId).ThenBy(g=>g.Id).Take(FacetLimit+1).ToArrayAsync(ct);
        await EnsureAttributeDefinitionsAsync(input.CategoryId,definitions,ct);
        return new(1,locale,Scope(input),
            categories.Take(FacetLimit).Select(g=>new MarketCategoryFacet(g.Id,g.Count)).ToArray(),
            brands.Take(FacetLimit).Select(g=>new MarketBrandFacet(g.Id,g.Name,g.Count)).ToArray(),
            categories.Length>FacetLimit,brands.Length>FacetLimit);
    },ct);
}
