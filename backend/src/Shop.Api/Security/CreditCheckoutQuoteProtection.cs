using Microsoft.AspNetCore.DataProtection;
using System.Security.Cryptography;
using System.Text;
using Shop.Modules.Sales;
public sealed class DataProtectionCreditCheckoutQuoteProtection(IDataProtectionProvider provider):ICreditCheckoutQuoteProtection
{
    private IDataProtector Protector(string owner,string id){CreditCheckoutQuoteRules.Owner(owner);CreditCheckoutQuoteRules.Id(id);var digest=Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(owner)));return provider.CreateProtector("Sayman.Sales.PrivateCreditQuote.v1",digest,id);}
    public byte[] Protect(string owner,string quoteId,string text)
    {
        var bytes=new UTF8Encoding(false,true).GetBytes(text);try{if(bytes.Length is <1 or >1048576)throw CreditCheckoutQuoteRules.Unavailable();var encrypted=Protector(owner,quoteId).Protect(bytes);if(encrypted.Length>1572864)throw CreditCheckoutQuoteRules.Unavailable();return encrypted;}finally{CryptographicOperations.ZeroMemory(bytes);}
    }
    public string Unprotect(string owner,string quoteId,byte[] bytes)
    {
        byte[]? raw=null;try{if(bytes is null||bytes.Length is <1 or >1572864)throw CreditCheckoutQuoteRules.Unavailable();raw=Protector(owner,quoteId).Unprotect(bytes);if(raw.Length is <1 or >1048576)throw CreditCheckoutQuoteRules.Unavailable();return new UTF8Encoding(false,true).GetString(raw);}catch(Exception e)when(e is CryptographicException or DecoderFallbackException or ArgumentException){throw CreditCheckoutQuoteRules.Unavailable();}finally{if(raw is not null)CryptographicOperations.ZeroMemory(raw);}
    }
}
