using Shop.Modules.Reviews;
using Shop.SharedKernel;
using Xunit;
namespace Shop.Tests;
public sealed class ReviewRulesTests
{
    private static SaveReviewInput Input()=>new(null,"fa",5,"نام عمومی","تجربهٔ من","متن دیدگاه واقعی برای آزمون",true);
    [Theory][InlineData(0)][InlineData(6)][InlineData(int.MaxValue)]
    public void RatingMustBeOneToFive(int rating)=>Assert.Throws<BusinessException>(()=>ReviewRules.Validate(Input() with{Rating=rating}));
    [Fact]public void ConsentAndSupportedOriginalLanguageAreRequired(){Assert.Throws<BusinessException>(()=>ReviewRules.Validate(Input() with{PublishConsent=false}));Assert.Throws<BusinessException>(()=>ReviewRules.Validate(Input() with{Locale="de"}));}
    [Theory][InlineData("\u202ehidden")][InlineData("\u0000data")][InlineData("\u2066isolate")]
    public void RejectControlAndDirectionOverrides(string value)=>Assert.Throws<BusinessException>(()=>ReviewRules.Validate(Input() with{DisplayName=value}));
    [Fact]public void PlainTextAndPersianJoinersArePreserved(){var value=ReviewRules.Validate(Input() with{Body="  <script>alert(1)</script> می‌ماند  "});Assert.Equal("<script>alert(1)</script> می‌ماند",value.Body);}
    [Theory][InlineData("0")][InlineData("-1")][InlineData("01")][InlineData("9223372036854775808")][InlineData("۱")]
    public void PagingRejectsMalformedOrOverflowCursor(string cursor)=>Assert.Throws<BusinessException>(()=>ReviewRules.Cursor(cursor));
    [Fact]public void PagingAndVersionPreserveBoundaries(){Assert.Equal(long.MaxValue,ReviewRules.Cursor("9223372036854775807"));ReviewRules.Version("AAAAAAAAAAE=");Assert.Throws<BusinessException>(()=>ReviewRules.Version("AA=="));}
}
