using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Domain;
using Shop.SharedKernel;
using Shop.Modules.Catalog.Media;

namespace Shop.Modules.Catalog.Infrastructure;

public sealed partial class CatalogService(CatalogDbContext db, IInventoryReader inventory, IPurchaseConfiguration purchasing, TimeProvider time,IInventorySerialGuard serialGuard) : ICatalogService
{
    public Task<bool> VariantExistsAsync(string id, CancellationToken ct) => db.Variants.AnyAsync(x => x.Id == id, ct);
    public async Task<bool> CategoriesExistAsync(string[] ids, CancellationToken ct) => ids.Length == await db.Categories.CountAsync(x => ids.Contains(x.Id), ct);
    public async Task<string> SaveBrandAsync(string? id, BrandInput input, CancellationToken ct)
    {
        CatalogRules.Slug(input.Slug);
        if (string.IsNullOrWhiteSpace(input.Name) || input.Name.Length > 120) throw new BusinessException("invalid_brand", "Provide a brand name up to 120 characters.");
        var logoUrl = input.LogoUrl == "" ? "" : SafeImage(input.LogoUrl);
        var entity = id is null ? new Brand() : await db.Brands.SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw new BusinessException("not_found", "Brand was not found.");
        if (id is not null) CatalogRules.Version(entity.Version, input.Version);
        if(logoUrl.Length>0)await ValidateUploadedImagesAsync([logoUrl],ct);
        entity.Name = input.Name.Trim(); entity.Slug = input.Slug; entity.LogoUrl = logoUrl; entity.IsActive = input.IsActive; Touch(entity, id is null);
        if (id is null) db.Brands.Add(entity); await db.SaveChangesAsync(ct); return entity.Id;
    }
    private IQueryable<Product> Graph => CatalogProductGraph.Read(db);

