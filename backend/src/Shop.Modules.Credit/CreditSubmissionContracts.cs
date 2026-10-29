using System.Text;
using System.Text.Json.Serialization;
using Shop.SharedKernel;
namespace Shop.Modules.Credit;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SubmitCreditApplicationInput(string ApplicationVersion,string ConsentId,string RequirementsRevisionId,string RequirementsVersion,string Locale,string Note,[property:JsonRequired]bool ReviewRequested);
public sealed record CreditSubmissionSummary(string Id,string ConsentId,string RequirementsRevisionId,string Locale,int DocumentCount,DateTimeOffset SubmittedAt);
public sealed record CreditSubmissionCapabilities(int SchemaVersion,CreditApplicationSummary Application,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? ConsentId,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? RequirementsRevisionId,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? RequirementsVersion,bool CanSubmit,bool CanWithdraw,int RequiredDocumentCount,int SelectedDocumentCount,string[] MissingDocumentKeys,string[] Blockers,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]CreditSubmissionSummary? LatestSubmission);
public sealed record CreditSubmissionPage(int SchemaVersion,string ApplicationId,CreditSubmissionSummary[] Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? NextCursor);
public sealed record CreditSubmissionFileData(string DocumentKey,string AttachmentId,bool Required,PrivateFileDescriptor File);
public sealed record CreditSubmissionDetail(int SchemaVersion,CreditApplicationSummary Application,CreditSubmissionSummary Submission,CreditApplicationPlan Plan,CreditRequirementsConsentData Consent,string Note,CreditSubmissionFileData[] Documents);
public sealed record CreditSubmissionResult(int SchemaVersion,bool Replayed,string CommandId,CreditApplicationSummary Application,CreditSubmissionSummary Submission,string Note);
public static class CreditSubmissionRules
{
    public static BusinessException Invalid()=>new("invalid_credit_submission","The exact application, consent, requirements and explicit review request are required.");
    public static BusinessException Conflict()=>new("credit_submission_conflict","Review the current application, plan, consent and required documents before submitting.");
    public static SubmitCreditApplicationInput Validate(SubmitCreditApplicationInput value)
    {
        if(value is null||!value.ReviewRequested)throw Invalid();CreditApplicationRules.Version(value.ApplicationVersion);CreditApplicationRules.Id(value.ConsentId);CreditApplicationRules.Id(value.RequirementsRevisionId);CreditApplicationRules.Version(value.RequirementsVersion);CreditApplicationRules.Locale(value.Locale);CreditRequirementsRules.Text(value.Note,2000,true);try{new UTF8Encoding(false,true).GetByteCount(value.Note);}catch(EncoderFallbackException){throw Invalid();}return value;
    }
}
