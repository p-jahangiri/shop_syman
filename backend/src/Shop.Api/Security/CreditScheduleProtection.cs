using Microsoft.AspNetCore.DataProtection;
using System.Security.Cryptography;
using System.Text;
using Shop.Modules.Credit;
public sealed class DataProtectionCreditScheduleProtection(IDataProtectionProvider provider):ICreditScheduleProtection
{
    private IDataProtector Protector(string actor,string id,string command){actor=CreditApplicationRules.Actor(actor);CreditApplicationRules.Id(id);CreditApplicationRules.Id(command);var digest=Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(actor)));return provider.CreateProtector("Sayman.Credit.PrivateChequeSchedule.v1",digest,id,command);}
    public byte[] Protect(string actor,string orderId,string commandId,string text)
    {
        var bytes=new UTF8Encoding(false,true).GetBytes(text);try{if(bytes.Length is <1 or >48000)throw CreditScheduleRules.Unavailable();var encrypted=Protector(actor,orderId,commandId).Protect(bytes);if(encrypted.Length>65536)throw CreditScheduleRules.Unavailable();return encrypted;}finally{CryptographicOperations.ZeroMemory(bytes);}
    }
    public string Unprotect(string actor,string orderId,string commandId,byte[] bytes)
    {
        byte[]? raw=null;try{if(bytes is null||bytes.Length is <1 or >65536)throw CreditScheduleRules.Unavailable();raw=Protector(actor,orderId,commandId).Unprotect(bytes);if(raw.Length is <1 or >48000)throw CreditScheduleRules.Unavailable();return new UTF8Encoding(false,true).GetString(raw);}catch(Exception e)when(e is CryptographicException or DecoderFallbackException or ArgumentException){throw CreditScheduleRules.Unavailable();}finally{if(raw is not null)CryptographicOperations.ZeroMemory(raw);}
    }
}
