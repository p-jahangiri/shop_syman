using Shop.Modules.Market;
using Shop.SharedKernel;
using Xunit;
namespace Shop.Tests;
public sealed class MarketAttributeRulesTests
{
    [Theory]
    [InlineData("99999999999999999999.12345678")]
    [InlineData("0.00000001")]
    [InlineData("۰")]
    [InlineData("-۱۲.۵")]
    public void NumbersRetainDecimalPrecisionAndNormalizePersianDigits(string value)=>Assert.IsType<decimal>(MarketAttributeRules.Number(value));
    [Theory]
    [InlineData("100000000000000000000")]
    [InlineData("0.000000001")]
    [InlineData("1e3")]
    [InlineData("NaN")]
    public void UnsupportedNumericRepresentationsFailClosed(string value)=>Assert.Equal("invalid_market_attribute",Assert.Throws<BusinessException>(()=>MarketAttributeRules.Number(value)).Code);
    [Fact]public void CategoryDistinctKeysAndBoundedValuesAreRequired()
    {
        var selection=new MarketAttributeSelection("memory",["0"]);MarketAttributeRules.Validate(new(CategoryId:"phones",Attributes:[selection]));
        foreach(var value in new[]{new MarketSearchInput(Attributes:[selection]),new(CategoryId:"phones",Attributes:[selection,selection]),new(CategoryId:"phones",Attributes:[new("memory",["0","0"])]),new(CategoryId:"phones",Attributes:[new("memory",["bad\0value"])])})Assert.Throws<BusinessException>(()=>MarketAttributeRules.Validate(value));
    }
}
