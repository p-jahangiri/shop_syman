using Shop.SharedKernel;
using Xunit;
namespace Shop.Tests;
public sealed class NewOrderFulfillmentCapacityTests
{
    [Theory][InlineData("serial")][InlineData("imei")]
    public void ExactlyOneHundredTrackedUnitsFitButOneHundredAndOneDoNot(string mode)
    {
        PartialFulfillmentRules.RequireNewOrderCapacity([(mode,100)]);
        Assert.Equal("fulfillment_order_capacity_conflict",Assert.Throws<BusinessException>(()=>PartialFulfillmentRules.RequireNewOrderCapacity([(mode,101)])).Code);
    }
    [Fact]public void SumIncludesAllLinesAndBothTrackingModesButNotUntrackedPhysicalOrDigitalStock()
    {
        PartialFulfillmentRules.RequireNewOrderCapacity([("serial",60),("imei",40),("none",1000000)]);
        Assert.Equal("fulfillment_order_capacity_conflict",Assert.Throws<BusinessException>(()=>PartialFulfillmentRules.RequireNewOrderCapacity([("serial",60),("imei",41),("none",1)])).Code);
        PartialFulfillmentRules.RequireNewOrderCapacity(Enumerable.Repeat(("none",1000000),64));
    }
    [Theory][InlineData("unknown",1)][InlineData("serial",0)][InlineData("none",1000001)]
    public void InvalidStockFactsCannotSilentlyBypassTheAggregateBound(string mode,int quantity)
        =>Assert.Equal("invalid_reservation",Assert.Throws<BusinessException>(()=>PartialFulfillmentRules.RequireNewOrderCapacity([(mode,quantity)])).Code);
}
