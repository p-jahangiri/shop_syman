using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Shop.SharedKernel;

namespace Shop.Modules.Credit;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CreditDocumentRequirementInput(string Key,string NameFa,string NameEn,string HelpFa,string HelpEn,[property:JsonRequired]bool Required,int MaxBytes,string[] ContentTypes);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CreditRequirementsContent(string TitleFa,string TitleEn,string TermsFa,string TermsEn,string ConsentLabelFa,string ConsentLabelEn,[property:JsonRequired]bool Enabled,CreditDocumentRequirementInput[] Documents);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record PublishCreditRequirementsInput([property:JsonRequired,JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? Version,CreditRequirementsContent Content);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record AcceptCreditRequirementsInput(string ApplicationVersion,string RequirementsRevisionId,string RequirementsVersion,string Locale,bool Accepted);

public sealed record CreditRequirementsRevisionData(string Id,DateTimeOffset CreatedAt,CreditRequirementsContent Content);
public sealed record CreditRequirementsCurrent(int SchemaVersion,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? Version,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]CreditRequirementsRevisionData? Published);
public sealed record CreditRequirementsRevisionSummary(string Id,DateTimeOffset CreatedAt,string TitleFa,string TitleEn,bool Enabled,int DocumentCount);
public sealed record CreditRequirementsHistory(int SchemaVersion,CreditRequirementsRevisionSummary[] Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? NextCursor);
public interface ICreditRequirementsCommandResult { bool Replayed{get;} }
public sealed record PublishCreditRequirementsResult(int SchemaVersion,bool Replayed,string CommandId,CreditRequirementsCurrent Current):ICreditRequirementsCommandResult;
public sealed record CreditRequirementsConsentData(string Id,string Locale,DateTimeOffset AcceptedAt,CreditRequirementsRevisionData Requirements);
public sealed record CreditCaseRequirements(int SchemaVersion,CreditApplicationSummary Application,CreditRequirementsCurrent Current,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]CreditRequirementsConsentData? Consent,bool CanConsent);
public sealed record AcceptCreditRequirementsResult(int SchemaVersion,bool Replayed,string CommandId,CreditApplicationSummary Application,CreditRequirementsConsentData Consent):ICreditRequirementsCommandResult;

public static class CreditRequirementsRules
{
    public static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web){MaxDepth=16};
    public static readonly string[] Types=["application/pdf","image/jpeg","image/png","image/webp"];
    public static BusinessException Invalid()=>new("invalid_credit_requirements","Bilingual requirements, document definitions and exact versions are required.");
    public static BusinessException Conflict()=>new("credit_requirements_version_conflict","The application or published requirements changed. Review the current version.");
    public static BusinessException Immutable()=>new("credit_requirements_history_immutable","Published requirements and consent history cannot be changed or deleted.");
    public static string Text(string value,int max,bool optional=false)
    {
        if(value is null||value.Length>max||(!optional&&string.IsNullOrWhiteSpace(value))||value!=value.Trim()||value.Any(c=>char.IsControl(c)&&c is not('\n'or'\t'))||value.Any(c=>c is >= '\u202A' and <= '\u202E' or >= '\u2066' and <= '\u2069'))throw Invalid();
        return value;
    }
    public static void Validate(CreditRequirementsContent content)
    {
        if(content is null||content.Documents is null||content.Documents.Length>12)throw Invalid();
        Text(content.TitleFa,160);Text(content.TitleEn,160);Text(content.TermsFa,4000);Text(content.TermsEn,4000);Text(content.ConsentLabelFa,500);Text(content.ConsentLabelEn,500);
        var keys=new HashSet<string>(StringComparer.Ordinal);
        foreach(var doc in content.Documents){
            if(doc is null)throw Invalid();CreditApplicationRules.Key(doc.Key);if(!keys.Add(doc.Key)||doc.MaxBytes is <1 or >8388608||doc.ContentTypes is null||doc.ContentTypes.Length is <1 or >4||doc.ContentTypes.Distinct(StringComparer.Ordinal).Count()!=doc.ContentTypes.Length||doc.ContentTypes.Any(x=>!Types.Contains(x,StringComparer.Ordinal)))throw Invalid();
            Text(doc.NameFa,120);Text(doc.NameEn,120);Text(doc.HelpFa,300,true);Text(doc.HelpEn,300,true);
        }
        // Includes JSON escaping. The immutable revision must fit the same
        // bounded private response and protected receipt budgets as its readers.
        if(Encoding.UTF8.GetByteCount(JsonSerializer.Serialize(content,Json))>36000)throw Invalid();
    }
    public static int TypeMask(string[] types){var mask=0;foreach(var type in types){var i=Array.IndexOf(Types,type);if(i<0)throw Invalid();mask|=1<<i;}return mask;}
    public static string[] ContentTypes(int mask){if(mask is <1 or >15)throw Invalid();return Types.Where((_,i)=>(mask&(1<<i))!=0).ToArray();}
    public static string Snapshot(CreditRequirementsRevisionData value)
    {
        CreditApplicationRules.Id(value.Id);if(value.CreatedAt.Offset!=TimeSpan.Zero)throw Invalid();Validate(value.Content);return JsonSerializer.Serialize(value,Json);
    }
}
