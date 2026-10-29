using System.Globalization;
using System.Text.Json.Serialization;
using Shop.SharedKernel;
namespace Shop.Modules.Credit;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CreditReminderInput(string OrderVersion,string LedgerVersion,string PreviewFingerprint,string Note,[property:JsonRequired]bool Confirmed);
public sealed record CreditReminderSummary(string Id,string OrderId,string ChequeId,int Sequence,string CivilDay,string DueDate,string AmountRial,string LedgerState,string LedgerVersion,string OrderVersion,string PreviewFingerprint,DateTimeOffset At);
public sealed record CreditReminderPage(int SchemaVersion,string OrderId,string OrderVersion,string OrderState,ChequeSummary Cheque,string Today,string PreviewFingerprint,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]int? NextSequence,bool CanSend,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]CreditReminderSummary? SentToday,bool BankVerified=false,bool CanPay=false,bool CanFulfill=false);
public sealed record CreditReminderEventData(CreditReminderSummary Summary,string Note);
public sealed record CreditReminderHistory(int SchemaVersion,string OrderId,string ChequeId,CreditReminderEventData[] Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]int? NextBefore);
public sealed record CreditReminderResult(int SchemaVersion,bool Replayed,string CommandId,CreditReminderEventData Event,bool BankVerified=false,bool CanPay=false,bool CanFulfill=false);
public interface ICreditReminderProtection
{
    byte[] Protect(string purpose,string principal,string orderId,string id,string text);
    string Unprotect(string purpose,string principal,string orderId,string id,byte[] value);
}
public static class CreditReminderRules
{
    public const int MaxEvents=3650;
    public static BusinessException Invalid()=>new("invalid_credit_reminder","Review the retained cheque, exact order/ledger versions and explicit confirmation.");
    public static BusinessException Unavailable()=>new("credit_reminder_unavailable","The retained private reminder could not be verified.");
    public static BusinessException Conflict()=>new("credit_reminder_changed_conflict","The current cheque, order or civil report day changed.");
    public static BusinessException Immutable()=>new("credit_reminder_history_immutable","Reminder events and command receipts cannot be changed or removed.");
    public static bool Eligible(string orderState,string ledgerState)=>(orderState is "CreditApproved" or "Fulfilled")&&ChequeReportRules.Held(ledgerState);
    public static void Validate(CreditReminderInput input)
    {
        if(input is null||!input.Confirmed)throw Invalid();CreditApplicationRules.Version(input.OrderVersion);CreditApplicationRules.Version(input.LedgerVersion);CreditApplicationRules.Digest(input.PreviewFingerprint);ChequeLedgerRules.Text(input.Note,500,true);
    }
    public static string Day(string value)=>ChequeReportRules.Date(value).ToString("yyyy-MM-dd",CultureInfo.InvariantCulture);
}
