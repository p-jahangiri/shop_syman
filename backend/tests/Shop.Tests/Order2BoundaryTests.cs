using System.Text.Json;
using Shop.Modules.Market;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class Order2BoundaryTests
{
    private static string Id()=>Guid.NewGuid().ToString("N");
    private static SourcingAgreementOrderedEvent Event(){var acceptance=Id();return new(1,Id(),Id(),"generated-owner",acceptance,Id(),Id(),Id(),acceptance,Id(),true,new DateTimeOffset(2020,1,1,0,0,0,TimeSpan.Zero));}
    [Fact]public void HistoricalProjectionRetainsOriginalDateAndContainsNoMoneyOrCurrentEligibility(){var e=Event();Assert.Same(e,SourcingOrderProjection.Validate(e));Assert.Equal(2020,e.At.Year);var json=JsonSerializer.Serialize(e,new JsonSerializerOptions(JsonSerializerDefaults.Web));Assert.DoesNotContain("price",json,StringComparison.OrdinalIgnoreCase);Assert.DoesNotContain("canPay",json);Assert.DoesNotContain("state",json);}
    [Theory][InlineData(0)][InlineData(1)][InlineData(2)][InlineData(3)][InlineData(4)][InlineData(5)][InlineData(6)][InlineData(7)]
    public void ProjectionRejectsEveryUnboundIdentity(int field){var e=Event();e=field switch{0=>e with{EventId=new string('0',32)},1=>e with{OrderId="A"+new string('1',31)},2=>e with{AgreementId=Id()},3=>e with{RequestId="../private"},4=>e with{TaskId=""},5=>e with{OfferId=null!},6=>e with{AcceptanceId=Id()},_=>e with{AllocationId="not-an-allocation"}};Assert.Throws<BusinessException>(()=>SourcingOrderProjection.Validate(e));}
    [Fact]public void ProjectionRejectsUnknownContractTimezoneAndInvalidOwner(){var e=Event();Assert.Throws<BusinessException>(()=>SourcingOrderProjection.Validate(e with{SchemaVersion=2}));Assert.Throws<BusinessException>(()=>SourcingOrderProjection.Validate(e with{At=e.At.ToOffset(TimeSpan.FromHours(1))}));Assert.Throws<BusinessException>(()=>SourcingOrderProjection.Validate(e with{OwnerId="owner@example.invalid"}));}
    [Theory][InlineData("unitPriceRial")][InlineData("quantity")][InlineData("ownerId")][InlineData("allocationId")]
    public void BrowserCannotSupplyOrderAuthority(string property){var body=$"{{\"quoteId\":\"{Id()}\",\"requestId\":\"{Id()}\",\"contactName\":\"Synthetic QA\",\"contactPhone\":\"09100000000\",\"delivery\":null,\"note\":null,\"acknowledgeTemporary\":true,\"{property}\":\"1\"}}";Assert.Throws<JsonException>(()=>JsonSerializer.Deserialize<CreateOrderV2Input>(body,new JsonSerializerOptions(JsonSerializerDefaults.Web)));}
    [Fact]public void NestedDeliveryAndQuoteAlsoRejectUnknownAuthority(){var quote="{\"cartVersion\":null,\"methodId\":null,\"planId\":null,\"requestId\":null,\"acceptedPrice\":\"1\"}";Assert.Throws<JsonException>(()=>JsonSerializer.Deserialize<CheckoutQuoteV5Input>(quote,new JsonSerializerOptions(JsonSerializerDefaults.Web)));Assert.Throws<JsonException>(()=>JsonSerializer.Deserialize<OrderAddressV2Input>("{\"countryCode\":\"IR\",\"province\":\"QA\",\"city\":\"QA\",\"address\":\"Synthetic only\",\"postalCode\":\"1234567890\",\"shippingRial\":\"0\"}",new JsonSerializerOptions(JsonSerializerDefaults.Web)));}
}
