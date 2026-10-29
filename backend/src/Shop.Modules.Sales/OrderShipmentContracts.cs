using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Shop.SharedKernel;

namespace Shop.Modules.Sales;
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ShipmentCommandInput(string OwnerId, string CommandId, string Action, string OrderVersion, string? ShipmentVersion, string InventoryFingerprint, string Reason, bool Acknowledge, string? CarrierNameFa, string? CarrierNameEn, string? TrackingNumber, DateTimeOffset? OccurredAt);
public sealed record ShipmentLineData(string LineKey, string VariantId, string ProductId, string Sku, string Name, string Label, string Warranty, int Quantity, string TrackingMode);
public sealed record ShipmentUnitData(string UnitId, string LineKey, string VariantId,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] string? Serial,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] string? Imei1,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] string? Imei2,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] DateTimeOffset? WarrantyUntil);
public sealed record ShipmentData(string Id, string OrderId, string State, string Version, int PackingRevision, DateTimeOffset PackedAt,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] DateTimeOffset? DispatchedAt,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] DateTimeOffset? DeliveredAt,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] string? CarrierNameFa,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] string? CarrierNameEn,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] string? TrackingNumber,
    bool ContainsDemo, bool UnitDetailsVisible, ShipmentLineData[] Lines, ShipmentUnitData[] Units);
public sealed record ShipmentCommandResult(int SchemaVersion, string CommandId, string PayloadHash, string OrderId, string Action, string InventoryFingerprint, string Reason, DateTimeOffset RecordedAt, string OrderVersion, ShipmentData Shipment, bool Replayed);
public sealed record AdminShipmentData(int SchemaVersion, string OrderId, string OwnerId, string OrderState, string OrderVersion, bool ContainsDemo,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] ShipmentData? Shipment,
    ShipmentLineData[] PackingLines, ShipmentUnitData[] PackingUnits, bool CanPack, bool CanRepack, bool CanDispatch, bool CanDeliver, string[] Blockers, string InventoryFingerprint, bool LiveCarrierConfigured);
public sealed record CustomerShipmentData(int SchemaVersion, string OrderId,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] ShipmentData? Shipment, bool ManualCarrierReport);

public static class ShipmentRules
{
    public static ShipmentCommandInput Normalize(ShipmentCommandInput x)
    {
        if (x is null || x.Action is not ("pack" or "repack" or "dispatch" or "deliver") || !x.Acknowledge) throw Invalid();
        var owner = OrderInputRules.Identifier(x.OwnerId); var command = Uuid(x.CommandId); var orderVersion = Version(x.OrderVersion); var shipmentVersion = x.ShipmentVersion is null ? null : Version(x.ShipmentVersion); var fingerprint = Fingerprint(x.InventoryFingerprint); var reason = Text(x.Reason, 400, false)!;
        var fa = Text(x.CarrierNameFa, 120, true); var en = Text(x.CarrierNameEn, 120, true); var tracking = Text(x.TrackingNumber, 120, true); var at = x.OccurredAt?.ToUniversalTime();
        if (x.Action is "pack" or "repack") {
            if ((x.Action == "pack" ? shipmentVersion is not null : shipmentVersion is null) || fa is not null || en is not null || tracking is not null || at is not null) throw Invalid();
        } else if (shipmentVersion is null || at is null || (x.Action == "dispatch" ? fa is null || en is null : fa is not null || en is not null || tracking is not null)) throw Invalid();
        return new(owner, command, x.Action, orderVersion, shipmentVersion, fingerprint, reason, true, fa, en, tracking, at);
    }
    public static string Fingerprint(string x) => x is { Length:64 } && x.All(c => c is >= '0' and <= '9' or >= 'A' and <= 'F') ? x : throw Invalid();
    public static string Uuid(string x) => x is { Length:32 } && Guid.TryParseExact(x, "N", out var id) && id != Guid.Empty && id.ToString("N") == x ? x : throw Invalid();
    public static string Version(string x) { try { if (x is not { Length:12 } || Convert.FromBase64String(x).Length != 8 || Convert.ToBase64String(Convert.FromBase64String(x)) != x) throw Invalid(); return x; } catch (FormatException) { throw Invalid(); } }
    public static string Hash(object value) => Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(value)));
    private static string? Text(string? x, int max, bool optional) { if (x is null) return optional ? null : throw Invalid(); var value = x.Trim(); if (value.Length == 0 && optional) return null; if (value.Length is 0 || value.Length > max || value.Any(char.IsControl)) throw Invalid(); return value; }
    private static BusinessException Invalid() => new("invalid_shipment", "Provide the exact action, versions, confirmation, bounded reason and its required hand-off or delivery facts.");
}
