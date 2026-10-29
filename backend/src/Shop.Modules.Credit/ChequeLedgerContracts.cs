using System.Globalization;
using System.Text;
using System.Text.Json.Serialization;
using Shop.SharedKernel;
namespace Shop.Modules.Credit;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ReceiveChequeInput(string OrderVersion,string ScheduleVersion,int Sequence,string InstrumentReference,string Note,DateTimeOffset OccurredAt,[property:JsonRequired]bool Confirmed);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record MoveChequeInput(string Version,string Action,string Note,DateTimeOffset OccurredAt,[property:JsonRequired]bool Confirmed,[property:JsonRequired]bool AcknowledgedClosedOrder);
public sealed record ChequeSummary(string Id,string InternalReference,string OrderId,string ScheduleId,int Sequence,string DueDate,string AmountRial,string State,string Version,DateTimeOffset OccurredAt,DateTimeOffset RecordedAt,bool BankVerified=false);
public sealed record ChequeLedgerPage(int SchemaVersion,string OrderId,string OrderVersion,string OrderState,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? ScheduleVersion,bool CanReceive,bool ScheduleFrozen,ChequeSummary[] Items,bool CanPay=false,bool CanFulfill=false);
public sealed record ChequeEventData(string Id,string ChequeId,int Sequence,string Action,string State,string Version,DateTimeOffset OccurredAt,DateTimeOffset RecordedAt,string Note,bool BankVerified=false);
public sealed record ChequeDetail(int SchemaVersion,ChequeSummary Cheque,string InstrumentReference,string ReceiptNote,ChequeEventData Current,string[] AllowedActions,bool ClosedOrderAcknowledgementRequired,bool CanPay=false,bool CanFulfill=false);
public sealed record ChequeHistoryPage(int SchemaVersion,string ChequeId,ChequeEventData[] Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]int? NextSequence);
public sealed record ChequeCommandResult(int SchemaVersion,bool Replayed,string CommandId,ChequeSummary Cheque,ChequeEventData Event,bool CanPay=false,bool CanFulfill=false);
public interface IChequeLedgerProtection
{
    byte[] Protect(string purpose,string principal,string orderId,string id,string text);
    string Unprotect(string purpose,string principal,string orderId,string id,byte[] value);
}
public static class ChequeLedgerRules
{
    public const int MaxEvents=200;
    public static BusinessException Invalid()=>new("invalid_cheque_ledger","Review the cheque reference, explicit UTC time, state and exact versions.");
    public static BusinessException Conflict()=>new("cheque_ledger_changed_conflict","The order, dated schedule or current cheque state changed.");
    public static BusinessException Unavailable()=>new("cheque_ledger_unavailable","The private cheque record could not be read safely.");
    public static BusinessException Immutable()=>new("cheque_ledger_history_immutable","Cheque registrations, events and receipts cannot be modified or removed.");
    public static string Text(string value,int limit,bool required=false)
    {
        if(value is null||value.Length>limit||value!=value.Trim()||value.Any(char.IsControl)||value.Any(char.IsSurrogate)||required&&string.IsNullOrWhiteSpace(value))throw Invalid();
        return value;
    }
    public static void Time(DateTimeOffset value,DateTimeOffset earliest,DateTimeOffset now)
    {
        if(value.Offset!=TimeSpan.Zero||value<earliest||value>now||value.Year<2000)throw Invalid();
    }
    public static string[] Actions(string state)=>state switch
    {
        "Received"=>["Deposit","ReturnToCustomer"],
        "Deposited"=>["ReportCollection","ReportBounce","Withdraw"],
        "BouncedReported" or "Withdrawn"=>["Deposit","ReturnToCustomer"],
        "CollectedReported"=>["CorrectCollectionReport"],
        "ReturnedToCustomer"=>[],_=>throw Invalid()
    };
    public static string Next(string state,string action)
    {
        if(!Actions(state).Contains(action,StringComparer.Ordinal))throw Conflict();
        return action switch{"Deposit" or "CorrectCollectionReport"=>"Deposited","ReportCollection"=>"CollectedReported","ReportBounce"=>"BouncedReported","Withdraw"=>"Withdrawn","ReturnToCustomer"=>"ReturnedToCustomer",_=>throw Invalid()};
    }
    public static string Rial(long value)=>value.ToString(CultureInfo.InvariantCulture);
    public static void Receive(ReceiveChequeInput x)
    {
        if(x is null||!x.Confirmed||x.Sequence is <1 or >60)throw Invalid();CreditApplicationRules.Version(x.OrderVersion);CreditApplicationRules.Version(x.ScheduleVersion);Text(x.InstrumentReference,128,true);Text(x.Note,500);
    }
    public static void Move(MoveChequeInput x)
    {
        if(x is null||!x.Confirmed)throw Invalid();CreditApplicationRules.Version(x.Version);Text(x.Action,32,true);Text(x.Note,500,true);
    }
}
