using System.Text.Json.Serialization;
using Shop.SharedKernel;
namespace Shop.Modules.Sales;
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ChequeReviewHoldInput(string Action,[property:JsonRequired]string? Version,[property:JsonRequired]int? Minutes,[property:JsonRequired]bool Confirmed);
public sealed record ChequeReviewHoldRevisionData(string Id,int Revision,bool Enabled,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]int? Minutes,DateTimeOffset CreatedAt);
public sealed record ChequeReviewHoldCurrent(int SchemaVersion,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? Version,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]ChequeReviewHoldRevisionData? Current,int MaximumMinutes=60);
public sealed record ChequeReviewHoldResult(int SchemaVersion,string CommandId,ChequeReviewHoldCurrent Policy,bool Replayed);
public sealed record ChequeReviewHoldHistory(int SchemaVersion,ChequeReviewHoldRevisionData[] Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]int? NextBefore);
public sealed record CreditReviewHoldOption(string PolicyRevisionId,string PolicyVersion,int MaximumMinutes,string Boundary="ScopeAndExistingStockRights");
public sealed record CreditReviewHoldData(string PolicyRevisionId,string PolicyVersion,int Minutes,DateTimeOffset QuoteExpiresAt,DateTimeOffset ExpiresAt);
public static class ChequeReviewHoldRules
{
    public const int MaximumMinutes=60,MaximumRevisions=10000;
    public static BusinessException Invalid()=>new("invalid_cheque_review_hold","Select Enable with an explicit 1–60 minute limit or Disable with no limit, exact version and explicit confirmation.");
    public static BusinessException Conflict()=>new("cheque_review_hold_changed_conflict","The cheque review-hold policy changed. Review the current version.");
    public static BusinessException Unavailable()=>new("cheque_review_hold_unavailable","The retained cheque review-hold policy could not be verified.");
    public static BusinessException Immutable()=>new("cheque_review_hold_history_immutable","Policy revisions, command receipts and original order deadlines cannot be modified or removed.");
    public static string Id(string value)=>CreditCheckoutQuoteRules.Id(value);
    public static void Version(string value){try{if(value is null||value.Length!=12||Convert.FromBase64String(value).Length!=8||Convert.ToBase64String(Convert.FromBase64String(value))!=value)throw Invalid();}catch(FormatException){throw Invalid();}}
    public static void Validate(ChequeReviewHoldInput input){if(input is null||!input.Confirmed||input.Action is not("Enable"or"Disable")||input.Action=="Enable"&&input.Minutes is not(>=1 and<=60)||input.Action=="Disable"&&input.Minutes is not null)throw Invalid();if(input.Version is{}v)Version(v);}
}
