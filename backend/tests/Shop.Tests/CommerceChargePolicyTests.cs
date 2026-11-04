using System.Text.Json;
using System.Text.Json.Serialization;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;
public sealed class CommerceChargePolicyTests
{
    private static CheckoutChargePolicy Policy()=>new(){ShippingMode="postpaid",ShippingNameFa="پس‌کرایه",ShippingNameEn="Pay carrier separately",ShippingDescriptionFa="کرایه را جداگانه به حمل‌کننده بپردازید",ShippingDescriptionEn="Carrier charge is paid separately; it is not free",TaxMode="included_unitemized",TaxBase="goods_shipping"};
    [Theory][InlineData("fa",true,"postpaid")][InlineData("en",true,"postpaid")][InlineData("fa",false,"digital")]
    public void ExternalCarrierFeeIsNotCollectedOnlineAndDigitalDeliveryDoesNotBecomePostpaid(string locale,bool physical,string reason)
    {
        var charges=CheckoutChargeCalculator.Calculate(9007199254740993,9007199254740993,physical,Policy(),locale);
        Assert.Equal(0,charges.ShippingRial);Assert.Equal(reason,charges.Rules.ShippingReason);Assert.Equal("postpaid",charges.Rules.ShippingMode);
        Assert.Null(charges.TaxRial);Assert.True(charges.Rules.TaxIncluded);Assert.Null(charges.Rules.TaxRateBasisPoints);
        Assert.Equal(9007199254740993,charges.PayableTotalRial);Assert.Equal("9007199254740993",charges.Rules.TaxableBaseRial);
        Assert.Equal(locale=="fa"?"پس‌کرایه":"Pay carrier separately",charges.Rules.ShippingName);
    }
    [Fact]public void UnitemizedTaxDoesNotTurnUnknownShippingIntoZeroOrInventAnExtractedTax()
    {
        var policy=Policy();policy.ShippingMode="unconfigured";
        var missing=CheckoutChargeCalculator.Calculate(100,100,true,policy,"en");Assert.Null(missing.PayableTotalRial);Assert.Null(missing.ShippingRial);Assert.Null(missing.TaxRial);Assert.True(missing.Rules.TaxIncluded);
        policy.ShippingMode="postpaid";var maximum=CheckoutChargeCalculator.Calculate(long.MaxValue,long.MaxValue,true,policy,"en");Assert.Equal(long.MaxValue,maximum.PayableTotalRial);Assert.Null(maximum.TaxRial);
    }
    [Theory][InlineData("1",null,null)][InlineData(null,"100",null)][InlineData(null,null,925)]
    public void DeferredCarrierAndUnitemizedTaxCannotHideAFeeThresholdOrInventedRate(string? fee,string? free,int? rate)
    {
        var input=new CheckoutChargePolicyInput("postpaid","پس‌کرایه","Pay carrier separately","","",fee,free,"included_unitemized",rate,"goods_shipping","half_up",null);
        Assert.Equal("invalid_charge_policy",Assert.Throws<BusinessException>(()=>CheckoutChargePolicyService.Validate(input)).Code);
    }
    private static string Snapshot(string mode="postpaid",string reason="postpaid",bool physical=true)=>JsonSerializer.Serialize(new { ShippingRequired=physical,ShippingRial="0",GoodsTotalRial="100",PayableTotalRial="100",TaxRial=(string?)null,ChargeRules=new{ShippingMode=mode,ShippingReason=reason,TaxMode="included_unitemized",TaxIncluded=true,TaxRateBasisPoints=(int?)null} });
    private static SalesOrder Unitemized()=>new(){GoodsTotalRial=100,ItemsSubtotalRial=100,PayableTotalRial=100,ShippingRial=0,TaxRial=null,TaxIncluded=true,TaxBreakdownKnown=false,ShippingRequired=true,QuoteSnapshotJson=Snapshot()};
    [Fact]public void OnlyImmutablePhysicalPostpaidFactsProduceAHistoricalDiscriminator()
    {
        Assert.Equal("postpaid",OrderShippingSnapshots.PostpaidMode(Snapshot(),true,0));
        Assert.Null(OrderShippingSnapshots.PostpaidMode(Snapshot("postpaid","digital",false),false,0));
        Assert.Null(OrderShippingSnapshots.PostpaidMode(Snapshot("free","free"),true,0));
        Assert.Null(OrderShippingSnapshots.PostpaidMode("{\"ShippingName\":\"postpaid\"}",true,0));
        Assert.Null(OrderShippingSnapshots.PostpaidMode("{}",true,0));
    }
    [Theory][InlineData("mismatch")][InlineData("charge")][InlineData("digital")][InlineData("duplicate")][InlineData("wrong-case")][InlineData("malformed")][InlineData("oversized")]
    public void CorruptPostpaidSnapshotsCannotBeRenderedAsFreeShipping(string kind)
    {
        var snapshot=kind switch {"mismatch"=>Snapshot("postpaid","free"),"digital"=>Snapshot("postpaid","digital",false),"duplicate"=>Snapshot().Replace("\"ShippingReason\":\"postpaid\"","\"ShippingReason\":\"free\",\"ShippingReason\":\"postpaid\""),"wrong-case"=>Snapshot().Replace("ChargeRules","chargeRules").Replace("ShippingMode","shippingMode").Replace("ShippingReason","shippingReason"),"malformed"=>"{","oversized"=>new string(' ',524289),_=>Snapshot()};
        Assert.Equal("order_shipping_unavailable",Assert.Throws<BusinessException>(()=>OrderShippingSnapshots.PostpaidMode(snapshot,true,kind=="charge"?1:0)).Code);
    }
    [Fact]public void IncludedUnknownTaxIsExplicitAndLegacyKnownTaxDoesNotGainANewFlag()
    {
        var unknown=Unitemized();Assert.False(OrderTaxSnapshots.BreakdownKnown(unknown));Assert.Null(unknown.TaxRial);
        var legacy=new SalesOrder{GoodsTotalRial=100,PayableTotalRial=100,QuoteSnapshotJson="{}"};Assert.True(legacy.TaxBreakdownKnown);Assert.Equal(0,legacy.TaxRial);Assert.Null(OrderTaxSnapshots.BreakdownKnown(legacy));
    }
    [Theory][InlineData("zero")][InlineData("known")][InlineData("exclusive")][InlineData("rate")][InlineData("mode")][InlineData("amount")][InlineData("missing")][InlineData("duplicate")]
    public void UnknownTaxCannotBecomeZeroExemptOrAnInventedKnownComponent(string kind)
    {
        var order=Unitemized();
        switch(kind){case"zero":order.TaxRial=0;break;case"known":order.TaxBreakdownKnown=true;order.TaxRial=0;break;case"exclusive":order.TaxIncluded=false;break;case"rate":order.QuoteSnapshotJson=order.QuoteSnapshotJson.Replace("\"TaxRateBasisPoints\":null","\"TaxRateBasisPoints\":925");break;case"mode":order.QuoteSnapshotJson=order.QuoteSnapshotJson.Replace("included_unitemized","exempt");break;case"amount":order.PayableTotalRial=101;break;case"missing":order.QuoteSnapshotJson="{}";break;case"duplicate":order.QuoteSnapshotJson=order.QuoteSnapshotJson.Replace("\"TaxMode\":\"included_unitemized\"","\"TaxMode\":\"exempt\",\"TaxMode\":\"included_unitemized\"");break;}
        Assert.Equal("order_tax_unavailable",Assert.Throws<BusinessException>(()=>OrderTaxSnapshots.BreakdownKnown(order)).Code);
    }
    private static OrderDetailData Detail(string? tax="0",string? shippingMode=null,bool? known=null)=>new(1,new("id","SM-1","fa","AwaitingPayment",DateTimeOffset.UnixEpoch,DateTimeOffset.UnixEpoch.AddHours(1),"100",1,"AAAAAAAAAAA="),"quote","Synthetic QA","09100000000",null,"",true,"Cash","Shipping","100","100","0",tax,"100",true,[],[],true,false,"gateway_unconfigured",shippingMode,known);
    [Fact]public void NewTaxNullAndFalseFlagAreExplicitWhileOldOmittedFieldsRemainAbsent()
    {
        var options=new JsonSerializerOptions(JsonSerializerDefaults.Web){DefaultIgnoreCondition=JsonIgnoreCondition.WhenWritingNull};
        using var legacy=JsonDocument.Parse(JsonSerializer.Serialize(Detail(),options));Assert.False(legacy.RootElement.TryGetProperty("shippingMode",out _));Assert.False(legacy.RootElement.TryGetProperty("taxBreakdownKnown",out _));Assert.Equal("0",legacy.RootElement.GetProperty("taxRial").GetString());
        using var current=JsonDocument.Parse(JsonSerializer.Serialize(Detail(null,"postpaid",false),options));Assert.Equal(JsonValueKind.Null,current.RootElement.GetProperty("taxRial").ValueKind);Assert.False(current.RootElement.GetProperty("taxBreakdownKnown").GetBoolean());Assert.Equal("postpaid",current.RootElement.GetProperty("shippingMode").GetString());
    }
}
