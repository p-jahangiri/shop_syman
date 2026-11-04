using Microsoft.AspNetCore.DataProtection;
using System.Security.Cryptography;
using System.Text;
using Shop.Modules.Credit;
public sealed class DataProtectionCreditClearanceProtection(IDataProtectionProvider provider):ICreditClearanceProtection
{
    private IDataProtector Protector(string purpose,string principal,string order,string id)
    {
        if(purpose is not("event"or"receipt"))throw CreditClearanceRules.Unavailable();principal=CreditApplicationRules.Actor(principal);CreditApplicationRules.Id(order);CreditApplicationRules.Id(id);return provider.CreateProtector("Sayman.Credit.PrivateFinancialClearance.v1",purpose,CreditApplicationRules.Hash(principal),order,id);
    }
    public byte[] Protect(string purpose,string principal,string order,string id,string text)
    {
        var raw=new UTF8Encoding(false,true).GetBytes(text);try{if(raw.Length<1||raw.Length>(purpose=="event"?60000:12000))throw CreditClearanceRules.Unavailable();var b=Protector(purpose,principal,order,id).Protect(raw);if(b.Length>(purpose=="event"?65536:16384))throw CreditClearanceRules.Unavailable();return b;}finally{CryptographicOperations.ZeroMemory(raw);}
    }
    public string Unprotect(string purpose,string principal,string order,string id,byte[] bytes)
    {
        byte[]? raw=null;try{if(bytes.Length<1||bytes.Length>(purpose=="event"?65536:16384))throw CreditClearanceRules.Unavailable();raw=Protector(purpose,principal,order,id).Unprotect(bytes);if(raw.Length<1||raw.Length>(purpose=="event"?60000:12000))throw CreditClearanceRules.Unavailable();return new UTF8Encoding(false,true).GetString(raw);}catch(Exception e)when(e is CryptographicException or DecoderFallbackException or ArgumentException){throw CreditClearanceRules.Unavailable();}finally{if(raw is not null)CryptographicOperations.ZeroMemory(raw);}
    }
}
