using System.Text;
using System.Text.Json.Serialization;
using Shop.SharedKernel;
namespace Shop.Modules.Credit;
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ReviewCreditApplicationInput(string ApplicationVersion,string SubmissionId,string Outcome,string Locale,string Note,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? ApprovedAmountRial,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]DateTimeOffset? ExpiresAt,[property:JsonRequired]bool ReviewConfirmed);
public sealed record CreditReviewData(string Id,string SubmissionId,string Outcome,string Locale,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? ApprovedAmountRial,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]DateTimeOffset? ExpiresAt,DateTimeOffset At);
public sealed record CreditReviewCapabilities(int SchemaVersion,CreditApplicationSummary Application,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? SubmissionId,bool CanReview,bool CanApprove,string[] Blockers,string[] ApprovalBlockers);
public sealed record CreditReviewPage(int SchemaVersion,string ApplicationId,CreditReviewData[] Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? NextCursor);
public sealed record CreditReviewDetail(int SchemaVersion,CreditApplicationSummary Application,CreditReviewData Review,string Note);
public sealed record CreditReviewResult(int SchemaVersion,bool Replayed,string CommandId,CreditApplicationSummary Application,CreditReviewData Review,string Note);
public static class CreditReviewRules
{
    public static BusinessException Invalid()=>new("invalid_credit_review","Choose an explicit review outcome, reason and, for approval, amount and future UTC expiry.");
    public static BusinessException Conflict()=>new("credit_review_conflict","The submitted application changed or was already reviewed or withdrawn.");
    public static string Outcome(string value)=>value is "Returned"or"Declined"or"Approved"?value:throw Invalid();
    public static bool ValidApproval(string outcome,long? amount,DateTimeOffset? until,DateTimeOffset at)=>outcome=="Approved"?amount is >0&&until is{}end&&end.Offset==TimeSpan.Zero&&end>at:amount is null&&until is null;
    public static string Note(string value){CreditRequirementsRules.Text(value,2000);try{new UTF8Encoding(false,true).GetByteCount(value);}catch(EncoderFallbackException){throw Invalid();}return value;}
    public static ReviewCreditApplicationInput Validate(ReviewCreditApplicationInput x){if(x is null||!x.ReviewConfirmed)throw Invalid();CreditApplicationRules.Version(x.ApplicationVersion);CreditApplicationRules.Id(x.SubmissionId);Outcome(x.Outcome);CreditApplicationRules.Locale(x.Locale);Note(x.Note);if(x.Outcome=="Approved"){CreditApplicationRules.Amount(x.ApprovedAmountRial!);if(x.ExpiresAt is null||x.ExpiresAt.Value.Offset!=TimeSpan.Zero)throw Invalid();}else if(x.ApprovedAmountRial is not null||x.ExpiresAt is not null)throw Invalid();return x;}
}
