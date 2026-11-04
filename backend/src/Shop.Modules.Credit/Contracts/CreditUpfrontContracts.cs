using System.Globalization;
using System.Text;
using System.Text.Json.Serialization;
using Shop.SharedKernel;
namespace Shop.Modules.Credit;
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CreditUpfrontInput(string Action,string OrderVersion,string ScheduleVersion,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? Version,string Reference,string Note,DateTimeOffset OccurredAt,bool Confirmed=false,bool AcknowledgedClosedOrder=false,[property:JsonIgnore(Condition=JsonIgnoreCondition.WhenWritingDefault)]bool AcknowledgedCommittedOrder=false);
public sealed record CreditUpfrontSummary(string Id,string ConfirmationId,string OrderId,int Sequence,string Action,string State,string RequiredAmountRial,string AcknowledgedAmountRial,string Version,DateTimeOffset OccurredAt,DateTimeOffset RecordedAt,bool BankVerified=false);
public sealed record CreditUpfrontEventData(CreditUpfrontSummary Summary,string Reference,string Note,string OrderVersion,string ScheduleVersion,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? PreviousVersion,bool AcknowledgedClosedOrder,[property:JsonIgnore(Condition=JsonIgnoreCondition.WhenWritingDefault)]bool AcknowledgedCommittedOrder=false);
public sealed record CreditUpfrontPage(int SchemaVersion,string OrderId,string OrderVersion,string OrderState,string RequiredAmountRial,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? ScheduleVersion,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]CreditUpfrontSummary? Current,bool CanConfirmReceipt,bool CanConfirmNoUpfrontDue,bool CanRevoke,string[] Blockers,bool BankVerified=false,bool CanPay=false,bool CanFulfill=false);
public sealed record CreditUpfrontCustomerPage(int SchemaVersion,string OrderId,string RequiredAmountRial,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]CreditUpfrontSummary? Current,bool BankVerified=false,bool CanPay=false,bool CanFulfill=false);
public sealed record CreditUpfrontHistory(int SchemaVersion,string OrderId,CreditUpfrontEventData[] Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]int? NextBefore);
public sealed record CreditUpfrontResult(int SchemaVersion,string CommandId,string OrderId,CreditUpfrontEventData Event,bool Replayed,bool BankVerified=false,bool CanPay=false,bool CanFulfill=false);
public interface ICreditUpfrontProtection
{
    byte[] Protect(string purpose,string principal,string orderId,string id,string text);
    string Unprotect(string purpose,string principal,string orderId,string id,byte[] bytes);
}
public static class CreditUpfrontRules
{
    public const int MaximumEvents=200;
    public static BusinessException Invalid()=>new("invalid_credit_upfront","Review the full server-calculated upfront amount, explicit action, reference, UTC time and versions.");
    public static BusinessException Conflict()=>new("credit_upfront_changed_conflict","The order, dated schedule or active upfront confirmation changed or expired.");
    public static BusinessException Unavailable()=>new("credit_upfront_unavailable","The private upfront confirmation could not be verified.");
    public static BusinessException Immutable()=>new("credit_upfront_history_immutable","Upfront confirmations, revisions and receipts are immutable.");
    public static string Rial(long amount)=>amount.ToString(CultureInfo.InvariantCulture);
    public static long Required(long payable,IReadOnlyList<long> cheques)
    {
        if(payable<=0||cheques is null||cheques.Count>60||cheques.Any(x=>x<=0))throw Invalid();try{var sum=0L;foreach(var v in cheques)sum=checked(sum+v);if(sum>payable)throw Invalid();return payable-sum;}catch(OverflowException){throw Invalid();}
    }
    public static string Text(string text,int maximum,bool required=false)
    {
        if(text is null||text.Length>maximum||text!=text.Trim()||text.Any(c=>char.IsControl(c)||c is >= '\u202a' and <= '\u202e' or >= '\u2066' and <= '\u2069')||required&&string.IsNullOrWhiteSpace(text))throw Invalid();try{_=new UTF8Encoding(false,true).GetByteCount(text);}catch(EncoderFallbackException){throw Invalid();}return text;
    }
    public static void Input(CreditUpfrontInput x)
    {
        if(x is null||!x.Confirmed||x.Action is not("ConfirmReceipt"or"ConfirmNoUpfrontDue"or"RevokeConfirmation"))throw Invalid();
        try{CreditApplicationRules.Version(x.OrderVersion);CreditApplicationRules.Version(x.ScheduleVersion);if(x.Version is{}v)CreditApplicationRules.Version(v);}catch(BusinessException){throw Invalid();}
        Text(x.Reference,256,x.Action=="ConfirmReceipt");Text(x.Note,500,x.Action=="RevokeConfirmation"||x.AcknowledgedCommittedOrder);if(x.Action!="ConfirmReceipt"&&x.Reference.Length!=0||x.Action=="RevokeConfirmation"&&x.Version is null||x.Action!="RevokeConfirmation"&&x.AcknowledgedClosedOrder||x.AcknowledgedCommittedOrder&&(x.Version is null||x.AcknowledgedClosedOrder)||x.OccurredAt.Offset!=TimeSpan.Zero||x.OccurredAt.Year<2000)throw Invalid();
    }
    public static string Next(string? state,string action,long required)
    {
        if(required<0)throw Invalid();if(action=="RevokeConfirmation")return state is"ReceiptConfirmed"or"NoUpfrontDue"?"Revoked":throw Conflict();if(state is not(null or"Revoked"))throw Conflict();return action switch{"ConfirmReceipt"when required>0=>"ReceiptConfirmed","ConfirmNoUpfrontDue"when required==0=>"NoUpfrontDue",_=>throw Conflict()};
    }
    public static long Acknowledged(string state,long required)=>state switch{"ReceiptConfirmed"when required>0=>required,"NoUpfrontDue"when required==0=>0,"Revoked"when required>=0=>0,_=>throw Invalid()};
}
