using System.Text.Json;
using System.Text.Json.Serialization;
using Shop.Modules.Sales;
using Shop.Modules.Credit;
using Shop.SharedKernel;
using Xunit;
namespace Shop.Tests;
public sealed class ParcelRuleTests
{
    private const string V="AAAAAAAAAAE=";private static string Id()=>Guid.NewGuid().ToString("N");
    private static ParcelCommandInput Pack()=>new("owner",Id(),"pack",V,null,null,new('A',64),"review",true,"QA reference",[new("line",1,[])],null,null,null,null);
    [Fact]public void SelectionIsCanonicalAndCannotInjectFinancialOrAnotherLifecycleAction()
    {
        var input=Pack();Assert.Equal(JsonSerializer.Serialize(input),JsonSerializer.Serialize(ParcelRules.Normalize(input)));Assert.Throws<BusinessException>(()=>ParcelRules.Normalize(input with{Acknowledge=false}));Assert.Throws<BusinessException>(()=>ParcelRules.Normalize(input with{Action="refund"}));Assert.Throws<BusinessException>(()=>ParcelRules.Normalize(input with{Lines=[new("line",1,[]),new("line",1,[])]}));
        var json=JsonSerializer.Serialize(input,new JsonSerializerOptions(JsonSerializerDefaults.Web));Assert.Throws<JsonException>(()=>JsonSerializer.Deserialize<ParcelCommandInput>(json[..^1]+",\"paid\":true}",new JsonSerializerOptions(JsonSerializerDefaults.Web)));
    }
    [Fact]public void RepackingVoidingAndHandoffAcceptOnlyTheirOwnFacts()
    {
        var pack=Pack();Assert.Throws<BusinessException>(()=>ParcelRules.Normalize(pack with{Action="repack"}));var repack=pack with{Action="repack",ParcelId=Id(),ParcelVersion=V,Reference=null};ParcelRules.Normalize(repack);Assert.Throws<BusinessException>(()=>ParcelRules.Normalize(repack with{CarrierNameFa="unexpected"}));
        var dispatch=repack with{Action="dispatch",Lines=[],CarrierNameFa="حمل",CarrierNameEn="Carrier",OccurredAt=DateTimeOffset.UtcNow};ParcelRules.Normalize(dispatch);Assert.Throws<BusinessException>(()=>ParcelRules.Normalize(dispatch with{CarrierNameEn=null}));ParcelRules.Normalize(repack with{Action="void",Lines=[]});Assert.Throws<BusinessException>(()=>ParcelRules.Normalize(repack with{Action="void",Lines=[],OccurredAt=DateTimeOffset.UtcNow}));
    }
    [Fact]public void ParcelNumbersAreDecimalStringsWithoutUnsafeJavascriptCoercion()
    {
        Assert.Equal("9007199254740993",ParcelRules.After("9007199254740993"));Assert.Throws<BusinessException>(()=>ParcelRules.After("01"));Assert.Throws<BusinessException>(()=>ParcelRules.After("9223372036854775808"));
    }
    [Fact]public void OptionalPartialAcknowledgmentKeepsTheLegacyCanonicalFinancialShape()
    {
        var options=new JsonSerializerOptions(JsonSerializerDefaults.Web);var legacy=new CreditClearanceInput("Approve",V,null,new('A',64),"review",true);var json=JsonSerializer.Serialize(legacy,options);Assert.DoesNotContain("acknowledgedPartialDispatch",json);var parsed=JsonSerializer.Deserialize<CreditClearanceInput>(json,options)!;Assert.False(parsed.AcknowledgedPartialDispatch);
        var status=JsonSerializer.Serialize(new CreditOrderCommitmentState(Id(),V,"CreditApproved","Allocated","packed"),options);Assert.DoesNotContain("hasRemainingPartialDispatch",status);
        Assert.Throws<BusinessException>(()=>CreditClearanceRules.Validate(legacy with{AcknowledgedPartialDispatch=true}));CreditClearanceRules.Validate(legacy with{Version=V,AcknowledgedPartialDispatch=true});
    }
    [Fact]public void FinalIncompleteParcelIsAKnownCorrectableConflictRatherThanAnUnknownCommitOutcome()
    {
        var reservation=Id();var view=new PartialFulfillmentView(1,reservation,Id(),1,V,StockReservationState.Allocated,63,[new("LINE","VARIANT",65,63,2,"none")],[],new('A',64));var input=new PartialDispatchRequest("OWNER",reservation,Id(),"ACTOR",Id(),view.Fingerprint,[new("LINE",1,[])]);
        Assert.Equal("parcel_capacity_conflict",Assert.Throws<BusinessException>(()=>ParcelRules.Plan(view,input)).Code);Assert.True(ParcelRules.Plan(view,input with{Lines=[new("LINE",2,[])]}).CompletesReservation);
    }
    [Fact]public void NullableParcelMetadataStaysExplicitUnderApiNullOmission()
    {
        var opts=new JsonSerializerOptions(JsonSerializerDefaults.Web){DefaultIgnoreCondition=JsonIgnoreCondition.WhenWritingNull};var summary=new ParcelSummary(Id(),"1","QA","packed",V,1,DateTimeOffset.UtcNow,null,null,null,null,null,null,[new("line",1)]);var json=JsonSerializer.Serialize(summary,opts);foreach(var field in new[]{"dispatchedAt","deliveredAt","voidedAt","carrierNameFa","carrierNameEn","trackingNumber"})Assert.Contains("\""+field+"\":null",json);
    }
}
