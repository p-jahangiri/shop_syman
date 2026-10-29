using System.Text.Json;
using Shop.Modules.Market;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;
public sealed class MarketRulesTests
{
    private static readonly DateTimeOffset Now=DateTimeOffset.Parse("2026-10-23T12:00:00Z");
    private static MarketListingInput Input()=>new("model-a",new("Draft","manual","MODEL-A","ورود دستی نمونه","Sample manual entry",null,"unknown",null,null,null,true),null);
    [Fact] public void UnknownMeansNoInventoryOrPriceClaimAndDemoFailsClosedOutsideDevelopment()
    {
        Assert.Null(MarketRules.Validate(Input(),true,Now));
        Assert.Equal("unknown",MarketRules.EffectiveAvailability("unknown",null,Now));
        Assert.Throws<BusinessException>(()=>MarketRules.Validate(Input(),false,Now));
    }
    [Fact] public void ReferencePriceStaysExactAndObservationExpiresAtBoundary()
    {
        var value=Input() with{Details=Input().Details with{Availability="available",ObservedAt=Now.AddHours(-1),ValidUntil=Now.AddHours(1),ReferencePriceRial=long.MaxValue.ToString()}};
        Assert.Equal(long.MaxValue,MarketRules.Validate(value,true,Now));
        Assert.Equal("available",MarketRules.EffectiveAvailability("available",Now.AddSeconds(1),Now));
        Assert.Equal("stale",MarketRules.EffectiveAvailability("available",Now,Now));
        Assert.Equal("stale",MarketRules.EffectiveAvailability("unavailable",Now.AddDays(-1),Now));
    }
    [Theory]
    [InlineData("0")][InlineData("-1")][InlineData("1.5")][InlineData("1e3")][InlineData("9223372036854775808")][InlineData("۱۲۳")]
    public void ReferencePriceRejectsInvalidMoney(string price)=>Assert.Throws<BusinessException>(()=>MarketRules.Validate(Input() with{Details=Input().Details with{ObservedAt=Now.AddHours(-1),ValidUntil=Now.AddHours(1),ReferencePriceRial=price}},true,Now));
    [Fact] public void KnownAvailabilityAndPricesRequireDatedSourceEvidence()
    {
        var d=Input().Details;
        foreach(var invalid in new[]{d with{Availability="available"},d with{ReferencePriceRial="1"},d with{ObservedAt=Now},d with{ValidUntil=Now},d with{ObservedAt=Now,ValidUntil=Now},d with{ObservedAt=Now.AddSeconds(1),ValidUntil=Now.AddHours(1)}})
            Assert.Throws<BusinessException>(()=>MarketRules.Validate(Input() with{Details=invalid},true,Now));
    }
    [Theory]
    [InlineData("https://u:p@source.test/model")][InlineData("https://source.test/model?token=secret")][InlineData("https://source.test/model#secret")][InlineData("http://source.test/model")][InlineData("//source.test/model")][InlineData("https://source.test\\model")]
    public void SourceLinksExcludeCredentialsQueriesAndUntrustedSchemes(string url)=>Assert.Throws<BusinessException>(()=>MarketRules.Validate(Input() with{Details=Input().Details with{SourceUrl=url}},true,Now));
    [Fact] public void SearchNormalizesPersianAndBoundsThePage()
    {
        Assert.Equal("گوشی 12",MarketRules.Search(new("گوشي ۱۲")));
        foreach(var invalid in new[]{new MarketSearchInput(Page:0),new MarketSearchInput(PageSize:25),new MarketSearchInput(CategoryId:"../private"),new MarketSearchInput(Query:new string('a',121))})Assert.Throws<BusinessException>(()=>MarketRules.Search(invalid));
    }
    [Fact] public void InputsRejectUnknownFinancialAndPublicationFields()
    {
        var options=new JsonSerializerOptions(JsonSerializerDefaults.Web);
        Assert.Throws<JsonException>(()=>JsonSerializer.Deserialize<MarketSearchInput>("{\"payableTotalRial\":\"1\"}",options));
        Assert.Throws<JsonException>(()=>JsonSerializer.Deserialize<MarketListingInput>("{\"modelId\":\"m\",\"stock\":1}",options));
    }
}
