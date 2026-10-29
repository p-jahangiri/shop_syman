using Microsoft.EntityFrameworkCore;
using Shop.Modules.Catalog.Domain;
using Shop.SharedKernel;
namespace Shop.Modules.Catalog.Infrastructure;
public sealed record CheckoutCatalogCandidate(string Id,string ProductId,string CategoryId,string BrandId,string Slug,string? Name,string? Fallback,string Label,long PriceRial,bool IsDigital,string Sku,string SellerId,string Warranty,byte[] VariantVersion,byte[] ProductVersion,byte[] CategoryVersion,byte[] BrandVersion,string? UsedInspectionId=null);
public static class CheckoutCatalogQuery
{
    public static IQueryable<CheckoutCatalogCandidate> Read(CatalogDbContext db,string locale,string[] ids,DateTimeOffset now)=>
        from v in db.Variants.AsNoTracking()
        join p in db.Products.AsNoTracking() on v.ProductId equals p.Id
        join c in db.Categories.AsNoTracking() on p.CategoryId equals c.Id
        join b in db.Brands.AsNoTracking() on p.BrandId equals b.Id
        where ids.Contains(v.Id)&&v.IsActive&&p.Status=="Published"&&(p.PublishAt==null||p.PublishAt<=now)&&c.IsActive&&b.IsActive
        select new CheckoutCatalogCandidate(v.Id,p.Id,p.CategoryId,p.BrandId,p.Slug,p.Translations.Where(t=>t.Locale==locale).Select(t=>t.Name).FirstOrDefault(),p.Translations.Where(t=>t.Locale=="fa").Select(t=>t.Name).FirstOrDefault(),locale=="en"?v.LabelEn:v.LabelFa,v.PriceRial,p.IsDigital,v.Sku,p.SellerId,locale=="en"?v.WarrantyEn:v.WarrantyFa,v.Version,p.Version,c.Version,b.Version,v.UsedInspectionId);
    public static CatalogReadVersion[] Versions(IEnumerable<CatalogReadVersion> rows)
    {
        return rows.GroupBy(r=>r.Id,StringComparer.Ordinal).Select(group=>{var first=group.First();if(group.Any(r=>!r.Version.SequenceEqual(first.Version)))throw new BusinessException("version_conflict","Catalogue versions changed inside the checkout projection.");return new CatalogReadVersion(first.Id,first.Version.ToArray());}).ToArray();
    }
}
public sealed partial class CatalogService : ICheckoutCatalogReader
{
    public async Task<IReadOnlyDictionary<string, CheckoutVariantData>> ReadCheckoutVariantsAsync(string locale,IReadOnlyCollection<string> variantIds,CancellationToken ct)
    {
        if(locale is not ("fa" or "en")||variantIds.Count>64)throw new BusinessException("invalid_cart","Use a supported locale and at most 64 variants.");
        var ids=variantIds.Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        if(ids.Length==0)return new Dictionary<string,CheckoutVariantData>(StringComparer.OrdinalIgnoreCase);
        return await CatalogReadRetry.RunAsync(async token=>{
            var rows=await CheckoutCatalogQuery.Read(db,locale,ids,DateTimeOffset.UtcNow).ToArrayAsync(token);
            if(rows.Length==0)return (IReadOnlyDictionary<string,CheckoutVariantData>)new Dictionary<string,CheckoutVariantData>(StringComparer.OrdinalIgnoreCase);
            var usedConditions=await UsedItemConditions.CurrentAsync(db,rows.Select(v=>(v.Id,v.UsedInspectionId)),token);
            var foundIds=rows.Select(v=>v.Id).ToArray();var productIds=rows.Select(v=>v.ProductId).Distinct().ToArray();
            var methods=await db.Set<ProductPurchaseMethod>().AsNoTracking().Where(m=>productIds.Contains(m.ProductId)).ToArrayAsync(token);
            var variantMethods=await db.Set<VariantPurchaseMethod>().AsNoTracking().Where(m=>foundIds.Contains(m.VariantId)).ToArrayAsync(token);
            var plans=await db.Set<ProductCreditPlan>().AsNoTracking().Where(p=>productIds.Contains(p.ProductId)).ToArrayAsync(token);
            await CatalogReadVersions.EnsureSnapshotsAsync<Product>(db,CheckoutCatalogQuery.Versions(rows.Select(r=>new CatalogReadVersion(r.ProductId,r.ProductVersion))),token);
            await CatalogReadVersions.EnsureSnapshotsAsync<ProductVariant>(db,CheckoutCatalogQuery.Versions(rows.Select(r=>new CatalogReadVersion(r.Id,r.VariantVersion))),token);
            await CatalogReadVersions.EnsureSnapshotsAsync<Category>(db,CheckoutCatalogQuery.Versions(rows.Select(r=>new CatalogReadVersion(r.CategoryId,r.CategoryVersion))),token);
            await CatalogReadVersions.EnsureSnapshotsAsync<Brand>(db,CheckoutCatalogQuery.Versions(rows.Select(r=>new CatalogReadVersion(r.BrandId,r.BrandVersion))),token);
            return (IReadOnlyDictionary<string,CheckoutVariantData>)rows.ToDictionary(v=>v.Id,v=>{
                var item=new CartCatalogVariant(v.Id,v.ProductId,v.CategoryId,v.Slug,v.Name??v.Fallback??"",v.Label,v.PriceRial,v.IsDigital);
                var own=variantMethods.Where(m=>m.VariantId==v.Id).Select(m=>m.MethodId).Order(StringComparer.Ordinal).ToArray();
                return new CheckoutVariantData(item,v.Sku,v.SellerId,v.Warranty,Convert.ToBase64String(v.VariantVersion),methods.Where(m=>m.ProductId==v.ProductId).Select(m=>m.MethodId).Order(StringComparer.Ordinal).ToArray(),own.Length==0?null:own,plans.Where(p=>p.ProductId==v.ProductId).Select(p=>p.PlanId).Order(StringComparer.Ordinal).ToArray(),usedConditions.GetValueOrDefault(v.Id));
            },StringComparer.OrdinalIgnoreCase);
        },ct);
    }
}
