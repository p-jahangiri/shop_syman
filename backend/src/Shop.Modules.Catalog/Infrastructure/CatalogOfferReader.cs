using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Catalog.Domain;
using Shop.SharedKernel;

namespace Shop.Modules.Catalog.Infrastructure;

public sealed class CatalogOfferCandidate
{
    public ProductVariant Variant {get;init;}=null!;
    public Product Product {get;init;}=null!;
    public Category Category {get;init;}=null!;
    public Brand Brand {get;init;}=null!;
}
public static class CatalogOfferQuery
{
    // Stock is deliberately absent. A real published SKU may be offered while
    // supply is still pending; this projection grants no inventory rights.
    public static IQueryable<CatalogOfferCandidate> Read(CatalogDbContext db,DateTimeOffset now)=>
        from v in db.Variants.AsNoTracking()
        join p in db.Products.AsNoTracking() on v.ProductId equals p.Id
        join c in db.Categories.AsNoTracking() on p.CategoryId equals c.Id
        join b in db.Brands.AsNoTracking() on p.BrandId equals b.Id
        where v.IsActive&&v.UsedInspectionId==null&&!p.IsDigital&&p.Status=="Published"&&(p.PublishAt==null||p.PublishAt<=now)&&c.IsActive&&b.IsActive&&p.PurchaseMethods.Any()
        select new CatalogOfferCandidate{Variant=v,Product=p,Category=c,Brand=b};
    public static IQueryable<CatalogOfferCandidate> Lookup(CatalogDbContext db,CatalogOfferLookup lookup,string? after,DateTimeOffset now)
    {
        var query=Read(db,now).Where(r=>r.Product.Id==lookup.ModelId);
        foreach(var token in lookup.Search.Split(' ',StringSplitOptions.RemoveEmptyEntries))query=query.Where(r=>r.Variant.SearchSku.Contains(token)||r.Variant.LabelFa.Contains(token)||r.Variant.LabelEn.Contains(token)||r.Variant.ColorNameFa.Contains(token)||r.Variant.ColorNameEn.Contains(token));
        if(after is not null)query=query.Where(r=>string.Compare(r.Variant.Id,after)>0);
        return query.OrderBy(r=>r.Variant.Id);
    }
}

