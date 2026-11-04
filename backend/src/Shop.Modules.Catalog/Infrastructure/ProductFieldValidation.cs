using Microsoft.EntityFrameworkCore;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Domain;
using Shop.SharedKernel;
namespace Shop.Modules.Catalog.Infrastructure;

public sealed class ProductFieldValidation(CatalogDbContext db)
{
    public async Task ValidateAsync(string? productId, ProductInput value, CancellationToken ct)
    {
        var errors = new Dictionary<string, string[]>(StringComparer.Ordinal);
        void Error(string field, string text) => errors.TryAdd(field, [text]);
        var fa = value.Translations.FirstOrDefault(t => t.Locale == "fa");
        var en = value.Translations.FirstOrDefault(t => t.Locale == "en");
        if (fa is null || string.IsNullOrWhiteSpace(fa.Name) || fa.Name.Length > 250)
            Error("nameFa", "نام فارسی کالا را بین۱تا۲۵۰نویسه وارد کنید.");
        if (en is null || string.IsNullOrWhiteSpace(en.Name) || en.Name.Length > 250)
            Error("nameEn", "نام انگلیسی یا جایگزین فارسی را مشخص کنید.");
        if (value.Translations.Length != 2 || value.Translations.Select(t => t.Locale).Distinct().Count() != 2)
            Error("nameFa", "اطلاعات فارسی و انگلیسی باید هرکدام یک‌بار وجود داشته باشند.");
        if (fa?.Description.Length > 8000)
            Error("descriptionFa", "توضیحات فارسی حداکثر۸۰۰۰نویسه است.");
        if (en?.Description.Length > 8000)
            Error("descriptionEn", "توضیحات انگلیسی حداکثر۸۰۰۰نویسه است.");
        try
        {
            CatalogRules.Slug(value.Slug);
        }
        catch (BusinessException) { Error("slug", "نشانی با حروف کوچک انگلیسی، عدد و خط تیره وارد کنید."); }
        if (await db.Products.AnyAsync(p => p.Id != productId && p.Slug == value.Slug, ct))
            Error("slug", "این نشانی برای کالای دیگری ثبت شده؛ نشانی یکتا انتخاب کنید.");
        var category = await db.Categories.AsNoTracking().Include(c => c.Attributes).SingleOrDefaultAsync(c => c.Id == value.CategoryId, ct);
        if (category is null)
            Error("categoryId", "دسته‌بندی معتبر را انتخاب یا دستهٔ جدید اضافه کنید.");
        if (!await db.Brands.AnyAsync(b => b.Id == value.BrandId, ct))
            Error("brandId", "برند معتبر را انتخاب یا برند جدید اضافه کنید.");
        if (value.Variants.Length > 500)
            Error("variants", "حداکثر۵۰۰تنوع در یک کالا مجاز است.");
        var skus = value.Variants.Select(v => v.Sku.Trim().ToUpperInvariant()).ToArray();
        var occupied = await db.Variants.AsNoTracking().Where(v => skus.Contains(v.Sku)).Select(v => new { v.Id, v.Sku }).ToArrayAsync(ct);
        var definitions = category is null ? new Dictionary<string, AttributeDefinition>() : await db.AttributeDefinitions.AsNoTracking().Include(a => a.Options).Where(a => category.Attributes.Select(r => r.AttributeId).Contains(a.Id)).ToDictionaryAsync(a => a.Id, ct);
        void Values(AttributeValueInput[] attributes, string prefix)
        {
            foreach (var a in attributes)
            {
                var path = prefix + "attribute." + a.AttributeId;
                if (attributes.Count(v => v.AttributeId == a.AttributeId) > 1)
                {
                    Error(path, "این ویژگی تکراری است.");
                    continue;
                }
                if (!definitions.TryGetValue(a.AttributeId, out var definition))
                {
                    Error(path, "ویژگی به دستهٔ انتخاب‌شده تعلق ندارد.");
                    continue;
                }
                try
                {
                    CatalogRules.AttributeValue(definition, a);
                }
                catch (BusinessException) { Error(path, "مقدار با نوع یا گزینه‌های تعریف‌شدهٔ ویژگی سازگار نیست."); }
            }
        }
        Values(value.Attributes, "");
        for (var i = 0; i < value.Variants.Length; i++)
        {
            var variant = value.Variants[i];
            var prefix = $"variants.{i}.";
            var sku = skus[i];
            if (sku.Length is < 1 or > 80)
                Error(prefix + "sku", "کد یکتای تنوع بین۱تا۸۰نویسه لازم است.");
            else if (skus.Count(s => s == sku) > 1 || occupied.Any(existing => string.Equals(existing.Sku, sku, StringComparison.OrdinalIgnoreCase) && existing.Id != variant.Id))
                Error(prefix + "sku", "این کد تنوع تکراری است؛ کد دیگری وارد کنید.");
            long? price = null;
            try
            {
                price = CatalogRules.Money(variant.PriceRial);
            }
            catch (BusinessException) { Error(prefix + "price", "قیمت فروش باید مبلغ ریال صحیح و معتبر باشد."); }
            if (variant.CompareAtRial is not null)
                try
                {
                    if (price is { } p && CatalogRules.Money(variant.CompareAtRial) < p)
                        Error(prefix + "referencePrice", "قیمت پیش از تخفیف کمتر از قیمت فروش است.");
                }
                catch (BusinessException) { Error(prefix + "referencePrice", "قیمت پیش از تخفیف معتبر نیست."); }
            if (variant.Color.Length != 7 || variant.Color[0] != '#' || variant.Color.Skip(1).Any(c => !Uri.IsHexDigit(c)))
                Error(prefix + "color", "رنگ معتبر انتخاب کنید.");
            if (variant.WarrantyFa.Length > 2000 || variant.WarrantyEn.Length > 2000)
                Error(prefix + "warrantyFa", "توضیحات گارانتی هر زبان حداکثر۲۰۰۰نویسه است.");
            Values(variant.Attributes, prefix);
            if (value.Status == "Published" && variant.IsActive && category is not null)
            foreach (var rule in category.Attributes.Where(a => a.IsRequired))
            if (!value.Attributes.Any(a => a.AttributeId == rule.AttributeId) && !variant.Attributes.Any(a => a.AttributeId == rule.AttributeId))
                Error((rule.IsVariantAxis ? prefix : "") + "attribute." + rule.AttributeId, "این ویژگی برای انتشار کالا لازم است.");
        }
        if (value.Status == "Published")
        {
            if (!value.Variants.Any(v => v.IsActive))
                Error("variants", "حداقل یک تنوع قابل نمایش لازم است.");
            if (value.ImageUrls.Length == 0)
                Error("images", "حداقل یک تصویر آماده اضافه کنید.");
            if (value.PurchaseMethodIds.Length == 0)
                Error("purchaseMethods", "حداقل یک روش خرید انتخاب کنید.");
        }
        if (errors.Count > 0)
            throw new ProductFieldValidationException(errors);
    }
}
