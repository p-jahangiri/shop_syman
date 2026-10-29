using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;
namespace Shop.Tests;
public sealed class ChequeReviewHoldTests
{
    private const string Version="AAAAAAAAAAE=";
    [Theory][InlineData(1)][InlineData(30)][InlineData(60)]public void EnableRequiresAnExplicitBoundedDuration(int minutes)=>ChequeReviewHoldRules.Validate(new("Enable",null,minutes,true));
    [Theory][InlineData(0)][InlineData(-1)][InlineData(61)]public void ExistingInventoryHourBoundIsPreserved(int minutes)=>Assert.Throws<BusinessException>(()=>ChequeReviewHoldRules.Validate(new("Enable",null,minutes,true)));
    [Fact]public void NoDefaultDurationOrImplicitConfirmationIsAccepted()
    {
        foreach(var x in new[]{new ChequeReviewHoldInput("Enable",null,null,true),new("Enable",null,60,false),new("Disable",null,60,true),new("",null,30,true),new("Enable","bad",30,true)})Assert.Throws<BusinessException>(()=>ChequeReviewHoldRules.Validate(x));ChequeReviewHoldRules.Validate(new("Disable",Version,null,true));
    }
    [Fact]public void OptionalPolicyVersionDoesNotChangeHistoricalOrderPayloadOrItsIdempotencyHash()
    {
        var options=new JsonSerializerOptions(JsonSerializerDefaults.Web);var q=new string('a',32);var fingerprint=new string('A',64);var input=new CreditOrderInput(q,fingerprint,"Synthetic QA","09100000000",null,"",true,true);
        var expected="{\"contract\":\"Sayman.CreditOrder.v1\",\"input\":{\"creditQuoteId\":\""+q+"\",\"fingerprint\":\""+fingerprint+"\",\"contactName\":\"Synthetic QA\",\"contactPhone\":\"09100000000\",\"delivery\":null,\"note\":\"\",\"quoteAccepted\":true,\"acknowledgeTemporary\":true}}";
        var actual=JsonSerializer.Serialize(new{Contract="Sayman.CreditOrder.v1",Input=input},options);Assert.Equal(expected,actual);Assert.Equal(SHA256.HashData(Encoding.UTF8.GetBytes(expected)),SHA256.HashData(Encoding.UTF8.GetBytes(actual)));Assert.DoesNotContain("reviewHoldPolicyVersion",actual);var changed=JsonSerializer.Serialize(input with{ReviewHoldPolicyVersion=Version},options);Assert.Contains("\"reviewHoldPolicyVersion\":\""+Version+"\"",changed);Assert.NotEqual(JsonSerializer.Serialize(input,options),changed);
        var parsed=JsonSerializer.Deserialize<CreditOrderInput>(JsonSerializer.Serialize(input,options),new JsonSerializerOptions(JsonSerializerDefaults.Web){RespectRequiredConstructorParameters=true,RespectNullableAnnotations=true});Assert.Null(parsed!.ReviewHoldPolicyVersion);
    }
    [Fact]public void LegacyReadinessDoesNotGainAnUnreviewedPolicyField()
    {
        var json=JsonSerializer.Serialize(new CreditOrderReadiness(1,new string('a',32),new string('A',64),DateTimeOffset.UtcNow,true,[]),new JsonSerializerOptions(JsonSerializerDefaults.Web));Assert.DoesNotContain("reviewHold",json);var input=new ChequeReviewHoldInput("Enable",null,60,true);Assert.Throws<JsonException>(()=>JsonSerializer.Deserialize<ChequeReviewHoldInput>(JsonSerializer.Serialize(input,new JsonSerializerOptions(JsonSerializerDefaults.Web)).Replace("\"confirmed\":true","\"confirmed\":true,\"cashReservationMinutes\":60"),new JsonSerializerOptions(JsonSerializerDefaults.Web)));
    }
}
