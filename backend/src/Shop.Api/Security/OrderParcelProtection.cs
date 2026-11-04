using Microsoft.AspNetCore.DataProtection;
using System.Security.Cryptography;
using System.Text;
using Shop.Modules.Sales;

public sealed class DataProtectionOrderParcelProtection(IDataProtectionProvider provider):IOrderParcelProtection
{
    private IDataProtector Protector(string actor,string order,string command)=>provider.CreateProtector("Sayman.Sales.PrivateParcelReceipt.v1",Shop.Modules.Sales.OrderInputRules.Identifier(actor).ToUpperInvariant(),ShipmentRules.Uuid(order),ShipmentRules.Uuid(command));
    public byte[] Protect(string actor,string order,string command,string text)
    {
        var raw=new UTF8Encoding(false,true).GetBytes(text);try{if(raw.Length is<1 or>ParcelRules.MaxReceiptBytes)throw ParcelRules.Unavailable();var bytes=Protector(actor,order,command).Protect(raw);if(bytes.Length>8388608)throw ParcelRules.Unavailable();return bytes;}finally{CryptographicOperations.ZeroMemory(raw);}
    }
    public string Unprotect(string actor,string order,string command,byte[] bytes)
    {
        byte[]? raw=null;try{if(bytes.Length is<1 or>8388608)throw ParcelRules.Unavailable();raw=Protector(actor,order,command).Unprotect(bytes);if(raw.Length is<1 or>ParcelRules.MaxReceiptBytes)throw ParcelRules.Unavailable();return new UTF8Encoding(false,true).GetString(raw);}catch(Exception e)when(e is CryptographicException or ArgumentException or DecoderFallbackException){throw ParcelRules.Unavailable();}finally{if(raw is not null)CryptographicOperations.ZeroMemory(raw);}
    }
}