    public Task<CatalogSnapshot> ReadAsync(string locale, CancellationToken ct, bool hideUsed = false) =>
        ReadCoreAsync(locale, null, false, ct, hideUsed);
    public Task<CatalogSnapshot> ReadMetadataAsync(string locale, CancellationToken ct) => ReadCoreAsync(locale, [], true, ct);
    private Task<CatalogSnapshot> ReadCoreAsync(string locale,string[]? productIds,bool metadataOnly,CancellationToken ct,bool hideUsed=false)=>CatalogReadRetry.RunAsync(token=>ReadCoreAttemptAsync(locale,productIds,metadataOnly,token,hideUsed:hideUsed),ct);
    private async Task<CatalogSnapshot> ReadCoreAttemptAsync(string locale, string[]? productIds, bool metadataOnly, CancellationToken ct,CatalogReadVersion[]? expectedProducts=null,CatalogReadVersion[]? expectedVariants=null,bool hideUsed=false)
    {
        var categories = await db.Categories.AsNoTracking().Include(x => x.Translations).Include(x => x.Attributes).Where(x => x.IsActive).OrderBy(x => x.SortOrder).ToListAsync(ct);
        var definitions = await db.AttributeDefinitions.AsNoTracking().Include(x => x.Translations).ToListAsync(ct);
        var definitionMap = definitions.ToDictionary(x => x.Id);
        var brands = await db.Brands.AsNoTracking().Where(x => x.IsActive).ToDictionaryAsync(x => x.Id, ct);
        var categoryIds = categories.Select(x => x.Id).ToArray();
        var brandIds = brands.Keys.ToArray();
        var now = DateTimeOffset.UtcNow;
        var products = metadataOnly ? [] : await Graph.AsNoTracking().Where(x => x.Status == "Published" && categoryIds.Contains(x.CategoryId) && brandIds.Contains(x.BrandId) && (x.PublishAt == null || x.PublishAt <= now) && (productIds == null || productIds.Contains(x.Id))).ToListAsync(ct);
        var usedConditions = hideUsed
            ? new Dictionary<string, UsedItemConditionData>()
            : await UsedItemConditions.CurrentAsync(db, products.SelectMany(p => p.Variants).Select(v => (v.Id, v.UsedInspectionId)), ct);
        var optionIds=products.SelectMany(p=>p.Attributes.SelectMany(v=>v.Selections.Select(x=>x.OptionId).Concat(v.ValueOptionId is null?[]:new[]{v.ValueOptionId})).Concat(p.Variants.SelectMany(v=>v.Attributes.Where(a=>a.ValueOptionId!=null).Select(a=>a.ValueOptionId!)))).Distinct().ToArray();
        if(optionIds.Length>0){var used=await db.AttributeOptions.AsNoTracking().Where(o=>optionIds.Contains(o.Id)).ToArrayAsync(ct);foreach(var group in used.GroupBy(o=>o.AttributeId))if(definitionMap.TryGetValue(group.Key,out var definition))definition.Options=group.ToList();}
        if(expectedProducts is not null)CatalogReadVersions.EnsureUnchanged(expectedProducts,CatalogReadVersions.Capture(products));
        if(expectedVariants is not null){var wanted=expectedVariants.Select(v=>v.Id).ToHashSet(StringComparer.Ordinal);CatalogReadVersions.EnsureUnchanged(expectedVariants,CatalogReadVersions.Capture(products.SelectMany(p=>p.Variants).Where(v=>wanted.Contains(v.Id))));}
        await CatalogReadVersions.EnsureAsync(db,categories,ct);
        await CatalogReadVersions.EnsureAsync(db,definitions,ct);
        await CatalogReadVersions.EnsureAsync(db,brands.Values,ct);
        await CatalogReadVersions.EnsureProductsAsync(db,products,ct);
        var referenced=categories.SelectMany(c=>c.Attributes.Select(a=>a.AttributeId)).Concat(products.SelectMany(p=>p.Attributes.Select(a=>a.AttributeId).Concat(p.Variants.SelectMany(v=>v.Attributes.Select(a=>a.AttributeId)))));
        if(referenced.Any(id=>!definitionMap.ContainsKey(id)))throw new BusinessException("version_conflict","Catalogue definitions changed while reading their values.");
        IReadOnlyDictionary<string,int> availability = products.Count == 0 ? new Dictionary<string,int>() : await inventory.AvailableAsync(products.SelectMany(p => p.Variants).Select(v => v.Id), ct);
        string Name(AttributeDefinition d) => d.Translations.FirstOrDefault(t => t.Locale == locale)?.Name ?? d.Translations.First(t => t.Locale == "fa").Name;
        string Text(AttributeDefinition d, string? fa, string? en, decimal? number, bool? boolean, string? option, IEnumerable<string>? options = null)
        {
            string Option(string id) { var o = d.Options.FirstOrDefault(x => x.Id == id); return o is null ? "" : locale == "en" ? o.LabelEn : o.LabelFa; }
            if (options?.Any() == true) return string.Join(", ", options.Select(Option));
            if (option is not null) return Option(option);
            if (number is not null) return number.Value.ToString("0.########", CultureInfo.InvariantCulture) + (string.IsNullOrEmpty(d.Unit) ? "" : " " + d.Unit);
            if (boolean is not null) return boolean.Value ? locale == "en" ? "Yes" : "بله" : locale == "en" ? "No" : "خیر";
            return locale == "en" ? en ?? fa ?? "" : fa ?? en ?? "";
        }
        var categoryDtos = categories.Select(c => {
            var tr = c.Translations.FirstOrDefault(x => x.Locale == locale) ?? c.Translations.First(x => x.Locale == "fa");
            return new CategoryDto(c.Id, tr.Name, tr.Description, c.ImageUrl, c.Attributes.Where(a => a.IsFilterable).OrderBy(a => a.SortOrder).Select(a => new FilterDto(definitionMap[a.AttributeId].Key, Name(definitionMap[a.AttributeId]))).ToArray(), c.ParentId, c.Attributes.OrderBy(a=>a.SortOrder).Select(a=>new CategoryAttributeRuleDto(definitionMap[a.AttributeId].Key,a.IsComparable,a.ShowInSpecs,a.IsVariantAxis)).ToArray());
        }).ToArray();
        var productDtos = products.Select(p => {
            var tr = p.Translations.FirstOrDefault(x => x.Locale == locale) ?? p.Translations.First(x => x.Locale == "fa");
            var variants = p.Variants.Where(v => v.IsActive && (!hideUsed || v.UsedInspectionId == null));
            var videos = p.Media.Where(m => m.Type == "video" &&
                (!hideUsed || m.VariantId is null || variants.Any(v => v.Id == m.VariantId)))
                .OrderBy(m => m.SortOrder).Select(m => new ProductVideoDto(m.Url, m.VariantId)).ToArray();
            return new ProductDto(p.Id, p.Slug, tr.Name, p.Translations.FirstOrDefault(x => x.Locale == "en")?.Name ?? tr.Name, p.CategoryId, brands[p.BrandId].Name, tr.Description,
                p.Media.Where(m=>m.Type=="image").OrderBy(x => x.SortOrder).FirstOrDefault()?.Url ?? "", tr.Badge, p.IsDigital, p.Featured,
                p.Attributes.ToDictionary(x => definitionMap[x.AttributeId].Key, x => Text(definitionMap[x.AttributeId], x.ValueTextFa, x.ValueTextEn, x.ValueNumber, x.ValueBool, x.ValueOptionId, x.Selections.Select(s => s.OptionId))),
                variants.Select(v => new VariantDto(v.Id, v.Sku, locale == "en" ? v.LabelEn : v.LabelFa, v.Color, locale == "en" ? v.ColorNameEn : v.ColorNameFa,
                    v.PriceRial.ToString(CultureInfo.InvariantCulture), v.CompareAtPriceRial?.ToString(CultureInfo.InvariantCulture), availability.GetValueOrDefault(v.Id), locale == "en" ? v.WarrantyEn : v.WarrantyFa,
                    v.Attributes.ToDictionary(x => definitionMap[x.AttributeId].Key, x => Text(definitionMap[x.AttributeId], x.ValueTextFa, x.ValueTextEn, x.ValueNumber, x.ValueBool, x.ValueOptionId)), v.PurchaseMethods.Count == 0 ? null : v.PurchaseMethods.Select(m => m.MethodId).ToArray(),usedConditions.GetValueOrDefault(v.Id))).ToArray(),
                p.PurchaseMethods.Select(m => m.MethodId).ToArray(), p.CreditPlans.Select(m => m.PlanId).ToArray(),p.Media.Where(m=>m.Type=="image").OrderBy(m=>m.SortOrder).Select(m=>m.Url).Take(24).ToArray(),videos.Length > 0 ? videos : null);
        }).Where(p => p.Variants.Length > 0).ToArray();
        return new(categoryDtos, productDtos, definitions.Select(d => new DefinitionDto(d.Key, Name(d), char.ToLowerInvariant(d.DataType.ToString()[0]) + d.DataType.ToString()[1..], d.Unit,
            categories.Any(c => c.Attributes.Any(a => a.AttributeId == d.Id && a.IsComparable)), categories.Any(c => c.Attributes.Any(a => a.AttributeId == d.Id && a.IsFilterable)), categories.Any(c => c.Attributes.Any(a => a.AttributeId == d.Id && a.ShowInSpecs)))).ToArray(), definitions.ToDictionary(d => d.Key, Name));
    }