public sealed class CatalogOfferReader(CatalogDbContext db,TimeProvider time):ICatalogOfferReader
{
    public const int MaxVariants=64;
    public const int MaxAttributes=64;
    public const int MaxImages=24;
    public const int MaxMethods=64;
    public const int MaxSelectedOptions=4096;
    public const int MaxSnapshotBytes=2*1024*1024;
    public Task<IReadOnlyDictionary<string,OfferSkuSnapshot>> ReadAsync(string[] variantIds,CancellationToken ct)
    {
        if(variantIds is null||variantIds.Length>MaxVariants||variantIds.Distinct(StringComparer.OrdinalIgnoreCase).Count()!=variantIds.Length)throw Invalid();
        foreach(var id in variantIds)CatalogOfferLookup.ValidateId(id);
        if(variantIds.Length==0)return Task.FromResult<IReadOnlyDictionary<string,OfferSkuSnapshot>>(new Dictionary<string,OfferSkuSnapshot>(StringComparer.Ordinal));
        return CatalogReadRetry.RunAsync(token=>ReadAttemptAsync(variantIds,token),ct);
    }
    public Task<OfferSkuPage> LookupAsync(string modelId,string? query,string? cursor,CancellationToken ct)
    {
        var lookup=CatalogOfferLookup.Create(modelId,query);var after=CatalogOfferPaging.Decode(cursor,lookup);
        return CatalogReadRetry.RunAsync(async token=>{
            var rows=await CatalogOfferQuery.Lookup(db,lookup,after,time.GetUtcNow()).Take(CatalogOfferPaging.PageSize+1).ToArrayAsync(token);
            await EnsureCandidatesAsync(rows,token);
            var items=rows.Take(CatalogOfferPaging.PageSize).Select(r=>new OfferSkuChoice(r.Variant.Id,r.Product.Id,r.Variant.Sku,r.Variant.LabelFa,r.Variant.LabelEn,r.Variant.Color,r.Variant.ColorNameFa,r.Variant.ColorNameEn,r.Variant.WarrantyFa,r.Variant.WarrantyEn,r.Variant.PriceRial.ToString(CultureInfo.InvariantCulture),Convert.ToBase64String(r.Variant.Version))).ToArray();
            return new OfferSkuPage(1,CatalogOfferPaging.PageSize,items,rows.Length>CatalogOfferPaging.PageSize?CatalogOfferPaging.Encode(rows[CatalogOfferPaging.PageSize-1].Variant.Id,lookup):null);
        },ct);
    }
    private async Task<IReadOnlyDictionary<string,OfferSkuSnapshot>> ReadAttemptAsync(string[] ids,CancellationToken ct)
    {
        var candidates=await CatalogOfferQuery.Read(db,time.GetUtcNow()).Where(r=>ids.Contains(r.Variant.Id)).ToArrayAsync(ct);
        if(candidates.Length==0)return new Dictionary<string,OfferSkuSnapshot>(StringComparer.Ordinal);
        var variantIds=candidates.Select(r=>r.Variant.Id).ToArray();var productIds=candidates.Select(r=>r.Product.Id).Distinct(StringComparer.Ordinal).ToArray();
        // Counts precede collection materialization, including an aggregate
        // bound on selected multi-value options. No collection is truncated.
        if(await db.Products.AnyAsync(p=>productIds.Contains(p.Id)&&(p.Attributes.Count>MaxAttributes||p.Media.Count>MaxImages||p.PurchaseMethods.Count>MaxMethods||p.CreditPlans.Count>MaxMethods||p.Attributes.Any(a=>a.Selections.Count>MaxAttributes)),ct)
            ||await db.Variants.AnyAsync(v=>variantIds.Contains(v.Id)&&(v.Attributes.Count>MaxAttributes||v.PurchaseMethods.Count>MaxMethods),ct))throw CatalogOfferSnapshots.Unavailable();
        if(await db.Set<ProductAttributeSelection>().CountAsync(s=>productIds.Contains(s.ProductId),ct)>MaxSelectedOptions)throw CatalogOfferSnapshots.Unavailable();
        var products=await db.Products.AsNoTracking().Where(p=>productIds.Contains(p.Id)).Include(p=>p.Translations.Where(t=>t.Locale=="fa"||t.Locale=="en")).Include(p=>p.Attributes).ThenInclude(a=>a.Selections).Include(p=>p.Media).Include(p=>p.PurchaseMethods).Include(p=>p.CreditPlans).AsSplitQuery().ToArrayAsync(ct);
        var variants=await db.Variants.AsNoTracking().Where(v=>variantIds.Contains(v.Id)).Include(v=>v.Attributes).Include(v=>v.PurchaseMethods).AsSplitQuery().ToArrayAsync(ct);
        if(products.Any(p=>p.Attributes.Count>MaxAttributes||p.Media.Count>MaxImages||p.PurchaseMethods.Count>MaxMethods||p.CreditPlans.Count>MaxMethods||p.Attributes.Any(a=>a.Selections.Count>MaxAttributes))||variants.Any(v=>v.Attributes.Count>MaxAttributes||v.PurchaseMethods.Count>MaxMethods)||products.Sum(p=>p.Attributes.Sum(a=>a.Selections.Count))>MaxSelectedOptions)throw CatalogOfferSnapshots.Unavailable();
        var definitionIds=products.SelectMany(p=>p.Attributes.Select(a=>a.AttributeId)).Concat(variants.SelectMany(v=>v.Attributes.Select(a=>a.AttributeId))).Distinct(StringComparer.Ordinal).ToArray();
        if(definitionIds.Length>MaxSelectedOptions)throw CatalogOfferSnapshots.Unavailable();
        var categoryIds=products.Select(p=>p.CategoryId).Distinct(StringComparer.Ordinal).ToArray();var brandIds=products.Select(p=>p.BrandId).Distinct(StringComparer.Ordinal).ToArray();
        var categories=await db.Categories.AsNoTracking().Where(c=>categoryIds.Contains(c.Id)).Include(c=>c.Translations.Where(t=>t.Locale=="fa"||t.Locale=="en")).Include(c=>c.Attributes.Where(a=>definitionIds.Contains(a.AttributeId))).AsSplitQuery().ToArrayAsync(ct);
        var brands=await db.Brands.AsNoTracking().Where(b=>brandIds.Contains(b.Id)).ToArrayAsync(ct);
        var definitions=await db.AttributeDefinitions.AsNoTracking().Where(d=>definitionIds.Contains(d.Id)).Include(d=>d.Translations.Where(t=>t.Locale=="fa"||t.Locale=="en")).AsSplitQuery().ToArrayAsync(ct);
        var selectedIds=products.SelectMany(p=>p.Attributes.SelectMany(a=>a.Selections.Select(s=>s.OptionId).Concat(a.ValueOptionId is null?[]:new[]{a.ValueOptionId}))).Concat(variants.SelectMany(v=>v.Attributes.Where(a=>a.ValueOptionId!=null).Select(a=>a.ValueOptionId!))).Distinct(StringComparer.Ordinal).ToArray();
        if(selectedIds.Length>MaxSelectedOptions)throw CatalogOfferSnapshots.Unavailable();
        var optionQuery=db.AttributeOptions.AsNoTracking().Where(o=>definitionIds.Contains(o.AttributeId)&&selectedIds.Contains(o.Id));
        if(await optionQuery.CountAsync(ct)>MaxSelectedOptions)throw CatalogOfferSnapshots.Unavailable();
        var selectedOptions=await optionQuery.ToArrayAsync(ct);
        EnsureInitial(candidates,products,variants,categories,brands);
        await CatalogReadVersions.EnsureAsync(db,products,ct);await CatalogReadVersions.EnsureAsync(db,variants,ct);await CatalogReadVersions.EnsureAsync(db,categories,ct);await CatalogReadVersions.EnsureAsync(db,brands,ct);await CatalogReadVersions.EnsureAsync(db,definitions,ct);
        var fresh=await CatalogOfferQuery.Read(db,time.GetUtcNow()).Where(r=>variantIds.Contains(r.Variant.Id)).ToArrayAsync(ct);
        if(fresh.Length!=candidates.Length)throw Changed();
        EnsureInitial(fresh,products,variants,categories,brands);
        var productMap=products.ToDictionary(p=>p.Id,StringComparer.Ordinal);var categoryMap=categories.ToDictionary(c=>c.Id,StringComparer.Ordinal);var brandMap=brands.ToDictionary(b=>b.Id,StringComparer.Ordinal);var definitionMap=definitions.ToDictionary(d=>d.Id,StringComparer.Ordinal);
        var optionsByDefinition=selectedOptions.GroupBy(o=>o.AttributeId,StringComparer.Ordinal).ToDictionary(g=>g.Key,g=>(IReadOnlyDictionary<string,AttributeOption>)g.ToDictionary(o=>o.Id,StringComparer.Ordinal),StringComparer.Ordinal);
        SourcingAttributeSnapshot Attribute(string id,string? fa,string? en,decimal? number,bool? flag,string? optionId,string[] optionIds)
        {
            if(!definitionMap.TryGetValue(id,out var definition))throw CatalogOfferSnapshots.Unavailable();
            var options=optionsByDefinition.GetValueOrDefault(id)??new Dictionary<string,AttributeOption>(StringComparer.Ordinal);
            return CatalogOfferSnapshots.Attribute(definition,fa,en,number,flag,optionId,optionIds,options);
        }
        var modelMap=new Dictionary<string,OfferModelSnapshot>(StringComparer.Ordinal);
        foreach(var p in products){
            if(!categoryMap.TryGetValue(p.CategoryId,out var category)||!brandMap.TryGetValue(p.BrandId,out var brand))throw Changed();
            var fa=p.Translations.SingleOrDefault(t=>t.Locale=="fa")??throw CatalogOfferSnapshots.Unavailable();var en=p.Translations.SingleOrDefault(t=>t.Locale=="en")??throw CatalogOfferSnapshots.Unavailable();
            var categoryFa=category.Translations.SingleOrDefault(t=>t.Locale=="fa")??throw CatalogOfferSnapshots.Unavailable();var categoryEn=category.Translations.SingleOrDefault(t=>t.Locale=="en")??throw CatalogOfferSnapshots.Unavailable();
            if(p.Attributes.Any(a=>category.Attributes.All(assigned=>assigned.AttributeId!=a.AttributeId)))throw CatalogOfferSnapshots.Unavailable();
            var visible=category.Attributes.Where(a=>a.ShowInSpecs||a.IsComparable).Select(a=>a.AttributeId).ToHashSet(StringComparer.Ordinal);
            var attributes=p.Attributes.Where(a=>visible.Contains(a.AttributeId)).OrderBy(a=>a.AttributeId,StringComparer.Ordinal).Select(a=>Attribute(a.AttributeId,a.ValueTextFa,a.ValueTextEn,a.ValueNumber,a.ValueBool,a.ValueOptionId,a.Selections.Select(s=>s.OptionId).ToArray())).ToArray();
            var images=p.Media.Where(m=>m.Type=="image").OrderBy(m=>m.SortOrder).ThenBy(m=>m.Id,StringComparer.Ordinal).Select(m=>m.Url).ToArray();
            modelMap.Add(p.Id,new(p.Id,p.Slug,p.CategoryId,categoryFa.Name,categoryEn.Name,p.BrandId,brand.Name,fa.Name,en.Name,fa.Description,en.Description,images,attributes));
        }
        var result=new Dictionary<string,OfferSkuSnapshot>(StringComparer.Ordinal);
        foreach(var v in variants.OrderBy(v=>v.Id,StringComparer.Ordinal)){
            var p=productMap[v.ProductId];var category=categoryMap[p.CategoryId];var brand=brandMap[p.BrandId];
            var assigned=category.Attributes.Select(a=>a.AttributeId).ToHashSet(StringComparer.Ordinal);
            if(v.Attributes.Any(a=>!assigned.Contains(a.AttributeId))||p.PurchaseMethods.Count==0||v.PurchaseMethods.Any(m=>p.PurchaseMethods.All(pm=>pm.MethodId!=m.MethodId)))throw CatalogOfferSnapshots.Unavailable();
            var attributes=v.Attributes.OrderBy(a=>a.AttributeId,StringComparer.Ordinal).Select(a=>Attribute(a.AttributeId,a.ValueTextFa,a.ValueTextEn,a.ValueNumber,a.ValueBool,a.ValueOptionId,[])).ToArray();
            var own=v.PurchaseMethods.Select(m=>m.MethodId).Order(StringComparer.Ordinal).ToArray();
            var snapshot=new OfferSkuSnapshot(v.Id,p.Id,p.SellerId,v.Sku,modelMap[p.Id],v.LabelFa,v.LabelEn,v.Color,v.ColorNameFa,v.ColorNameEn,v.WarrantyFa,v.WarrantyEn,attributes,p.PurchaseMethods.Select(m=>m.MethodId).Order(StringComparer.Ordinal).ToArray(),own.Length==0?null:own,p.CreditPlans.Select(m=>m.PlanId).Order(StringComparer.Ordinal).ToArray(),v.PriceRial.ToString(CultureInfo.InvariantCulture),Convert.ToBase64String(v.Version),"","");
            var relevant=definitions.Where(d=>p.Attributes.Any(a=>a.AttributeId==d.Id)||v.Attributes.Any(a=>a.AttributeId==d.Id));
            var versions=new[]{Version("product",p),Version("variant",v),Version("category",category),Version("brand",brand)}.Concat(relevant.Select(d=>Version("attribute",d)));
            result.Add(v.Id,snapshot with{MaterialFingerprint=CatalogOfferSnapshots.MaterialFingerprint(snapshot),CurrentFingerprint=CatalogOfferSnapshots.CurrentFingerprint(snapshot,versions)});
        }
        if(JsonSerializer.SerializeToUtf8Bytes(result).Length>MaxSnapshotBytes)throw CatalogOfferSnapshots.Unavailable();
        return result;
    }
    private static CatalogOfferVersion Version(string kind,CatalogEntity entity)=>new(kind,entity.Id,Convert.ToBase64String(entity.Version));
    private static void EnsureInitial(CatalogOfferCandidate[] candidates,Product[] products,ProductVariant[] variants,Category[] categories,Brand[] brands)
    {
        CatalogReadVersions.EnsureUnchanged(CheckoutCatalogQuery.Versions(candidates.Select(r=>new CatalogReadVersion(r.Product.Id,r.Product.Version))),CatalogReadVersions.Capture(products));
        CatalogReadVersions.EnsureUnchanged(CheckoutCatalogQuery.Versions(candidates.Select(r=>new CatalogReadVersion(r.Variant.Id,r.Variant.Version))),CatalogReadVersions.Capture(variants));
        CatalogReadVersions.EnsureUnchanged(CheckoutCatalogQuery.Versions(candidates.Select(r=>new CatalogReadVersion(r.Category.Id,r.Category.Version))),CatalogReadVersions.Capture(categories));
        CatalogReadVersions.EnsureUnchanged(CheckoutCatalogQuery.Versions(candidates.Select(r=>new CatalogReadVersion(r.Brand.Id,r.Brand.Version))),CatalogReadVersions.Capture(brands));
    }
    private async Task EnsureCandidatesAsync(CatalogOfferCandidate[] rows,CancellationToken ct)
    {
        await CatalogReadVersions.EnsureSnapshotsAsync<Product>(db,CheckoutCatalogQuery.Versions(rows.Select(r=>new CatalogReadVersion(r.Product.Id,r.Product.Version))),ct);
        await CatalogReadVersions.EnsureSnapshotsAsync<ProductVariant>(db,CheckoutCatalogQuery.Versions(rows.Select(r=>new CatalogReadVersion(r.Variant.Id,r.Variant.Version))),ct);
        await CatalogReadVersions.EnsureSnapshotsAsync<Category>(db,CheckoutCatalogQuery.Versions(rows.Select(r=>new CatalogReadVersion(r.Category.Id,r.Category.Version))),ct);
        await CatalogReadVersions.EnsureSnapshotsAsync<Brand>(db,CheckoutCatalogQuery.Versions(rows.Select(r=>new CatalogReadVersion(r.Brand.Id,r.Brand.Version))),ct);
    }
    private static BusinessException Invalid()=>new("invalid_offer_catalog","Use at most 64 distinct current SKU ids.");
    private static BusinessException Changed()=>new("version_conflict","The offer SKU changed while being read.");
}
