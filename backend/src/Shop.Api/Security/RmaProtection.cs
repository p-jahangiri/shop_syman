using Microsoft.AspNetCore.DataProtection;
using System.Security.Cryptography;
using System.Text;
using Shop.Modules.Sales;
using Shop.SharedKernel;

public sealed class DataProtectionRmaProtection(IDataProtectionProvider provider):IRmaProtection
{
    private static int Limit(string purpose)=>purpose switch{
        "policyNote"=>16384,"request"=>32768,"event"=>65536,"line"=>131072,
        "receipt" or "policyReceipt"=>RmaRules.MaxProtectedBytes,_=>throw RmaRules.Unavailable()};
    private IDataProtector Protector(string purpose,string principal,string id)
    {
        try{
            _=Limit(purpose);principal=RmaRules.Actor(principal);
            if(purpose is "line" or "event"){
                var pieces=id.Split(':');if(pieces.Length!=2)throw RmaRules.Unavailable();RmaRules.Id(pieces[0]);
                if(purpose=="line")ShipmentRules.Fingerprint(pieces[1]);
                else if(pieces[1] is not("submitted"or"startReview"or"completeReview"or"withdrawn"))throw RmaRules.Unavailable();
            }else RmaRules.Id(id);
            return provider.CreateProtector("Sayman.Sales.PrivateReturns.v1",purpose,RmaRules.Hash(principal),id);
        }catch(BusinessException){throw RmaRules.Unavailable();}
    }
    public byte[] Protect(string purpose,string principal,string id,string text)
    {
        byte[]? raw=null;
        try{var limit=Limit(purpose);raw=new UTF8Encoding(false,true).GetBytes(text);if(raw.Length<1||raw.Length>limit-1024)throw RmaRules.Unavailable();
            var bytes=Protector(purpose,principal,id).Protect(raw);if(bytes.Length>limit)throw RmaRules.Unavailable();return bytes;
        }catch(Exception e)when(e is CryptographicException or ArgumentException or EncoderFallbackException){throw RmaRules.Unavailable();}
        finally{if(raw is not null)CryptographicOperations.ZeroMemory(raw);}
    }
    public string Unprotect(string purpose,string principal,string id,byte[] value)
    {
        byte[]? raw=null;
        try{var limit=Limit(purpose);if(value.Length<1||value.Length>limit)throw RmaRules.Unavailable();raw=Protector(purpose,principal,id).Unprotect(value);
            if(raw.Length<1||raw.Length>limit-1024)throw RmaRules.Unavailable();return new UTF8Encoding(false,true).GetString(raw);
        }catch(Exception e)when(e is CryptographicException or ArgumentException or DecoderFallbackException){throw RmaRules.Unavailable();}
        finally{if(raw is not null)CryptographicOperations.ZeroMemory(raw);}
    }
}