    public Task<object> AdminReadAsync(CancellationToken ct) => AdminReadCoreAsync(false, ct);
    public Task<object> AdminMetadataAsync(CancellationToken ct) => AdminReadCoreAsync(true, ct);
    private async Task<object> AdminReadCoreAsync(bool metadataOnly, CancellationToken ct)
    {
        var categories=await db.Categories.AsNoTracking().Include(c=>c.Translations).Include(c=>c.Attributes).AsSplitQuery().OrderBy(c=>c.SortOrder).ToListAsync(ct);
        var brands=await db.Brands.AsNoTracking().ToListAsync(ct);
        var attributes=await db.AttributeDefinitions.AsNoTracking().Include(a=>a.Translations).Include(a=>a.Options).AsSplitQuery().ToListAsync(ct);
        var products=metadataOnly?new List<Product>():await Graph.AsNoTracking().ToListAsync(ct);
        await CatalogReadVersions.EnsureAsync(db,categories,ct);
        await CatalogReadVersions.EnsureAsync(db,attributes,ct);
        await CatalogReadVersions.EnsureProductsAsync(db,products,ct);
        return new { Categories=categories,Brands=brands,Attributes=attributes,Products=products };
    }

    public async Task<string> SaveCategoryAsync(string? id, CategoryInput input, CancellationToken ct)
    {
        CatalogRules.Slug(input.Slug); CatalogRules.Translations(input.Translations);
        if(db.Database.CurrentTransaction is {} existing&&existing.GetDbTransaction().IsolationLevel!=IsolationLevel.Serializable)throw new InvalidOperationException("This operation requires a Serializable transaction.");
        await using var transaction = db.Database.CurrentTransaction is null?await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct):null;
        var entity = id is null ? new Category() : await db.Categories.Include(x => x.Translations).Include(x => x.Attributes).SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw new BusinessException("not_found", "Category was not found.");
        if (id is not null) CatalogRules.Version(entity.Version, input.Version);
        var parents = await db.Categories.AsNoTracking().ToDictionaryAsync(x => x.Id, x => x.ParentId, ct);
        var seen = new HashSet<string> { entity.Id };
        for (var parent = input.ParentId; parent is not null; parent = parents[parent])
            if (!parents.ContainsKey(parent) || !seen.Add(parent)) throw new BusinessException("invalid_category_tree", "Category parent is missing or creates a cycle.");
        if (input.Attributes.Select(a => a.AttributeId).Distinct().Count() != input.Attributes.Length) throw new BusinessException("duplicate_attribute", "Category attributes must be unique.");
        var known = await db.AttributeDefinitions.Select(x => x.Id).ToListAsync(ct);
        if (input.Attributes.Any(a => !known.Contains(a.AttributeId))) throw new BusinessException("unknown_attribute", "An attribute is not defined.");
        var axes=input.Attributes.Where(a=>a.IsVariantAxis).Select(a=>a.AttributeId).ToArray();
        if(await db.AttributeDefinitions.AnyAsync(d=>axes.Contains(d.Id)&&d.DataType==AttributeDataType.MultiSelect,ct))throw new BusinessException("invalid_variant_axis","A multi-select specification cannot be a single SKU axis.");
        await ValidateUploadedImagesAsync([input.ImageUrl],ct);
        entity.Slug = input.Slug; entity.ParentId = input.ParentId; entity.ImageUrl = SafeImage(input.ImageUrl); entity.SortOrder = input.SortOrder; entity.IsActive = input.IsActive; Touch(entity, id is null);
        foreach (var tr in input.Translations) { var target = entity.Translations.FirstOrDefault(x => x.Locale == tr.Locale); if (target is null) { target = new() { Locale = tr.Locale }; entity.Translations.Add(target); } target.Name = tr.Name.Trim(); target.Description = tr.Description; }
        foreach (var old in entity.Attributes.Where(a => input.Attributes.All(i => i.AttributeId != a.AttributeId)).ToList()) { db.Remove(old); entity.Attributes.Remove(old); }
        foreach (var a in input.Attributes) { var target = entity.Attributes.FirstOrDefault(x => x.AttributeId == a.AttributeId); if (target is null) { target = new() { AttributeId = a.AttributeId }; entity.Attributes.Add(target); } target.IsRequired = a.IsRequired; target.IsFilterable = a.IsFilterable; target.IsComparable = a.IsComparable; target.ShowInSpecs = a.ShowInSpecs; target.IsVariantAxis = a.IsVariantAxis; target.SortOrder = a.SortOrder; target.GroupName = a.GroupName; }
        if (id is null) db.Categories.Add(entity);
        await db.SaveChangesAsync(ct); if(transaction is not null)await transaction.CommitAsync(ct); return entity.Id;
    }

    public async Task<string> SaveAttributeAsync(string? id, AttributeInput input, CancellationToken ct)
    {
        CatalogRules.Slug(input.Key); CatalogRules.Translations(input.Translations);
        var entity = id is null ? new AttributeDefinition() : await db.AttributeDefinitions.Include(x => x.Options).Include(x => x.Translations).SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw new BusinessException("not_found", "Attribute was not found.");
        if (id is not null) { CatalogRules.Version(entity.Version, input.Version); if (entity.DataType != input.DataType && (await db.Set<ProductAttributeValue>().AnyAsync(x => x.AttributeId == id, ct) || await db.Set<VariantAttributeValue>().AnyAsync(x => x.AttributeId == id, ct))) throw new BusinessException("attribute_in_use", "An attribute with stored values cannot change type without a migration."); }
        if (!Enum.IsDefined(input.DataType) || input.Unit?.Length > 80 || input.DataType is not (AttributeDataType.Select or AttributeDataType.MultiSelect) && input.Options.Length > 0 || input.Options.Select(o => o.Value).Distinct().Count() != input.Options.Length || input.Options.Where(o => !string.IsNullOrEmpty(o.Id)).Select(o => o.Id).Distinct().Count() != input.Options.Count(o => !string.IsNullOrEmpty(o.Id)) || input.Options.Any(o => string.IsNullOrWhiteSpace(o.Value) || o.Value.Length > 400 || string.IsNullOrWhiteSpace(o.LabelFa) || string.IsNullOrWhiteSpace(o.LabelEn))) throw new BusinessException("invalid_options", "Attribute type or option values are invalid.");
        entity.Key = input.Key; entity.DataType = input.DataType; entity.Unit = input.Unit; Touch(entity, id is null);
        if (input.Options.Any(o => !string.IsNullOrEmpty(o.Id) && entity.Options.All(existing => existing.Id != o.Id))) throw new BusinessException("invalid_options", "An option id does not belong to this attribute.");
        foreach (var tr in input.Translations) { var target = entity.Translations.FirstOrDefault(x => x.Locale == tr.Locale); if (target is null) { target = new() { Locale = tr.Locale }; entity.Translations.Add(target); } target.Name = tr.Name.Trim(); target.Unit = input.Unit; }
        var removedOptions=entity.Options.Where(o=>input.Options.All(i=>i.Id!=o.Id)).Select(o=>o.Id).ToArray();
        if(removedOptions.Length>0&&(await db.Set<ProductAttributeValue>().AnyAsync(v=>v.ValueOptionId!=null&&removedOptions.Contains(v.ValueOptionId),ct)||await db.Set<VariantAttributeValue>().AnyAsync(v=>v.ValueOptionId!=null&&removedOptions.Contains(v.ValueOptionId),ct)||await db.Set<ProductAttributeSelection>().AnyAsync(v=>removedOptions.Contains(v.OptionId),ct)))throw new BusinessException("attribute_option_in_use","An option used by products cannot be deleted; retain it or migrate its values first.");
        foreach (var old in entity.Options.Where(o => input.Options.All(i => i.Id != o.Id)).ToList()) { db.Remove(old); entity.Options.Remove(old); }
        foreach (var option in input.Options) { var target = entity.Options.FirstOrDefault(x => x.Id == option.Id); if (target is null) { target = new(); entity.Options.Add(target); } target.Value = option.Value; target.LabelFa = option.LabelFa; target.LabelEn = option.LabelEn; target.SortOrder = option.SortOrder; }
        if (id is null) db.AttributeDefinitions.Add(entity);
        await db.SaveChangesAsync(ct); return entity.Id;
    }

    private async Task ValidateProductInputAsync(string? id,ProductInput input,CancellationToken ct)
    {
        CatalogRules.Slug(input.Slug); CatalogRules.Translations(input.Translations);
        if(input.IsDigital&&id is not null){
            // The same transaction protects the product read and the absence of
            // active links from a concurrent link creation before conversion.
            if(db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel!=IsolationLevel.Serializable)throw new InvalidOperationException("Digital product edits require the root Serializable transaction.");
            if(await db.Products.AnyAsync(p=>p.Id==id&&!p.IsDigital,ct)&&await db.AccountingLinks.AnyAsync(l=>l.Provider=="holoo"&&l.IsActive&&db.Variants.Any(v=>v.Id==l.VariantId&&v.ProductId==id),ct))throw new BusinessException("accounting_target_conflict","Deactivate active Holoo links before converting their product to digital.");
            await serialGuard.AssertDigitalVariantsAllowedAsync(await db.Variants.Where(v=>v.ProductId==id).Select(v=>v.Id).ToArrayAsync(ct),ct);
        }
        if(input.ImageUrls.Length>24||input.ImageUrls.Distinct().Count()!=input.ImageUrls.Length)throw new BusinessException("invalid_product_images","Use up to 24 distinct product images.");
        await ValidateUploadedImagesAsync(input.ImageUrls,ct);
        await ValidateVideosAsync(input.Videos,input.Variants,ct);
        if (input.Status is not ("Draft" or "Published" or "Hidden") || input.Status == "Published" && input.Variants.Length == 0 || input.Variants.Select(v => v.Sku.Trim().ToUpperInvariant()).Distinct().Count() != input.Variants.Length || input.Variants.Where(v => v.Id is not null).Select(v => v.Id).Distinct().Count() != input.Variants.Count(v => v.Id is not null) || input.Variants.Any(v => string.IsNullOrWhiteSpace(v.Sku) || v.Sku.Length > 80)) throw new BusinessException("invalid_product", "Use a valid status and unique variants. Storefront publication requires a sellable variant.");
        var category = await db.Categories.AsNoTracking().Include(x => x.Attributes).SingleOrDefaultAsync(x => x.Id == input.CategoryId, ct) ?? throw new BusinessException("unknown_category", "Category is not defined.");
        if (!await db.Brands.AnyAsync(x => x.Id == input.BrandId, ct)) throw new BusinessException("unknown_brand", "Brand is not defined.");
        var definitions = await db.AttributeDefinitions.AsNoTracking().Include(x => x.Options).ToDictionaryAsync(x => x.Id, ct);
        void ValidateValues(AttributeValueInput[] values) { if (values.Select(v => v.AttributeId).Distinct().Count() != values.Length) throw new BusinessException("duplicate_attribute", "Attribute values must be unique."); foreach (var value in values) { if (!category.Attributes.Any(a => a.AttributeId == value.AttributeId) || !definitions.TryGetValue(value.AttributeId, out var definition)) throw new BusinessException("unknown_category_attribute", "Attribute does not belong to this category."); CatalogRules.AttributeValue(definition, value); } }
        ValidateValues(input.Attributes); foreach (var variant in input.Variants) { ValidateValues(variant.Attributes); if (variant.Attributes.Any(v => v.OptionIds?.Length > 0)) throw new BusinessException("invalid_variant_axis", "Variant axes must have one value."); }
        if (input.Status == "Published" && category.Attributes.Where(a => a.IsRequired).Any(a => input.Variants.Where(v => v.IsActive).Any(v => !input.Attributes.Any(x => x.AttributeId == a.AttributeId) && !v.Attributes.Any(x => x.AttributeId == a.AttributeId)))) throw new BusinessException("required_attribute", "A required category attribute is missing.");
        if (input.Status == "Published" && (!input.Variants.Any(v => v.IsActive) || input.PurchaseMethodIds.Length == 0 || input.ImageUrls.Length == 0)) throw new BusinessException("incomplete_product", "Publishing requires an image, an active variant and a purchase method.");
        var methods = await purchasing.MethodsAsync("fa", ct); var plans = await purchasing.PlansAsync("fa", ct);
        if (input.PurchaseMethodIds.Distinct().Count() != input.PurchaseMethodIds.Length || input.PurchaseMethodIds.Any(id => !methods.Any(m => m.Id == id)) || input.ChequePlanIds.Any(id => !plans.Any(p => p.Id == id)) || input.Variants.Any(v => v.PurchaseMethodIds.Any(id => !input.PurchaseMethodIds.Contains(id)))) throw new BusinessException("invalid_purchase_rules", "Purchase methods and plans must exist; variant methods must be a subset of product methods.");
    }

    public async Task<string> SaveProductAsync(string? id, ProductInput input, string actorId, CancellationToken ct)
    {
        await ValidateProductInputAsync(id,input,ct);
        var entity = id is null ? new Product() : await Graph.SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw new BusinessException("not_found", "Product was not found.");
        if (id is not null) CatalogRules.Version(entity.Version, input.Version);
        if(entity.ArchivedAt is not null)throw new BusinessException("product_archived","Restore the product before editing it.");
        if(input.IsDigital&&entity.Variants.Any(v=>v.UsedInspectionId!=null))throw new BusinessException("used_item_digital_conflict","A used physical SKU cannot become a digital product.");
        entity.CategoryId = input.CategoryId; entity.BrandId = input.BrandId; entity.Slug = input.Slug; entity.Status = input.Status; entity.IsDigital = input.IsDigital; entity.Featured = input.Featured; Touch(entity, id is null);
        foreach (var tr in input.Translations) { var target = entity.Translations.FirstOrDefault(x => x.Locale == tr.Locale); if (target is null) { target = new() { Locale = tr.Locale }; entity.Translations.Add(target); } target.Name = tr.Name.Trim(); target.Description = tr.Description; target.Badge = tr.Badge; }
        foreach (var old in entity.Attributes.Where(v => input.Attributes.All(i => i.AttributeId != v.AttributeId)).ToList()) { db.Remove(old); entity.Attributes.Remove(old); }
        foreach (var value in input.Attributes) {
            var target = entity.Attributes.FirstOrDefault(x => x.AttributeId == value.AttributeId); if (target is null) { target = new() { AttributeId = value.AttributeId }; entity.Attributes.Add(target); }
            target.ValueTextFa = value.TextFa; target.ValueTextEn = value.TextEn; target.ValueNumber = value.Number; target.ValueBool = value.Bool; target.ValueOptionId = value.OptionId;
            foreach (var old in target.Selections.Where(s => value.OptionIds?.Contains(s.OptionId) != true).ToList()) { db.Remove(old); target.Selections.Remove(old); }
            foreach (var optionId in value.OptionIds ?? []) if (!target.Selections.Any(s => s.OptionId == optionId)) target.Selections.Add(new() { OptionId = optionId });
        }
        foreach (var old in entity.Variants.Where(v => input.Variants.All(i => i.Id != v.Id))) { if (old.IsActive) { old.IsActive = false; Touch(old, false); } }
        foreach (var v in input.Variants) {
            var target = entity.Variants.FirstOrDefault(x => x.Id == v.Id); var isNew = target is null;
            if (target is null) { if (v.Id is not null) throw new BusinessException("unknown_variant", "Variant does not belong to this product."); target = new(); entity.Variants.Add(target); }
            else CatalogRules.Version(target.Version, v.Version);
            var price = CatalogRules.Money(v.PriceRial); var compare = v.CompareAtRial is null ? (long?)null : CatalogRules.Money(v.CompareAtRial);
            if (compare < price) throw new BusinessException("invalid_compare_price", "Reference price must be at least the current price.");
            if (!isNew && price != target.PriceRial) { var history = new PriceHistory { VariantId = target.Id, OldPrice = target.PriceRial, NewPrice = price, ChangedBy = actorId }; Touch(history, true); db.PriceHistory.Add(history); }
            target.Sku = v.Sku.Trim().ToUpperInvariant(); target.PriceRial = price; target.CompareAtPriceRial = compare; target.Color = v.Color; target.ColorNameFa = v.ColorNameFa; target.ColorNameEn = v.ColorNameEn; target.LabelFa = v.LabelFa; target.LabelEn = v.LabelEn; target.WarrantyFa = v.WarrantyFa; target.WarrantyEn = v.WarrantyEn; target.IsActive = v.IsActive; Touch(target, isNew);
            foreach (var old in target.Attributes.Where(a => v.Attributes.All(i => i.AttributeId != a.AttributeId)).ToList()) { db.Remove(old); target.Attributes.Remove(old); }
            foreach (var a in v.Attributes) { var item = target.Attributes.FirstOrDefault(x => x.AttributeId == a.AttributeId); if (item is null) { item = new() { AttributeId = a.AttributeId }; target.Attributes.Add(item); } item.ValueTextFa = a.TextFa; item.ValueTextEn = a.TextEn; item.ValueNumber = a.Number; item.ValueBool = a.Bool; item.ValueOptionId = a.OptionId; }
            foreach (var old in target.PurchaseMethods.Where(m => !v.PurchaseMethodIds.Contains(m.MethodId)).ToList()) { db.Remove(old); target.PurchaseMethods.Remove(old); }
            foreach (var methodId in v.PurchaseMethodIds.Distinct()) if (!target.PurchaseMethods.Any(m => m.MethodId == methodId)) target.PurchaseMethods.Add(new() { MethodId = methodId });
        }
        foreach (var old in entity.Media.Where(m => m.Type=="image"&&!input.ImageUrls.Contains(m.Url)).ToList()) { db.Remove(old); entity.Media.Remove(old); }
        for (var i = 0; i < input.ImageUrls.Length; i++) {
            var url=SafeImage(input.ImageUrls[i]);var media=entity.Media.FirstOrDefault(m=>m.Type=="image"&&m.Url==url);var creating=media is null;
            if(media is null){media=new(){Url=url};entity.Media.Add(media);}
            var assetId=PublicImagePaths.TryParse(url,out var asset,out _)?asset:null;
            if(creating||media.SortOrder!=i||media.AssetId!=assetId)Touch(media,creating);
            media.SortOrder=i;media.AssetId=assetId;
        }
        if(input.Videos is not null){
            foreach(var old in entity.Media.Where(m=>m.Type=="video"&&!input.Videos.Any(v=>v.Url==m.Url&&v.VariantId==m.VariantId)).ToArray()){db.Remove(old);entity.Media.Remove(old);}
            for(var i=0;i<input.Videos.Length;i++){var video=input.Videos[i];var media=entity.Media.SingleOrDefault(m=>m.Type=="video"&&m.Url==video.Url&&m.VariantId==video.VariantId);var creating=media is null;if(media is null){media=new(){Type="video",Url=video.Url,VariantId=video.VariantId};entity.Media.Add(media);}media.SortOrder=i;media.VideoAssetId=PublicVideoPaths.TryParse(video.Url,out var asset,out _)?asset:null;Touch(media,creating);}
        }
        foreach (var old in entity.PurchaseMethods.Where(m => !input.PurchaseMethodIds.Contains(m.MethodId)).ToList()) { db.Remove(old); entity.PurchaseMethods.Remove(old); }
        foreach (var methodId in input.PurchaseMethodIds.Distinct()) if (!entity.PurchaseMethods.Any(m => m.MethodId == methodId)) entity.PurchaseMethods.Add(new() { MethodId = methodId });
        foreach (var old in entity.CreditPlans.Where(m => !input.ChequePlanIds.Contains(m.PlanId)).ToList()) { db.Remove(old); entity.CreditPlans.Remove(old); }
        foreach (var planId in input.ChequePlanIds.Distinct()) if (!entity.CreditPlans.Any(m => m.PlanId == planId)) entity.CreditPlans.Add(new() { PlanId = planId });
        if (id is null) db.Products.Add(entity);
        await db.SaveChangesAsync(ct); return entity.Id;
    }

    private async Task ValidateVideosAsync(ProductVideoInput[]? videos,VariantInput[] variants,CancellationToken ct){
        if(videos is null)return;
        if(videos.Length>8||videos.Select(v=>(v.Url,v.VariantId)).Distinct().Count()!=videos.Length)throw new BusinessException("invalid_product_videos","Use up to eight distinct product videos.");
        foreach(var video in videos){if(!PublicVideoPaths.ValidUrl(video.Url)||video.VariantId is not null&&!variants.Any(v=>v.Id==video.VariantId))throw new BusinessException("invalid_product_videos","Use safe direct video links and variants of this product.");if(PublicVideoPaths.TryParse(video.Url,out var asset,out var extension)&&!await db.Set<PublicVideoAsset>().AnyAsync(a=>a.Id==asset&&a.Extension==extension&&a.Status=="Ready",ct))throw new BusinessException("video_not_ready","Choose a ready processed video.");}
    }
    private void Touch(CatalogEntity entity, bool creating)
    {
        var now = time.GetUtcNow();
        entity.UpdatedAt = now;
        if (creating) entity.CreatedAt = now;
        else db.Entry(entity).Property(x => x.UpdatedAt).IsModified = true;
    }

    private Task ValidateUploadedImagesAsync(IEnumerable<string> urls,CancellationToken ct) =>
        new CatalogPublicImageReferences(db).RequireReadyAsync(urls.ToArray(),ct);
    private static string SafeImage(string url)
    {
        if (!PublicImageUrlRules.IsValid(url)) throw new BusinessException("invalid_image_url", "Use an issued public image path, a bundled product image or an HTTPS image URL without credentials or a fragment.");
        return url;
    }

    public async Task SeedAsync(string seedPath, CancellationToken ct)
    {
        if (await db.Categories.AnyAsync(ct)) return;
        var root = JsonNode.Parse(await File.ReadAllTextAsync(seedPath, ct))!;
        var fa = root["fa"]!; var en = root["en"]!;
        static string S(JsonNode? n) => n?.GetValue<string>() ?? "";
        foreach (var a in fa["attributeDefinitions"]!.AsArray()) {
            var key = S(a!["key"]); var english = en["attributeDefinitions"]!.AsArray().First(x => S(x!["key"]) == key)!;
            var definition = new AttributeDefinition { Id = key, Key = key, DataType = Enum.Parse<AttributeDataType>(S(a["dataType"]), true), Translations = [new() { Locale = "fa", Name = S(a["name"]) }, new() { Locale = "en", Name = S(english["name"]) }] };
            if (definition.DataType is AttributeDataType.Select or AttributeDataType.MultiSelect) {
                foreach (var p in fa["products"]!.AsArray()) {
                    var ep = en["products"]!.AsArray().First(x => S(x!["id"]) == S(p!["id"]))!;
                    var values = new List<(string Fa, string En)> { (S(p!["attributes"]?[key]), S(ep["attributes"]?[key])) };
                    foreach (var v in p["variants"]!.AsArray()) { var ev = ep["variants"]!.AsArray().First(x => S(x!["id"]) == S(v!["id"]))!; values.Add((S(v!["attributes"]?[key]), S(ev["attributes"]?[key]))); }
                    foreach (var value in values.Where(v => v.Fa.Length > 0)) if (!definition.Options.Any(o => o.LabelFa == value.Fa)) definition.Options.Add(new() { Id = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value.Fa)))[..24], Value = PersianText.Normalize(value.Fa), LabelFa = value.Fa, LabelEn = value.En, SortOrder = definition.Options.Count });
                }
            }
            db.AttributeDefinitions.Add(definition);
        }
        foreach (var c in fa["categories"]!.AsArray()) { var ec = en["categories"]!.AsArray().First(x => S(x!["key"]) == S(c!["key"]))!; var category = new Category { Id = S(c!["key"]), Slug = S(c["key"]), ImageUrl = S(c["image"]), SortOrder = db.ChangeTracker.Entries<Category>().Count(), Translations = [new() { Locale = "fa", Name = S(c["name"]), Description = S(c["description"]) }, new() { Locale = "en", Name = S(ec["name"]), Description = S(ec["description"]) }] }; var keys = fa["products"]!.AsArray().Where(p => S(p!["category"]) == category.Id).SelectMany(p => p!["attributes"]!.AsObject().Select(k => k.Key)).Distinct(); foreach (var key in keys) category.Attributes.Add(new() { AttributeId = key, IsComparable = true, ShowInSpecs = true, IsFilterable = c["filters"]!.AsArray().Any(f => S(f!["key"]) == key), IsVariantAxis = key is "ram" or "storage" }); db.Categories.Add(category); }
        foreach (var brand in fa["products"]!.AsArray().Select(p => S(p!["brand"])).Distinct()) db.Brands.Add(new() { Id = brand.ToLowerInvariant(), Name = brand, Slug = brand.ToLowerInvariant() });
        await db.SaveChangesAsync(ct);
        var definitions = await db.AttributeDefinitions.Include(a => a.Options).ToDictionaryAsync(a => a.Key, ct);
        ProductAttributeValue Value(string key, string f, string e) { var d = definitions[key]; return new() { AttributeId = d.Id, ValueTextFa = d.DataType == AttributeDataType.Text ? f : null, ValueTextEn = d.DataType == AttributeDataType.Text ? e : null, ValueOptionId = d.DataType == AttributeDataType.Select ? d.Options.Single(o => o.LabelFa == f).Id : null }; }
        foreach (var p in fa["products"]!.AsArray()) {
            var ep = en["products"]!.AsArray().First(x => S(x!["id"]) == S(p!["id"]))!;
            var product = new Product { Id = S(p!["id"]), Slug = S(p["slug"]), CategoryId = S(p["category"]), BrandId = S(p["brand"]).ToLowerInvariant(), Status = "Published", Featured = p["featured"]?.GetValue<bool>() ?? false, IsDigital = p["isDigital"]?.GetValue<bool>() ?? false, Translations = [new() { Locale = "fa", Name = S(p["name"]), Description = S(p["description"]), Badge = p["badge"]?.GetValue<string>() }, new() { Locale = "en", Name = S(ep["name"]), Description = S(ep["description"]), Badge = ep["badge"]?.GetValue<string>() }], Media = [new() { Url = S(p["image"]) }] };
            foreach (var attribute in p["attributes"]!.AsObject()) product.Attributes.Add(Value(attribute.Key, S(attribute.Value), S(ep["attributes"]?[attribute.Key])));
            foreach (var method in p["purchaseMethodIds"]!.AsArray()) product.PurchaseMethods.Add(new() { MethodId = S(method) });
            foreach (var v in p["variants"]!.AsArray()) { var ev = ep["variants"]!.AsArray().First(x => S(x!["id"]) == S(v!["id"]))!; var variant = new ProductVariant { Id = S(v!["id"]), Sku = S(v["sku"]), PriceRial = CatalogRules.Money(S(v["priceRial"])), CompareAtPriceRial = v["compareAtRial"] is null ? null : CatalogRules.Money(S(v["compareAtRial"])), Color = S(v["color"]), ColorNameFa = S(v["colorName"]), ColorNameEn = S(ev["colorName"]), LabelFa = S(v["label"]), LabelEn = S(ev["label"]), WarrantyFa = S(v["warranty"]), WarrantyEn = S(ev["warranty"]) }; foreach (var a in v["attributes"]?.AsObject() ?? []) { var value = Value(a.Key, S(a.Value), S(ev["attributes"]?[a.Key])); variant.Attributes.Add(new() { AttributeId = value.AttributeId, ValueTextFa = value.ValueTextFa, ValueTextEn = value.ValueTextEn, ValueOptionId = value.ValueOptionId }); } product.Variants.Add(variant); }
            db.Products.Add(product);
        }
        await db.SaveChangesAsync(ct);
    }
}
