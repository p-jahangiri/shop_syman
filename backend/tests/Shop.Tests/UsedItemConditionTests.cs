using System.Text.Json;
using System.Text.Json.Serialization;
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
}
