using System.Globalization;
using System.Text.Json.Serialization;
using Shop.SharedKernel;
namespace Shop.Modules.Credit;
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CreditSchedulePreviewInput(string OrderVersion,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? ScheduleVersion,string CalendarKind,string AnchorDate);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SaveCreditScheduleInput(string OrderVersion,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? ScheduleVersion,string CalendarKind,string AnchorDate,string PreviewFingerprint,[property:JsonRequired]bool Confirmed);
public sealed record CreditScheduleLineData(int Sequence,int MonthOffset,string DueDate,string AmountRial);
public sealed record CreditScheduleCalculation(string CalendarKind,string AnchorDate,string TimeZone,string PlanDownPaymentRial,string ChargesOutsideChequesRial,string UpfrontTotalRial,string InstallmentsTotalRial,string PayableTotalRial,CreditScheduleLineData[] Lines);
public sealed record CreditScheduleRevisionData(string Id,string OrderId,int Revision,string Version,string CreditQuoteId,string QuoteFingerprint,string PlanName,string Locale,CreditScheduleCalculation Calculation,DateTimeOffset CreatedAt,string State="Planned",bool CanPay=false,bool CanFulfill=false);
public sealed record CreditSchedulePreview(int SchemaVersion,string OrderId,string OrderVersion,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? ScheduleVersion,string Fingerprint,string CreditQuoteId,string QuoteFingerprint,string PlanName,string Locale,CreditScheduleCalculation Calculation,bool CanPay=false,bool CanFulfill=false);
public sealed record CreditScheduleResult(int SchemaVersion,bool Replayed,string CommandId,CreditScheduleRevisionData Revision);
public sealed record CreditSchedulePage(int SchemaVersion,string OrderId,string OrderVersion,string OrderState,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]CreditScheduleRevisionData? Current,bool CanAmend,string[] Blockers,bool CanPay=false,bool CanFulfill=false);
public sealed record CreditScheduleHistoryPage(int SchemaVersion,string OrderId,CreditScheduleRevisionData[] Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]int? NextRevision);
public interface ICreditScheduleProtection{byte[] Protect(string actor,string orderId,string commandId,string text);string Unprotect(string actor,string orderId,string commandId,byte[] bytes);}
public static class CreditScheduleRules
{
    public static BusinessException Invalid()=>new("invalid_credit_schedule","Select an explicit month calendar, anchor date, exact versions and reviewed preview.");
    public static BusinessException Conflict()=>new("credit_schedule_changed_conflict","The cheque order, plan preview or current schedule changed or expired.");
    public static BusinessException Unavailable()=>new("credit_schedule_unavailable","The private cheque schedule could not be read safely.");
    public static BusinessException Immutable()=>new("credit_schedule_history_immutable","Schedule revisions, lines and command receipts cannot be modified or removed.");
    public static DateOnly Date(string value){if(value is null||value.Length!=10||!DateOnly.TryParseExact(value,"yyyy-MM-dd",CultureInfo.InvariantCulture,DateTimeStyles.None,out var date)||date.ToString("yyyy-MM-dd",CultureInfo.InvariantCulture)!=value)throw Invalid();return date;}
    public static void Validate(CreditSchedulePreviewInput x){if(x is null)throw Invalid();CreditApplicationRules.Version(x.OrderVersion);if(x.ScheduleVersion is{}v)CreditApplicationRules.Version(v);if(x.CalendarKind is not("Persian"or"Gregorian"))throw Invalid();Date(x.AnchorDate);}
    public static CreditSchedulePreviewInput Validate(SaveCreditScheduleInput x){if(x is null||!x.Confirmed)throw Invalid();CreditApplicationRules.Digest(x.PreviewFingerprint);var input=new CreditSchedulePreviewInput(x.OrderVersion,x.ScheduleVersion,x.CalendarKind,x.AnchorDate);Validate(input);return input;}
}
