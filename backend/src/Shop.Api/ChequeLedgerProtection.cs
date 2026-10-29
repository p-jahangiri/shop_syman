using Microsoft.AspNetCore.DataProtection;
using System.Security.Cryptography;
using System.Text;
using Shop.Modules.Credit;
public sealed class DataProtectionChequeLedgerProtection(IDataProtectionProvider provider):IChequeLedgerProtection
{
    private IDataProtector Protector(string purpose,string principal,string orderId,string id)
    {
        if(purpose is not("registration" or "event" or "receipt"))throw ChequeLedgerRules.Unavailable();
        principal=CreditApplicationRules.Actor(principal);CreditApplicationRules.Id(orderId);CreditApplicationRules.Id(id);
        var hash=Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(principal)));
        return provider.CreateProtector("Sayman.Credit.PrivateChequeLedger.v1",purpose,hash,orderId,id);
    }
    public byte[] Protect(string purpose,string principal,string orderId,string id,string text)
    {
        var raw=new UTF8Encoding(false,true).GetBytes(text);try{
            var max=purpose=="receipt"?12000:6000;if(raw.Length is <1||raw.Length>max)throw ChequeLedgerRules.Unavailable();
            var value=Protector(purpose,principal,orderId,id).Protect(raw);if(value.Length>(purpose=="receipt"?16384:8192))throw ChequeLedgerRules.Unavailable();return value;
        }finally{CryptographicOperations.ZeroMemory(raw);}
    }
    public string Unprotect(string purpose,string principal,string orderId,string id,byte[] value)
    {
        byte[]? raw=null;try{
            if(value is null||value.Length<1||value.Length>(purpose=="receipt"?16384:8192))throw ChequeLedgerRules.Unavailable();
            raw=Protector(purpose,principal,orderId,id).Unprotect(value);
            if(raw.Length<1||raw.Length>(purpose=="receipt"?12000:6000))throw ChequeLedgerRules.Unavailable();return new UTF8Encoding(false,true).GetString(raw);
        }catch(Exception e)when(e is CryptographicException or DecoderFallbackException or ArgumentException){throw ChequeLedgerRules.Unavailable();}
        finally{if(raw is not null)CryptographicOperations.ZeroMemory(raw);}
    }
}
