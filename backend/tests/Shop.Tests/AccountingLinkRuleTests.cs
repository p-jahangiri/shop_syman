using Shop.SharedKernel;
using Xunit;
namespace Shop.Tests;
public sealed class AccountingLinkRuleTests
{
    [Fact] public void OpaqueCompanyAndItemKeysKeepLeadingZeroesCaseAndDigitScript(){Assert.Equal("00012",AccountingLinkRules.Key("00012",120));Assert.Equal("aB-۱۲",AccountingLinkRules.Key("aB-۱۲",120));}
    [Theory][InlineData("")][InlineData(" leading")][InlineData("trailing ")][InlineData("line\nbreak")]
    public void InvalidKeysAreRejectedWithoutSilentlyChangingIdentity(string key)=>Assert.Throws<BusinessException>(()=>AccountingLinkRules.Key(key,120));
    [Fact] public void KeysAreBoundedAndLinkIdIsAnExplicitNonzeroGuid(){Assert.Throws<BusinessException>(()=>AccountingLinkRules.Key(new string('x',121),120));Assert.Throws<BusinessException>(()=>AccountingLinkRules.Id(new string('0',32)));var id=Guid.NewGuid().ToString("N");Assert.Equal(id,AccountingLinkRules.Id(id.ToUpperInvariant()));}
}
