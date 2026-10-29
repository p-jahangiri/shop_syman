using System.Globalization;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Shop.SharedKernel;

namespace Shop.Modules.Market;
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record MarketDetailsInput(string Status,string SourceKey,string SourceItemKey,string SourceNameFa,string SourceNameEn,string? SourceUrl,string Availability,DateTimeOffset? ObservedAt,DateTimeOffset? ValidUntil,string? ReferencePriceRial,bool IsDemo);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record MarketListingInput(string ModelId,MarketDetailsInput Details,string? Version);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CreateMarketModelInput(CatalogModelInput Model,MarketDetailsInput Details);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record EditMarketModelInput(CatalogModelInput Model,MarketDetailsInput Details,string ListingVersion);
public sealed record MarketItemDto(string Id,CatalogModelDto Model,string SourceName,string? SourceUrl,string Availability,DateTimeOffset? ObservedAt,DateTimeOffset? ValidUntil,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] string? ReferencePriceRial,bool ReferencePriceCurrent,bool IsDemo);
public sealed record MarketPage(int SchemaVersion,string Locale,MarketItemDto[] Items,int Total,int Page,int PageSize,int TotalPages,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.WhenWritingNull)]MarketAttributeSelection[]? AppliedAttributes=null);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record MarketSearchInput(string? Query=null,string? CategoryId=null,string? BrandId=null,int Page=1,int PageSize=12,MarketAttributeSelection[]? Attributes=null);
public static partial class MarketRules
{
    [GeneratedRegex("^[a-z0-9][a-z0-9_-]{0,63}$",RegexOptions.CultureInvariant)] private static partial Regex SourcePattern();
    public static string Id(string id)=>id is {Length:>0 and <=64}&&id.All(c=>char.IsAsciiLetterOrDigit(c)||c is '-' or '_')?id:throw Invalid();
    public static string Search(MarketSearchInput input)
    {
        MarketAttributeRules.Validate(input);
        if(input.Page is <1 or >10000||input.PageSize is <1 or >24||input.Query?.Length>120||input.Query?.Any(c=>char.IsControl(c)&&!char.IsWhiteSpace(c))==true)throw Invalid();
        if(input.CategoryId is not null)Id(input.CategoryId);if(input.BrandId is not null)Id(input.BrandId);
        var search=PersianText.Normalize(input.Query??"");if(search.Split(' ',StringSplitOptions.RemoveEmptyEntries).Length>8)throw Invalid();return search;
    }
    public static long? Validate(MarketListingInput listing,bool allowDemo,DateTimeOffset now)
    {
        Id(listing.ModelId);var input=listing.Details;
        if(input.Status is not ("Draft" or "Published" or "Hidden")||!SourcePattern().IsMatch(input.SourceKey)||string.IsNullOrWhiteSpace(input.SourceItemKey)||input.SourceItemKey.Length>120||input.SourceItemKey.Any(char.IsControl)||new[]{input.SourceNameFa,input.SourceNameEn}.Any(n=>string.IsNullOrWhiteSpace(n)||n.Length>200||n.Any(char.IsControl))||input.Availability is not ("unknown" or "available" or "unavailable"))throw Invalid();
        if(input.IsDemo&&!allowDemo)throw new BusinessException("demo_unavailable","Sample market entries are unavailable outside Development.");
        if(input.SourceUrl is not null&&(!Uri.TryCreate(input.SourceUrl,UriKind.Absolute,out var url)||url.Scheme!="https"||url.UserInfo.Length>0||url.Query.Length>0||url.Fragment.Length>0||input.SourceUrl.Length>1500||input.SourceUrl.Any(c=>c=='\\'||char.IsWhiteSpace(c))))throw Invalid();
        if(input.ObservedAt.HasValue!=input.ValidUntil.HasValue||input.ObservedAt>now||input.ValidUntil<=input.ObservedAt||input.Availability!="unknown"&&!input.ObservedAt.HasValue)throw Invalid();
        if(input.ReferencePriceRial is null)return null;
        if(!input.ObservedAt.HasValue||input.ReferencePriceRial.Length is <1 or >19||input.ReferencePriceRial.Any(c=>c is <'0' or >'9')||!long.TryParse(input.ReferencePriceRial,NumberStyles.None,CultureInfo.InvariantCulture,out var value)||value<=0)throw Invalid();
        return value;
    }
    public static string EffectiveAvailability(string state,DateTimeOffset? validUntil,DateTimeOffset now)=>validUntil<=now?"stale":state;
    private static BusinessException Invalid()=>new("invalid_market_input","Use bounded market fields, a known status, explicit source and consistent observation dates. Reference prices are positive integer rial strings, never payable prices.");
}
