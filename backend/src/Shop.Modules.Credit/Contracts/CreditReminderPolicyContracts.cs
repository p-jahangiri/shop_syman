using System.Globalization;
using System.Text.Json.Serialization;
using Shop.SharedKernel;
namespace Shop.Modules.Credit;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CreditReminderPolicyInput([property:JsonRequired]string? Version,[property:JsonRequired]bool Enabled,int[] DayOffsets,[property:JsonRequired]string? SendAt,string Note,[property:JsonRequired]bool Confirmed);
public sealed record CreditReminderPolicyRevisionData(string Id,int Revision,string Version,bool Enabled,int[] DayOffsets,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? SendAt,string Note,DateTimeOffset At);
public sealed record CreditReminderDeliveryOptions(bool WorkerEnabled);
public sealed record CreditReminderPolicyCurrent(int SchemaVersion,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]CreditReminderPolicyRevisionData? Current,string TimeZone="Asia/Tehran",string Channel="PrivateAccountInbox",bool WorkerEnabled=true);
public sealed record CreditReminderPolicyResult(int SchemaVersion,string CommandId,bool Replayed,CreditReminderPolicyCurrent Policy);
public sealed record CreditReminderPolicyHistory(int SchemaVersion,CreditReminderPolicyRevisionData[] Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]int? NextBefore);
public interface ICreditReminderPolicyProtection
{
    byte[] Protect(string purpose,string principal,string id,string text);
    string Unprotect(string purpose,string principal,string id,byte[] value);
}
public static class CreditReminderPolicyRules
{
    public const int MaxRevisions=10000,MaxOffsets=31,MaxDayOffset=365;
    public static BusinessException Invalid()=>new("invalid_credit_reminder_policy","Choose explicit sorted unique day offsets (-365 to 365), a Tehran HH:mm time, exact version and confirmation, or disable with no offsets or time.");
    public static BusinessException Conflict()=>new("credit_reminder_policy_changed_conflict","The reminder policy changed. Read and review it again.");
    public static BusinessException Unavailable()=>new("credit_reminder_policy_unavailable","The retained reminder policy could not be verified.");
    public static BusinessException Immutable()=>new("credit_reminder_policy_history_immutable","Reminder policy revisions, day offsets and receipts are immutable.");
    public static bool Time(string value)=>value is{Length:5}&&TimeOnly.TryParseExact(value,"HH:mm",CultureInfo.InvariantCulture,DateTimeStyles.None,out var time)&&time.ToString("HH:mm",CultureInfo.InvariantCulture)==value;
    public static void Validate(CreditReminderPolicyInput x)
    {
        if(x is null||!x.Confirmed||x.DayOffsets is null||x.DayOffsets.Length>MaxOffsets||x.DayOffsets.Any(d=>d is < -MaxDayOffset or > MaxDayOffset)||!x.DayOffsets.SequenceEqual(x.DayOffsets.Distinct().Order())||x.Enabled&&(x.DayOffsets.Length==0||x.SendAt is null||!Time(x.SendAt))||!x.Enabled&&(x.DayOffsets.Length!=0||x.SendAt is not null))throw Invalid();
        if(x.Version is{}v)CreditApplicationRules.Version(v);ChequeLedgerRules.Text(x.Note,500,true);
    }
    // Positive offsets are after the due date; negative offsets are before it. No catch-up on a later civil day.
    public static bool Ready(CreditReminderPolicyRevisionData policy,DateTimeOffset now)
    {
        if(!policy.Enabled||policy.SendAt is null||!Time(policy.SendAt)||now<policy.At)return false;
        var local=TimeZoneInfo.ConvertTime(now,TimeZoneInfo.FindSystemTimeZoneById("Asia/Tehran"));return TimeOnly.FromDateTime(local.DateTime)>=TimeOnly.ParseExact(policy.SendAt,"HH:mm",CultureInfo.InvariantCulture);
    }
    public static bool Due(CreditReminderPolicyRevisionData policy,string dueDate,DateTimeOffset now)
    {
        if(!Ready(policy,now))return false;
        var local=TimeZoneInfo.ConvertTime(now,TimeZoneInfo.FindSystemTimeZoneById("Asia/Tehran"));var today=DateOnly.FromDateTime(local.DateTime);var due=ChequeReportRules.Date(dueDate);
        return policy.DayOffsets.Contains(today.DayNumber-due.DayNumber);
    }
}
