using System.Text.Json;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;
namespace Shop.Tests;
public sealed class DigitalDeliveryRuleTests
{
    private static string Id()=>Guid.NewGuid().ToString("N");
    private static DigitalDeliveryInput Input()=>new("owner",Id(),"AAAAAAAAAAE=",new('A',64),"reviewed",true,[new("digital",["license"])]);
    private static PartialFulfillmentView View(int count=0,int digital=2,int physical=1)=>new(1,new('1',32),new('2',32),1,"AAAAAAAAAAE=",StockReservationState.Allocated,count,[new("digital","sku-d",digital,0,digital,"none"),new("physical","sku-p",physical,0,physical,"none")],[],new('A',64));
    private static PartialDispatchRequest Select(PartialFulfillmentView view,params PartialDispatchSelection[] lines)=>new("owner",view.ReservationId,Id(),"staff",Id(),view.Fingerprint,lines);
    [Fact]public void ContentPreservesMeaningfulSpacesAndUnitOrderWhileCanonicalizingCrLf()
    {
        var x=Input() with{Reason=" review ",Lines=[new("z",["  code  \r\nnext\tline", "second"]),new("a",["الف"])]};
        var n=DigitalDeliveryRules.Normalize(x);Assert.Equal("a",n.Lines[0].LineKey);Assert.Equal("  code  \nnext\tline",n.Lines[1].Contents[0]);Assert.Equal("second",n.Lines[1].Contents[1]);Assert.Equal("review",n.Reason);Assert.Equal(n,DigitalDeliveryRules.Normalize(n) with{Lines=n.Lines});
    }
    [Theory][InlineData("")][InlineData("  \n\t ")][InlineData("x\0y")][InlineData("x\ry")][InlineData("x\u001by")]
    public void InvalidContentIsRejected(string text)=>Assert.Throws<BusinessException>(()=>DigitalDeliveryRules.Normalize(Input() with{Lines=[new("digital",[text])]}));
    [Fact]public void UnpairedUtf16SurrogatesAreRejectedBeforeEncryption()
    {
        var invalid=new string((char)0xd800,1);Assert.Throws<BusinessException>(()=>DigitalDeliveryRules.Normalize(Input() with{Lines=[new("digital",[invalid])]}));
    }
    [Fact]public void LimitsCountUtf8BytesRatherThanOnlyCharacters()
    {
        DigitalDeliveryRules.Normalize(Input() with{Lines=[new("digital",[new('آ',2048)])]});
        Assert.Throws<BusinessException>(()=>DigitalDeliveryRules.Normalize(Input() with{Lines=[new("digital",[new('آ',2049)])]}));
        Assert.Throws<BusinessException>(()=>DigitalDeliveryRules.Normalize(Input() with{Lines=[new("digital",Enumerable.Repeat(new string('x',4096),17).ToArray())]}));
        DigitalDeliveryRules.Normalize(Input() with{Lines=[new("digital",Enumerable.Repeat("x",100).ToArray())]});
        Assert.Throws<BusinessException>(()=>DigitalDeliveryRules.Normalize(Input() with{Lines=[new("digital",Enumerable.Repeat("x",101).ToArray())]}));
    }
    [Fact]public void DuplicateLinesAndUnconfirmedOrInjectedCommandsAreRejected()
    {
        var x=Input();Assert.Throws<BusinessException>(()=>DigitalDeliveryRules.Normalize(x with{Acknowledge=false}));Assert.Throws<BusinessException>(()=>DigitalDeliveryRules.Normalize(x with{Lines=[new("DIGITAL",["a"]),new("digital",["b"])]}));
        var json=JsonSerializer.Serialize(x,new JsonSerializerOptions(JsonSerializerDefaults.Web));Assert.Throws<JsonException>(()=>JsonSerializer.Deserialize<DigitalDeliveryInput>(json[..^1]+",\"paid\":true}",new JsonSerializerOptions(JsonSerializerDefaults.Web)));
    }
    [Fact]public void MixedOrderCannotStrandTwoKindsInOneRemainingSlot()
    {
        var v=View(62);var keys=new HashSet<string>{"digital"};
        Assert.Equal("fulfillment_capacity_conflict",Assert.Throws<BusinessException>(()=>FulfillmentCapacityRules.Plan(v,Select(v,new PartialDispatchSelection("digital",1,[])),keys,true)).Code);
        FulfillmentCapacityRules.Plan(v,Select(v,new PartialDispatchSelection("digital",2,[])),keys,true);
        FulfillmentCapacityRules.Plan(v,Select(v,new PartialDispatchSelection("physical",1,[])),keys,false);
    }
    [Fact]public void DeliveryKindComesFromImmutableLineKeysAndRejectsPhysicalSelections()
    {
        var v=View();var keys=new HashSet<string>{"digital"};
        Assert.Equal("fulfillment_kind_conflict",Assert.Throws<BusinessException>(()=>FulfillmentCapacityRules.Plan(v,Select(v,new PartialDispatchSelection("physical",1,[])),keys,true)).Code);
        Assert.Equal("fulfillment_kind_conflict",Assert.Throws<BusinessException>(()=>FulfillmentCapacityRules.Plan(v,Select(v,new PartialDispatchSelection("digital",1,[])),keys,false)).Code);
        Assert.Throws<BusinessException>(()=>FulfillmentCapacityRules.Plan(v,Select(v,new PartialDispatchSelection("digital",1,[])),new HashSet<string>{"absent"},true));
    }
    [Fact]public void RemainingDigitalUnitsReserveEnoughFutureBoundedBatches()
    {
        var v=View(61,32);var keys=new HashSet<string>{"digital"};
        Assert.Throws<BusinessException>(()=>FulfillmentCapacityRules.Plan(v,Select(v,new PartialDispatchSelection("digital",1,[])),keys,true));
        FulfillmentCapacityRules.Plan(v,Select(v,new PartialDispatchSelection("digital",16,[])),keys,true);
        var large=View(61,200);
        Assert.Equal("fulfillment_capacity_conflict",Assert.Throws<BusinessException>(()=>FulfillmentCapacityRules.Plan(large,Select(large,new PartialDispatchSelection("digital",100,[])),keys,true)).Code);
        var tooMany=View(0,101,0);
        Assert.Throws<BusinessException>(()=>FulfillmentCapacityRules.Plan(tooMany,Select(tooMany,new PartialDispatchSelection("digital",101,[])),keys,true));
    }
    [Fact]public void PhysicalDispatchAlsoReservesFutureDigitalByteCapacity()
    {
        var v=View(61,33);var keys=new HashSet<string>{"digital"};
        Assert.Equal("fulfillment_capacity_conflict",Assert.Throws<BusinessException>(()=>FulfillmentCapacityRules.Plan(v,Select(v,new PartialDispatchSelection("physical",1,[])),keys,false)).Code);
        v=View(61,32);FulfillmentCapacityRules.Plan(v,Select(v,new PartialDispatchSelection("physical",1,[])),keys,false);
        Assert.Equal(16,DigitalDeliveryRules.GuaranteedUnitsPerFutureBatch);
    }
    [Fact]public void EncryptedEnvelopeSerializationPreservesMaximumLiteralTextWithoutHtmlExpansion()
    {
        foreach(var text in new[]{new string('<',4096),new string('"',4096),new string('\\',4096),new string('آ',2048),string.Concat(Enumerable.Repeat("😀",1024)),new string('\u2028',1365)+"x","x"+new string('\t',4095)}){
            var normalized=DigitalDeliveryRules.Normalize(Input()with{Lines=[new("digital",[text])]});
            var json=DigitalDeliveryRules.SerializeEncryptedEnvelope(new{schemaVersion=1,ownerId=new string('o',64),orderId=Id(),deliveryId=Id(),itemId=Id(),lineKey=new string('l',64),position=100,content=normalized.Lines[0].Contents[0]});
            Assert.True(System.Text.Encoding.UTF8.GetByteCount(json)<16384-1024);
            using var doc=JsonDocument.Parse(json);Assert.Equal(text,doc.RootElement.GetProperty("content").GetString());
        }
    }
    [Fact]public void NewOrdersReserveWorstCaseByteCapacityForEveryDigitalUnitAndAnyPhysicalHandoff()
    {
        DigitalDeliveryRules.RequireOrderCapacity([(true,1024)]);
        Assert.Equal("digital_delivery_order_capacity_conflict",Assert.Throws<BusinessException>(()=>DigitalDeliveryRules.RequireOrderCapacity([(true,1025)])).Code);
        DigitalDeliveryRules.RequireOrderCapacity([(true,1008),(false,1)]);
        Assert.Throws<BusinessException>(()=>DigitalDeliveryRules.RequireOrderCapacity([(true,1009),(false,1)]));
        DigitalDeliveryRules.RequireOrderCapacity([(true,504),(true,504),(false,1000000)]);
        Assert.Throws<BusinessException>(()=>DigitalDeliveryRules.RequireOrderCapacity([(true,505),(true,504),(false,1)]));
        DigitalDeliveryRules.RequireOrderCapacity([(false,1000000)]);
    }
    [Fact]public void NewDigitalOrderMetadataUsesTheActualStrictEscapedJsonBudgetWithoutTruncation()
    {
        DigitalDeliveryRules.RequireOrderCapacity([(true,16,"LICENSE","مجوز",new string('آ',600))]);
        Assert.Equal("digital_delivery_metadata_capacity_conflict",Assert.Throws<BusinessException>(()=>DigitalDeliveryRules.RequireOrderCapacity([(true,1,"LICENSE","مجوز",new string('آ',700))])).Code);
        Assert.Throws<BusinessException>(()=>DigitalDeliveryRules.RequireOrderCapacity([(true,1,"LICENSE",new string('<',700),"label")]));
        Assert.Throws<BusinessException>(()=>DigitalDeliveryRules.RequireOrderCapacity([(true,1,new string('"',2100),"License","label")]));
        DigitalDeliveryRules.RequireOrderCapacity([(false,1,"PHYSICAL","Physical",new string('آ',10000))]);
    }
}
