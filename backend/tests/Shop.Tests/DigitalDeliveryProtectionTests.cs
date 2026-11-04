using System.Text;
using Microsoft.AspNetCore.DataProtection;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class DigitalDeliveryProtectionTests
{
    private const string Owner = "SYNTHETIC_OWNER", Order = "11111111111111111111111111111111", Item = "22222222222222222222222222222222";
    private sealed record Envelope(int SchemaVersion, string OwnerId, string OrderId, string DeliveryId, string ItemId, string LineKey, int Position, string Content);

    [Theory]
    [InlineData("<", 4096)] [InlineData("\"", 4096)] [InlineData("\\", 4096)]
    [InlineData("ف", 2048)] [InlineData("😀", 1024)] [InlineData("\u2028", 1365)]
    [InlineData("\t", 4095)] [InlineData("\n", 4095)]
    public void EveryMaximumSizedValidTextFitsTheActualEncryptedSqlColumn(string token, int repeat)
    {
        var content = string.Concat(Enumerable.Repeat(token, repeat));
        if (string.IsNullOrWhiteSpace(content)) content += "x";
        var input = DigitalDeliveryRules.Normalize(new(Owner, Item, "AAAAAAAAAAE=", new('A', 64), "synthetic boundary", true, [new("digital", [content])]));
        var json = DigitalDeliveryRules.SerializeEncryptedEnvelope(new Envelope(1, Owner, Order, Item, Item, "digital", 1, input.Lines[0].Contents[0]));
        var protector = new DataProtectionDigitalDeliveryProtection(new EphemeralDataProtectionProvider());
        var encrypted = protector.Protect("content", Owner, Order, Item, json);
        Assert.InRange(encrypted.Length, 1, 16384);
        Assert.Equal(json, protector.Unprotect("content", Owner, Order, Item, encrypted));
        Assert.False(encrypted.AsSpan().IndexOf(Encoding.UTF8.GetBytes(content)) >= 0);
    }

    [Fact]
    public void ContentCiphertextIsBoundToPurposeOwnerOrderAndUnitAndRejectsTampering()
    {
        var protector = new DataProtectionDigitalDeliveryProtection(new EphemeralDataProtectionProvider());
        var encrypted = protector.Protect("content", Owner, Order, Item, "SYNTHETIC PRIVATE TEXT");
        foreach (var (purpose, owner, order, item) in new[] {
            ("manifest", Owner, Order, Item), ("content", "ANOTHER_OWNER", Order, Item),
            ("content", Owner, Item, Item), ("content", Owner, Order, Order) })
            Assert.Equal("digital_delivery_unavailable", Assert.Throws<BusinessException>(() => protector.Unprotect(purpose, owner, order, item, encrypted)).Code);
        encrypted[^1] ^= 1;
        Assert.Equal("digital_delivery_unavailable", Assert.Throws<BusinessException>(() => protector.Unprotect("content", Owner, Order, Item, encrypted)).Code);
    }
}
