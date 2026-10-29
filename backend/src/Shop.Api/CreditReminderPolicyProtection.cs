using Microsoft.AspNetCore.DataProtection;
using System.Security.Cryptography;
using System.Text;
using Shop.Modules.Credit;
public sealed class DataProtectionCreditReminderPolicyProtection(IDataProtectionProvider provider):ICreditReminderPolicyProtection
{
    private IDataProtector Protector(string purpose,string principal,string id)
    {
        if(purpose is not("revision"or"receipt"))throw CreditReminderPolicyRules.Unavailable();principal=CreditApplicationRules.Actor(principal);CreditApplicationRules.Id(id);return provider.CreateProtector("Sayman.Credit.PrivateReminderPolicy.v1",purpose,CreditApplicationRules.Hash(principal),id);
    }
    public byte[] Protect(string purpose,string principal,string id,string text)
    {
        var raw=new UTF8Encoding(false,true).GetBytes(text);try{if(raw.Length<1||raw.Length>(purpose=="revision"?7000:14000))throw CreditReminderPolicyRules.Unavailable();var data=Protector(purpose,principal,id).Protect(raw);if(data.Length>(purpose=="revision"?8192:16384))throw CreditReminderPolicyRules.Unavailable();return data;}finally{CryptographicOperations.ZeroMemory(raw);}
    }
    public string Unprotect(string purpose,string principal,string id,byte[] data)
    {
        byte[]? raw=null;try{if(data.Length<1||data.Length>(purpose=="revision"?8192:16384))throw CreditReminderPolicyRules.Unavailable();raw=Protector(purpose,principal,id).Unprotect(data);if(raw.Length<1||raw.Length>(purpose=="revision"?7000:14000))throw CreditReminderPolicyRules.Unavailable();return new UTF8Encoding(false,true).GetString(raw);}catch(Exception e)when(e is CryptographicException or DecoderFallbackException or ArgumentException){throw CreditReminderPolicyRules.Unavailable();}finally{if(raw is not null)CryptographicOperations.ZeroMemory(raw);}
    }
}
