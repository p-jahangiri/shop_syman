using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Domain;
using Shop.SharedKernel;

namespace Shop.Modules.Catalog.Infrastructure;
public sealed partial class CatalogService:IMarketModelCatalog
{
    private async Task<(Product? Existing,ProductInput Input)> ModelProductInputAsync(string? id,CatalogModelInput input,CancellationToken ct)
    {
        if(id is null&&input.Version is not null)throw new BusinessException("version_conflict","A new model must not carry an existing version.");
        var existing=id is null?null:await Graph.AsNoTracking().SingleOrDefaultAsync(p=>p.Id==id,ct)??throw new BusinessException("not_found","Model was not found.");
        if(existing?.IsDigital==true)throw new BusinessException("invalid_market_model","Market sourcing currently accepts physical models only.");
        // A model edit preserves every existing offer, price and purchase rule.
        // New market-only models have no SKU, variant or inventory record.
        var variants=existing?.Variants.Select(v=>new VariantInput(v.Id,v.Sku,v.PriceRial.ToString(CultureInfo.InvariantCulture),v.CompareAtPriceRial?.ToString(CultureInfo.InvariantCulture),v.Color,v.ColorNameFa,v.ColorNameEn,v.LabelFa,v.LabelEn,v.WarrantyFa,v.WarrantyEn,v.IsActive,
            v.Attributes.Select(a=>new AttributeValueInput(a.AttributeId,a.ValueTextFa,a.ValueTextEn,a.ValueNumber,a.ValueBool,a.ValueOptionId)).ToArray(),v.PurchaseMethods.Select(m=>m.MethodId).ToArray(),Convert.ToBase64String(v.Version))).ToArray()??[];
        var translated=input.Translations.Select(t=>new TranslationInput(t.Locale,t.Name,t.Description,existing?.Translations.FirstOrDefault(e=>e.Locale==t.Locale)?.Badge)).ToArray();
        var values=input.Attributes.Select(a=>new AttributeValueInput(a.AttributeId,a.TextFa,a.TextEn,a.Number,a.Bool,a.OptionId,a.OptionIds)).ToArray();
        var product=new ProductInput(input.CategoryId,input.BrandId,input.Slug,existing?.Status??"Draft",false,existing?.Featured??false,translated,values,variants,input.ImageUrls,existing?.PurchaseMethods.Select(m=>m.MethodId).ToArray()??[],existing?.CreditPlans.Select(p=>p.PlanId).ToArray()??[],input.Version);
        return (existing,product);
    }
    async Task<string> IMarketModelCatalog.SaveAsync(string? id,CatalogModelInput input,string actorId,CancellationToken ct)
    {
        var prepared=await ModelProductInputAsync(id,input,ct);
        return await SaveProductAsync(id,prepared.Input,actorId,ct);
    }
    public async Task<CatalogModelEditable> ReadEditableAsync(string id,CancellationToken ct)
    {
        PurchaseAdminFilter.Id(id);
        var product=await Graph.AsNoTracking().SingleOrDefaultAsync(p=>p.Id==id,ct)??throw new BusinessException("not_found","Model was not found.");
        if(product.IsDigital)throw new BusinessException("invalid_market_model","Market sourcing accepts physical models only.");
        await CatalogReadVersions.EnsureProductsAsync(db,[product],ct);
        var input=new CatalogModelInput(product.CategoryId,product.BrandId,product.Slug,product.Translations.Select(t=>new ModelTranslationInput(t.Locale,t.Name,t.Description)).ToArray(),product.Attributes.Select(a=>new ModelAttributeInput(a.AttributeId,a.ValueTextFa,a.ValueTextEn,a.ValueNumber,a.ValueBool,a.ValueOptionId,a.Selections.Count==0?null:a.Selections.Select(s=>s.OptionId).ToArray())).ToArray(),product.Media.Where(m=>m.Type=="image").OrderBy(m=>m.SortOrder).Select(m=>m.Url).ToArray(),Convert.ToBase64String(product.Version));
        return new(input,product.Status,product.Variants.Count>0);
    }
    public async Task<Dictionary<string,string>> ResolveAttributeKeysAsync(string[] keys,CancellationToken ct)
    {
        if(keys.Length>64||keys.Distinct(StringComparer.OrdinalIgnoreCase).Count()!=keys.Length)throw new BusinessException("invalid_market_csv","Use up to 64 distinct attribute keys.");
        return await db.AttributeDefinitions.AsNoTracking().Where(d=>keys.Contains(d.Key)).ToDictionaryAsync(d=>d.Key,d=>d.Id,ct);
    }
    public async Task<string> ValidateAsync(string? id,CatalogModelInput input,bool publishInMarket,CancellationToken ct)
    {
        var prepared=await ModelProductInputAsync(id,input,ct);
        if(prepared.Existing is not null)CatalogRules.Version(prepared.Existing.Version,input.Version);
        var metadataBefore=await ModelMetadataFingerprintAsync(prepared.Input,ct);
        await ValidateProductInputAsync(id,prepared.Input,ct);
        if(await db.Products.AnyAsync(p=>p.Slug==input.Slug&&(id==null||p.Id!=id),ct))throw new BusinessException("model_slug_conflict","This slug belongs to another model. Supply model_id to link an existing model.");
        if(publishInMarket){
            var category=await db.Categories.AsNoTracking().Include(c=>c.Attributes).SingleAsync(c=>c.Id==input.CategoryId,ct);
            if(prepared.Existing?.Status=="Hidden"||!category.IsActive||!await db.Brands.AnyAsync(b=>b.Id==input.BrandId&&b.IsActive,ct)||input.ImageUrls.Length==0||category.Attributes.Any(a=>a.IsRequired&&!input.Attributes.Any(v=>v.AttributeId==a.AttributeId)))throw new BusinessException("incomplete_market_model","Market publication requires an eligible model and all required base attributes.");
        }
        var metadataAfter=await ModelMetadataFingerprintAsync(prepared.Input,ct);
        if(metadataBefore!=metadataAfter)throw new BusinessException("version_conflict","Model metadata changed during validation.");
        return metadataAfter;
    }
    private async Task<string> ModelMetadataFingerprintAsync(ProductInput input,CancellationToken ct)
    {
        var category=await db.Categories.AsNoTracking().Where(c=>c.Id==input.CategoryId).Select(c=>new{c.Id,c.Version}).SingleOrDefaultAsync(ct);
        var brand=await db.Brands.AsNoTracking().Where(b=>b.Id==input.BrandId).Select(b=>new{b.Id,b.Version}).SingleOrDefaultAsync(ct);
        var ids=input.Attributes.Select(a=>a.AttributeId).Concat(input.Variants.SelectMany(v=>v.Attributes.Select(a=>a.AttributeId))).Distinct().ToArray();
        var definitions=await db.AttributeDefinitions.AsNoTracking().Where(d=>ids.Contains(d.Id)).OrderBy(d=>d.Id).Select(d=>new{d.Id,d.Version}).ToArrayAsync(ct);
        var json=System.Text.Json.JsonSerializer.Serialize(new{Category=category,Brand=brand,Definitions=definitions});
        return Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(json)));
    }
    public Task<CatalogModelRead[]> ReadCandidatesAsync(string locale,string[] ids,CancellationToken ct)
    {
        if(locale is not ("fa" or "en")||ids.Length>24||ids.Distinct(StringComparer.OrdinalIgnoreCase).Count()!=ids.Length)throw new BusinessException("invalid_market_input","Use a supported locale and up to 24 distinct model ids.");
        foreach(var id in ids)PurchaseAdminFilter.Id(id);
        return ids.Length==0?Task.FromResult(Array.Empty<CatalogModelRead>()):CatalogReadRetry.RunAsync(token=>ReadModelCandidatesAttemptAsync(locale,ids,token),ct);
    }
    private async Task<CatalogModelRead[]> ReadModelCandidatesAttemptAsync(string locale,string[] ids,CancellationToken ct)
    {
        var eligible=await db.MarketModels.AsNoTracking().Where(m=>m.IsEligible&&ids.Contains(m.ModelId)).ToDictionaryAsync(m=>m.ModelId,ct);
        var keys=eligible.Keys.ToArray();
        var products=await db.Products.AsNoTracking().Where(p=>keys.Contains(p.Id)).Include(p=>p.Translations).Include(p=>p.Attributes).ThenInclude(a=>a.Selections).Include(p=>p.Media).AsSplitQuery().ToArrayAsync(ct);
        var categoryIds=products.Select(p=>p.CategoryId).Distinct().ToArray();var brandIds=products.Select(p=>p.BrandId).Distinct().ToArray();var definitionIds=products.SelectMany(p=>p.Attributes.Select(a=>a.AttributeId)).Distinct().ToArray();
        var categories=await db.Categories.AsNoTracking().Where(c=>categoryIds.Contains(c.Id)).ToArrayAsync(ct);
        var brands=await db.Brands.AsNoTracking().Where(b=>brandIds.Contains(b.Id)).ToArrayAsync(ct);
        var definitions=await db.AttributeDefinitions.AsNoTracking().Where(d=>definitionIds.Contains(d.Id)).ToArrayAsync(ct);
        var optionIds=products.SelectMany(p=>p.Attributes.SelectMany(a=>a.Selections.Select(s=>s.OptionId).Concat(a.ValueOptionId is null?[]:new[]{a.ValueOptionId}))).Distinct().ToArray();
        var options=await db.AttributeOptions.AsNoTracking().Where(o=>optionIds.Contains(o.Id)).ToArrayAsync(ct);
        CatalogReadVersions.EnsureUnchanged(eligible.Values.Select(m=>new CatalogReadVersion(m.ModelId,m.Version)).ToArray(),CatalogReadVersions.Capture(products));
        await CatalogReadVersions.EnsureAsync(db,products,ct);await CatalogReadVersions.EnsureAsync(db,categories,ct);await CatalogReadVersions.EnsureAsync(db,brands,ct);await CatalogReadVersions.EnsureAsync(db,definitions,ct);
        var fresh=await db.MarketModels.AsNoTracking().Where(m=>m.IsEligible&&keys.Contains(m.ModelId)).ToDictionaryAsync(m=>m.ModelId,ct);
        if(fresh.Count!=eligible.Count||eligible.Values.Any(m=>!fresh.TryGetValue(m.ModelId,out var current)||!m.Version.SequenceEqual(current.Version)||m.Brand!=current.Brand||m.SearchFa!=current.SearchFa||m.SearchEn!=current.SearchEn))throw new BusinessException("version_conflict","Model publication eligibility changed while reading.");
        var defs=definitions.ToDictionary(d=>d.Id);var brandMap=brands.ToDictionary(b=>b.Id);
        string Text(ProductAttributeValue value){
            if(!defs.TryGetValue(value.AttributeId,out var definition))throw new BusinessException("version_conflict","Model definitions changed while reading.");
            string Option(string id){var option=options.SingleOrDefault(o=>o.AttributeId==value.AttributeId&&o.Id==id)??throw new BusinessException("version_conflict","Model options changed while reading.");return locale=="en"?option.LabelEn:option.LabelFa;}
            if(value.Selections.Count>0)return string.Join(", ",value.Selections.OrderBy(s=>s.OptionId,StringComparer.Ordinal).Select(s=>Option(s.OptionId)));
            if(value.ValueOptionId is not null)return Option(value.ValueOptionId);
            if(value.ValueNumber is not null)return value.ValueNumber.Value.ToString("0.########",CultureInfo.InvariantCulture)+(string.IsNullOrEmpty(definition.Unit)?"":" "+definition.Unit);
            if(value.ValueBool is {} flag)return flag?(locale=="en"?"Yes":"بله"):(locale=="en"?"No":"خیر");
            return locale=="en"?value.ValueTextEn??value.ValueTextFa??"":value.ValueTextFa??value.ValueTextEn??"";
        }
        return products.Select(p=>{
            var translation=p.Translations.Single(t=>t.Locale==locale);var images=p.Media.Where(m=>m.Type=="image").OrderBy(m=>m.SortOrder).ThenBy(m=>m.Id).Select(m=>m.Url).Take(24).ToArray();
            if(!brandMap.TryGetValue(p.BrandId,out var brand))throw new BusinessException("version_conflict","Model brand changed while reading.");
            var model=new CatalogModelDto(p.Id,p.Slug,p.CategoryId,p.BrandId,brand.Name,translation.Name,p.Translations.Single(t=>t.Locale=="en").Name,translation.Description,images.FirstOrDefault()??"",images,p.Attributes.ToDictionary(a=>defs[a.AttributeId].Key,Text));
            return new CatalogModelRead(model,Convert.ToBase64String(p.Version));
        }).ToArray();
    }
}
