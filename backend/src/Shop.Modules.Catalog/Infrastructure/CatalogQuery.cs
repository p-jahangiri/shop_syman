using System.Globalization;
using System.Data;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Domain;
using Shop.SharedKernel;

namespace Shop.Modules.Catalog.Infrastructure;

public sealed class CatalogCandidate
{
    public Product Product { get; set; } = null!;
    public ProductVariant Variant { get; set; } = null!;
    public Brand Brand { get; set; } = null!;
    public int Available { get; set; }
}
public sealed record CatalogWinner(string Id,string VariantId,string BrandId,byte[] ProductVersion,byte[] VariantVersion,byte[] BrandVersion);
public sealed class CatalogPageKey
{
    public string Id { get; set; } = "";
    public long PriceRial { get; set; }
    public bool Featured { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
public sealed class TextFacetValue
{
    public string Value { get; set; } = "";
    public string? Label { get; set; }
}
public static class CatalogQuery
{
    public static IQueryable<TextFacetValue> TextValues(CatalogDbContext db, IQueryable<string> publishedIds, string id, string locale, string[]? tokens = null) =>
        db.Set<ProductAttributeValue>().Where(a => a.AttributeId == id && publishedIds.Contains(a.ProductId) && db.Variants.Any(v=>v.ProductId==a.ProductId&&v.IsActive&&!db.Set<VariantAttributeValue>().Any(o=>o.VariantId==v.Id&&o.AttributeId==id)) && (tokens == null || tokens.All(term => a.FacetSearch != null && a.FacetSearch.Contains(term)))).Select(a => new { Value = a.ValueTextFa ?? a.ValueTextEn, Label = locale == "en" ? a.ValueTextEn ?? a.ValueTextFa : a.ValueTextFa ?? a.ValueTextEn })
            .Union(db.Set<VariantAttributeValue>().Where(a => a.AttributeId == id && db.Variants.Any(v => v.Id == a.VariantId && v.IsActive && publishedIds.Contains(v.ProductId)) && (tokens == null || tokens.All(term => a.FacetSearch != null && a.FacetSearch.Contains(term)))).Select(a => new { Value = a.ValueTextFa ?? a.ValueTextEn, Label = locale == "en" ? a.ValueTextEn ?? a.ValueTextFa : a.ValueTextFa ?? a.ValueTextEn }))
            .Where(t => t.Value != null && t.Value != "").GroupBy(t => t.Value).Select(g => new TextFacetValue { Value = g.Key!, Label = g.Min(t => t.Label) });
    public static IQueryable<decimal?> NumberValues(CatalogDbContext db, IQueryable<string> publishedIds, string id) =>
        db.Set<ProductAttributeValue>().Where(a => a.AttributeId == id && publishedIds.Contains(a.ProductId) && db.Variants.Any(v=>v.ProductId==a.ProductId&&v.IsActive&&!db.Set<VariantAttributeValue>().Any(o=>o.VariantId==v.Id&&o.AttributeId==id)) && a.ValueNumber != null).Select(a => a.ValueNumber)
            .Union(db.Set<VariantAttributeValue>().Where(a => a.AttributeId == id && a.ValueNumber != null && db.Variants.Any(v => v.Id == a.VariantId && v.IsActive && publishedIds.Contains(v.ProductId))).Select(a => a.ValueNumber)).Distinct();
    public static IQueryable<CatalogCandidate> Match(CatalogDbContext db, CatalogSearchQuery query, string locale, string[] categoryIds, AttributeDefinition[] definitions, DateTimeOffset now)
    {
        var result = from p in db.Products.AsNoTracking()
                     from v in db.Variants.Where(v => v.ProductId == p.Id && v.IsActive)
                     join brand in db.Brands.AsNoTracking() on p.BrandId equals brand.Id
                     join a in db.AvailableStock on v.Id equals a.VariantId into stock
                     from a in stock.DefaultIfEmpty()
                     where p.Status == "Published" && (p.PublishAt == null || p.PublishAt <= now) && categoryIds.Contains(p.CategoryId)
                        && brand.IsActive
                     select new CatalogCandidate { Product = p, Variant = v, Brand=brand, Available = (int?)a.Available ?? 0 };
        if (query.BrandIds.Length > 0) result = result.Where(x => query.BrandIds.Contains(x.Product.BrandId));
        foreach (var term in query.Tokens) result = result.Where(x => x.Product.Translations.Any(t => t.SearchName.Contains(term)) || x.Variant.SearchSku.Contains(term) || x.Brand.SearchName.Contains(term));
        if (query.MinPriceRial is { } min) result = result.Where(x => x.Variant.PriceRial >= min);
        if (query.MaxPriceRial is { } max) result = result.Where(x => x.Variant.PriceRial <= max);
        if (query.AvailableOnly) result = result.Where(x => x.Available > 0);
        foreach (var filter in query.Attributes) {
            var definition = definitions.SingleOrDefault(d => d.Key == filter.Key) ?? throw new BusinessException("unknown_catalog_filter", "The selected category does not expose this attribute as a filter.");
            var id = definition.Id; var values = filter.Values;
            result = result.Where(x => db.CategoryAttributes.Any(a => a.CategoryId == x.Product.CategoryId && a.AttributeId == id && a.IsFilterable));
            var productValues = db.Set<ProductAttributeValue>().Where(a => a.AttributeId == id);
            var variantValues = db.Set<VariantAttributeValue>().Where(a => a.AttributeId == id);
            var overrides = variantValues.Select(a => a.VariantId);
            switch (definition.DataType) {
                case AttributeDataType.Text:
                    productValues = productValues.Where(a => values.Contains(a.ValueTextFa ?? "") || values.Contains(a.ValueTextEn ?? ""));
                    variantValues = variantValues.Where(a => values.Contains(a.ValueTextFa ?? "") || values.Contains(a.ValueTextEn ?? "")); break;
                case AttributeDataType.Number:
                    var numbers = values.Select(Number).ToArray();
                    productValues = productValues.Where(a => a.ValueNumber != null && numbers.Contains(a.ValueNumber.Value));
                    variantValues = variantValues.Where(a => a.ValueNumber != null && numbers.Contains(a.ValueNumber.Value)); break;
                case AttributeDataType.Bool:
                    if (values.Any(v => v is not ("true" or "false"))) throw new BusinessException("invalid_attribute_filter", "Boolean filters accept true or false.");
                    var booleans = values.Select(bool.Parse).ToArray();
                    productValues = productValues.Where(a => a.ValueBool != null && booleans.Contains(a.ValueBool.Value));
                    variantValues = variantValues.Where(a => a.ValueBool != null && booleans.Contains(a.ValueBool.Value)); break;
                case AttributeDataType.Select:
                    if (values.Any(value => !definition.Options.Any(o => o.Id == value))) throw new BusinessException("invalid_attribute_filter", "Select filters require configured option identifiers.");
                    productValues = productValues.Where(a => a.ValueOptionId != null && values.Contains(a.ValueOptionId));
                    variantValues = variantValues.Where(a => a.ValueOptionId != null && values.Contains(a.ValueOptionId)); break;
                case AttributeDataType.MultiSelect:
                    if (values.Any(value => !definition.Options.Any(o => o.Id == value))) throw new BusinessException("invalid_attribute_filter", "Multi-select filters require configured option identifiers.");
                    productValues = productValues.Where(a => a.Selections.Any(s => values.Contains(s.OptionId)));
                    variantValues = variantValues.Where(_ => false); break;
                default: throw new BusinessException("invalid_attribute_filter", "Unsupported attribute type.");
            }
            var productIds = productValues.Select(a => a.ProductId); var variantIds = variantValues.Select(a => a.VariantId);
            result = result.Where(x => variantIds.Contains(x.Variant.Id) || !overrides.Contains(x.Variant.Id) && productIds.Contains(x.Product.Id));
        }
        return result;
    }
    public static IQueryable<CatalogWinner> Winners(IQueryable<CatalogCandidate> candidates)=>candidates.GroupBy(x=>x.Product.Id).Select(g=>g.OrderByDescending(x=>x.Available>0).ThenBy(x=>x.Variant.PriceRial).ThenBy(x=>x.Variant.Id).Select(x=>new CatalogWinner(x.Product.Id,x.Variant.Id,x.Brand.Id,x.Product.Version,x.Variant.Version,x.Brand.Version)).First());
    public static decimal Number(string value)
    {
        var text = PersianText.Normalize(value);
        if (!decimal.TryParse(text, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var number) || decimal.Abs(number) >= 100000000000000000000m || decimal.Round(number, 8) != number) throw new BusinessException("invalid_attribute_filter", "Numeric filters must be invariant decimal values with at most eight fractional digits.");
        return number;
    }
    public static IQueryable<CatalogPageKey> Keys(IQueryable<CatalogCandidate> candidates) => candidates.GroupBy(x => new { x.Product.Id, x.Product.Featured, x.Product.CreatedAt }).Select(g => new CatalogPageKey {
        Id = g.Key.Id, Featured = g.Key.Featured, CreatedAt = g.Key.CreatedAt,
        PriceRial = g.Min(x => x.Available > 0 ? (long?)x.Variant.PriceRial : null) ?? g.Min(x => x.Variant.PriceRial)
    });
    public static IOrderedQueryable<CatalogPageKey> Order(IQueryable<CatalogPageKey> keys, string sort) => sort switch {
        "price-asc" => keys.OrderBy(x => x.PriceRial).ThenBy(x => x.Id),
        "price-desc" => keys.OrderByDescending(x => x.PriceRial).ThenBy(x => x.Id),
        "newest" => keys.OrderByDescending(x => x.CreatedAt).ThenBy(x => x.Id),
        _ => keys.OrderByDescending(x => x.Featured).ThenByDescending(x => x.CreatedAt).ThenBy(x => x.Id)
    };
}

public sealed partial class CatalogService
{
    public async Task<bool> SearchFieldsReadyAsync(CancellationToken ct) =>
        !await db.Brands.AnyAsync(b => b.SearchName == "", ct) && !await db.Set<ProductTranslation>().AnyAsync(t => t.SearchName == "", ct) && !await db.Variants.AnyAsync(v => v.SearchSku == "", ct) && await FacetFieldsReadyAsync(ct);
    public async Task RepairSearchFieldsAsync(CancellationToken ct)
    {
        // The SQL schema migration deliberately leaves derived values empty. Rebuild in
        // bounded application batches so legacy text receives exactly the same NFKC
        // and Persian normalization as new writes; no approximate SQL transliteration.
        ct.ThrowIfCancellationRequested();
        if(db.Database.CurrentTransaction is not null||System.Transactions.Transaction.Current is not null)throw new InvalidOperationException("Search maintenance requires its own transactions.");
        if (db.ChangeTracker.HasChanges()) throw new InvalidOperationException("Search maintenance requires a context without pending writes.");
        db.ChangeTracker.Clear();
        while (true) {
            await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, ct);
            var brands = await db.Brands.Where(b => b.SearchName == "").OrderBy(b => b.Id).Take(250).ToArrayAsync(ct);
            if (brands.Length == 0) { await transaction.CommitAsync(ct); break; }
            foreach (var b in brands) { b.SearchName = PersianText.Normalize(b.Name); if (b.SearchName.Length == 0) throw new BusinessException("invalid_search_text", "Repair empty brand names before rebuilding search fields."); }
            await db.SaveChangesAsync(ct); await transaction.CommitAsync(ct); db.ChangeTracker.Clear();
        }
        while (true) {
            await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, ct);
            var translations = await db.Set<ProductTranslation>().Where(t => t.SearchName == "").OrderBy(t => t.ProductId).ThenBy(t => t.Locale).Take(250).ToArrayAsync(ct);
            if (translations.Length == 0) { await transaction.CommitAsync(ct); break; }
            foreach (var t in translations) { t.SearchName = PersianText.Normalize(t.Name); if (t.SearchName.Length == 0) throw new BusinessException("invalid_search_text", "Repair empty product names before rebuilding search fields."); }
            await db.SaveChangesAsync(ct); await transaction.CommitAsync(ct); db.ChangeTracker.Clear();
        }
        while (true) {
            await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, ct);
            var variants = await db.Variants.Where(v => v.SearchSku == "").OrderBy(v => v.Id).Take(250).ToArrayAsync(ct);
            if (variants.Length == 0) { await transaction.CommitAsync(ct); break; }
            foreach (var v in variants) { v.SearchSku = PersianText.Normalize(v.Sku); if (v.SearchSku.Length == 0) throw new BusinessException("invalid_search_text", "Repair empty SKUs before rebuilding search fields."); }
            await db.SaveChangesAsync(ct); await transaction.CommitAsync(ct); db.ChangeTracker.Clear();
        }
        while(true){
            await using var transaction=await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead,ct);
            var values=await db.Set<AttributeOption>().Where(v=>v.FacetSearch=="").OrderBy(v=>v.AttributeId).ThenBy(v=>v.Id).Take(250).ToArrayAsync(ct);
            if(values.Length==0){await transaction.CommitAsync(ct);break;}
            foreach(var v in values){v.FacetSearch=PersianText.Normalize($"{v.Value} {v.LabelFa} {v.LabelEn}"); if(v.FacetSearch.Length==0)throw new BusinessException("invalid_search_text","Repair empty attribute options before rebuilding search fields.");}
            await db.SaveChangesAsync(ct);await transaction.CommitAsync(ct);db.ChangeTracker.Clear();
        }
        while(true){
            await using var transaction=await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead,ct);
            var values=await db.Set<ProductAttributeValue>().Where(v=>(v.ValueTextFa!=null||v.ValueTextEn!=null)&&v.FacetSearch==null).OrderBy(v=>v.ProductId).ThenBy(v=>v.AttributeId).Take(250).ToArrayAsync(ct);
            if(values.Length==0){await transaction.CommitAsync(ct);break;}
            foreach(var v in values){v.FacetSearch=PersianText.Normalize($"{v.ValueTextFa} {v.ValueTextEn}");}
            await db.SaveChangesAsync(ct);await transaction.CommitAsync(ct);db.ChangeTracker.Clear();
        }
        while(true){
            await using var transaction=await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead,ct);
            var values=await db.Set<VariantAttributeValue>().Where(v=>(v.ValueTextFa!=null||v.ValueTextEn!=null)&&v.FacetSearch==null).OrderBy(v=>v.VariantId).ThenBy(v=>v.AttributeId).Take(250).ToArrayAsync(ct);
            if(values.Length==0){await transaction.CommitAsync(ct);break;}
            foreach(var v in values){v.FacetSearch=PersianText.Normalize($"{v.ValueTextFa} {v.ValueTextEn}");}
            await db.SaveChangesAsync(ct);await transaction.CommitAsync(ct);db.ChangeTracker.Clear();
        }
    }
    private async Task<bool> FacetFieldsReadyAsync(CancellationToken ct) => !await db.AttributeOptions.AnyAsync(o=>o.FacetSearch=="",ct)
        && !await db.Set<ProductAttributeValue>().AnyAsync(v=>(v.ValueTextFa!=null||v.ValueTextEn!=null)&&v.FacetSearch==null,ct)
        && !await db.Set<VariantAttributeValue>().AnyAsync(v=>(v.ValueTextFa!=null||v.ValueTextEn!=null)&&v.FacetSearch==null,ct);
    private sealed record CategoryScope(string[] Ids,CatalogReadVersion[] Versions);
    private async Task<CategoryScope> QueryCategoryScopeAsync(string? categoryId,CancellationToken ct)
    {
        var categories=await db.Categories.AsNoTracking().Where(c=>c.IsActive).Select(c=>new{c.Id,c.ParentId,c.Version}).ToArrayAsync(ct);
        var versions=categories.Select(c=>new CatalogReadVersion(c.Id,c.Version)).ToArray();
        if(categoryId is null)return new(categories.Select(c=>c.Id).ToArray(),versions);
        if(!categories.Any(c=>c.Id==categoryId))throw new BusinessException("unknown_category","This category is unavailable.");
        var ids=new HashSet<string>{categoryId};var children=categories.ToLookup(c=>c.ParentId);var pending=new Queue<string>();pending.Enqueue(categoryId);
        while(pending.TryDequeue(out var parent))foreach(var child in children[parent])if(ids.Add(child.Id))pending.Enqueue(child.Id);
        return new(ids.ToArray(),versions);
    }
    public Task<CatalogSearchPage> SearchAsync(string locale,CatalogSearchInput input,CancellationToken ct)
    {
        var query=CatalogSearchQuery.Create(input);
        return CatalogReadRetry.RunAsync(token=>SearchAttemptAsync(locale,query,token),ct);
    }
    private async Task<CatalogSearchPage> SearchAttemptAsync(string locale,CatalogSearchQuery query,CancellationToken ct)
    {
        if(!await SearchFieldsReadyAsync(ct))throw new BusinessException("catalog_reindex_required","Catalog search maintenance is incomplete. Try again after the service is ready.");
        var scope=await QueryCategoryScopeAsync(query.CategoryId,ct);var categoryIds=scope.Ids;
        var filterIds=db.CategoryAttributes.Where(a=>categoryIds.Contains(a.CategoryId)&&a.IsFilterable).Select(a=>a.AttributeId);
        var requestedKeys=query.Attributes.Select(a=>a.Key).ToArray();var requestedOptions=query.Attributes.SelectMany(a=>a.Values).ToArray();
        var definitions=await db.AttributeDefinitions.AsNoTracking().Include(d=>d.Options.Where(o=>requestedOptions.Contains(o.Id))).Where(d=>filterIds.Contains(d.Id)&&requestedKeys.Contains(d.Key)).ToArrayAsync(ct);
        var matching=CatalogQuery.Match(db,query,locale,categoryIds,definitions,DateTimeOffset.UtcNow);var keys=CatalogQuery.Keys(matching);var total=await keys.CountAsync(ct);
        var pageIds=await CatalogQuery.Order(keys,query.Sort).Skip((query.Page-1)*query.PageSize).Take(query.PageSize).Select(k=>k.Id).ToArrayAsync(ct);
        if(pageIds.Length==0){await CatalogReadVersions.EnsureSnapshotsAsync<Category>(db,scope.Versions,ct);await CatalogReadVersions.EnsureAsync(db,definitions,ct);return new(1,locale,[],[],total,query.Page,query.PageSize,total==0?0:1+(total-1)/query.PageSize);}
        var winners=await CatalogQuery.Winners(matching.Where(x=>pageIds.Contains(x.Product.Id))).ToArrayAsync(ct);
        if(winners.Length!=pageIds.Length)throw new BusinessException("version_conflict","Catalogue matches changed while selecting a page.");
        var productVersions=CheckoutCatalogQuery.Versions(winners.Select(w=>new CatalogReadVersion(w.Id,w.ProductVersion)));
        var variantVersions=CheckoutCatalogQuery.Versions(winners.Select(w=>new CatalogReadVersion(w.VariantId,w.VariantVersion)));
        var snapshot=await ReadCoreAttemptAsync(locale,pageIds,false,ct,productVersions,variantVersions);var products=snapshot.Products.ToDictionary(p=>p.Id);
        if(winners.Any(w=>!products.TryGetValue(w.Id,out var product)||!product.Variants.Any(v=>v.Id==w.VariantId)))throw new BusinessException("version_conflict","A catalogue match is no longer visible.");
        await CatalogReadVersions.EnsureSnapshotsAsync<Brand>(db,CheckoutCatalogQuery.Versions(winners.Select(w=>new CatalogReadVersion(w.BrandId,w.BrandVersion))),ct);
        await CatalogReadVersions.EnsureSnapshotsAsync<Category>(db,scope.Versions,ct);await CatalogReadVersions.EnsureAsync(db,definitions,ct);
        return new(1,locale,pageIds.Select(id=>products[id]).ToArray(),winners.ToDictionary(w=>w.Id,w=>w.VariantId),total,query.Page,query.PageSize,total==0?0:1+(total-1)/query.PageSize);
    }
    public Task<ProductDto[]> LookupAsync(string locale,ProductLookupInput input,CancellationToken ct)
    {
        CatalogSearchQuery.ValidateLookup(input);var productIds=input.ProductIds??[];var variantIds=input.VariantIds??[];var slugs=input.Slugs??[];
        return CatalogReadRetry.RunAsync(async token=>{
            var now=DateTimeOffset.UtcNow;
            var selected=await db.Products.AsNoTracking().Where(p=>p.Status=="Published"&&(p.PublishAt==null||p.PublishAt<=now)&&db.Categories.Any(c=>c.Id==p.CategoryId&&c.IsActive)&&db.Brands.Any(b=>b.Id==p.BrandId&&b.IsActive)&&p.Variants.Any(v=>v.IsActive)&&(productIds.Contains(p.Id)||slugs.Contains(p.Slug)||p.Variants.Any(v=>v.IsActive&&variantIds.Contains(v.Id)))).Select(p=>new CatalogReadVersion(p.Id,p.Version)).Take(64).ToArrayAsync(token);
            var snapshot=await ReadCoreAttemptAsync(locale,selected.Select(p=>p.Id).ToArray(),false,token,selected);
            return snapshot.Products.Where(p=>productIds.Contains(p.Id,StringComparer.OrdinalIgnoreCase)||slugs.Contains(p.Slug,StringComparer.Ordinal)||p.Variants.Any(v=>variantIds.Contains(v.Id,StringComparer.OrdinalIgnoreCase))).ToArray();
        },ct);
    }
    public Task<CatalogFiltersDto> FiltersAsync(string locale,string? categoryId,CancellationToken ct)=>CatalogReadRetry.RunAsync(token=>ReadFiltersAttemptAsync(locale,categoryId,token),ct);
    private async Task<CatalogFiltersDto> ReadFiltersAttemptAsync(string locale,string? categoryId,CancellationToken ct)
    {
        var scope=await QueryCategoryScopeAsync(categoryId,ct);var ids=scope.Ids;var products=FacetProducts(ids,DateTimeOffset.UtcNow);
        var brands=await db.Brands.AsNoTracking().Where(b=>b.IsActive&&products.Any(p=>p.BrandId==b.Id)).OrderBy(b=>b.Name).ThenBy(b=>b.Id).Select(b=>new BrandFacetDto(b.Id,b.Name)).ToArrayAsync(ct);
        var maximum=await products.SelectMany(p=>p.Variants.Where(v=>v.IsActive)).Select(v=>(long?)v.PriceRial).MaxAsync(ct);
        if(categoryId is null){await CatalogReadVersions.EnsureSnapshotsAsync<Category>(db,scope.Versions,ct);return new(brands,[],maximum?.ToString(CultureInfo.InvariantCulture));}
        var definitionIds=db.CategoryAttributes.Where(a=>ids.Contains(a.CategoryId)&&a.IsFilterable).Select(a=>a.AttributeId);
        var definitions=await db.AttributeDefinitions.AsNoTracking().Include(d=>d.Translations).Where(d=>definitionIds.Contains(d.Id)).OrderBy(d=>d.Key).ToArrayAsync(ct);
        var facets=new List<AttributeFacetDto>();
        foreach(var definition in definitions){
            var page=await ReadFacetPageAsync(locale,FacetValuesQuery.Create(new(categoryId,definition.Key)),definition,products,ct);
            facets.Add(new(definition.Key,definition.Translations.FirstOrDefault(t=>t.Locale==locale)?.Name??definition.Translations.First().Name,char.ToLowerInvariant(definition.DataType.ToString()[0])+definition.DataType.ToString()[1..],definition.Unit,page.Values,page.Total>page.Values.Length,page.Total));
        }
        await CatalogReadVersions.EnsureAsync(db,definitions,ct);
        await CatalogReadVersions.EnsureSnapshotsAsync<Category>(db,scope.Versions,ct);
        return new(brands,facets.ToArray(),maximum?.ToString(CultureInfo.InvariantCulture));
    }
}
