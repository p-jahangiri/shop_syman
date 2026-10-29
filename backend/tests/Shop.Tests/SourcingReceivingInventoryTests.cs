using System.Data;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Shop.Modules.Inventory;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class SourcingReceivingInventoryTests
{
    private static string Id()=>Guid.NewGuid().ToString("N");
    private const string Version="AAAAAAAAAAA=";
    private static SourcingReceiptLineInput Line(string? key=null)=>new(Id(),key??"001",Id(),Version,"1","none",null,[]);
    private static SourcingReceiptInput Input(params SourcingReceiptLineInput[] lines)=>new(Id(),Version,Version,"manual","Holoo","001","Main","RCPT-001",DateTimeOffset.UnixEpoch,"Actual receipt",false,lines.Length==0?[Line()]:lines);

    [Theory]
    [InlineData("1",1,1,1)]
    [InlineData("0.5",2,1,1)]
    [InlineData("1.5",2,3,1)]
    [InlineData("1000000",1,1,1000000)]
    [InlineData("0.000001",1000000,1,1)]
    [InlineData("1000000000000",1,1000000,1000000)]
    public void RationalConversionsProduceOnlyExactBoundedSalesUnits(string quantity,int numerator,int denominator,int expected)=>Assert.Equal(expected,SourcingReceivingRules.ConvertQuantity(quantity,numerator,denominator));

    [Theory]
    [InlineData("0.1",1,1)]
    [InlineData("1",1,3)]
    [InlineData("1000001",1,1)]
    [InlineData("99999999999999999999.99999999",1000000,1)]
    public void FractionalOrOverlargeConversionsNeverRoundOrOverflow(string quantity,int numerator,int denominator)=>Assert.Equal("receiving_unit_conversion_conflict",Assert.Throws<BusinessException>(()=>SourcingReceivingRules.ConvertQuantity(quantity,numerator,denominator)).Code);

    [Theory]
    [InlineData("")][InlineData("0")][InlineData("0.0")][InlineData("01")][InlineData("1.0")][InlineData("1.20")][InlineData(".5")][InlineData("1.")][InlineData("+1")][InlineData("-1")][InlineData("1e3")][InlineData("۱")][InlineData(" 1")][InlineData("1 ")][InlineData("1,000")][InlineData("0.000000001")][InlineData("100000000000000000000")]
    public void SourceQuantitiesUseOneCanonicalPositiveDecimalSpelling(string quantity)=>Assert.Equal("invalid_sourcing_receipt",Assert.Throws<BusinessException>(()=>SourcingReceivingRules.SourceQuantity(quantity)).Code);

    [Theory][InlineData(0,1)][InlineData(1,0)][InlineData(-1,1)][InlineData(1,1000001)]
    public void MappingRatiosArePositiveBoundedIntegers(int numerator,int denominator)=>Assert.Throws<BusinessException>(()=>SourcingReceivingRules.ConvertQuantity("1",numerator,denominator));

    [Fact] public void ExternalPhysicalIdentityPreservesCaseLeadingZeroesDigitScriptAndUnicode()
    {
        var baseline=SourcingReceivingRules.ExternalLineIdentity("Holoo","001","Main","R-01","001");
        var variants=new[]{SourcingReceivingRules.ExternalLineIdentity("holoo","001","Main","R-01","001"),SourcingReceivingRules.ExternalLineIdentity("Holoo","1","Main","R-01","001"),SourcingReceivingRules.ExternalLineIdentity("Holoo","001","main","R-01","001"),SourcingReceivingRules.ExternalLineIdentity("Holoo","001","Main","R-1","001"),SourcingReceivingRules.ExternalLineIdentity("Holoo","001","Main","R-01","۰۰۱")};
        Assert.All(variants,value=>Assert.NotEqual(baseline,value));Assert.Equal(variants.Length,variants.Distinct().Count());
        Assert.NotEqual(SourcingReceivingRules.ExternalLineIdentity("é","a","a","a","a"),SourcingReceivingRules.ExternalLineIdentity("e\u0301","a","a","a","a"));
        Assert.Equal(SourcingReceivingRules.MappingIdentity("H","001","W","each","sku"),SourcingReceivingRules.MappingIdentity("H","001","W","each","SKU"));
    }

    [Fact] public void ReceiptCanonicalizationIsOrderIndependentAndNormalizesPhysicalIdentifiersOnly()
    {
        var first=Line("002") with{TrackingMode="serial",Units=[new(" case-۱۲۳ ")]};var second=Line("001");var input=Input(first,second);var one=SourcingReceivingRules.Normalize(input);var two=SourcingReceivingRules.Normalize(input with{Lines=[second,first with{Units=[new("CASE-123")]}]});Assert.Equal(SourcingReceivingRules.Hash(one),SourcingReceivingRules.Hash(two));Assert.Equal("001",one.Lines[0].SourceReceiptLineKey);Assert.Equal("CASE-123",one.Lines[1].Units[0].Serial);Assert.Equal("Holoo",one.OriginSystem);Assert.Equal("001",one.CompanyKey);
    }

    [Fact] public void DuplicateSourceLineAndOversizedPhysicalBatchesAreRejectedWithoutSplitting()
    {
        var line=Line();Assert.Throws<BusinessException>(()=>SourcingReceivingRules.Normalize(Input(line,line with{OfferLineId=Id()})));Assert.Throws<BusinessException>(()=>SourcingReceivingRules.Normalize(Input(Enumerable.Range(0,65).Select(i=>Line(i.ToString())).ToArray())));
        var tracked=Line() with{TrackingMode="serial",Units=Enumerable.Range(0,100).Select(i=>new ReceivingSerialInput("A"+i)).ToArray()};var extra=Line("002") with{TrackingMode="serial",Units=[new("extra")]};Assert.Throws<BusinessException>(()=>SourcingReceivingRules.Normalize(Input(tracked,extra)));Assert.Equal(100,SourcingReceivingRules.Normalize(Input(tracked)).Lines[0].Units.Length);
    }

    [Fact] public void TrackingModesUnitArraysUtcAndVersionsMustBeExplicit()
    {
        var input=Input();Assert.Throws<BusinessException>(()=>SourcingReceivingRules.Normalize(input with{Channel="api"}));Assert.Throws<BusinessException>(()=>SourcingReceivingRules.Normalize(input with{ReceivedAt=new(2026,1,1,0,0,0,TimeSpan.FromHours(3))}));Assert.Throws<BusinessException>(()=>SourcingReceivingRules.Normalize(input with{Lines=[Line() with{Units=[new("s")]}]}));Assert.Throws<BusinessException>(()=>SourcingReceivingRules.Normalize(input with{Lines=[Line() with{TrackingMode="imei"}]}));Assert.Throws<BusinessException>(()=>SourcingReceivingRules.Normalize(input with{Lines=[Line() with{MappingVersion=""}]}));Assert.Throws<BusinessException>(()=>SourcingReceivingRules.Normalize(input with{RequestId=Guid.NewGuid().ToString("D")}));
    }

    [Fact] public void MappingIdentityLabelsAndVersionDoNotGuessDefaults()
    {
        var input=new ReceivingUnitMappingInput(Id(),"Holoo","001","Main","BOX", "sku",12,1,"بستهٔ دوازده‌تایی","Box of twelve",true,null);var normalized=SourcingReceivingRules.Normalize(input);Assert.Equal("SKU",normalized.VariantId);Assert.Equal("001",normalized.CompanyKey);Assert.Equal("BOX",normalized.SourceUnitKey);Assert.Null(normalized.Version);Assert.Throws<BusinessException>(()=>SourcingReceivingRules.Normalize(input with{SourceUnitKey=" BOX"}));Assert.Throws<BusinessException>(()=>SourcingReceivingRules.Normalize(input with{NameEn=""}));Assert.Throws<BusinessException>(()=>SourcingReceivingRules.Normalize(input with{Version=""}));Assert.Throws<BusinessException>(()=>SourcingReceivingRules.Normalize(input with{Numerator=0}));
    }

    [Fact] public void RelationalModelKeepsPhysicalUniquenessImmutableUnitProvenanceAndModuleOwnership()
    {
        using var db=new InventoryDbContext(DesignTimeOptions.Create<InventoryDbContext>("inventory"));var model=db.GetService<IDesignTimeModel>().Model;var mapping=model.FindEntityType(typeof(ReceivingUnitMapping))!;Assert.True(mapping.FindProperty(nameof(ReceivingUnitMapping.Version))!.IsConcurrencyToken);Assert.Contains(mapping.GetIndexes(),i=>i.IsUnique&&i.Properties.Single().Name==nameof(ReceivingUnitMapping.IdentityHash));
        foreach(var property in new[]{nameof(ReceivingUnitMapping.OriginSystem),nameof(ReceivingUnitMapping.CompanyKey),nameof(ReceivingUnitMapping.WarehouseKey),nameof(ReceivingUnitMapping.SourceUnitKey)})Assert.Equal("Latin1_General_100_BIN2",mapping.FindProperty(property)!.GetCollation());
        var line=model.FindEntityType(typeof(SourcingStockReceiptLine))!;Assert.Contains(line.GetIndexes(),i=>i.IsUnique&&i.Properties.Count==1&&i.Properties[0].Name==nameof(SourcingStockReceiptLine.ExternalIdentityHash));Assert.Contains(line.GetForeignKeys(),fk=>fk.PrincipalEntityType.ClrType==typeof(StockMovement));
        var unit=model.FindEntityType(typeof(SourcingStockReceiptUnit))!;Assert.Contains(unit.GetIndexes(),i=>i.IsUnique&&i.Properties.Single().Name==nameof(SourcingStockReceiptUnit.UnitId));
        foreach(var type in new[]{typeof(ReceivingUnitMapping),typeof(SourcingStockReceipt),typeof(SourcingStockReceiptLine),typeof(SourcingStockReceiptUnit),typeof(ReceivingCommand)}){var entity=model.FindEntityType(type)!;Assert.Equal("inventory",entity.GetSchema());Assert.All(entity.GetForeignKeys(),fk=>{Assert.Equal("inventory",fk.PrincipalEntityType.GetSchema());Assert.Equal(DeleteBehavior.Restrict,fk.DeleteBehavior);});}
        var command=model.FindEntityType(typeof(ReceivingCommand))!;Assert.Equal(new[]{"ActorId","Operation","CommandId"},command.FindPrimaryKey()!.Properties.Select(p=>p.Name));
    }

    [Fact] public void NoStockVersionAndLargeMovementIdsRemainLosslessInWireContract()
    {
        var options=new JsonSerializerOptions(JsonSerializerDefaults.Web){DefaultIgnoreCondition=JsonIgnoreCondition.WhenWritingNull};using var stock=JsonDocument.Parse(JsonSerializer.Serialize(new ReceivingStockState("sku","none",0,0,null),options));Assert.Equal(JsonValueKind.Null,stock.RootElement.GetProperty("version").ValueKind);
        using var line=JsonDocument.Parse(JsonSerializer.Serialize(new SourcingReceivedLine(Id(),Id(),"sku",1,"9007199254740993",[]),options));Assert.Equal("9007199254740993",line.RootElement.GetProperty("movementId").GetString());var json=JsonSerializer.Serialize(Input(),options);Assert.Throws<JsonException>(()=>JsonSerializer.Deserialize<SourcingReceiptInput>(json[..^1]+",\"price\":\"1\"}",options));
    }

    [Fact] public async Task CommandsRejectMissingParentTransactionBeforeOpeningSql()
    {
        using var db=new InventoryDbContext(DesignTimeOptions.Create<InventoryDbContext>("inventory"));var reservations=new StockReservationService(db,TimeProvider.System);var serials=new SerialInventoryService(db,reservations,TimeProvider.System);var receiving=new SourcingReceivingService(db,reservations,serials,TimeProvider.System,false);var input=Input();await Assert.ThrowsAsync<InvalidOperationException>(()=>receiving.ReplayAsync("actor",Id(),Id(),Id(),input,default));var mappings=new ReceivingUnitMappingService(db,reservations,TimeProvider.System);await Assert.ThrowsAsync<InvalidOperationException>(()=>mappings.SaveAsync("actor",Id(),new(Id(),"Holoo","001","Main","each","sku",1,1,"عدد","Each",true,null),default));Assert.Equal(ConnectionState.Closed,db.Database.GetDbConnection().State);
    }
}
