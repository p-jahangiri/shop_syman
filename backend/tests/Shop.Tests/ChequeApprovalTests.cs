using System.Text.Json;
using Shop.Modules.Credit;
using Shop.SharedKernel;
using Xunit;
namespace Shop.Tests;
public sealed class ChequeApprovalTests
{
    private const string Id="11111111111111111111111111111111",Other="22222222222222222222222222222222",V="AAAAAAAAAAE=",V2="AAAAAAAAAAI=";
    private static readonly DateTimeOffset At=new(2026,10,28,0,0,0,TimeSpan.Zero);
    private static ChequeSummary Cheque(string state="Received",string version=V)=>new(Id,"CH-QA",Id,Id,1,"2026-11-28","9007199254740993",state,version,At,At);
    private static ChequeApprovalSummary Approved(string ledger=V)=>new(Id,Id,Id,Id,1,"Approve","Approved",V,V,V,ledger,At,At);
    private static ChequeApprovalInput Input()=>new("Approve",V,V,V,null,"تأیید ساختگی 🎮",At,true,false);
    [Theory][InlineData("Received",true)][InlineData("Deposited",true)][InlineData("CollectedReported",true)][InlineData("BouncedReported",false)][InlineData("Withdrawn",false)][InlineData("ReturnedToCustomer",false)][InlineData("Paid",false)]
    public void OnlyExplicitCustodyStatesCanSupportManualApproval(string state,bool eligible){Assert.Equal(eligible,ChequeApprovalRules.Eligible(state));Assert.Equal(eligible,ChequeApprovalRules.Effective(Approved(),Cheque(state),V));}
    [Fact]public void EveryBindingAndRevocationMatters(){Assert.True(ChequeApprovalRules.Effective(Approved(),Cheque(),V));Assert.False(ChequeApprovalRules.Effective(null,Cheque(),V));Assert.False(ChequeApprovalRules.Effective(Approved(),Cheque(version:V2),V));Assert.False(ChequeApprovalRules.Effective(Approved(),Cheque(),V2));Assert.False(ChequeApprovalRules.Effective(Approved()with{State="Revoked"},Cheque(),V));Assert.False(ChequeApprovalRules.Effective(Approved()with{ChequeId=Other},Cheque(),V));Assert.False(ChequeApprovalRules.Effective(Approved()with{OrderId=Other},Cheque(),V));}
    [Fact]public void ReviewReasonExactVersionsAndClosedAckAreExplicit(){ChequeApprovalRules.Validate(Input());foreach(var input in new[]{Input()with{Confirmed=false},Input()with{Action=""},Input()with{Action="Approve",AcknowledgedClosedOrder=true},Input()with{Action="Revoke"},Input()with{Note=""},Input()with{Note="line\nbreak"},Input()with{Note="\u202ehidden"},Input()with{OrderVersion="bad"},Input()with{OccurredAt=At.ToOffset(TimeSpan.FromHours(3.5))}})Assert.Throws<BusinessException>(()=>ChequeApprovalRules.Validate(input));ChequeApprovalRules.Validate(Input()with{Action="Revoke",Version=V,AcknowledgedClosedOrder=true});}
    [Fact]public void InputRejectsClientMoneyAndImplicitReview(){var options=new JsonSerializerOptions(JsonSerializerDefaults.Web);var raw=JsonSerializer.Serialize(Input(),options);Assert.Throws<JsonException>(()=>JsonSerializer.Deserialize<ChequeApprovalInput>(raw[..^1]+",\"amountRial\":\"1\"}",options));Assert.Throws<JsonException>(()=>JsonSerializer.Deserialize<ChequeApprovalInput>(raw.Replace("\"confirmed\":true,",""),options));}
}
