using Shop.Modules.Payments;
using Shop.SharedKernel;
using Xunit;
namespace Shop.Tests;
public sealed class CashGatewayTests
{
    // Test assembly only; there is no gateway success substitute in the product.
    private sealed class TestGateway(bool configured=true,bool idempotent=true):ICashPaymentGateway
    {
        public string ProviderKey=>"synthetic";public string AccountKey=>"test";public bool IsConfigured=>configured;public bool SupportsIdempotentInitiation=>idempotent;public IReadOnlySet<string> AllowedRedirectHosts=>new HashSet<string>{"gateway.example.test"};
        public Task<CashGatewayStarted> StartAsync(CashGatewayStart request,CancellationToken ct)=>throw new NotSupportedException();public Task<CashGatewayVerified> VerifyAsync(CashGatewayVerify request,CancellationToken ct)=>throw new NotSupportedException();
    }
    [Fact]public void EmptyOrUnconfiguredRegistryNeverEnablesPaymentAndClientsCannotSupplyProviderUrls()
    {
        Assert.False(new CashGatewayRegistry([]).AnyConfigured);Assert.Null(new CashGatewayRegistry([]).Resolve("synthetic","test"));var disabled=new CashGatewayRegistry([new TestGateway(false)]);Assert.False(disabled.AnyConfigured);Assert.Null(disabled.Resolve("synthetic","test"));Assert.Null(disabled.Resolve("https://other.test","test"));
        var verifyOnly=new CashGatewayRegistry([new TestGateway(idempotent:false)]);Assert.False(verifyOnly.AnyConfigured);Assert.Null(verifyOnly.Resolve("synthetic","test"));Assert.NotNull(verifyOnly.Resolve("synthetic","test",forInitiation:false));Assert.Throws<InvalidOperationException>(()=>new CashGatewayRegistry([new TestGateway(),new TestGateway()]));
    }
    [Theory][InlineData("http://gateway.example.test/pay")][InlineData("https://evil.example.test/pay")][InlineData("https://secret@gateway.example.test/pay")][InlineData("https://gateway.example.test/pay#secret")]
    public void RedirectMustUseTheConfiguredGatewayHttpsHostWithoutCredentialsOrFragment(string uri)=>Assert.Throws<BusinessException>(()=>CashGatewayRules.Started(new("pending","opaque",new(uri)),new TestGateway()));
    [Fact]public void InitiationCannotReportPaymentSuccessAndUnknownCannotInventAnAuthority()
    {
        Assert.Throws<BusinessException>(()=>CashGatewayRules.Started(new("succeeded","opaque",new("https://gateway.example.test/pay")),new TestGateway()));Assert.Throws<BusinessException>(()=>CashGatewayRules.Started(new("unknown","opaque",null),new TestGateway()));Assert.Equal("pending",CashGatewayRules.Started(new("pending","opaque",new("https://gateway.example.test/pay")),new TestGateway()).State);
    }
    [Fact]public void VerificationRequiresTheOriginalAuthorityExactCurrencyAndPositiveServerAmountAboveJavascriptRange()
    {
        var value=new CashGatewayVerified("succeeded","opaque",9007199254740993,"IRR","reference");Assert.Equal(9007199254740993,CashGatewayRules.Verified(value,"opaque").AmountRial);
        foreach(var invalid in new[]{value with{Authority="other"},value with{Currency="IRT"},value with{AmountRial=0},value with{Reference=null},value with{State="unknown"}})Assert.Throws<BusinessException>(()=>CashGatewayRules.Verified(invalid,"opaque"));Assert.NotEqual(CashGatewayRules.EvidenceHash("REF",200),CashGatewayRules.EvidenceHash("ref",200));
    }
}
