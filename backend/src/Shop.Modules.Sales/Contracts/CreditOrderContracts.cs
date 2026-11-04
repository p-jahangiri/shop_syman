using System.Text.Json.Serialization;
using Shop.SharedKernel;
namespace Shop.Modules.Sales;
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CreditOrderAddressInput(string CountryCode,string Province,string City,string Address,string PostalCode);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CreditOrderInput(string CreditQuoteId,string Fingerprint,string ContactName,string ContactPhone,CreditOrderAddressInput? Delivery,string? Note,[property:JsonRequired]bool QuoteAccepted,[property:JsonRequired]bool AcknowledgeTemporary,[property:JsonIgnore(Condition=JsonIgnoreCondition.WhenWritingNull)]string? ReviewHoldPolicyVersion=null);
public sealed record CreditOrderLinkData(string OrderId,string CreditQuoteId,string ApplicationId,string ScopeId,string QuoteFingerprint,string LimitBasis,string LimitAmountRial,string AssessedAmountRial,DateTimeOffset AcceptedAt,string SettlementState="Pending",bool CanPay=false);
public sealed record CreditOrderResult(int SchemaVersion,bool Replayed,string CommandId,CreditOrderLinkData Credit,OrderDetailV2Data Order,[property:JsonIgnore(Condition=JsonIgnoreCondition.WhenWritingNull)]CreditReviewHoldData? ReviewHold=null);
public sealed record CreditOrderDetail(int SchemaVersion,CreditOrderLinkData Credit,OrderDetailV2Data Order,CreditCheckoutQuoteData Calculation,[property:JsonIgnore(Condition=JsonIgnoreCondition.WhenWritingNull)]CreditReviewHoldData? ReviewHold=null);
public interface ICreditOrderProtection
{
    byte[] Protect(string owner,string orderId,string text);
    string Unprotect(string owner,string orderId,byte[] bytes);
}
public static class CreditOrderRules
{
    public static CreditOrderInput Validate(CreditOrderInput input,string commandId)
    {
        if(input is null||!input.QuoteAccepted||!input.AcknowledgeTemporary)throw Invalid();CreditCheckoutQuoteRules.Id(commandId);CreditCheckoutQuoteRules.Id(input.CreditQuoteId);
        if(input.ReviewHoldPolicyVersion is{}holdVersion)ChequeReviewHoldRules.Version(holdVersion);
        if(input.Fingerprint is not{Length:64}||input.Fingerprint.Any(c=>!char.IsAsciiHexDigit(c)))throw Invalid();
        var x=OrderInputRules.Normalize(new(input.CreditQuoteId,commandId,input.ContactName,input.ContactPhone,input.Delivery is null?null:new(input.Delivery.CountryCode,input.Delivery.Province,input.Delivery.City,input.Delivery.Address,input.Delivery.PostalCode),input.Note,true));
        return input with{ContactName=x.ContactName,ContactPhone=x.ContactPhone,Delivery=x.Delivery is null?null:new(x.Delivery.CountryCode,x.Delivery.Province,x.Delivery.City,x.Delivery.Address,x.Delivery.PostalCode),Note=x.Note};
    }
    public static BusinessException Invalid()=>new("invalid_credit_order","Accept the exact cheque calculation and temporary-order deadline and provide bounded delivery details.");
    public static BusinessException Unavailable()=>new("credit_order_unavailable","The retained private cheque order receipt is unavailable.");
}

public sealed record CreditOrderReadiness(int SchemaVersion,string CreditQuoteId,string Fingerprint,DateTimeOffset ExpiresAt,bool CanCreate,string[] Blockers,bool CanPay=false,[property:JsonIgnore(Condition=JsonIgnoreCondition.WhenWritingNull)]CreditReviewHoldOption? ReviewHold=null);
