using Microsoft.AspNetCore.DataProtection;
using System.Security.Cryptography;
using System.Text;
using Shop.Modules.Credit;
public sealed class DataProtectionChequeApprovalProtection(IDataProtectionProvider provider):IChequeApprovalProtection
{
    private IDataProtector Protector(string purpose,string principal,string orderId,string id)
    {
        if(purpose is not("origin" or "event" or "receipt"))throw ChequeApprovalRules.Unavailable();
        principal=CreditApplicationRules.Actor(principal);CreditApplicationRules.Id(orderId);CreditApplicationRules.Id(id);
        var hash=Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(principal)));
        return provider.CreateProtector("Sayman.Credit.PrivateChequeApproval.v1",purpose,hash,orderId,id);
    }
    public byte[] Protect(string purpose,string principal,string orderId,string id,string text)
    {
        var raw=new UTF8Encoding(false,true).GetBytes(text);try{
            var max=purpose=="receipt"?12000:6000;if(raw.Length is <1||raw.Length>max)throw ChequeApprovalRules.Unavailable();
            var value=Protector(purpose,principal,orderId,id).Protect(raw);if(value.Length>(purpose=="receipt"?16384:8192))throw ChequeApprovalRules.Unavailable();return value;
        }finally{CryptographicOperations.ZeroMemory(raw);}
    }
    public string Unprotect(string purpose,string principal,string orderId,string id,byte[] value)
    {
        byte[]? raw=null;try{
            if(value is null||value.Length<1||value.Length>(purpose=="receipt"?16384:8192))throw ChequeApprovalRules.Unavailable();
            raw=Protector(purpose,principal,orderId,id).Unprotect(value);
            if(raw.Length<1||raw.Length>(purpose=="receipt"?12000:6000))throw ChequeApprovalRules.Unavailable();return new UTF8Encoding(false,true).GetString(raw);
        }catch(Exception e)when(e is CryptographicException or DecoderFallbackException or ArgumentException){throw ChequeApprovalRules.Unavailable();}
        finally{if(raw is not null)CryptographicOperations.ZeroMemory(raw);}
    }
}
