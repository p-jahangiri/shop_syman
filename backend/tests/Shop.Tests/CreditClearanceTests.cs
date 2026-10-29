using Shop.Modules.Credit;
using Shop.SharedKernel;
using Xunit;
namespace Shop.Tests;
public sealed class CreditClearanceTests
{
    private const string V="AAAAAAAAAAE=",H="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    private static CreditClearanceInput Input()=>new("Approve",V,null,H,"Explicit synthetic review",true);
    [Fact]public void ApprovalRequiresExplicitConfirmationAndCanonicalVersions(){CreditClearanceRules.Validate(Input());Assert.Throws<BusinessException>(()=>CreditClearanceRules.Validate(Input()with{Confirmed=false}));Assert.Throws<BusinessException>(()=>CreditClearanceRules.Validate(Input()with{OrderVersion="bad"}));Assert.Throws<BusinessException>(()=>CreditClearanceRules.Validate(Input()with{PreviewFingerprint="bad"}));}
    [Fact]public void RevocationRequiresExistingVersionAndPrivateReason(){Assert.Throws<BusinessException>(()=>CreditClearanceRules.Validate(Input()with{Action="Revoke"}));CreditClearanceRules.Validate(Input()with{Action="Revoke",Version=V});Assert.Throws<BusinessException>(()=>CreditClearanceRules.Validate(Input()with{Note=""}));Assert.Throws<BusinessException>(()=>CreditClearanceRules.Validate(Input()with{Note="Unsafe\nreason"}));}
    private static CreditClearanceEvidence Evidence()=>new(H,H,new string('a',32),V,"10",new string('b',32),V,"ReceiptConfirmed",true,[new(1,"2027-01-01","20",new string('c',32),V,"Received",new string('d',32),V,true)],true);
    [Fact]public void AllActualCurrentInstrumentsAndUpfrontAreRequired(){Assert.True(CreditClearanceRules.Eligible(Evidence()));Assert.False(CreditClearanceRules.Eligible(Evidence()with{Cheques=[]}));Assert.False(CreditClearanceRules.Eligible(Evidence()with{UpfrontConfirmed=false}));Assert.False(CreditClearanceRules.Eligible(Evidence()with{AllChequesApproved=false}));Assert.False(CreditClearanceRules.Eligible(Evidence()with{Cheques=[Evidence().Cheques[0]with{LedgerState="BouncedReported"}]}));Assert.False(CreditClearanceRules.Eligible(Evidence()with{Cheques=[Evidence().Cheques[0]with{ApprovalVersion=null}]}));}
    [Fact]public void ExplicitNullResponseFieldsSurviveTheApiNullOmissionPolicy()
    {
        var options=new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web){DefaultIgnoreCondition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull};var customer=System.Text.Json.JsonSerializer.Serialize(new CreditClearanceCustomerPage(1,new string('a',32),"AwaitingPayment",null,false),options);Assert.Contains("\"current\":null",customer);var history=System.Text.Json.JsonSerializer.Serialize(new CreditClearanceHistory(1,new string('a',32),[],null),options);Assert.Contains("\"nextBefore\":null",history);var data=System.Text.Json.JsonSerializer.Serialize(new CreditClearanceEventData(new(new string('b',32),new string('a',32),1,"Approve","Approved",V,H,V,V,DateTimeOffset.UtcNow),"Explicit QA",null),options);Assert.Contains("\"previousVersion\":null",data);
    }

}
