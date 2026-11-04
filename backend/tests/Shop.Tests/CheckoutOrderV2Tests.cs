using System.Data;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class CheckoutOrderV2Tests
{
    private static readonly DateTimeOffset At=new(2030,1,1,0,0,0,TimeSpan.Zero);
    private const string V="AAAAAAAAAAA=";private static readonly string H=new('A',64);private static string Id()=>Guid.NewGuid().ToString("N");
    private static QuoteLineV5Data Accepted(DateTimeOffset? purchase=null,DateTimeOffset? allocation=null)=>new(Id(),"acceptedOffer","sku","model","seller","phones","QA-SKU","Accepted name","Accepted variant","Accepted warranty",false,2,"9007199254740993","18014398509481986",null,new(Id(),Id(),Id(),Id(),Id(),Id(),Id(),Id(),Id(),H,V,V,purchase??At.AddHours(1),allocation??At.AddMinutes(10),3,H,"شرایط پذیرفته‌شده","Original accepted terms",H,false));
    [Theory][InlineData(null)][InlineData("")][InlineData("unknown")][InlineData("AAAAAAAAAAA==")][InlineData("AAAAAAAAAAB=")]
    public void UnknownLegacyVersionsStayExplicitlyUnknown(string? value)=>Assert.Null(OrderV2HistoryRules.PriceVersion(value));
    [Fact]public void CanonicalHistoricalVersionIsPreserved()=>Assert.Equal(V,OrderV2HistoryRules.PriceVersion(V));
    [Fact]public void FreshQuoteAllowsConfiguredPaymentHoldWhilePurchaseAndAllocationDeadlinesRemainAbsolute()
    {
        var line=Accepted();Assert.Equal(At.AddMinutes(10),CheckoutQuoteV5Rules.OrderExpiry(At,At.AddMinutes(5),[line],60));
        Assert.Equal(At.AddMinutes(1),CheckoutQuoteV5Rules.OrderExpiry(At,At.AddMinutes(5),[line],1));
        Assert.Equal(At.AddSeconds(20),CheckoutQuoteV5Rules.OrderExpiry(At,At.AddMinutes(5),[Accepted(allocation:At.AddSeconds(20))],60));
        Assert.Equal(At.AddSeconds(10),CheckoutQuoteV5Rules.OrderExpiry(At,At.AddMinutes(5),[Accepted(purchase:At.AddSeconds(10),allocation:At.AddSeconds(10))],60));
        // A quote is a creation precondition, not the separate payment hold.
        // Accepted allocation rights still cannot be renewed by waiting.
        Assert.Equal(At.AddMinutes(10),CheckoutQuoteV5Rules.OrderExpiry(At.AddMinutes(4),At.AddMinutes(5),[line],60));
    }
    [Fact]public void OrdinaryOrderGetsItsConfiguredHourOnlyAfterValidQuoteCreation()
    {
        var ordinary=Accepted()with{LineKind="ordinary",Accepted=null};
        Assert.Equal(At.AddHours(1),CheckoutQuoteV5Rules.OrderExpiry(At,At.AddSeconds(1),[ordinary],60));
        Assert.Equal("quote_accepted_offer_expired_conflict",Assert.Throws<BusinessException>(()=>CheckoutQuoteV5Rules.OrderExpiry(At,At,[ordinary],60)).Code);
    }
    [Theory][InlineData(0)][InlineData(61)]public void ReservationLifetimeHasNoImplicitNewPolicy(int minutes)=>Assert.Equal("invalid_order_settings",Assert.Throws<BusinessException>(()=>CheckoutQuoteV5Rules.OrderExpiry(At,At.AddMinutes(5),[Accepted()],minutes)).Code);
    [Theory][InlineData("quote")][InlineData("purchase")][InlineData("allocation")]
    public void EveryAbsoluteAuthorityMustRemainStrictlyFuture(string source)
    {
        var line=Accepted(purchase:source=="purchase"?At:null,allocation:source=="allocation"?At:null);var quote=source=="quote"?At:At.AddMinutes(5);
        Assert.Equal("quote_accepted_offer_expired_conflict",Assert.Throws<BusinessException>(()=>CheckoutQuoteV5Rules.OrderExpiry(At,quote,[line],15)).Code);
    }
    [Fact]public void Quote5AndOrder2KeepFullAcceptedProvenanceAndExactRialStrings()
    {
        var accepted=Accepted();var ordinary=accepted with{LineId=Id(),LineKind="ordinary",UnitPriceRial="123",LineTotalRial="246",PriceVersion=V,Accepted=null};
        var quote=new CheckoutQuoteV5Data(5,"en",null,V,H,At,At.AddMinutes(5),[ordinary,accepted],"18014398509482232","0","0","18014398509482232",true,null,null,null,[],[],null,null,[],false,false,[],TemporaryOrder:new(false,15,true,["charges_unconfigured"]));
        using var json=JsonDocument.Parse(JsonSerializer.Serialize(quote,new JsonSerializerOptions(JsonSerializerDefaults.Web){DefaultIgnoreCondition=JsonIgnoreCondition.WhenWritingNull}));
        Assert.Equal(5,json.RootElement.GetProperty("schemaVersion").GetInt32());Assert.Equal(JsonValueKind.Null,json.RootElement.GetProperty("quoteId").ValueKind);Assert.False(json.RootElement.GetProperty("canPay").GetBoolean());Assert.False(json.RootElement.GetProperty("canPlaceOrder").GetBoolean());
        var lines=json.RootElement.GetProperty("lines");Assert.Equal(JsonValueKind.Null,lines[0].GetProperty("accepted").ValueKind);Assert.Equal(JsonValueKind.Null,lines[1].GetProperty("priceVersion").ValueKind);Assert.Equal("9007199254740993",lines[1].GetProperty("unitPriceRial").GetString());
        var terms=lines[1].GetProperty("accepted");Assert.Equal("Original accepted terms",terms.GetProperty("termsEn").GetString());Assert.Equal(3,terms.GetProperty("revision").GetInt32());Assert.Equal(H,terms.GetProperty("materialFingerprint").GetString());Assert.Equal(H,terms.GetProperty("snapshotHash").GetString());
        Assert.NotEqual(accepted.LineId,ordinary.LineId);Assert.Equal(accepted.VariantId,ordinary.VariantId);
    }
    [Fact]public void AdditiveOrderModelPreservesHistoricalKeysAndKeepsPricesOutsideInventory()
    {
        using var db=new SalesDbContext(DesignTimeOptions.Create<SalesDbContext>("sales"));var model=db.GetService<IDesignTimeModel>().Model;
        var header=model.FindEntityType(typeof(SalesOrder))!;Assert.True(header.FindProperty(nameof(SalesOrder.SnapshotVersion))!.IsNullable);Assert.Equal(typeof(int?),header.FindProperty(nameof(SalesOrder.SnapshotVersion))!.ClrType);
        Assert.Equal(new[]{"OrderId","VariantId"},model.FindEntityType(typeof(SalesOrderLine))!.FindPrimaryKey()!.Properties.Select(p=>p.Name));
        var line=model.FindEntityType(typeof(SalesOrderLineV2))!;Assert.Equal(new[]{"OrderId","LineId"},line.FindPrimaryKey()!.Properties.Select(p=>p.Name));Assert.Equal(typeof(long),line.FindProperty(nameof(SalesOrderLineV2.UnitPriceRial))!.ClrType);
        Assert.Contains(line.GetCheckConstraints(),c=>c.Name=="CK_OrderLineV2_Provenance"&&c.Sql.Contains("[TermsFa] IS NOT NULL",StringComparison.Ordinal)&&c.Sql.Contains("[MaterialFingerprint] IS NOT NULL",StringComparison.Ordinal));
        Assert.All(line.GetForeignKeys(),fk=>Assert.Equal(typeof(SalesOrder),fk.PrincipalEntityType.ClrType));
        var stock=new StockOrderHoldV2Request("owner",Id(),Id(),At.AddMinutes(1),[new(acceptedLineId(),"sku",1) ],[]);Assert.DoesNotContain("Price",JsonSerializer.Serialize(stock),StringComparison.OrdinalIgnoreCase);
        static string acceptedLineId()=>Guid.NewGuid().ToString("N");
    }
    [Fact]public async Task NewCommandsRequireSerializableRootBeforeAnySqlOrCapabilityRead()
    {
        using var db=new SalesDbContext(DesignTimeOptions.Create<SalesDbContext>("sales"));
        var quote=new CheckoutQuoteV5Service(db,null!,null!,null!,null!,null!,null!,null!,null!,TimeProvider.System,false);
        await Assert.ThrowsAsync<InvalidOperationException>(()=>quote.CreateAsync(new("owner",null),"en",new(V,null,null,null),default));
        var order=new OrderV2Service(db,null!,null!,null!,null!,null!,null!,TimeProvider.System,false);
        await Assert.ThrowsAsync<InvalidOperationException>(()=>order.CreateAsync("owner",new(Id(),Id(),"QA customer","09121234567",null,"",true),default));
        await Assert.ThrowsAsync<InvalidOperationException>(()=>new OrderOutboxService(db,TimeProvider.System).MarkDeliveredAsync(Id(),default));
        Assert.Equal(ConnectionState.Closed,db.Database.GetDbConnection().State);
    }
}
