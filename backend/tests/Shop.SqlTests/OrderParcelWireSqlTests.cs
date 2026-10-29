using System.Net;
using System.Net.Http.Json;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.Json;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;
namespace Shop.SqlTests;
public sealed partial class OrderShipmentSqlTests
{
    [Fact]public async Task ActualParcelHttpBodiesBindPackingRevisionsVoidsHandoffsDeliveryAndHistoricalReceipts()
    {
        var s=await Create(mode:"imei",quantity:2);using var customer=s.Customer;var opts=new JsonSerializerOptions(JsonSerializerDefaults.Web);var dir=Environment.GetEnvironmentVariable("SHOP_PARCEL_WIRE_DIR");var entries=new List<object>();var bindings=new List<object>();
        if(dir is not null){Assert.Equal("order-parcel-sql-wire",Path.GetFileName(dir));Assert.False(Directory.Exists(dir));Directory.CreateDirectory(dir);}
        async Task Save(string name,string kind,byte[] raw){if(dir is not null){await File.WriteAllBytesAsync(Path.Combine(dir,name+".json"),raw);entries.Add(new{File=name+".json",Kind=kind,Sha256=Convert.ToHexString(SHA256.HashData(raw)).ToLowerInvariant()});}}
        async Task<T> ReadWire<T>(string name,string kind,HttpClient client,string path){using var response=await client.GetAsync(path);Assert.Equal(HttpStatusCode.OK,response.StatusCode);Assert.Contains("no-store",response.Headers.CacheControl!.ToString());Assert.Equal("parcels-v1",response.Headers.GetValues("X-Sayman-Fulfillment-Contract").Single());var raw=await response.Content.ReadAsByteArrayAsync();await Save(name,kind,raw);return JsonSerializer.Deserialize<T>(raw,opts)!;}
        async Task<ParcelCommandResult> Stage(string name,string action,string? parcel=null,string? unit=null){var before=await ReadWire<ParcelPage>(name+"-before","page",ParcelStaff,ParcelBase(s));ParcelDetail? previous=null;if(parcel is not null)previous=await ReadWire<ParcelDetail>(name+"-previous","detail",ParcelStaff,ParcelBase(s)+"/parcels/"+parcel);var input=ParcelInput(before,action,previous?.Parcel,action is"pack"or"repack"?[new(before.Lines[0].LineKey,1,[unit!])]:[]);var raw=JsonSerializer.SerializeToUtf8Bytes(input,opts);await Save(name+"-input","input",raw);using var content=new ByteArrayContent(raw);content.Headers.ContentType=new MediaTypeHeaderValue("application/json");using var response=await ParcelStaff.PostAsync(ParcelBase(s)+"/commands/"+input.CommandId,content);Assert.Equal(HttpStatusCode.OK,response.StatusCode);Assert.Contains("no-store",response.Headers.CacheControl!.ToString());var bytes=await response.Content.ReadAsByteArrayAsync();await Save(name,"result",bytes);bindings.Add(new{Name=name,Before=name+"-before",Input=name+"-input",Previous=previous is null?null:name+"-previous",Result=name});return JsonSerializer.Deserialize<ParcelCommandResult>(bytes,opts)!;}
        var initial=await ReadWire<ParcelPage>("initial","page",ParcelStaff,ParcelBase(s));var firstUnit=initial.AvailableUnits[0].Id;var secondUnit=initial.AvailableUnits[1].Id;
        var a=await Stage("pack-a","pack",unit:firstUnit);await Stage("repack-a","repack",a.Detail.Parcel.Id,firstUnit);var b=await Stage("pack-b","pack",unit:secondUnit);await Stage("void-b","void",b.Detail.Parcel.Id);
        var own="/api/orders/v2/"+s.OrderId+"/fulfillment";await ReadWire<CustomerFulfillmentData>("customer-packed","customer",customer,own);var hidden=await ReadWire<ParcelDetail>("customer-hidden","detail",customer,own+"/parcels/"+a.Detail.Parcel.Id);Assert.False(hidden.UnitDetailsVisible);Assert.Empty(hidden.Units);
        await Stage("dispatch-a","dispatch",a.Detail.Parcel.Id);var visible=await ReadWire<ParcelDetail>("customer-visible","detail",customer,own+"/parcels/"+a.Detail.Parcel.Id);Assert.Equal(firstUnit,Assert.Single(visible.Units).UnitId);await Stage("deliver-a","deliver",a.Detail.Parcel.Id);
        var c=await Stage("pack-c","pack",unit:secondUnit);await Stage("dispatch-c","dispatch",c.Detail.Parcel.Id);await Stage("deliver-c","deliver",c.Detail.Parcel.Id);
        var historical=await ReadWire<ParcelCommandResult>("pack-receipt","result",ParcelStaff,ParcelBase(s)+"/commands/"+a.CommandId);Assert.True(historical.Replayed);Assert.Equal("packed",historical.Detail.Parcel.State);await ReadWire<CustomerFulfillmentData>("customer-final","customer",customer,own);
        if(dir is not null)await File.WriteAllTextAsync(Path.Combine(dir,"manifest.json"),JsonSerializer.Serialize(new{ActualSqlHttpBodies=true,SyntheticTestOnly=true,Entries=entries,Bindings=bindings},new JsonSerializerOptions(JsonSerializerDefaults.Web){WriteIndented=true}));
    }
}
