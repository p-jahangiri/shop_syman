using System.Globalization;
using Shop.Modules.Catalog.Domain;

namespace Shop.Modules.Catalog.Application;
public sealed record AdminTranslation(string Locale,string Name,string Description,string? Badge);
public sealed record AdminSelection(string OptionId);
public sealed record AdminValue(string AttributeId,string? ValueTextFa,string? ValueTextEn,decimal? ValueNumber,bool? ValueBool,string? ValueOptionId,AdminSelection[] Selections);
public sealed record AdminMethod(string MethodId);
public sealed record AdminPlan(string PlanId);
public sealed record AdminMedia(string Url,int SortOrder);
public sealed record AdminVariant(string Id,string Version,string Sku,string PriceRial,string? CompareAtPriceRial,string Color,string ColorNameFa,string ColorNameEn,string LabelFa,string LabelEn,string WarrantyFa,string WarrantyEn,bool IsActive,AdminValue[] Attributes,AdminMethod[] PurchaseMethods);
public sealed record AdminEditableProduct(string Id,string Version,string Slug,string CategoryId,string BrandId,string Status,bool IsDigital,bool Featured,AdminTranslation[] Translations,AdminValue[] Attributes,AdminVariant[] Variants,AdminMedia[] Media,AdminMethod[] PurchaseMethods,AdminPlan[] CreditPlans);
public sealed record AdminProductDetail(int SchemaVersion,AdminEditableProduct Product)
{
    public static AdminProductDetail From(Product p)=>new(1,new(p.Id,Convert.ToBase64String(p.Version),p.Slug,p.CategoryId,p.BrandId,p.Status,p.IsDigital,p.Featured,
        p.Translations.OrderBy(t=>t.Locale,StringComparer.Ordinal).Select(t=>new AdminTranslation(t.Locale,t.Name,t.Description,t.Badge)).ToArray(),
        p.Attributes.Select(a=>new AdminValue(a.AttributeId,a.ValueTextFa,a.ValueTextEn,a.ValueNumber,a.ValueBool,a.ValueOptionId,a.Selections.Select(s=>new AdminSelection(s.OptionId)).ToArray())).ToArray(),
        p.Variants.OrderBy(v=>v.Id,StringComparer.Ordinal).Select(v=>new AdminVariant(v.Id,Convert.ToBase64String(v.Version),v.Sku,v.PriceRial.ToString(CultureInfo.InvariantCulture),v.CompareAtPriceRial?.ToString(CultureInfo.InvariantCulture),v.Color,v.ColorNameFa,v.ColorNameEn,v.LabelFa,v.LabelEn,v.WarrantyFa,v.WarrantyEn,v.IsActive,
            v.Attributes.Select(a=>new AdminValue(a.AttributeId,a.ValueTextFa,a.ValueTextEn,a.ValueNumber,a.ValueBool,a.ValueOptionId,[])).ToArray(),v.PurchaseMethods.Select(m=>new AdminMethod(m.MethodId)).ToArray())).ToArray(),
        p.Media.OrderBy(m=>m.SortOrder).Select(m=>new AdminMedia(m.Url,m.SortOrder)).ToArray(),p.PurchaseMethods.Select(m=>new AdminMethod(m.MethodId)).ToArray(),p.CreditPlans.Select(m=>new AdminPlan(m.PlanId)).ToArray()));
}
