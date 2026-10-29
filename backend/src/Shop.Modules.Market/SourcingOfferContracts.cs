using System.Globalization;
using System.Text.Json.Serialization;
using Shop.SharedKernel;

namespace Shop.Modules.Market;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SourcingOfferLineInput(string LineId,string ListingId,string VariantId,int Quantity,string UnitPriceRial,string MaterialFingerprint,string CurrentFingerprint);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SourcingOfferSaveInput(string RequestId,string RequestVersion,string? Version,SourcingOfferLineInput[] Lines,string TermsFa,string TermsEn,DateTimeOffset AcceptUntil,DateTimeOffset PurchaseUntil,DateTimeOffset? ExpectedAt=null);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SourcingOfferActionInput(string RequestId,string RequestVersion,string Version,string TermsHash);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SourcingOfferPublishInput(string RequestId,string RequestVersion,string Version,string TermsHash,string? SupersedesOfferId=null,string? SupersedesVersion=null);
public sealed record SourcingOfferLineData(string LineId,string ListingId,int Quantity,string UnitPriceRial,string LineTotalRial,OfferSkuSnapshot Sku);
public sealed record SourcingOfferSummary(string Id,int Revision,string State,string EffectiveState,string Version,string TermsHash,string TotalRial,int LineCount,int ItemCount,DateTimeOffset AcceptUntil,DateTimeOffset PurchaseUntil,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]DateTimeOffset? ExpectedAt,DateTimeOffset CreatedAt,DateTimeOffset ChangedAt,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]DateTimeOffset? PublishedAt,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]DateTimeOffset? AcceptedAt,bool IsDemo);
public sealed record SourcingOfferData(SourcingOfferSummary Summary,string TermsFa,string TermsEn,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? AcceptanceId,SourcingOfferLineData[] Lines);
public sealed record SourcingOfferDetail(int SchemaVersion,string RequestId,string RequestReference,string RequestVersion,SourcingOfferData Offer,bool CanEditDraft,bool CanPublish,bool CanWithdraw,bool CanAccept,bool CanDecline,bool CanCancelRequest,bool CanMarkRequestUnavailable,string[] Blockers,bool ConsentOnly=true,bool CanPay=false);
public sealed record SourcingOfferPage(int SchemaVersion,string RequestId,string RequestReference,string RequestVersion,int PageSize,SourcingOfferSummary[] Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? NextCursor,bool CanCancelRequest,bool CanMarkRequestUnavailable,bool ConsentOnly=true,bool CanPay=false);
public sealed record SourcingOfferMutation(int SchemaVersion,string RequestId,string OfferId,string Operation,int Revision,string State,string Version,string RequestVersion,string EventId,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? AcceptanceId,DateTimeOffset At,bool Replayed,bool ConsentOnly=true,bool CanPay=false);
public sealed record SourcingOfferEventData(string Id,int Revision,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? StateBefore,string StateAfter,string ActorKind,string ReasonCode,string PublicMessage,DateTimeOffset At);
public sealed record SourcingOfferEventPage(int SchemaVersion,int PageSize,SourcingOfferEventData[] Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? NextCursor);

public static class SourcingOfferRules
{
    public static readonly string[] Operations=["save","publish","withdraw","accept","decline"];
    public static string Identifier(string? value)=>SourcingRules.Actor(value);
    public static long Price(string? value)=>value is {Length:>0 and <=19}&&value.All(char.IsAsciiDigit)&&long.TryParse(value,NumberStyles.None,CultureInfo.InvariantCulture,out var amount)&&amount>=0&&amount.ToString(CultureInfo.InvariantCulture)==value?amount:throw Invalid();
    public static SourcingOfferSaveInput Normalize(SourcingOfferSaveInput input)
    {
        if(input.Lines is not {Length:>0 and <=64}||input.Lines.Any(l=>l is null)||input.AcceptUntil.Offset!=TimeSpan.Zero||input.PurchaseUntil.Offset!=TimeSpan.Zero||input.ExpectedAt is {Offset:var offset}&&offset!=TimeSpan.Zero||input.PurchaseUntil<input.AcceptUntil)throw Invalid();
        var lines=input.Lines.Select(l=>new SourcingOfferLineInput(SourcingRules.Id(l.LineId),SourcingRules.Id(l.ListingId),Identifier(l.VariantId),l.Quantity,Price(l.UnitPriceRial).ToString(CultureInfo.InvariantCulture),SourcingRules.Fingerprint(l.MaterialFingerprint),SourcingRules.Fingerprint(l.CurrentFingerprint))).OrderBy(l=>l.LineId,StringComparer.Ordinal).ToArray();
        if(lines.Any(l=>l.Quantity is <1 or >1000000)||lines.Select(l=>l.LineId).Distinct(StringComparer.Ordinal).Count()!=lines.Length||lines.GroupBy(l=>new{l.ListingId,l.VariantId}).Any(g=>g.Count()>1))throw Invalid();
        Total(lines.Select(l=>(l.Quantity,Price(l.UnitPriceRial))));
        return new(SourcingRules.CommandId(input.RequestId),SourcingRules.Version(input.RequestVersion),input.Version is null?null:SourcingRules.Version(input.Version),lines,SourcingRules.Text(input.TermsFa,4000,true),SourcingRules.Text(input.TermsEn,4000,true),input.AcceptUntil,input.PurchaseUntil,input.ExpectedAt);
    }
    public static long Total(IEnumerable<(int Quantity,long UnitPrice)> lines){try{return lines.Aggregate(0L,(sum,line)=>checked(sum+checked(line.Quantity*line.UnitPrice)));}catch(OverflowException){throw new BusinessException("sourcing_offer_amount_limit","The offer exceeds the supported integer rial amount.");}}
    public static string EffectiveState(string state,DateTimeOffset acceptUntil,DateTimeOffset purchaseUntil,DateTimeOffset now)=>state=="Published"&&acceptUntil<=now||state=="Accepted"&&purchaseUntil<=now?"Expired":state;
    public static bool AcceptedBlocks(string state,bool active,DateTimeOffset purchaseUntil,DateTimeOffset now)=>state=="Accepted"&&active&&purchaseUntil>now;
    private static BusinessException Invalid()=>new("invalid_sourcing_offer","Use bounded explicit offer terms, UTC deadlines, canonical integer rial amounts, unique lines and current versions/fingerprints.");
}
