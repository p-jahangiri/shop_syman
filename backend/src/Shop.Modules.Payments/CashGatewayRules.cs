using System.Security.Cryptography;
using System.Text;
using Shop.SharedKernel;
namespace Shop.Modules.Payments;
public static class CashGatewayRules
{
    public static string Evidence(string value,int max)
    {
        if(string.IsNullOrWhiteSpace(value)||value.Length>max||value!=value.Trim()||value.Any(char.IsControl))throw Invalid();return value;
    }
    public static string EvidenceHash(string value,int max)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Evidence(value,max))));
    public static CashGatewayStarted Started(CashGatewayStarted value,ICashPaymentGateway gateway)
    {
        if(value is null||value.State is not("pending" or "unknown" or "failed" or "cancelled"))throw Invalid();
        if(value.State!="pending"){if(value.Authority is not null||value.RedirectUri is not null)throw Invalid();return value;}
        _=Evidence(value.Authority!,512);var uri=value.RedirectUri;
        if(uri is null||!uri.IsAbsoluteUri||uri.Scheme!="https"||uri.UserInfo.Length!=0||uri.Fragment.Length!=0||uri.AbsoluteUri.Length>2048||!gateway.AllowedRedirectHosts.Contains(uri.IdnHost.ToLowerInvariant()))throw Invalid();return value;
    }
    public static CashGatewayVerified Verified(CashGatewayVerified value,string expectedAuthority)
    {
        _=Evidence(expectedAuthority,512);
        if(value is null||value.State is not("succeeded" or "pending" or "unknown" or "failed" or "cancelled"))throw Invalid();
        if(value.Authority is not null&&value.Authority!=expectedAuthority)throw Invalid();
        if(value.State!="succeeded"){if(value.AmountRial is not null||value.Currency is not null||value.Reference is not null)throw Invalid();return value;}
        if(value.Authority!=expectedAuthority||value.AmountRial is null or <=0||value.Currency!="IRR")throw Invalid();_=Evidence(value.Reference!,200);return value;
    }
    private static BusinessException Invalid()=>new("gateway_response_unavailable","The gateway did not return a complete, bounded, authority-bound response.");
}
