using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Domain;
using Shop.SharedKernel;

namespace Shop.Modules.Catalog.Infrastructure;

public sealed partial class CatalogService
{
    private IQueryable<Product> FacetProducts(string[] categoryIds,DateTimeOffset now) => db.Products.AsNoTracking().Where(p=>p.Status=="Published"&&(p.PublishAt==null||p.PublishAt<=now)&&categoryIds.Contains(p.CategoryId)&&db.Brands.Any(b=>b.Id==p.BrandId&&b.IsActive)&&p.Variants.Any(v=>v.IsActive));
    public Task<FacetValuesPage> FacetValuesAsync(string locale,FacetValuesInput input,CancellationToken ct)
    {
        var query=FacetValuesQuery.Create(input);
        return CatalogReadRetry.RunAsync(token=>ReadFacetAttemptAsync(locale,query,token),ct);
    }
    private async Task<FacetValuesPage> ReadFacetAttemptAsync(string locale,FacetValuesQuery query,CancellationToken ct)
    {
        var scope=await QueryCategoryScopeAsync(query.CategoryId,ct);var categories=scope.Ids;
        var definition=await db.AttributeDefinitions.AsNoTracking().SingleOrDefaultAsync(d=>d.Key==query.Key&&db.CategoryAttributes.Any(a=>categories.Contains(a.CategoryId)&&a.AttributeId==d.Id&&a.IsFilterable),ct);
        if(definition is null){await CatalogReadVersions.EnsureSnapshotsAsync<Category>(db,scope.Versions,ct);throw new BusinessException("unknown_catalog_filter","The selected category does not expose this attribute as a filter.");}
        if(!await FacetFieldsReadyAsync(ct))throw new BusinessException("catalog_reindex_required","Catalog search maintenance is incomplete.");
        var page=await ReadFacetPageAsync(locale,query,definition,FacetProducts(categories,DateTimeOffset.UtcNow),ct);
        await CatalogReadVersions.EnsureAsync(db,new[]{definition},ct);
        await CatalogReadVersions.EnsureSnapshotsAsync<Category>(db,scope.Versions,ct);
        return page;
    }
    private async Task<FacetValuesPage> ReadFacetPageAsync(string locale,FacetValuesQuery query,AttributeDefinition definition,IQueryable<Product> products,CancellationToken ct)
    {
        var id=definition.Id;var offset=(query.Page-1)*query.PageSize;var selected=query.SelectedValues;
        var eligibleIds=products.Where(p=>db.CategoryAttributes.Any(a=>a.CategoryId==p.CategoryId&&a.AttributeId==id&&a.IsFilterable)).Select(p=>p.Id);
        FacetValueDto[] values;FacetValueDto[] selectedValues;int total;
        if(definition.DataType is AttributeDataType.Select or AttributeDataType.MultiSelect){
            var all=db.AttributeOptions.AsNoTracking().Where(o=>o.AttributeId==id);var matches=all;
            foreach(var token in query.Tokens)matches=matches.Where(o=>o.FacetSearch.Contains(token));
            total=await matches.CountAsync(ct);
            values=await matches.OrderBy(o=>o.SortOrder).ThenBy(o=>o.Id).Skip(offset).Take(query.PageSize).Select(o=>new FacetValueDto(o.Id,locale=="en"?o.LabelEn:o.LabelFa)).ToArrayAsync(ct);
            selectedValues=selected.Length==0?[]:await all.Where(o=>selected.Contains(o.Id)).OrderBy(o=>o.SortOrder).ThenBy(o=>o.Id).Take(20).Select(o=>new FacetValueDto(o.Id,locale=="en"?o.LabelEn:o.LabelFa)).ToArrayAsync(ct);
        }else if(definition.DataType==AttributeDataType.Bool){
            if(selected.Any(v=>v is not ("true" or "false")))throw new BusinessException("invalid_attribute_filter","Boolean filters accept true or false.");
            FacetValueDto[] all=[new("true",locale=="en"?"Yes":"بله"),new("false",locale=="en"?"No":"خیر")];
            var matches=all.Where(v=>query.Tokens.All(term=>PersianText.Normalize($"{v.Value} {v.Label} {(v.Value=="true"?"Yes بله":"No خیر")}").Contains(term,StringComparison.Ordinal))).ToArray();
            total=matches.Length;values=matches.Skip(offset).Take(query.PageSize).ToArray();selectedValues=all.Where(v=>selected.Contains(v.Value)).ToArray();
        }else if(definition.DataType==AttributeDataType.Number){
            var all=CatalogQuery.NumberValues(db,eligibleIds,id);var matches=CatalogFacetQuery.Numbers(all,query.Tokens);
            var selectedNumbers=selected.Select(CatalogQuery.Number).ToArray();
            total=await matches.CountAsync(ct);values=(await matches.OrderBy(v=>v).Skip(offset).Take(query.PageSize).ToArrayAsync(ct)).Select(v=>NumberValue(v!.Value,definition.Unit)).ToArray();
            selectedValues=selected.Length==0?[]:(await all.Where(v=>selectedNumbers.Contains(v!.Value)).OrderBy(v=>v).Take(20).ToArrayAsync(ct)).Select(v=>NumberValue(v!.Value,definition.Unit)).ToArray();
        }else{
            var matches=CatalogQuery.TextValues(db,eligibleIds,id,locale,query.Tokens);var all=CatalogQuery.TextValues(db,eligibleIds,id,locale);
            total=await matches.CountAsync(ct);
            values=(await matches.OrderBy(v=>v.Value).Skip(offset).Take(query.PageSize).ToArrayAsync(ct)).Select(v=>new FacetValueDto(v.Value,v.Label??v.Value)).ToArray();
            selectedValues=selected.Length==0?[]:(await all.Where(v=>selected.Contains(v.Value)).OrderBy(v=>v.Value).Take(20).ToArrayAsync(ct)).Select(v=>new FacetValueDto(v.Value,v.Label??v.Value)).ToArray();
        }
        return new(1,locale,query.Key,values,selectedValues,total,query.Page,query.PageSize,total==0?0:1+(total-1)/query.PageSize);
    }
    private static FacetValueDto NumberValue(decimal number,string? unit){var value=number.ToString("0.########",CultureInfo.InvariantCulture);return new(value,value+(string.IsNullOrEmpty(unit)?"":" "+unit));}
}
public static class CatalogFacetQuery
{
    // SQL decimal-to-string retains precision. Search is an invariant numeric prefix;
    // formatting and the optional unit are applied only to the bounded output page.
    public static IQueryable<decimal?> Numbers(IQueryable<decimal?> values,string[] tokens){if(tokens.Length==0)return values;var prefix=string.Join(' ',tokens);return values.Where(v=>v!=null&&v.Value.ToString().StartsWith(prefix));}
}
