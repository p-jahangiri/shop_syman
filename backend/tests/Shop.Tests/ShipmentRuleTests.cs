using System.Text.Json;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;
namespace Shop.Tests;
public sealed class ShipmentRuleTests
{
    private static ShipmentCommandInput Pack() => new("owner", Guid.NewGuid().ToString("N"), "pack", "AAAAAAAAAAE=", null, new string('A',64), " reason ", true, null, null, null, null);
    [Fact] public void DispatchRequiresPhysicalConfirmationAndItsOwnFactsAndPreservesUtcPrecision()
    {
        var at = new DateTimeOffset(2026, 10, 26, 12, 0, 0, TimeSpan.FromHours(3.5)).AddTicks(1234567);
        var value = ShipmentRules.Normalize(Pack() with { Action = "dispatch", ShipmentVersion = "AAAAAAAAAAI=", CarrierNameFa = " حمل نمونه ", CarrierNameEn = " Sample carrier ", TrackingNumber = " QA-001 ", OccurredAt = at });
        Assert.Equal("reason", value.Reason); Assert.Equal("QA-001", value.TrackingNumber); Assert.Equal(TimeSpan.Zero, value.OccurredAt!.Value.Offset); Assert.Equal(at.UtcTicks, value.OccurredAt.Value.Ticks);
        Assert.Throws<BusinessException>(() => ShipmentRules.Normalize(value with { Acknowledge = false })); Assert.Throws<BusinessException>(() => ShipmentRules.Normalize(value with { CarrierNameEn = null }));
    }
    [Theory][InlineData("paid")][InlineData("cancel")][InlineData("refund")][InlineData("")]
    public void ShipmentCannotBeUsedToRecordPaymentOrAnotherLifecycleOperation(string action) => Assert.Throws<BusinessException>(() => ShipmentRules.Normalize(Pack() with { Action = action }));
    [Fact] public void PackAndDeliveryRejectUnrelatedCarrierFactsAndStrictJsonRejectsFinancialFields()
    {
        Assert.Throws<BusinessException>(() => ShipmentRules.Normalize(Pack() with { TrackingNumber = "unexpected" })); Assert.Throws<BusinessException>(() => ShipmentRules.Normalize(Pack() with { Action = "deliver", ShipmentVersion = "AAAAAAAAAAI=", OccurredAt = DateTimeOffset.UtcNow, CarrierNameEn = "unexpected" }));
        var json = JsonSerializer.Serialize(Pack(), new JsonSerializerOptions(JsonSerializerDefaults.Web)); json = json[..^1] + ",\"amountRial\":\"1\"}";
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<ShipmentCommandInput>(json, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
    }
}
