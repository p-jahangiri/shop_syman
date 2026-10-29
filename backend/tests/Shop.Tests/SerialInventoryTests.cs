using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Inventory;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class SerialInventoryTests(ApiFactory factory):IClassFixture<ApiFactory>
{
    [Theory][InlineData("490154203237518")][InlineData("۴۹۰۱۵۴۲۰۳۲۳۷۵۱۸")][InlineData("٤٩٠١٥٤٢٠٣٢٣٧٥١٨")]
    public void PrintedImeiCheckDigitsAcceptAsciiAndPersianArabicDigits(string value)=>Assert.Equal("490154203237518",SerialRules.Imei(value));
    [Theory][InlineData("49015420323751")][InlineData("4901542032375180")][InlineData("490154203237519")][InlineData("000000000000000")][InlineData("+490154203237518")][InlineData("490154 203237518")]
    public void MalformedImeiNeverBecomesAStoredIdentifier(string value)=>Assert.Equal("invalid_serial_input",Assert.Throws<BusinessException>(()=>SerialRules.Imei(value)).Code);
    [Fact] public void SerialCanonicalizationPreservesSeparatorsAndRejectsControlCharacters()
    {
        Assert.Equal("AB-123/45_6.7",SerialRules.Serial(" ab-۱۲۳/٤٥_6.7 "));Assert.Null(SerialRules.Serial("  "));Assert.Throws<BusinessException>(()=>SerialRules.Serial("a\nb"));Assert.Throws<BusinessException>(()=>SerialRules.Serial("serial with spaces"));
    }
    [Fact] public void TwoImeisAreAliasesOfOneUnitAndSerialUniquenessIsScopedToTheVariant()
    {
        var unit=SerialRules.Unit(new(" a1 ","490154203237518","356938035643809"));Assert.Equal(3,SerialRules.Keys("one",unit).Length);Assert.Equal(SerialRules.Keys("one",unit)[1],SerialRules.Keys("two",unit)[1]);Assert.NotEqual(SerialRules.Keys("one",unit)[0],SerialRules.Keys("two",unit)[0]);Assert.Single(SerialRules.Units("one",[unit]));Assert.Throws<BusinessException>(()=>SerialRules.Unit(new(null,null,"490154203237518")));Assert.Throws<BusinessException>(()=>SerialRules.Unit(new(null,"490154203237518","490154203237518")));
    }
    [Fact] public void BatchCanonicalOrderSupportsReplayAndRejectsCrossSlotDuplicates()
    {
        SerialUnitInput[] rows=[new(" b "),new("a")];Assert.Equal(SerialRules.Hash(SerialRules.Units("v",rows)),SerialRules.Hash(SerialRules.Units("V",rows.Reverse().ToArray())));Assert.Throws<BusinessException>(()=>SerialRules.Units("v",[new("abc"),new(" ABC ")]));Assert.Throws<BusinessException>(()=>SerialRules.Units("v",[new(null,"490154203237518","356938035643809"),new(null,"356938035643809")]));Assert.Throws<BusinessException>(()=>SerialRules.Units("v",[]));Assert.Throws<BusinessException>(()=>SerialRules.Units("v",Enumerable.Range(0,101).Select(i=>new SerialUnitInput("S"+i)).ToArray()));
    }
    [Fact] public void ModesAndVersionInputsCannotSilentlyDowngradeTracking()
    {
        Assert.Throws<BusinessException>(()=>SerialRules.Mode("optional"));Assert.Equal("serial_tracking_required",Assert.Throws<BusinessException>(()=>SerialRules.RequireMode("none",[new("s")])).Code);Assert.Throws<BusinessException>(()=>SerialRules.RequireMode("imei",[new("s")]));Assert.Throws<BusinessException>(()=>SerialRules.RequireMode("serial",[new(null,"490154203237518")]));Assert.Null(SerialRules.Version(null));Assert.Throws<BusinessException>(()=>SerialRules.Version(null,false));Assert.Equal("AAAAAAAAAAA=",SerialRules.Version("AAAAAAAAAAA="));Assert.Throws<BusinessException>(()=>SerialRules.Version("AAAAAAAAAA=="));Assert.Throws<BusinessException>(()=>SerialRules.Reason(" \n "));
    }
    [Fact] public void PagingCursorBindsVariantStateAndNormalizedSearch()
    {
        var query=SerialPageQuery.Create("variant","available"," ab-۱۲ ");var id=Guid.NewGuid().ToString("N");var cursor=SerialPaging.Encode(id,query);Assert.Equal(id,SerialPaging.Decode(cursor,SerialPageQuery.Create("VARIANT","available","AB-12")));foreach(var changed in new[]{SerialPageQuery.Create("other","available","AB-12"),SerialPageQuery.Create("variant","retired","AB-12"),SerialPageQuery.Create("variant","available","AB-13")})Assert.Equal("invalid_serial_cursor",Assert.Throws<BusinessException>(()=>SerialPaging.Decode(cursor,changed)).Code);Assert.Throws<BusinessException>(()=>SerialPaging.Decode("%%%",query));
    }
    [Fact] public void SqlPageIsBoundedAndContainsNoProductGraphOrFinancialColumns()
    {
        using var db=new InventoryDbContext(DesignTimeOptions.Create<InventoryDbContext>("inventory"));var sql=SerialInventoryService.Query(db,SerialPageQuery.Create("v","available","AB"),Guid.NewGuid().ToString("N")).ToQueryString();Assert.Contains("TOP(",sql);Assert.Contains("ORDER BY",sql);Assert.Contains("SerialUnits",sql);Assert.DoesNotContain("Price",sql);Assert.DoesNotContain("Orders",sql);Assert.DoesNotContain("SerialIdentifiers",sql);
    }
    [Fact] public void InventoryModelKeepsHistoryAndHasGlobalAliasUniquenessAndRowversions()
    {
        using var db=new InventoryDbContext(DesignTimeOptions.Create<InventoryDbContext>("inventory"));var stock=db.Model.FindEntityType(typeof(StockItem))!;Assert.Equal("none",stock.FindProperty(nameof(StockItem.TrackingMode))!.GetDefaultValue());var unit=db.Model.FindEntityType(typeof(SerialUnit))!;Assert.True(unit.FindProperty(nameof(SerialUnit.Version))!.IsConcurrencyToken);var alias=db.Model.FindEntityType(typeof(SerialIdentifier))!;Assert.Equal(nameof(SerialIdentifier.Key),Assert.Single(alias.FindPrimaryKey()!.Properties).Name);Assert.All(alias.GetForeignKeys(),fk=>Assert.Equal(DeleteBehavior.Restrict,fk.DeleteBehavior));Assert.Equal("inventory",unit.GetSchema());
    }
    [Fact] public void MissingStockVersionAndUnknownWarrantyRemainExplicitNullInTheWireContract()
    {
        var settings=new JsonSerializerOptions(JsonSerializerDefaults.Web){DefaultIgnoreCondition=JsonIgnoreCondition.WhenWritingNull};using var stock=JsonDocument.Parse(JsonSerializer.Serialize(new SerialStock("v","none",0,0,null),settings));Assert.Equal(JsonValueKind.Null,stock.RootElement.GetProperty("version").ValueKind);var unit=new SerialUnitData("id","v",null,"490154203237518",null,"available",null,null,null,DateTimeOffset.UnixEpoch,DateTimeOffset.UnixEpoch,"AAAAAAAAAAA=");using var wire=JsonDocument.Parse(JsonSerializer.Serialize(unit,settings));foreach(var name in new[]{"serial","imei2","orderId","reservationId","warrantyUntil"})Assert.Equal(JsonValueKind.Null,wire.RootElement.GetProperty(name).ValueKind);using var history=JsonDocument.Parse(JsonSerializer.Serialize(new SerialHistoryEntry("9007199254740993","id","available","actor","reason",null,DateTimeOffset.UnixEpoch),settings));Assert.Equal("9007199254740993",history.RootElement.GetProperty("id").GetString());
    }
    [Fact] public async Task InvalidCommandsAndEmptyDigitalChecksDoNotOpenSql()
    {
        using var scope=factory.Services.CreateScope();var service=scope.ServiceProvider.GetRequiredService<SerialInventoryService>();var key=Guid.NewGuid().ToString();await Assert.ThrowsAsync<BusinessException>(()=>service.ConfigureAsync("v",false,new("guess",null,key),"actor",default));await Assert.ThrowsAsync<BusinessException>(()=>service.ReceiveAsync("v",false,new([],"reason",null,key),"actor",default));await Assert.ThrowsAsync<BusinessException>(()=>service.RetireAsync("v","bad",new("AAAAAAAAAAA=","reason",null,key),"actor",default));await Assert.ThrowsAsync<BusinessException>(()=>service.AssignAsync(new("owner",Guid.NewGuid().ToString(),"actor",key,[]),default));await Assert.ThrowsAsync<BusinessException>(()=>service.HistoryAsync("v",Guid.NewGuid().ToString(),"0",default));await service.AssertDigitalVariantsAllowedAsync([],default);Assert.Equal(System.Data.ConnectionState.Closed,scope.ServiceProvider.GetRequiredService<InventoryDbContext>().Database.GetDbConnection().State);
    }
    [Theory][InlineData("mfa_pending","inventory.read",false)][InlineData("access","cms.read",false)][InlineData("access","inventory.read",true)][InlineData("mfa_pending","inventory.write",true)]
    public async Task SerialReadsAndWritesRequireCompleteInventoryPermissions(string kind,string permission,bool write)
    {
        using var client=factory.CreateClient();client.DefaultRequestHeaders.Add("X-Test-Kind",kind);client.DefaultRequestHeaders.Add("X-Test-Permissions",permission);using var response=write?await client.PutAsJsonAsync("/api/admin/inventory/variants/v/serial-mode",new SerialModeInput("serial",null,Guid.NewGuid().ToString())):await client.GetAsync("/api/admin/inventory/variants/v/serials");Assert.Equal(HttpStatusCode.Forbidden,response.StatusCode);
    }
    [Fact] public async Task AnonymousCannotReadSerials(){using var client=factory.CreateClient();using var response=await client.GetAsync("/api/admin/inventory/variants/v/serials");Assert.Equal(HttpStatusCode.Unauthorized,response.StatusCode);using var history=await client.GetAsync("/api/admin/inventory/variants/v/serials/"+Guid.NewGuid().ToString("N")+"/history");Assert.Equal(HttpStatusCode.Unauthorized,history.StatusCode);}
}
