using System.Data;
using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Inventory;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class SerialInventoryV2Tests(ApiFactory factory):IClassFixture<ApiFactory>
{
    private const string V="AAAAAAAAAAA=";
    private const string Next="AQAAAAAAAAA=";
    private static string Id()=>Guid.NewGuid().ToString("N");
    private static JsonNode Cursor(string value){var raw=value.Replace('-','+').Replace('_','/');return JsonNode.Parse(Convert.FromBase64String(raw.PadRight((raw.Length+3)/4*4,'=')))!;}
    private static string Encode(JsonNode value)=>Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(value.ToJsonString())).TrimEnd('=').Replace('+','-').Replace('/','_');

    [Fact] public void CursorUsesIndependentVersionTwoDomainAndCanonicalVariantFilterAndStockVersion()
    {
        var id=Id();var query=SerialPageQuery.Create("variant","available"," ab-۱۲ ");var cursor=SerialPagingV2.Encode(id,query,V);Assert.InRange(cursor.Length,1,512);Assert.Equal(512,SerialPagingV2.MaximumCursorLength);Assert.Equal(id,SerialPagingV2.Decode(cursor,SerialPageQuery.Create("VARIANT","available","AB-12"),V));Assert.Equal(2,Cursor(cursor)["schemaVersion"]!.GetValue<int>());Assert.Equal(V,Cursor(cursor)["stockVersion"]!.GetValue<string>());Assert.Equal("version_conflict",Assert.Throws<BusinessException>(()=>SerialPagingV2.Decode(cursor,query,Next)).Code);Assert.Equal("version_conflict",Assert.Throws<BusinessException>(()=>SerialPagingV2.Decode(cursor,query,null)).Code);
    }
    [Fact] public void CursorCannotCrossSkuStateSearchOrVersionOneContract()
    {
        var query=SerialPageQuery.Create("variant","all",null);var cursor=SerialPagingV2.Encode(Id(),query,V);foreach(var foreign in new[]{SerialPageQuery.Create("other","all",null),SerialPageQuery.Create("variant","available",null),SerialPageQuery.Create("variant","all","AB")})Assert.Equal("invalid_serial_cursor",Assert.Throws<BusinessException>(()=>SerialPagingV2.Decode(cursor,foreign,V)).Code);var legacy=SerialPaging.Encode(Id(),query);Assert.Equal("invalid_serial_cursor",Assert.Throws<BusinessException>(()=>SerialPagingV2.Decode(legacy,query,V)).Code);Assert.Equal("invalid_serial_cursor",Assert.Throws<BusinessException>(()=>SerialPaging.Decode(cursor,query)).Code);
    }
    [Fact] public void CursorRejectsTamperedVersionUnknownFieldsInvalidPositionAndMalformedEncoding()
    {
        var query=SerialPageQuery.Create("variant","all",null);var cursor=SerialPagingV2.Encode(Id(),query,V);foreach(var modify in new Action<JsonNode>[]{n=>n["schemaVersion"]=1,n=>n["after"]="bad",n=>n["stockVersion"]=Next,n=>n["unexpected"]=true}){var value=Cursor(cursor);modify(value);Assert.Equal("invalid_serial_cursor",Assert.Throws<BusinessException>(()=>SerialPagingV2.Decode(Encode(value),query,V)).Code);}foreach(var bad in new[]{"",new string('a',513),"%%%","a"})Assert.Equal("invalid_serial_cursor",Assert.Throws<BusinessException>(()=>SerialPagingV2.Decode(bad,query,V)).Code);Assert.Null(SerialPagingV2.Decode(null,query,V));
    }
    [Fact] public void V2WireSeparatesPhysicalStateFromClaimAndPreservesExplicitNulls()
    {
        var at=DateTimeOffset.UnixEpoch;var unit=new SerialUnitData(Id(),"variant","QA-UNIT",null,null,"available",null,null,null,at,at,V);var page=new SerialUnitPageV2(2,50,new("variant","serial",3,1,1,1,V),[new(unit,true)],null);var options=new JsonSerializerOptions(JsonSerializerDefaults.Web){DefaultIgnoreCondition=JsonIgnoreCondition.WhenWritingNull};using var wire=JsonDocument.Parse(JsonSerializer.Serialize(page,options));var root=wire.RootElement;Assert.Equal(2,root.GetProperty("schemaVersion").GetInt32());Assert.Equal(1,root.GetProperty("stock").GetProperty("available").GetInt32());Assert.True(root.GetProperty("items")[0].GetProperty("hasActiveClaim").GetBoolean());Assert.Equal("available",root.GetProperty("items")[0].GetProperty("unit").GetProperty("state").GetString());Assert.Equal(JsonValueKind.Null,root.GetProperty("nextCursor").ValueKind);Assert.Equal(JsonValueKind.Null,root.GetProperty("items")[0].GetProperty("unit").GetProperty("imei1").ValueKind);var missing=JsonSerializer.Serialize(new SerialUnitPageV2(2,50,new("absent","none",0,0,0,0,null),[],null),options);Assert.Contains("\"version\":null",missing);foreach(var field in new[]{"ownerId","allocationId","originAllocationId","priceRial","termsHash","sourceKey","supplierReference"})Assert.DoesNotContain("\""+field+"\":",JsonSerializer.Serialize(page,options));
    }
    [Fact] public void VersionOneStockAndUnitWireShapesGainNoAllocationMembers()
    {
        var options=new JsonSerializerOptions(JsonSerializerDefaults.Web);using var stock=JsonDocument.Parse(JsonSerializer.Serialize(new SerialStock("v","none",0,0,null),options));Assert.Equal(new[]{"mode","onHand","reserved","variantId","version"},stock.RootElement.EnumerateObject().Select(p=>p.Name).Order());var unit=new SerialUnitData(Id(),"v","QA",null,null,"available",null,null,null,DateTimeOffset.UnixEpoch,DateTimeOffset.UnixEpoch,V);var json=JsonSerializer.Serialize(unit,options);foreach(var field in new[]{"sourcingReserved","available","hasActiveClaim","ownerId","allocationId"})Assert.DoesNotContain("\""+field+"\":",json);
    }
    [Fact] public async Task ReaderRejectsInvalidVariantOrFilterWithoutOpeningSql()
    {
        using var db=new InventoryDbContext(DesignTimeOptions.Create<InventoryDbContext>("inventory"));var reader=new SerialInventoryV2Reader(db);foreach(var query in new SerialPageQuery[]{null!,new("bad variant","all",""),new("v","unknown",""),new("v","all","a\nb")})await Assert.ThrowsAsync<BusinessException>(()=>reader.PageAsync(query,null,default));Assert.Equal(ConnectionState.Closed,db.Database.GetDbConnection().State);
    }
    [Theory][InlineData("mfa_pending","inventory.read")][InlineData("access","cms.read")]
    public async Task VersionTwoReadRequiresCompletedMfaAndInventoryPermission(string kind,string permission)
    {
        using var client=factory.CreateClient();client.DefaultRequestHeaders.Add("X-Test-Kind",kind);client.DefaultRequestHeaders.Add("X-Test-Permissions",permission);using var response=await client.GetAsync("/api/admin/inventory/variants/v/serials/v2");Assert.Equal(HttpStatusCode.Forbidden,response.StatusCode);
    }
    [Fact] public async Task AnonymousCannotReadVersionTwoSerials()
    {
        using var client=factory.CreateClient();using var response=await client.GetAsync("/api/admin/inventory/variants/v/serials/v2");Assert.Equal(HttpStatusCode.Unauthorized,response.StatusCode);
    }
}
