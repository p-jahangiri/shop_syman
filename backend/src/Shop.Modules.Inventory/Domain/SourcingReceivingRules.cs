using System.Globalization;
using System.Numerics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Shop.SharedKernel;

namespace Shop.Modules.Inventory;

public static class SourcingReceivingRules
{
    public const int MaxLines=64;
    public const int MaxQuantity=1000000;
    public static string Id(string? value)=>value is {Length:32}&&Guid.TryParseExact(value,"N",out var id)&&id!=Guid.Empty?id.ToString("N"):throw Invalid();
    public static string Actor(string? value)=>Identifier(value).ToUpperInvariant();
    public static string Identifier(string? value)=>value is {Length:>=1 and <=64}&&value.All(c=>char.IsAsciiLetterOrDigit(c)||c is '-' or '_')?value:throw Invalid();
    public static string Key(string? value,int max)=>value is {Length:>0}&&value.Length<=max&&value.Trim()==value&&!value.Any(char.IsControl)?value:throw Invalid();
    public static string Version(string? value)=>SerialRules.Version(value,false)!;
    public static string? OptionalVersion(string? value)=>SerialRules.Version(value);
    public static string Text(string? value,int max)=>value?.Trim() is {Length:>0} text&&text.Length<=max&&!text.Any(c=>char.IsControl(c)&&c is not ('\n' or '\r' or '\t'))?text:throw Invalid();
    public static string Hash<T>(T value)=>Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(value)));
    public static string ExternalLineIdentity(string origin,string company,string warehouse,string receipt,string line)=>Hash(new{Origin=origin,Company=company,Warehouse=warehouse,Receipt=receipt,Line=line});
    public static string MappingIdentity(string origin,string company,string warehouse,string unit,string variant)=>Hash(new{Origin=origin,Company=company,Warehouse=warehouse,Unit=unit,Variant=variant.ToUpperInvariant()});
    public static string SourceQuantity(string? value)
    {
        if(value is not {Length:>=1 and <=29}||value.Any(c=>!char.IsAsciiDigit(c)&&c!='.'))throw Invalid();
        var parts=value.Split('.');if(parts.Length>2||parts[0].Length is <1 or >20||parts[0].Length>1&&parts[0][0]=='0'||parts.Length==2&&(parts[1].Length is <1 or >8||parts[1][^1]=='0')||parts.Sum(p=>p.Length)>28||value.All(c=>c is '0' or '.'))throw Invalid();
        return value;
    }
    public static int ConvertQuantity(string sourceQuantity,int numerator,int denominator)
    {
        SourceQuantity(sourceQuantity);Ratio(numerator,denominator);var parts=sourceQuantity.Split('.');var scale=parts.Length==2?parts[1].Length:0;
        var units=BigInteger.Parse(string.Concat(parts),NumberStyles.None,CultureInfo.InvariantCulture)*numerator;
        var result=BigInteger.DivRem(units,BigInteger.Pow(10,scale)*denominator,out var remainder);
        if(remainder!=BigInteger.Zero||result<1||result>MaxQuantity)throw new BusinessException("receiving_unit_conversion_conflict","The explicit unit mapping must produce an exact positive bounded sales-unit quantity.");
        return (int)result;
    }
    public static void Ratio(int numerator,int denominator){if(numerator is <1 or >MaxQuantity||denominator is <1 or >MaxQuantity)throw Invalid();}
    public static ReceivingUnitMappingInput Normalize(ReceivingUnitMappingInput input)
    {
        if(input is null)throw Invalid();Ratio(input.Numerator,input.Denominator);
        return input with{RequestId=Id(input.RequestId),OriginSystem=Key(input.OriginSystem,64),CompanyKey=Key(input.CompanyKey,64),WarehouseKey=Key(input.WarehouseKey,64),SourceUnitKey=Key(input.SourceUnitKey,120),VariantId=Identifier(input.VariantId).ToUpperInvariant(),NameFa=Text(input.NameFa,200),NameEn=Text(input.NameEn,200),Version=OptionalVersion(input.Version)};
    }
    public static SourcingReceiptInput Normalize(SourcingReceiptInput input)
    {
        if(input is null||input.Channel is not ("manual" or "csv")||input.ReceivedAt.Offset!=TimeSpan.Zero||input.Lines is null||input.Lines.Length is <1 or >MaxLines||input.Lines.Any(l=>l is null))throw Invalid();
        var lines=input.Lines.Select(l=>{
            if(l.TrackingMode is not ("none" or "serial" or "imei")||l.Units is null||l.Units.Length>SerialRules.BatchSize||l.Units.Any(u=>u is null)||l.TrackingMode=="none"&&l.Units.Length!=0||l.TrackingMode!="none"&&l.Units.Length==0)throw Invalid();
            var units=l.Units.Select(u=>SerialRules.Unit(new(u.Serial,u.Imei1,u.Imei2))).Select(u=>new ReceivingSerialInput(u.Serial,u.Imei1,u.Imei2)).OrderBy(u=>u.Serial,StringComparer.Ordinal).ThenBy(u=>u.Imei1,StringComparer.Ordinal).ThenBy(u=>u.Imei2,StringComparer.Ordinal).ToArray();
            return l with{OfferLineId=Id(l.OfferLineId),SourceReceiptLineKey=Key(l.SourceReceiptLineKey,120),MappingId=Id(l.MappingId),MappingVersion=Version(l.MappingVersion),SourceQuantity=SourceQuantity(l.SourceQuantity),StockVersion=OptionalVersion(l.StockVersion),Units=units};
        }).OrderBy(l=>l.SourceReceiptLineKey,StringComparer.Ordinal).ToArray();
        if(lines.Select(l=>l.SourceReceiptLineKey).Distinct(StringComparer.Ordinal).Count()!=lines.Length||lines.Sum(l=>l.Units.Length)>SerialRules.BatchSize)throw Invalid();
        return input with{RequestId=Id(input.RequestId),RequestVersion=Version(input.RequestVersion),TaskVersion=Version(input.TaskVersion),OriginSystem=Key(input.OriginSystem,64),CompanyKey=Key(input.CompanyKey,64),WarehouseKey=Key(input.WarehouseKey,64),SourceReceiptKey=Key(input.SourceReceiptKey,120),Reason=Text(input.Reason,500),Lines=lines};
    }
    public static BusinessException Invalid()=>new("invalid_sourcing_receipt","Use explicit bounded receiving identities, exact quantities, current versions, UTC dates and nonempty UUIDs.");
}
