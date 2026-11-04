using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Catalog.Infrastructure;
using Shop.SharedKernel;
using Shop.Modules.Sales;
using Xunit;
namespace Shop.Tests;
public sealed class UsedItemConditionTests
{
    private static UsedItemConditionData Facts()=>new("1234567890abcdef1234567890abcdef","unknown","unknown",null,"unknown","unknown","unknown","","",DateTimeOffset.Parse("2026-10-23T10:00:00Z"));
    [Theory][InlineData(0)][InlineData(100)]public void MeasuredBatteryIncludesBothBounds(int percent)=>UsedItemConditionRules.Validate(Facts() with{BatteryState="measured",BatteryHealthPercent=percent});
    [Theory][InlineData(-1)][InlineData(101)]public void BatteryCannotExceedPercentageBounds(int percent)=>Assert.Throws<BusinessException>(()=>UsedItemConditionRules.Validate(Facts() with{BatteryState="measured",BatteryHealthPercent=percent}));
    [Fact]public void UnknownIsNotInventedHealth(){UsedItemConditionRules.Validate(Facts());Assert.Throws<BusinessException>(()=>UsedItemConditionRules.Validate(Facts() with{BatteryHealthPercent=0}));Assert.Throws<BusinessException>(()=>UsedItemConditionRules.Validate(Facts() with{BatteryState="measured"}));Assert.Throws<BusinessException>(()=>UsedItemConditionRules.Validate(null));}
    [Theory][InlineData("\u0000")][InlineData("\u202e")][InlineData("\u2066")]
    public void PublicNotesCannotHideTextDirection(string text)=>Assert.Throws<BusinessException>(()=>UsedItemConditionRules.Validate(Facts() with{NotesFa=text}));
    [Fact]public void NotesStayPlainTextAndDateMustBeUtc(){var d=Facts() with{NotesFa="<script>متن ساده</script> می‌ماند\n"};UsedItemConditionRules.Validate(d);Assert.Throws<BusinessException>(()=>UsedItemConditionRules.Validate(d with{InspectedAt=d.InspectedAt.ToOffset(TimeSpan.FromHours(3.5))}));Assert.Throws<BusinessException>(()=>UsedItemConditionRules.Validate(d with{NotesEn=new string('a',2001)}));}
    [Fact]public void HistoricalFactsAreCorrelatedToExactOrdinaryLineAndNeverReadFromLiveCatalog()
    {
        var condition=Facts() with{BatteryState="measured",BatteryHealthPercent=0};var snapshot=JsonSerializer.Serialize(new{Lines=new[]{new{LineId="line",LineKind="ordinary",VariantId="V",ProductId="P",UsedCondition=condition}}},new JsonSerializerOptions(){NumberHandling=JsonNumberHandling.WriteAsString});
        var value=UsedOrderConditionSnapshots.Read(snapshot,[("line","v","p")]);Assert.Equal(condition,value["LINE"]);
        foreach(var expected in new[]{("other","v","p"),("line","other","p"),("line","v","other")})Assert.Equal("order_condition_unavailable",Assert.Throws<BusinessException>(()=>UsedOrderConditionSnapshots.Read(snapshot,[expected])).Code);
        Assert.Throws<BusinessException>(()=>UsedOrderConditionSnapshots.Read(snapshot.Replace("ordinary","acceptedOffer"),[("line","v","p")]));
    }
    [Fact]public void LegacySnapshotsAreUnchangedAndCorruptUsedFactsFailClosed()
    {
        Assert.Empty(UsedOrderConditionSnapshots.Read("{}",[("v","v","p")]));
        var line=new{VariantId="v",ProductId="p",UsedCondition=Facts()};var json=JsonSerializer.Serialize(new{Lines=new[]{line,line}},new JsonSerializerOptions(){NumberHandling=JsonNumberHandling.WriteAsString});Assert.Throws<BusinessException>(()=>UsedOrderConditionSnapshots.Read(json,[("v","v","p")]));
        Assert.Throws<BusinessException>(()=>UsedOrderConditionSnapshots.Read("{\"UsedCondition\":broken",[("v","v","p")]));
    }
    private static UsedItemInspectionPhotoData Photo(string? id=null)=>new($"/media/catalog/{id??Guid.NewGuid().ToString("N")}/card.webp","نمای همین دستگاه","This device view");
    [Fact]public void LegacyPhotoAbsenceKeepsBothPublicAndHistoricalWireShapesUnchanged()
    {
        foreach(var options in new[]{new JsonSerializerOptions(JsonSerializerDefaults.Web),new JsonSerializerOptions()}){
            var json=JsonSerializer.Serialize(Facts(),options);using var document=JsonDocument.Parse(json);Assert.DoesNotContain(document.RootElement.EnumerateObject(),p=>p.Name.Equals("photos",StringComparison.OrdinalIgnoreCase));
            Assert.Null(JsonSerializer.Deserialize<UsedItemConditionData>(json,options)!.Photos);
        }
        UsedItemConditionRules.Validate(Facts()with{Photos=[]});
    }
    [Fact]public void PhotoBoundsRequireTwelveDistinctIssuedCardsAndBilingualPlainAlternativeText()
    {
        var photos=Enumerable.Range(0,12).Select(_=>Photo()).ToArray();UsedItemConditionRules.Validate(Facts()with{Photos=photos});
        Assert.Throws<BusinessException>(()=>UsedItemConditionRules.Validate(Facts()with{Photos=photos.Append(Photo()).ToArray()}));
        Assert.Throws<BusinessException>(()=>UsedItemConditionRules.Validate(Facts()with{Photos=[photos[0],photos[0]]}));
        foreach(var url in new[]{"/products/phone.svg","https://example.test/device.webp",photos[0].Url.Replace("card.webp","zoom.webp"),"/media/catalog/00000000000000000000000000000000/card.webp",photos[0].Url+"?x=1"})Assert.Throws<BusinessException>(()=>UsedItemConditionRules.Validate(Facts()with{Photos=[Photo()with{Url=url}]}));
        foreach(var text in new[]{""," ","photo\n","photo\u202e",new string('x',161)})Assert.Throws<BusinessException>(()=>UsedItemConditionRules.Validate(Facts()with{Photos=[Photo()with{AltFa=text}]}));
    }
    [Fact]public void HistoricalInspectionPhotosRemainBoundToTheOriginalLineAndOrder()
    {
        var condition=Facts()with{Photos=[Photo(),Photo()]};var snapshot=JsonSerializer.Serialize(new{Lines=new[]{new{LineId="line",LineKind="ordinary",VariantId="V",ProductId="P",UsedCondition=condition}}},new JsonSerializerOptions{NumberHandling=JsonNumberHandling.WriteAsString});
        var historical=UsedOrderConditionSnapshots.Read(snapshot,[("line","v","p")])["line"];
        Assert.Equal(JsonSerializer.Serialize(condition),JsonSerializer.Serialize(historical));
        Assert.Equal("order_condition_unavailable",Assert.Throws<BusinessException>(()=>UsedOrderConditionSnapshots.Read(snapshot.Replace("card.webp","zoom.webp"),[("line","v","p")])).Code);
    }
    [Theory][InlineData(false)][InlineData(true)]public void InspectionPhotoAndReceiptMutationFailsBeforeOpeningAnyConnection(bool delete)
    {
        using var db=new CatalogDbContext(new DbContextOptionsBuilder<CatalogDbContext>().UseSqlServer("Server=127.0.0.1;Database=NeverOpened;Integrated Security=true;TrustServerCertificate=true").Options);
        foreach(var entity in new object[]{new UsedItemInspection{Id=Guid.NewGuid().ToString("N"),VariantId="sku"},new UsedItemInspectionPhoto{InspectionId=Guid.NewGuid().ToString("N"),Position=1,AssetId=Guid.NewGuid().ToString("N"),AltFa="نما",AltEn="View"},new UsedItemCommand{ActorId="actor",CommandId=Guid.NewGuid().ToString("N")}}){db.ChangeTracker.Clear();db.Attach(entity);db.Entry(entity).State=delete?EntityState.Deleted:EntityState.Modified;Assert.Throws<InvalidOperationException>(()=>db.SaveChanges());}
    }
    [Fact]public void WorstCaseCompleteInspectionReceiptAndSnapshotStayWithinExistingWireBudgets()
    {
        var photos=Enumerable.Range(0,12).Select(_=>Photo()with{AltFa=new string('<',160),AltEn=new string('آ',160)}).ToArray();
        var condition=Facts()with{NotesFa=new string('<',2000),NotesEn=new string('آ',2000),Photos=photos};UsedItemConditionRules.Validate(condition);
        var result=new UsedItemResult(1,false,new UsedItemDetail(1,new('v',64),new('p',64),new('S',80),"AAAAAAAAAAE=",condition));
        var wire=JsonSerializer.Serialize(result,new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert.InRange(System.Text.Encoding.UTF8.GetByteCount(wire),16001,65536);
        Assert.True(System.Text.Encoding.Unicode.GetByteCount(wire)<=131072);
        var parsed=JsonSerializer.Deserialize<UsedItemResult>(wire,new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        Assert.Equal(condition.NotesFa,parsed.Detail.Inspection!.NotesFa);Assert.Equal(12,parsed.Detail.Inspection.Photos!.Length);
        var snapshot=JsonSerializer.Serialize(new{Lines=new[]{new{VariantId="V",ProductId="P",UsedCondition=condition}}},new JsonSerializerOptions{NumberHandling=JsonNumberHandling.WriteAsString});
        Assert.True(System.Text.Encoding.UTF8.GetByteCount(snapshot)<524288);Assert.True(System.Text.Encoding.Unicode.GetByteCount(snapshot)<1048576);
        Assert.Equal(12,UsedOrderConditionSnapshots.Read(snapshot,[("v","v","p")])["v"].Photos!.Length);
    }
}
