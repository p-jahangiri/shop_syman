using Shop.SharedKernel;
namespace Shop.Modules.Payments;

// Empty by default. Configuration selects an explicitly registered adapter;
// arbitrary provider names/URLs supplied by a client cannot create an adapter.
public sealed class CashGatewayRegistry
{
    private readonly Dictionary<string,ICashPaymentGateway> gateways;
    public CashGatewayRegistry(IEnumerable<ICashPaymentGateway> registered)
    {
        gateways=new(StringComparer.Ordinal);
        foreach(var gateway in registered){
            if(gateway.AllowedRedirectHosts is null || gateway.AllowedRedirectHosts.Any(h=>h!=h.ToLowerInvariant()||Uri.CheckHostName(h)!=UriHostNameType.Dns)
                || gateway.IsConfigured&&gateway.SupportsIdempotentInitiation&&gateway.AllowedRedirectHosts.Count==0)
                throw new InvalidOperationException("Configured payment initiation requires canonical explicit gateway redirect hosts.");
            if(!CashPaymentProofRules.Key(gateway.ProviderKey,40)||!CashPaymentProofRules.Key(gateway.AccountKey,64)
                ||gateway.ProviderKey!=gateway.ProviderKey.ToLowerInvariant()||gateway.AccountKey!=gateway.AccountKey.ToLowerInvariant()
                ||!gateways.TryAdd(gateway.ProviderKey+":"+gateway.AccountKey,gateway))
                throw new InvalidOperationException("Payment gateways require unique canonical provider/account identities.");
        }
    }
    public ICashPaymentGateway? Resolve(string provider,string account,bool forInitiation=true)
    {
        if(!CashPaymentProofRules.Key(provider,40)||!CashPaymentProofRules.Key(account,64))return null;
        return gateways.TryGetValue(provider+":"+account,out var value)&&value.IsConfigured&&(!forInitiation||value.SupportsIdempotentInitiation)?value:null;
    }
    public bool AnyConfigured=>gateways.Values.Any(g=>g.IsConfigured&&g.SupportsIdempotentInitiation);
}
