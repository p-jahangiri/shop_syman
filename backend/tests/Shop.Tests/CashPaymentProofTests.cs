using Shop.SharedKernel;
using Xunit;
namespace Shop.Tests;
public sealed class CashPaymentProofTests
{
    private static VerifiedCashPayment Proof()=>new(new string('a',32),new string('b',32),new string('c',32),"owner","cash",9007199254740993,new string('C',64),"sample","qa",new string('A',64),new string('B',64),DateTimeOffset.UtcNow);
    [Fact]public void InternalVerificationKeepsExactRialAndCanonicalProviderAccountOwnerIdentity()
    {
        var original=Proof();var normalized=CashPaymentProofRules.Normalize(original with{ProviderKey="SAMPLE",AccountKey="QA",VerifiedAt=original.VerifiedAt.ToOffset(TimeSpan.FromHours(3.5))});Assert.Equal(9007199254740993,normalized.AmountRial);Assert.Equal("sample",normalized.ProviderKey);Assert.Equal("qa",normalized.AccountKey);Assert.Equal(TimeSpan.Zero,normalized.VerifiedAt.Offset);Assert.Equal(CashPaymentProofRules.Fingerprint(original),CashPaymentProofRules.Fingerprint(normalized with{OwnerId="OWNER",MethodId="CASH"}));Assert.NotEqual(CashPaymentProofRules.Fingerprint(original),CashPaymentProofRules.Fingerprint(original with{AmountRial=original.AmountRial+1}));
    }
    [Theory][InlineData(0)][InlineData(-1)]public void ZeroOrNegativeAmountIsNotVerifiedCash(long amount)=>Assert.Throws<BusinessException>(()=>CashPaymentProofRules.Normalize(Proof()with{AmountRial=amount}));
    [Fact]public void EveryIdentityAndExternalEvidenceDigestMustBeExplicitAndCanonical()
    {
        var p=Proof();foreach(var invalid in new[]{p with{AttemptId=new string('0',32)},p with{VerificationId=Guid.NewGuid().ToString()},p with{OrderId="other"},p with{OwnerId="owner\n"},p with{ProviderKey="https://sample"},p with{AuthorityHash=new string('a',64)},p with{ReferenceHash=""},p with{VerifiedAt=default}})Assert.Throws<BusinessException>(()=>CashPaymentProofRules.Normalize(invalid));
    }
}
