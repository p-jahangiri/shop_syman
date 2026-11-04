using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.DataProtection;
using Shop.Modules.Payments;
using Shop.SharedKernel;

public sealed class DataProtectionPaymentAuthorityProtection(IDataProtectionProvider provider):IPaymentAuthorityProtection
{
    private IDataProtector Protector(string attempt)=>provider.CreateProtector("Sayman.Payments.CashAuthority.v1",CashPaymentProofRules.Id(attempt));
    public byte[] Protect(string attemptId,string value)
    {
        value=CashGatewayRules.Evidence(value,512);var result=Protector(attemptId).Protect(Encoding.UTF8.GetBytes(value));if(result.Length>4096)throw Unavailable();return result;
    }
    public string Unprotect(string attemptId,byte[] value)
    {
        try{if(value is null||value.Length is <1 or >4096)throw Unavailable();return CashGatewayRules.Evidence(new UTF8Encoding(false,true).GetString(Protector(attemptId).Unprotect(value)),512);}
        catch(Exception e)when(e is CryptographicException or DecoderFallbackException or ArgumentException){throw Unavailable();}
    }
    private static BusinessException Unavailable()=>new("payment_authority_unavailable","The original gateway authority cannot be recovered safely.");
}
