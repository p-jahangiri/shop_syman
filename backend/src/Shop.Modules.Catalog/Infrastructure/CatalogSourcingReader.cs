using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Catalog.Domain;
using Shop.SharedKernel;

namespace Shop.Modules.Catalog.Infrastructure;

public sealed class CatalogSourcingReader(CatalogDbContext db):ICatalogSourcingReader
{
    public Task<IReadOnlyDictionary<string,SourcingModelSnapshot>> ReadAsync(string[] modelIds,CancellationToken ct)
    {
        if(modelIds.Length>24||modelIds.Distinct(StringComparer.Ordinal).Count()!=modelIds.Length)throw new BusinessException("invalid_sourcing_input","Use at most 24 distinct models.");
        foreach(var id in modelIds)PurchaseAdminFilter.Id(id);
        if(modelIds.Length==0)return Task.FromResult<IReadOnlyDictionary<string,SourcingModelSnapshot>>(new Dictionary<string,SourcingModelSnapshot>());
        return CatalogReadRetry.RunAsync(token=>ReadAttemptAsync(modelIds,token),ct);
    }
    private async Task<IReadOnlyDictionary<string,SourcingModelSnapshot>> ReadAttemptAsync(string[] ids,CancellationToken ct)
    {
        var eligible=await db.MarketModels.AsNoTracking().Where(m=>m.IsEligible&&ids.Contains(m.ModelId)).ToDictionaryAsync(m=>m.ModelId,ct);
        var keys=eligible.Keys.ToArray();
        var products=await db.Products.AsNoTracking().Where(p=>keys.Contains(p.Id)).Include(p=>p.Translations).Include(p=>p.Attributes).ThenInclude(a=>a.Selections).Include(p=>p.Media).AsSplitQuery().ToArrayAsync(ct);
        if(products.Any(p=>p.Attributes.Count>64||p.Media.Count>24))throw new BusinessException("sourcing_capacity_unavailable","This model exceeds the supported sourcing snapshot capacity.");
        var categoryIds=products.Select(p=>p.CategoryId).Distinct().ToArray();var brandIds=products.Select(p=>p.BrandId).Distinct().ToArray();
        var categories=await db.Categories.AsNoTracking().Where(c=>categoryIds.Contains(c.Id)).Include(c=>c.Translations).Include(c=>c.Attributes).AsSplitQuery().ToArrayAsync(ct);
        var brands=await db.Brands.AsNoTracking().Where(b=>brandIds.Contains(b.Id)).ToArrayAsync(ct);
        var definitionIds=products.SelectMany(p=>p.Attributes.Select(a=>a.AttributeId)).Distinct().ToArray();
        var definitions=await db.AttributeDefinitions.AsNoTracking().Where(d=>definitionIds.Contains(d.Id)).Include(d=>d.Translations).Include(d=>d.Options).AsSplitQuery().ToArrayAsync(ct);
        CatalogReadVersions.EnsureUnchanged(eligible.Values.Select(m=>new CatalogReadVersion(m.ModelId,m.Version)).ToArray(),CatalogReadVersions.Capture(products));
        await CatalogReadVersions.EnsureAsync(db,products,ct);await CatalogReadVersions.EnsureAsync(db,categories,ct);await CatalogReadVersions.EnsureAsync(db,brands,ct);await CatalogReadVersions.EnsureAsync(db,definitions,ct);
        var fresh=await db.MarketModels.AsNoTracking().Where(m=>m.IsEligible&&keys.Contains(m.ModelId)).ToDictionaryAsync(m=>m.ModelId,ct);
        if(fresh.Count!=eligible.Count||eligible.Values.Any(m=>!fresh.TryGetValue(m.ModelId,out var next)||!m.Version.SequenceEqual(next.Version)||m.HasAvailableStoreOffer!=next.HasAvailableStoreOffer))throw Changed();
        var definitionMap=definitions.ToDictionary(d=>d.Id);var categoryMap=categories.ToDictionary(c=>c.Id);var brandMap=brands.ToDictionary(b=>b.Id);
        var result=new Dictionary<string,SourcingModelSnapshot>(StringComparer.Ordinal);
        foreach(var p in products.OrderBy(p=>p.Id,StringComparer.Ordinal)){
            if(!categoryMap.TryGetValue(p.CategoryId,out var category)||!brandMap.TryGetValue(p.BrandId,out var brand)||!category.IsActive||!brand.IsActive)throw Changed();
            var fa=p.Translations.SingleOrDefault(t=>t.Locale=="fa")??throw Changed();var en=p.Translations.SingleOrDefault(t=>t.Locale=="en")??throw Changed();
            var categoryFa=category.Translations.SingleOrDefault(t=>t.Locale=="fa")??throw Changed();var categoryEn=category.Translations.SingleOrDefault(t=>t.Locale=="en")??throw Changed();
            var visible=category.Attributes.Where(a=>a.ShowInSpecs||a.IsComparable).Select(a=>a.AttributeId).ToHashSet(StringComparer.Ordinal);
            var attributes=p.Attributes.Where(a=>visible.Contains(a.AttributeId)).OrderBy(a=>a.AttributeId,StringComparer.Ordinal).Select(value=>{
                if(!definitionMap.TryGetValue(value.AttributeId,out var definition))throw Changed();
                var labelFa=definition.Translations.SingleOrDefault(t=>t.Locale=="fa")??throw Changed();var labelEn=definition.Translations.SingleOrDefault(t=>t.Locale=="en")??throw Changed();
                var selectionIds=value.Selections.Select(s=>s.OptionId).Concat(value.ValueOptionId is null?[]:new[]{value.ValueOptionId}).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToArray();
                var options=selectionIds.Select(id=>{var option=definition.Options.SingleOrDefault(o=>o.Id==id)??throw Changed();return new SourcingOptionSnapshot(id,option.LabelFa,option.LabelEn);}).ToArray();
                return new SourcingAttributeSnapshot(definition.Id,definition.Key,definition.DataType.ToString(),labelFa.Name,labelEn.Name,definition.Unit,labelFa.Unit,labelEn.Unit,value.ValueTextFa,value.ValueTextEn,value.ValueNumber,value.ValueBool,options);
            }).ToArray();
            // Parent versions cover their translation/options/category assignment children.
            // Values are included as an additional defense and deterministic display snapshot.
            var version=Convert.ToBase64String(p.Version);var images=p.Media.OrderBy(m=>m.SortOrder).ThenBy(m=>m.Id,StringComparer.Ordinal).Select(m=>m.Url).ToArray();
            var fingerprint=Hash(new{p.Id,Version=version,CategoryVersion=Convert.ToBase64String(category.Version),BrandVersion=Convert.ToBase64String(brand.Version),Definitions=definitions.Where(d=>p.Attributes.Any(a=>a.AttributeId==d.Id)).OrderBy(d=>d.Id,StringComparer.Ordinal).Select(d=>new{d.Id,Version=Convert.ToBase64String(d.Version)}),Attributes=attributes,Images=images,Available=fresh[p.Id].HasAvailableStoreOffer});
            result.Add(p.Id,new(p.Id,p.Slug,p.CategoryId,categoryFa.Name,categoryEn.Name,p.BrandId,brand.Name,fa.Name,en.Name,fa.Description,en.Description,images,version,fingerprint,fresh[p.Id].HasAvailableStoreOffer,attributes));
        }
        return result;
    }
    private static string Hash<T>(T value)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(value))));
    private static BusinessException Changed()=>new("version_conflict","The sourcing model changed while being read.");
}
