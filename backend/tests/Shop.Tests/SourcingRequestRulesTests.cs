using System.Text.Json;
using Shop.Modules.Market;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;
public sealed class SourcingRequestRulesTests
{
    private static string Id()=>Guid.NewGuid().ToString("N");
    private static SourcingModelSnapshot Model(params SourcingAttributeSnapshot[] attributes)=>new("model","sample-model","phones","گوشی","Phones","brand","Brand","نمونه","Sample","متن","Text",["/products/phone.svg"],"AAAAAAAAAAE=",new string('A',64),false,attributes);
    [Fact] public void SubmissionNormalizesCanonicalCommandExpectedOrderAndBoundedPrivateNote()
    {
        var a=Id();var b=Id();var command=Guid.NewGuid();var input=new SourcingSubmitInput(command.ToString("D"),"AAAAAAAAAAE=",[new(b,new string('B',64)),new(a,new string('A',64))],"  متن\r\nنمونه  ");var normalized=SourcingRules.Normalize(input);
        Assert.Equal(command.ToString("N"),normalized.RequestId);Assert.Equal("متن\nنمونه",normalized.Note);Assert.Equal(new[]{a,b}.Order(StringComparer.Ordinal),normalized.Expected.Select(e=>e.ListingId));
        Assert.Equal(SourcingRules.Payload(normalized),SourcingRules.Payload(SourcingRules.Normalize(input with{Expected=input.Expected.Reverse().ToArray()})));
    }
    [Fact] public void InvalidVersionsDuplicateListingsMalformedFingerprintsAndOversizedNotesAreRejected()
    {
        var id=Id();var input=new SourcingSubmitInput(Guid.NewGuid().ToString("D"),"AAAAAAAAAAE=",[new(id,new string('A',64))]);
        foreach(var bad in new[]{input with{RequestId=Guid.Empty.ToString()},input with{CartVersion="bad"},input with{Expected=[]},input with{Expected=[input.Expected[0],input.Expected[0]]},input with{Expected=[new(id,new string('a',64))]},input with{Note=new string('x',501)},input with{Note="private\0note"}})Assert.Throws<BusinessException>(()=>SourcingRules.Normalize(bad));
    }
    [Fact] public void ReferenceRialIsPositiveExactNullableInt64AndNeverANumberFallback()
    {
        Assert.Null(SourcingRules.ReferencePrice(null));Assert.Equal(9007199254740993L,SourcingRules.ReferencePrice("9007199254740993"));Assert.Equal(long.MaxValue,SourcingRules.ReferencePrice(long.MaxValue.ToString()));
        foreach(var invalid in new[]{"0","-1","1.0","۹۰۰","1,000","9223372036854775808",""})Assert.Throws<BusinessException>(()=>SourcingRules.ReferencePrice(invalid));
    }
    [Fact] public void SnapshotPreservesZeroFalseBothUnitLabelsAndAllTypedOptionKinds()
    {
        var number=new SourcingAttributeSnapshot("capacity","capacity","Number","ظرفیت","Capacity","GB","گیگابایت","Gigabytes",null,null,0,null,[]);
        var boolean=new SourcingAttributeSnapshot("sealed","sealed","Bool","پلمب","Sealed",null,null,null,null,null,null,false,[]);
        var text=new SourcingAttributeSnapshot("text","text","Text","متن","Text",null,null,null,"نمونه","Sample",null,null,[]);
        var select=new SourcingAttributeSnapshot("color","color","Select","رنگ","Color",null,null,null,null,null,null,null,[new("black","مشکی","Black")]);var multi=select with{AttributeId="ports",Key="ports",DataType="MultiSelect",Options=[new("usb","یو‌اس‌بی","USB"),new("typec","تایپ سی","Type C")]};
        var model=Model(number,boolean,text,select,multi);SourcingSnapshots.Validate(model);var serialized=JsonSerializer.Serialize(model);Assert.Contains("\"Number\":\"0\"",serialized);Assert.Contains("\"Bool\":false",serialized);var restored=JsonSerializer.Deserialize<SourcingModelSnapshot>(serialized)!;Assert.Equal(0,restored.Attributes[0].Number);Assert.False(restored.Attributes[1].Bool);Assert.Equal("گیگابایت",restored.Attributes[0].UnitFa);Assert.Equal("Gigabytes",restored.Attributes[0].UnitEn);
    }
    [Fact] public void SnapshotRejectsInvalidMixedTypesOversizedValuesAndUnboundedOptionSets()
    {
        var number=new SourcingAttributeSnapshot("number","number","Number","عدد","Number",null,null,null,null,null,1,null,[]);
        foreach(var invalid in new[]{number with{Number=null},number with{Number=decimal.MinValue},number with{Number=0.000000001m},number with{Bool=false},number with{TextFa="fake"},number with{DataType="Unknown"},number with{Options=[new("x","یک","One")]}})Assert.Throws<BusinessException>(()=>SourcingSnapshots.Validate(Model(invalid)));
        Assert.Throws<BusinessException>(()=>SourcingSnapshots.Validate(Model() with{DescriptionFa=new string('x',8001)}));Assert.Throws<BusinessException>(()=>SourcingSnapshots.Validate(Model(number,number)));
    }
    [Fact] public void PrivateAndMoneyFreeSummaryAndExplicitNullableCursorHaveSeparateContracts()
    {
        var now=DateTimeOffset.UtcNow;var summary=new SourcingRequestSummary(Id(),"SR-9007199254740993","fa","Submitted",now,now,1,1,"AAAAAAAAAAE=",true);var json=JsonSerializer.Serialize(new SourcingRequestPage(1,20,[summary],null),new JsonSerializerOptions(JsonSerializerDefaults.Web){DefaultIgnoreCondition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull});
        Assert.Contains("\"nextCursor\":null",json);Assert.DoesNotContain("ownerId",json);Assert.DoesNotContain("payable",json);Assert.DoesNotContain("note",json);
    }
}
