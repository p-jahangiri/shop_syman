using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.DataProtection;
using Shop.Modules.Credit;
public sealed class DataProtectionCreditApplicationProtection(IDataProtectionProvider provider):ICreditApplicationProtection
{
    private IDataProtector Protector(string id,string kind,string record)
    {
        CreditApplicationRules.Id(id);if(kind is not("plan"or"receipt"or"requirements-receipt"or"consent-receipt"or"document-receipt"or"submission-note"or"submission-receipt"or"review-note"or"review-receipt"or"scope-note"or"scope-receipt")||string.IsNullOrEmpty(record)||record.Length>100)throw CreditApplicationRules.Unavailable();return provider.CreateProtector("Sayman.Credit.PrivateApplication.v1",id,kind,record);
    }
    public byte[] Protect(string id,string kind,string record,string text)
    {
        var raw=new UTF8Encoding(false,true).GetBytes(text);try{if(raw.Length is <1 or >48000)throw CreditApplicationRules.Unavailable();var result=Protector(id,kind,record).Protect(raw);if(result.Length>65536)throw CreditApplicationRules.Unavailable();return result;}finally{CryptographicOperations.ZeroMemory(raw);}
    }
    public string Unprotect(string id,string kind,string record,byte[] bytes)
    {
        byte[]? raw=null;try{if(bytes is null||bytes.Length is <1 or >65536)throw CreditApplicationRules.Unavailable();raw=Protector(id,kind,record).Unprotect(bytes);if(raw.Length is <1 or >48000)throw CreditApplicationRules.Unavailable();return new UTF8Encoding(false,true).GetString(raw);}catch(Exception e)when(e is CryptographicException or DecoderFallbackException or ArgumentException){throw CreditApplicationRules.Unavailable();}finally{if(raw is not null)CryptographicOperations.ZeroMemory(raw);}
    }
}
