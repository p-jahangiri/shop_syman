using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
namespace Shop.SharedKernel;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record UsedItemInspectionPhotoData(string Url,string AltFa,string AltEn);

// Public, versioned facts about one physical used SKU. No private serial/IMEI.
// An order keeps this value in its existing immutable quote snapshot.
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record UsedItemConditionData(string InspectionId,string TechnicalState,string BatteryState,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]int? BatteryHealthPercent,
    string ScreenState,string BodyState,string RepairState,string NotesFa,string NotesEn,DateTimeOffset InspectedAt,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.WhenWritingNull)]UsedItemInspectionPhotoData[]? Photos=null);
public static class UsedItemConditionRules
{
    public const int MaximumPhotos=12,MaximumPhotoAltLength=160;
    private static readonly Regex PhotoPath=new("\\A/media/catalog/([a-f0-9]{32})/card\\.webp\\z",RegexOptions.CultureInvariant);
    public static string PhotoAssetId(string? url)
    {
        if(url is null||url.Length>80)throw Invalid();var match=PhotoPath.Match(url);
        if(!match.Success||!Guid.TryParseExact(match.Groups[1].Value,"N",out var id)||id==Guid.Empty)throw Invalid();
        return match.Groups[1].Value;
    }
    public static void ValidatePhotos(UsedItemInspectionPhotoData[]? photos)
    {
        if(photos is null)return;
        if(photos.Length>MaximumPhotos||photos.Any(p=>p is null))throw Invalid();
        var assets=new HashSet<string>(StringComparer.Ordinal);
        foreach(var photo in photos){if(!assets.Add(PhotoAssetId(photo.Url)))throw Invalid();PhotoAlt(photo.AltFa);PhotoAlt(photo.AltEn);}
    }
    private static void PhotoAlt(string value)
    {
        if(string.IsNullOrWhiteSpace(value)||value.Length>MaximumPhotoAltLength||value.Any(c=>char.IsControl(c)||c is '\u202a' or '\u202b' or '\u202c' or '\u202d' or '\u202e' or '\u2066' or '\u2067' or '\u2068' or '\u2069'))throw Invalid();
    }
    public static void Validate(UsedItemConditionData? d)
    {
        if(d is null)throw Invalid();
        if(!Guid.TryParseExact(d.InspectionId,"N",out var id)||id==Guid.Empty||id.ToString("N")!=d.InspectionId||d.TechnicalState is not("unknown" or "passed" or "needsRepair")||d.BatteryState is not("unknown" or "notApplicable" or "measured")||d.BatteryState=="measured"!=(d.BatteryHealthPercent is not null)||d.BatteryHealthPercent is <0 or >100||d.ScreenState is not("unknown" or "intact" or "worn" or "damaged")||d.BodyState is not("unknown" or "intact" or "worn" or "damaged")||d.RepairState is not("unknown" or "noKnownRepair" or "repaired")||d.InspectedAt==default||d.InspectedAt.Offset!=TimeSpan.Zero)throw Invalid();
        Text(d.NotesFa);Text(d.NotesEn);ValidatePhotos(d.Photos);
    }
    private static void Text(string value){if(value is null||value.Length>2000||value.Any(c=>(char.IsControl(c)&&c is not('\n' or '\r' or '\t'))||c is '\u202a' or '\u202b' or '\u202c' or '\u202d' or '\u202e' or '\u2066' or '\u2067' or '\u2068' or '\u2069'))throw Invalid();}
    public static BusinessException Invalid()=>new("invalid_used_condition","Used-item inspection facts, battery range or date are invalid.");
}
public interface IUsedItemStockPolicy
{
    // Metadata only: never changes balances or releases another reservation.
    Task RequireSingleUnitAsync(string variantId,CancellationToken ct);
}
