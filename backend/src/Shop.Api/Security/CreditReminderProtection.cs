using Microsoft.AspNetCore.DataProtection;
using System.Security.Cryptography;
using System.Text;
using Shop.Modules.Credit;
using Shop.Modules.Notifications;
public sealed class DataProtectionCreditReminderProtection(IDataProtectionProvider provider):ICreditReminderProtection
{
    private IDataProtector Protector(string purpose,string principal,string order,string id)
    {
        if(purpose is not("event"or"receipt"))throw CreditReminderRules.Unavailable();principal=CreditApplicationRules.Actor(principal);CreditApplicationRules.Id(order);CreditApplicationRules.Id(id);return provider.CreateProtector("Sayman.Credit.PrivateChequeReminder.v1",purpose,CreditApplicationRules.Hash(principal),order,id);
    }
    public byte[] Protect(string purpose,string principal,string order,string id,string text)
    {
        var raw=new UTF8Encoding(false,true).GetBytes(text);try{if(raw.Length<1||raw.Length>(purpose=="event"?7000:14000))throw CreditReminderRules.Unavailable();var bytes=Protector(purpose,principal,order,id).Protect(raw);if(bytes.Length>(purpose=="event"?8192:16384))throw CreditReminderRules.Unavailable();return bytes;}finally{CryptographicOperations.ZeroMemory(raw);}
    }
    public string Unprotect(string purpose,string principal,string order,string id,byte[] data)
    {
        byte[]? raw=null;try{if(data.Length<1||data.Length>(purpose=="event"?8192:16384))throw CreditReminderRules.Unavailable();raw=Protector(purpose,principal,order,id).Unprotect(data);if(raw.Length<1||raw.Length>(purpose=="event"?7000:14000))throw CreditReminderRules.Unavailable();return new UTF8Encoding(false,true).GetString(raw);}catch(Exception e)when(e is CryptographicException or DecoderFallbackException or ArgumentException){throw CreditReminderRules.Unavailable();}finally{if(raw is not null)CryptographicOperations.ZeroMemory(raw);}
    }
}
public sealed class DataProtectionCreditInboxProtection(IDataProtectionProvider provider):ICreditInboxProtection
{
    private IDataProtector Protector(string owner,string id){NotificationRules.Id(id);return provider.CreateProtector("Sayman.Notifications.PrivateCreditReminder.v1",NotificationRules.Owner(owner),id);}
    public byte[] Protect(string owner,string id,string text)
    {
        var raw=new UTF8Encoding(false,true).GetBytes(text);try{if(raw.Length is<1 or>4096)throw NotificationRules.Unavailable();var bytes=Protector(owner,id).Protect(raw);if(bytes.Length>8192)throw NotificationRules.Unavailable();return bytes;}finally{CryptographicOperations.ZeroMemory(raw);}
    }
    public string Unprotect(string owner,string id,byte[] data)
    {
        byte[]? raw=null;try{if(data.Length is<1 or>8192)throw NotificationRules.Unavailable();raw=Protector(owner,id).Unprotect(data);if(raw.Length is<1 or>4096)throw NotificationRules.Unavailable();return new UTF8Encoding(false,true).GetString(raw);}catch(Exception e)when(e is CryptographicException or DecoderFallbackException or ArgumentException){throw NotificationRules.Unavailable();}finally{if(raw is not null)CryptographicOperations.ZeroMemory(raw);}
    }
}
