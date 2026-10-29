using System.Data;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;
public sealed class SourcingCartTests
{
    [Theory]
    [InlineData("zero")][InlineData("negative")][InlineData("quantity-limit")][InlineData("duplicate")][InlineData("capacity")][InlineData("null-lines")][InlineData("null-line")][InlineData("invalid-id")][InlineData("long-id")][InlineData("zero-id")][InlineData("opaque-id")][InlineData("identity")][InlineData("locale")][InlineData("no-session")]
    public async Task InvalidSelectionFailsBeforeOpeningSql(string kind)
    {
        await using var db = new SalesDbContext(DesignTimeOptions.Create<SalesDbContext>("sales"));
        var identity = new CartIdentity("owner", null);
        CartSourcingLineInput[] lines = kind switch {
            "zero" => [new(new string('a',32), 0)], "negative" => [new(new string('a',32), -1)], "quantity-limit" => [new(new string('a',32), 1000001)],
            "duplicate" => [new(new string('a',32), 1), new(new string('A',32), 2)], "capacity" => Enumerable.Range(0,25).Select(_=>new CartSourcingLineInput(Guid.NewGuid().ToString("N"),1)).ToArray(),
            "null-lines" => null!, "null-line" => [null!], "invalid-id" => [new("private/id", 1)], "long-id" => [new(new string('a',33),1)], "zero-id"=>[new(new string('0',32),1)], "opaque-id"=>[new("opaque-listing",1)], _ => []
        };
        if(kind=="identity")identity=new("owner",CartService.CreateGuestToken());
        if(kind=="no-session")identity=new(null,null);
        var service = new CartSourcingService(db, new(db,null!,null!,TimeProvider.System), null!);
        await Assert.ThrowsAsync<BusinessException>(()=>service.ReplaceAsync(identity,kind=="locale"?"fr":"en",new(lines,null),CancellationToken.None));
        Assert.Equal(ConnectionState.Closed,db.Database.GetDbConnection().State);
    }
    [Fact] public async Task AllSourcingBoundariesRequireTheParentTransaction()
    {
        await using var db = new SalesDbContext(DesignTimeOptions.Create<SalesDbContext>("sales"));
        var service = new CartSourcingService(db,new(db,null!,null!,TimeProvider.System),null!);
        await Assert.ThrowsAsync<InvalidOperationException>(()=>service.ReadAsync(new("owner",null),"en",CancellationToken.None));
        await Assert.ThrowsAsync<InvalidOperationException>(()=>service.ReplaceAsync(new("owner",null),"en",new([],null),CancellationToken.None));
        await Assert.ThrowsAsync<InvalidOperationException>(()=>service.ReadForSubmissionAsync("owner",CancellationToken.None));
        await Assert.ThrowsAsync<InvalidOperationException>(()=>service.ConsumeSourcingAsync("owner","AAAAAAAAAAE=",CancellationToken.None));
        Assert.Equal(ConnectionState.Closed,db.Database.GetDbConnection().State);
    }
    [Theory][InlineData(1,1)][InlineData(1,1000000)][InlineData(24,1)]
    public async Task ValidBoundarySelectionsReachOnlyTheRequiredParentTransaction(int count,int quantity)
    {
        await using var db = new SalesDbContext(DesignTimeOptions.Create<SalesDbContext>("sales"));
        var service = new CartSourcingService(db,new(db,null!,null!,TimeProvider.System),null!);
        var lines=Enumerable.Range(0,count).Select(_=>new CartSourcingLineInput(Guid.NewGuid().ToString("N"),quantity)).ToArray();
        await Assert.ThrowsAsync<InvalidOperationException>(()=>service.ReplaceAsync(new("owner",null),"en",new(lines,null),CancellationToken.None));
        Assert.Equal(ConnectionState.Closed,db.Database.GetDbConnection().State);
    }
    [Fact] public void SourcingWireIsExplicitlyRequestOnlyAndKeepsNullVersion()
    {
        var options=new JsonSerializerOptions(JsonSerializerDefaults.Web){DefaultIgnoreCondition=JsonIgnoreCondition.WhenWritingNull};
        var json=JsonSerializer.SerializeToElement(new CartSourcingSnapshot(1,"fa",null,24,true,false,[],false),options);
        Assert.Equal(JsonValueKind.Null,json.GetProperty("version").ValueKind);Assert.True(json.GetProperty("requestOnly").GetBoolean());Assert.False(json.GetProperty("canPay").GetBoolean());
        Assert.Equal(24,json.GetProperty("capacity").GetInt32());Assert.DoesNotContain(json.EnumerateObject(),property=>property.Name.Contains("total",StringComparison.OrdinalIgnoreCase));
        var purchase=JsonSerializer.SerializeToElement(new CartSnapshot(1,"en",null,[],"0",false),new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert.Equal(new[]{"schemaVersion","locale","version","lines","subtotalRial","hasIssues"},purchase.EnumerateObject().Select(property=>property.Name));
    }
    [Theory][InlineData("{\"lines\":[],\"version\":null,\"ownerId\":\"forged\"}")][InlineData("{\"lines\":[{\"listingId\":\"listing\",\"quantity\":1,\"priceRial\":\"0\"}],\"version\":null}")]
    public void TheClientCannotSupplyOwnerOrPrice(string json) => Assert.Throws<JsonException>(()=>JsonSerializer.Deserialize<CartSourcingInput>(json,new JsonSerializerOptions(JsonSerializerDefaults.Web)));
}
