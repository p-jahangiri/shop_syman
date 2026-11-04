using System.Globalization;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Shop.SharedKernel;

namespace Shop.Modules.Market;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record PhoneConfigurationInput(bool Enabled,int RamGb,int StorageGb,string ColorKey,string ColorNameFa,string ColorNameEn,string? ColorHex,string? ImageUrl,string? LinkedVariantId);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record PhoneConfigurationCommand(string ListingVersion,string? ConfigurationVersion,PhoneConfigurationInput Configuration);
public sealed record PhoneAdminConfiguration(string Id,bool Enabled,int RamGb,int StorageGb,string ColorKey,string ColorNameFa,string ColorNameEn,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? ColorHex,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? ImageUrl,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? LinkedVariantId,string Version);
public sealed record PhoneAdminConfigurations(int SchemaVersion,string ListingId,string ListingVersion,PhoneAdminConfiguration[] Configurations);
public sealed record PhoneConfigurationResult(int SchemaVersion,string RequestId,string ListingId,string ConfigurationId,string ListingVersion,string ConfigurationVersion,bool Replayed);
public sealed record PhoneChoice(string Id,int RamGb,int StorageGb,string ColorKey,string ColorNameFa,string ColorNameEn,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? ColorHex,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? ImageUrl,string Version,bool AvailableInStore,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? StoreSlug,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? VariantId,bool CanRequest,bool CanNotify);
public sealed record PhoneSpecification(string Key,string Label,string Value);
public sealed record PhoneItem(string Id,CatalogModelDto Model,bool IsDemo,PhoneChoice[] Configurations)
{
    public PhoneSpecification[] Specifications{get;init;}=[];
}
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record PhoneSearchInput(string? Query=null,string? BrandId=null,int? RamGb=null,int? StorageGb=null,string? ColorKey=null,int Page=1,int PageSize=12);
public sealed record PhoneBrandFacet(string Id,string Name,int Count);
public sealed record PhoneNumberFacet(int Value,int Count);
public sealed record PhoneColorFacet(string Key,string NameFa,string NameEn,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? Hex,int Count);
public sealed record PhoneFacets(PhoneBrandFacet[] Brands,PhoneNumberFacet[] RamGb,PhoneNumberFacet[] StorageGb,PhoneColorFacet[] Colors,bool Truncated);
public sealed record PhonePage(int SchemaVersion,string Locale,PhoneItem[] Items,int Total,int Page,int PageSize,int TotalPages,PhoneFacets Facets);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record PhoneInterestInput(string ConfigurationId,bool Active,string? Version=null);
public sealed record PhoneInterestData(string Id,string ListingId,string ModelNameFa,string ModelNameEn,PhoneConfigurationSnapshot Configuration,string State,int Generation,string Version,DateTimeOffset CreatedAt,DateTimeOffset ChangedAt);
public sealed record PhoneInterestResult(int SchemaVersion,string RequestId,PhoneInterestData Interest,bool Replayed,bool CanPay=false);
public sealed record PhoneInterestPage(int SchemaVersion,PhoneInterestData[] Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? NextCursor);

public static partial class PhoneDiscoveryRules
{
    public const int MaximumConfigurations=64;
    [GeneratedRegex("^[a-z0-9]+(?:-[a-z0-9]+)*$",RegexOptions.CultureInvariant)]private static partial Regex ColorKeyPattern();
    [GeneratedRegex("^#[0-9a-fA-F]{6}$",RegexOptions.CultureInvariant)]private static partial Regex ColorPattern();
    public static PhoneConfigurationInput Normalize(PhoneConfigurationInput input)
    {
        if(input is null||input.RamGb is <1 or >128||input.StorageGb is <1 or >32768||input.ColorKey is not{Length:>0 and <=64}||!ColorKeyPattern().IsMatch(input.ColorKey)||input.ColorHex is not null&&!ColorPattern().IsMatch(input.ColorHex)||input.ImageUrl?.Length>1500)throw Invalid();
        var fa=SourcingRules.Text(input.ColorNameFa,120,true);var en=SourcingRules.Text(input.ColorNameEn,120,true);
        var variant=input.LinkedVariantId is null?null:MarketRules.Id(input.LinkedVariantId);
        return input with{ColorNameFa=fa,ColorNameEn=en,ColorHex=input.ColorHex?.ToLowerInvariant(),LinkedVariantId=variant};
    }
    public static bool Matches(PhoneConfigurationSnapshot configuration,OfferSkuSnapshot sku)
    {
        if(sku.ProductId!=configuration.ModelId||configuration.LinkedVariantId is not null&&sku.VariantId!=configuration.LinkedVariantId)return false;
        var attributes=sku.Model.Attributes.Concat(sku.Attributes).GroupBy(a=>a.Key,StringComparer.Ordinal).ToDictionary(g=>g.Key,g=>g.Last(),StringComparer.Ordinal);
        if(!attributes.TryGetValue("ram",out var ram)||!attributes.TryGetValue("storage",out var storage)||MemoryGb(ram)!=configuration.RamGb||MemoryGb(storage)!=configuration.StorageGb)return false;
        var color=PersianText.Normalize(sku.ColorNameFa)==PersianText.Normalize(configuration.ColorNameFa)||PersianText.Normalize(sku.ColorNameEn)==PersianText.Normalize(configuration.ColorNameEn);
        return color;
    }
    public static int? MemoryGb(SourcingAttributeSnapshot value)
    {
        static int? ExactGb(decimal number,string? unit){var normalized=PersianText.Normalize(unit??"");var factor=normalized is "gb" or "گیگابایت"?1:normalized is "tb" or "ترابایت"?1024:0;if(factor==0||number<=0||number>32768m/factor)return null;var gb=number*factor;return gb==decimal.Truncate(gb)&&gb>=1?(int)gb:null;}
        if(value.Number is{} number)return ExactGb(number,value.Unit);
        if(value.Options.Length>1)return null;
        var labels=value.Options.Length==1?new[]{value.Options[0].LabelFa,value.Options[0].LabelEn}:new[]{value.TextFa,value.TextEn};
        foreach(var raw in labels){if(raw is null)continue;var text=PersianText.Normalize(raw).Replace("گیگابایت","gb",StringComparison.Ordinal).Replace("ترابایت","tb",StringComparison.Ordinal).Replace(" ","",StringComparison.Ordinal).Replace('٫','.');var unit=text.EndsWith("gb",StringComparison.Ordinal)?"gb":text.EndsWith("tb",StringComparison.Ordinal)?"tb":null;if(unit is null)continue;if(decimal.TryParse(text[..^2],NumberStyles.AllowDecimalPoint,CultureInfo.InvariantCulture,out var parsed)&&ExactGb(parsed,unit)is{} gb)return gb;}
        return null;
    }
    public static BusinessException Invalid()=>new("invalid_phone_configuration","Use a configured phone, explicit RAM/storage/color and current versions.");
}
