using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using Xunit;
using Shop.Modules.Sales;

namespace Shop.SqlTests;
public sealed partial class OrderShipmentSqlTests
{
    [Fact] public async Task ActualTrackedShipmentResponsesBindEveryStageToTheSubmittedPreviewAndHistoricalReceipt()
    {
        var s = await Create(mode: "imei"); using var customer = s.Customer; var json = new JsonSerializerOptions(JsonSerializerDefaults.Web); var files = new List<object>();
        var directory = Environment.GetEnvironmentVariable("SHOP_SHIPMENT_WIRE_DIR");
        if (directory is not null) { Assert.Equal("order-shipment-sql-wire", Path.GetFileName(directory)); Assert.False(Directory.Exists(directory)); Directory.CreateDirectory(directory); }
        async Task<byte[]> Save(string file, byte[] raw) { if (directory is not null) { await File.WriteAllBytesAsync(Path.Combine(directory, file), raw); files.Add(new { File = file, Sha256 = Convert.ToHexString(SHA256.HashData(raw)).ToLowerInvariant() }); } return raw; }
        async Task<T> ReadWire<T>(string file, HttpClient client, string path) {
            using var response = await client.GetAsync(path); Assert.Equal(System.Net.HttpStatusCode.OK, response.StatusCode); Assert.Contains("no-store", response.Headers.CacheControl!.ToString()); var raw = await Save(file, await response.Content.ReadAsByteArrayAsync()); return JsonSerializer.Deserialize<T>(raw, json)!;
        }
        async Task<ShipmentCommandResult> Send(string name, ShipmentCommandInput input) {
            var bytes = await Save(name + "-input.json", JsonSerializer.SerializeToUtf8Bytes(input, json)); using var content = new ByteArrayContent(bytes); content.Headers.ContentType = new MediaTypeHeaderValue("application/json"); using var response = await fixture.Admin.PostAsync(Route(s.OrderId), content); Assert.Equal(System.Net.HttpStatusCode.OK, response.StatusCode); Assert.Contains("no-store", response.Headers.CacheControl!.ToString()); return JsonSerializer.Deserialize<ShipmentCommandResult>(await Save(name + ".json", await response.Content.ReadAsByteArrayAsync()), json)!;
        }
        var read = $"/api/admin/orders/{s.Owner}/{s.OrderId}/shipment"; var own = "/api/orders/v2/" + s.OrderId + "/shipment";
        var before = await ReadWire<AdminShipmentData>("pack-before.json", fixture.Admin, read); Assert.True(before.CanPack); Assert.Single(before.PackingUnits);
        var pack = Input(before, "pack"); var packed = await Send("pack", pack); Assert.Equal(before.InventoryFingerprint, packed.InventoryFingerprint);
        var hidden = await ReadWire<CustomerShipmentData>("customer-packed.json", customer, own); Assert.False(hidden.Shipment!.UnitDetailsVisible); Assert.Empty(hidden.Shipment.Units);
        var dispatchBefore = await ReadWire<AdminShipmentData>("dispatch-before.json", fixture.Admin, read); var dispatch = await Send("dispatch", Input(dispatchBefore, "dispatch")); Assert.Equal("dispatched", dispatch.Shipment.State);
        var visible = await ReadWire<CustomerShipmentData>("customer-dispatched.json", customer, own); Assert.Equal(s.Unit!.Imei1, Assert.Single(visible.Shipment!.Units).Imei1);
        var deliverBefore = await ReadWire<AdminShipmentData>("deliver-before.json", fixture.Admin, read); var delivered = await Send("deliver", Input(deliverBefore, "deliver")); Assert.Equal("delivered", delivered.Shipment.State);
        var historical = await ReadWire<ShipmentCommandResult>("pack-receipt.json", fixture.Admin, Route(s.OrderId) + "/" + pack.CommandId); Assert.True(historical.Replayed); Assert.Equal("packed", historical.Shipment.State);
        await ReadWire<CustomerShipmentData>("customer-delivered.json", customer, own);
        if (directory is not null) await File.WriteAllTextAsync(Path.Combine(directory, "manifest.json"), JsonSerializer.Serialize(new { ActualSqlHttpBodies = true, SyntheticTestOnly = true, Entries = files }, new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented = true }));
    }
}
