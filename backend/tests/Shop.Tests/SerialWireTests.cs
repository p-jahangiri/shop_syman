using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Inventory;
using Xunit;

namespace Shop.Tests;

public sealed class SerialWireTests(ApiFactory factory):IClassFixture<ApiFactory>
{
    public const string Unit="11111111111141118111111111111111";
    private static readonly DateTimeOffset At=new(2026,10,23,12,0,0,TimeSpan.Zero);
    private static readonly SerialStock Stock=new("wire-variant","imei",1,0,"AAAAAAAAAAE=");
    private static readonly SerialUnitData Row=new(Unit,"wire-variant",null,"490154203237518",null,"available",null,null,null,At,At,"AAAAAAAAAAI=");
    [Fact] public async Task NativeReadHttpAndConfiguredCommandSerializerPreserveNullsVersionsAndLargeHistoryIds()
    {
        var fake=new Fake();using var host=factory.WithWebHostBuilder(b=>b.ConfigureTestServices(s=>{s.AddSingleton<IAdminSerialReader>(fake);s.AddSingleton<IAdminStockCatalog>(fake);}));using var client=host.CreateClient();client.DefaultRequestHeaders.Add("X-Test-Kind","access");client.DefaultRequestHeaders.Add("X-Test-Permissions","inventory.read");
        foreach(var (route,name) in new[]{("/serials","serial-page"),("/serials/"+Unit+"/history","serial-history")}){using var response=await client.GetAsync("/api/admin/inventory/variants/wire-variant"+route);Assert.Equal(HttpStatusCode.OK,response.StatusCode);Assert.Contains("no-store",response.Headers.CacheControl!.ToString());var json=await response.Content.ReadAsStringAsync();Assert.DoesNotContain("priceRial",json);if(name=="serial-page"){Assert.Contains("\"nextCursor\":null",json);Assert.Contains("\"warrantyUntil\":null",json);}else Assert.Contains("9007199254740993",json);await ContractWireCapture.SaveAsync(name,json);}
        var options=host.Services.GetRequiredService<IOptions<Microsoft.AspNetCore.Http.Json.JsonOptions>>().Value.SerializerOptions;await ContractWireCapture.SaveAsync("serial-command",JsonSerializer.Serialize(new SerialCommandResult(1,Stock,[Row]),options));Assert.Equal(2,fake.Calls);
    }
    private sealed class Fake:IAdminSerialReader,IAdminStockCatalog
    {
        public int Calls;
        public Task<SerialUnitPage> PageAsync(SerialPageQuery query,string? cursor,CancellationToken ct){Calls++;Assert.Equal("wire-variant",query.VariantId);return Task.FromResult(new SerialUnitPage(1,50,Stock,[Row],null));}
        public Task<SerialHistoryPage> HistoryAsync(string variantId,string unitId,string? before,CancellationToken ct){Calls++;Assert.Equal(Unit,unitId);return Task.FromResult(new SerialHistoryPage(1,50,[new("9007199254740993",Unit,"available","wirestaff","Synthetic receipt",null,At)],null));}
        public Task<StockVariantMetadata?> FindAsync(string id,CancellationToken ct)=>Task.FromResult<StockVariantMetadata?>(new(id,"product","SYNTHETIC-SKU","نمونه","Synthetic",true,"Draft"));
        public Task<StockVariantPage> PageAsync(AdminStockQuery query,string? cursor,CancellationToken ct)=>throw new NotSupportedException();
        public Task<AdminCatalogSummary> SummaryAsync(CancellationToken ct)=>throw new NotSupportedException();
    }
}
