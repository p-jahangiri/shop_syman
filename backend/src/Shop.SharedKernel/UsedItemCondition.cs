using System.Text.Json.Serialization;
namespace Shop.SharedKernel;

// Public, versioned facts about one physical used SKU. No private serial/IMEI.
// An order keeps this value in its existing immutable quote snapshot.
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record UsedItemConditionData(string InspectionId,string TechnicalState,string BatteryState,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]int? BatteryHealthPercent,
    string ScreenState,string BodyState,string RepairState,string NotesFa,string NotesEn,DateTimeOffset InspectedAt);
public static class UsedItemConditionRules
{
    public static void Validate(UsedItemConditionData? d)
    {
        if(d is null)throw Invalid();
        if(!Guid.TryParseExact(d.InspectionId,"N",out var id)||id==Guid.Empty||id.ToString("N")!=d.InspectionId||d.TechnicalState is not("unknown" or "passed" or "needsRepair")||d.BatteryState is not("unknown" or "notApplicable" or "measured")||d.BatteryState=="measured"!=(d.BatteryHealthPercent is not null)||d.BatteryHealthPercent is <0 or >100||d.ScreenState is not("unknown" or "intact" or "worn" or "damaged")||d.BodyState is not("unknown" or "intact" or "worn" or "damaged")||d.RepairState is not("unknown" or "noKnownRepair" or "repaired")||d.InspectedAt==default||d.InspectedAt.Offset!=TimeSpan.Zero)throw Invalid();
        Text(d.NotesFa);Text(d.NotesEn);
    }
    private static void Text(string value){if(value is null||value.Length>2000||value.Any(c=>(char.IsControl(c)&&c is not('\n' or '\r' or '\t'))||c is '\u202a' or '\u202b' or '\u202c' or '\u202d' or '\u202e' or '\u2066' or '\u2067' or '\u2068' or '\u2069'))throw Invalid();}
    public static BusinessException Invalid()=>new("invalid_used_condition","Used-item inspection facts, battery range or date are invalid.");
}
public interface IUsedItemStockPolicy
{
    // Metadata only: never changes balances or releases another reservation.
    Task RequireSingleUnitAsync(string variantId,CancellationToken ct);
}
