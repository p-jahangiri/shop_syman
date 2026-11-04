using System.Text.Json.Serialization;
using Shop.SharedKernel;
namespace Shop.Modules.Credit;
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ChequeApprovalInput(string Action,string OrderVersion,string ScheduleVersion,string LedgerVersion,[property:JsonRequired]string? Version,string Note,DateTimeOffset OccurredAt,[property:JsonRequired]bool Confirmed,[property:JsonRequired]bool AcknowledgedClosedOrder);
public sealed record ChequeApprovalSummary(string Id,string ApprovalId,string OrderId,string ChequeId,int Sequence,string Action,string State,string Version,string OrderVersion,string ScheduleVersion,string LedgerVersion,DateTimeOffset OccurredAt,DateTimeOffset RecordedAt,bool BankVerified=false);
public sealed record ChequeApprovalEventData(ChequeApprovalSummary Summary,string Note,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? PreviousVersion,bool AcknowledgedClosedOrder);
public sealed record ChequeApprovalItem(int Sequence,string DueDate,string AmountRial,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]ChequeSummary? Cheque,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]ChequeApprovalSummary? Current,bool ApprovedForCurrentCheque);
public sealed record ChequeApprovalPage(int SchemaVersion,string OrderId,string OrderVersion,string OrderState,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? ScheduleVersion,ChequeApprovalItem[] Items,bool AllChequesApproved,bool BankVerified=false,bool CanPay=false,bool CanFulfill=false);
public sealed record ChequeApprovalDetail(int SchemaVersion,ChequeApprovalItem Item,string InstrumentReference,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]ChequeApprovalEventData? Current,bool CanApprove,bool CanRevoke,bool ClosedOrderAcknowledgementRequired);
public sealed record ChequeApprovalHistory(int SchemaVersion,string OrderId,string ChequeId,ChequeApprovalEventData[] Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]int? NextBefore);
public sealed record ChequeApprovalResult(int SchemaVersion,string CommandId,string OrderId,string ChequeId,ChequeApprovalEventData Event,bool Replayed,bool BankVerified=false,bool CanPay=false,bool CanFulfill=false);
public interface IChequeApprovalProtection{byte[] Protect(string purpose,string principal,string orderId,string id,string text);string Unprotect(string purpose,string principal,string orderId,string id,byte[] value);}
public static class ChequeApprovalRules
{
    public const int MaxEvents=200;
    public static BusinessException Invalid()=>new("invalid_cheque_approval","Review the exact cheque, schedule, custody version and explicit manual attestation.");
    public static BusinessException Conflict()=>new("cheque_approval_changed_conflict","The order, schedule, cheque custody or manual approval changed or expired.");
    public static BusinessException Unavailable()=>new("cheque_approval_unavailable","The private manual cheque approval could not be verified.");
    public static BusinessException Immutable()=>new("cheque_approval_history_immutable","Manual cheque approvals, events and receipts cannot be modified or removed.");
    public static bool Eligible(string state)=>state is "Received"or"Deposited"or"CollectedReported";
    public static void Validate(ChequeApprovalInput x)
    {
        if(x is null||!x.Confirmed||x.Action is not("Approve"or"Revoke")||x.Action=="Approve"&&x.AcknowledgedClosedOrder||x.Action=="Revoke"&&x.Version is null)throw Invalid();
        foreach(var v in new[]{x.OrderVersion,x.ScheduleVersion,x.LedgerVersion})CreditApplicationRules.Version(v);if(x.Version is{}version)CreditApplicationRules.Version(version);CreditUpfrontRules.Text(x.Note,500,true);
        if(x.OccurredAt.Offset!=TimeSpan.Zero||x.OccurredAt.Year<2000)throw Invalid();
    }
    public static bool Effective(ChequeApprovalSummary? approval,ChequeSummary cheque,string scheduleVersion)=>approval is{State:"Approved"}&&approval.ChequeId==cheque.Id&&approval.OrderId==cheque.OrderId&&approval.LedgerVersion==cheque.Version&&approval.ScheduleVersion==scheduleVersion&&Eligible(cheque.State);
}
