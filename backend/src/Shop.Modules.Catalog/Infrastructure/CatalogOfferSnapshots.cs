using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Domain;
using Shop.SharedKernel;

namespace Shop.Modules.Catalog.Infrastructure;

public sealed record CatalogOfferVersion(string Kind,string Id,string Version);
public static class CatalogOfferSnapshots
{
    public static string MaterialFingerprint(OfferSkuSnapshot value)=>Hash(new{
        value.VariantId,value.ProductId,value.SellerId,value.Sku,
        Model=new{value.Model.Id,value.Model.Slug,value.Model.CategoryId,value.Model.CategoryNameFa,value.Model.CategoryNameEn,value.Model.BrandId,value.Model.Brand,value.Model.NameFa,value.Model.NameEn,value.Model.DescriptionFa,value.Model.DescriptionEn,value.Model.Images,Attributes=Ordered(value.Model.Attributes)},
        value.LabelFa,value.LabelEn,value.Color,value.ColorNameFa,value.ColorNameEn,value.WarrantyFa,value.WarrantyEn,
        Attributes=Ordered(value.Attributes),ProductMethodIds=value.ProductMethodIds.Order(StringComparer.Ordinal),VariantMethodIds=value.VariantMethodIds?.Order(StringComparer.Ordinal).ToArray(),ChequePlanIds=value.ChequePlanIds.Order(StringComparer.Ordinal)
    });
    public static string CurrentFingerprint(OfferSkuSnapshot value,IEnumerable<CatalogOfferVersion> versions)=>Hash(new{
        Material=MaterialFingerprint(value),value.PublicPriceRial,
        Versions=versions.OrderBy(v=>v.Kind,StringComparer.Ordinal).ThenBy(v=>v.Id,StringComparer.Ordinal)
    });
    private static SourcingAttributeSnapshot[] Ordered(SourcingAttributeSnapshot[] values)=>values.OrderBy(a=>a.AttributeId,StringComparer.Ordinal).Select(a=>a with{Options=a.Options.OrderBy(o=>o.Id,StringComparer.Ordinal).ToArray()}).ToArray();
    private static string Hash<T>(T value)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(value))));

    // Catalog owns validation and translation of its typed values; a reader
    // never converts an invalid persisted value into a plausible text option.
    public static SourcingAttributeSnapshot Attribute(AttributeDefinition definition,string? textFa,string? textEn,decimal? number,bool? flag,string? optionId,string[] optionIds,IReadOnlyDictionary<string,AttributeOption> selectedOptions)
    {
        if(optionIds.Length>64)throw Unavailable();
        var fa=definition.Translations.SingleOrDefault(t=>t.Locale=="fa")??throw Unavailable();
        var en=definition.Translations.SingleOrDefault(t=>t.Locale=="en")??throw Unavailable();
        var ids=optionIds.Concat(optionId is null?[]:new[]{optionId}).Order(StringComparer.Ordinal).ToArray();
        if(ids.Distinct(StringComparer.Ordinal).Count()!=ids.Length)throw Unavailable();
        var options=ids.Select(id=>selectedOptions.TryGetValue(id,out var item)&&item.AttributeId==definition.Id?item:throw Unavailable()).ToArray();
        // The bounded selected-option set is sufficient for validating the
        // actual value; no unselected option graph needs to be materialized.
        var check=new AttributeDefinition{Id=definition.Id,Key=definition.Key,DataType=definition.DataType,Options=options.ToList()};
        try{CatalogRules.AttributeValue(check,new(definition.Id,textFa,textEn,number,flag,optionId,optionIds));}
        catch(BusinessException){throw Unavailable();}
        return new(definition.Id,definition.Key,definition.DataType.ToString(),fa.Name,en.Name,definition.Unit,fa.Unit,en.Unit,textFa,textEn,number,flag,options.Select(o=>new SourcingOptionSnapshot(o.Id,o.LabelFa,o.LabelEn)).ToArray());
    }
    public static BusinessException Unavailable()=>new("catalog_unavailable","The current SKU cannot be represented by the supported offer snapshot. Update its catalog data before retrying.");
}
