using Microsoft.AspNetCore.DataProtection;
using System.Security.Cryptography;
using System.Text;
using Shop.Modules.Sales;

public sealed class DataProtectionDigitalDeliveryProtection(IDataProtectionProvider provider):IDigitalDeliveryProtection
{
    private static int Limit(string purpose)=>purpose switch{"content"=>16384,"manifest"or"receipt"=>131072,_=>throw DigitalDeliveryRules.Unavailable()};
    private IDataProtector Protector(string purpose,string owner,string order,string id)=>provider.CreateProtector("Sayman.Sales.PrivateDigitalDelivery.v1",purpose,OrderInputRules.Identifier(owner).ToUpperInvariant(),ShipmentRules.Uuid(order),ShipmentRules.Uuid(id));
    public byte[] Protect(string purpose,string owner,string order,string id,string text)
    {
        var limit=Limit(purpose);byte[]? raw=null;
        try{raw=new UTF8Encoding(false,true).GetBytes(text);if(raw.Length is<1||raw.Length>limit)throw Capacity();var result=Protector(purpose,owner,order,id).Protect(raw);if(result.Length>limit)throw Capacity();return result;}
        catch(EncoderFallbackException){throw DigitalDeliveryRules.Invalid();}
        finally{if(raw is not null)CryptographicOperations.ZeroMemory(raw);}
    }
    public string Unprotect(string purpose,string owner,string order,string id,byte[] bytes)
    {
        byte[]? raw=null;try{var limit=Limit(purpose);if(bytes is null||bytes.Length is<1||bytes.Length>limit)throw DigitalDeliveryRules.Unavailable();raw=Protector(purpose,owner,order,id).Unprotect(bytes);if(raw.Length is<1||raw.Length>limit)throw DigitalDeliveryRules.Unavailable();return new UTF8Encoding(false,true).GetString(raw);}
        catch(Exception e)when(e is CryptographicException or ArgumentException or DecoderFallbackException){throw DigitalDeliveryRules.Unavailable();}
        finally{if(raw is not null)CryptographicOperations.ZeroMemory(raw);}
    }
    private static Shop.SharedKernel.BusinessException Capacity()=>new("digital_delivery_capacity_conflict","The complete encrypted delivery exceeds this workflow's supported size. Use fewer units without truncating their content.");
}
