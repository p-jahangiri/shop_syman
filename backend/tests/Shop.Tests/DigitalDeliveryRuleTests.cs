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
        var v=View(61,200);var keys=new HashSet<string>{"digital"};
        Assert.Throws<BusinessException>(()=>FulfillmentCapacityRules.Plan(v,Select(v,new PartialDispatchSelection("digital",1,[])),keys,true));
        FulfillmentCapacityRules.Plan(v,Select(v,new PartialDispatchSelection("digital",100,[])),keys,true);
        Assert.Throws<BusinessException>(()=>FulfillmentCapacityRules.Plan(v,Select(v,new PartialDispatchSelection("digital",101,[])),keys,true));
    }
}
