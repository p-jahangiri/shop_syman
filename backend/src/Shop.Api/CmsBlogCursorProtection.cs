using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.WebUtilities;
using System.Security.Cryptography;
using System.Text;
using Shop.Modules.Cms;
public sealed class DataProtectionCmsBlogCursorProtection(IDataProtectionProvider provider):ICmsBlogCursorProtection
{
    private IDataProtector For(string locale,string? tag,bool demo){if(locale is not("fa"or"en"))throw CmsBlogPostRules.Invalid();if(tag is not null)CmsBlogPostRules.Slug(tag);return provider.CreateProtector("Sayman.Cms.PublicBlogList.v1",locale,tag??"",demo?"DevelopmentSamples":"PublicOnly");}
    public string Protect(string locale,string? tag,bool demo,string json){var raw=new UTF8Encoding(false,true).GetBytes(json);try{if(raw.Length is<1 or>1024)throw CmsBlogPostRules.Unavailable();var token=WebEncoders.Base64UrlEncode(For(locale,tag,demo).Protect(raw));if(token.Length>2048)throw CmsBlogPostRules.Unavailable();return token;}finally{CryptographicOperations.ZeroMemory(raw);}}
    public string Unprotect(string locale,string? tag,bool demo,string token){byte[]? raw=null;try{if(token is null||token.Length is<1 or>2048||token.Any(c=>!char.IsAsciiLetterOrDigit(c)&&c is not('-'or'_')))throw CmsBlogPostRules.Invalid();raw=For(locale,tag,demo).Unprotect(WebEncoders.Base64UrlDecode(token));if(raw.Length is<1 or>1024)throw CmsBlogPostRules.Invalid();return new UTF8Encoding(false,true).GetString(raw);}catch(Exception e)when(e is CryptographicException or FormatException or DecoderFallbackException or ArgumentException){throw CmsBlogPostRules.Invalid();}finally{if(raw is not null)CryptographicOperations.ZeroMemory(raw);}}
}
