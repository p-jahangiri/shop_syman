using System.Text;
using System.Text.Json.Serialization;
using Shop.SharedKernel;
namespace Shop.Modules.Credit;
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record GrantCreditPurchaseScopeInput(string ApplicationVersion,string ReviewId,string LimitBasis,[property:JsonRequired]bool GrantConfirmed);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record RevokeCreditPurchaseScopeInput(string ApplicationVersion,string ScopeVersion,string Locale,string Note,[property:JsonRequired]bool RevokeConfirmed);
public sealed record CreditScopeRevocationData(string ActorKind,string Locale,string Note,DateTimeOffset At);
public sealed record CreditScopeUseData(string OrderId,string CreditQuoteId,DateTimeOffset At);
public sealed record CreditPurchaseScopeData(string Id,string Version,string ReviewId,string SubmissionId,string LimitBasis,string LimitAmountRial,DateTimeOffset ExpiresAt,DateTimeOffset GrantedAt,string State,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]CreditScopeRevocationData? Revocation,[property:JsonIgnore(Condition=JsonIgnoreCondition.WhenWritingNull)]CreditScopeUseData? Use=null);
public sealed record CreditPurchaseScopePage(int SchemaVersion,CreditApplicationSummary Application,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? ReviewId,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]CreditPurchaseScopeData? Scope,bool CanGrant,bool CanRevoke,bool EligibleForQuote,string[] GrantBlockers,string[] QuoteBlockers,bool CanPlaceOrder=false,bool CanPay=false);
public sealed record CreditPurchaseScopeResult(int SchemaVersion,bool Replayed,string CommandId,string Kind,CreditApplicationSummary Application,CreditPurchaseScopeData Scope);
public static class CreditPurchaseScopeRules
{
    public static BusinessException Invalid()=>new("invalid_credit_purchase_scope","Select an explicit purchase limit basis and confirm the exact application or scope version.");
    public static BusinessException Conflict()=>new("credit_purchase_scope_conflict","The approved application, purchase scope or plan changed, expired or was revoked.");
    public static string Basis(string value)=>value is "PayableTotalRial"or"InstallmentsTotalRial"?value:throw Invalid();
    public static GrantCreditPurchaseScopeInput Validate(GrantCreditPurchaseScopeInput x){if(x is null||!x.GrantConfirmed)throw Invalid();CreditApplicationRules.Version(x.ApplicationVersion);CreditApplicationRules.Id(x.ReviewId);Basis(x.LimitBasis);return x;}
    public static RevokeCreditPurchaseScopeInput Validate(RevokeCreditPurchaseScopeInput x,bool staff){if(x is null||!x.RevokeConfirmed)throw Invalid();CreditApplicationRules.Version(x.ApplicationVersion);CreditApplicationRules.Version(x.ScopeVersion);CreditApplicationRules.Locale(x.Locale);CreditRequirementsRules.Text(x.Note,2000,!staff);try{new UTF8Encoding(false,true).GetByteCount(x.Note);}catch(EncoderFallbackException){throw Invalid();}return x;}
}
