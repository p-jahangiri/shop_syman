using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.WebUtilities;
using System.Security.Cryptography;
using System.Text;
using Shop.Modules.Credit;
public sealed class DataProtectionChequeReportCursorProtection(IDataProtectionProvider provider):IChequeReportCursorProtection
{
    private IDataProtector Protector(string actor)=>provider.CreateProtector("Sayman.Credit.ChequeReportCursor.v1",CreditApplicationRules.Hash(CreditApplicationRules.Actor(actor)));
    public string Protect(string actor,string text)
    {
        var raw=new UTF8Encoding(false,true).GetBytes(text);try{if(raw.Length is<1 or>1024)throw ChequeReportRules.Invalid();var token=WebEncoders.Base64UrlEncode(Protector(actor).Protect(raw));if(token.Length>2048)throw ChequeReportRules.Invalid();return token;}finally{CryptographicOperations.ZeroMemory(raw);}
    }
    public string Unprotect(string actor,string cursor)
    {
        byte[]? raw=null;try{if(cursor is null||cursor.Length is<1 or>2048||cursor.Any(c=>!char.IsAsciiLetterOrDigit(c)&&c!='-'&&c!='_'))throw ChequeReportRules.Invalid();var bytes=WebEncoders.Base64UrlDecode(cursor);if(WebEncoders.Base64UrlEncode(bytes)!=cursor)throw ChequeReportRules.Invalid();raw=Protector(actor).Unprotect(bytes);if(raw.Length is<1 or>1024)throw ChequeReportRules.Invalid();return new UTF8Encoding(false,true).GetString(raw);}catch(Exception e)when(e is CryptographicException or DecoderFallbackException or ArgumentException or FormatException){throw ChequeReportRules.Invalid();}finally{if(raw is not null)CryptographicOperations.ZeroMemory(raw);}
    }
}
