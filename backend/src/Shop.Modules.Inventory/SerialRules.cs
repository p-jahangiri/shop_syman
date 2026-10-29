using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Shop.SharedKernel;

namespace Shop.Modules.Inventory;

public static class SerialRules
{
    public const int BatchSize=100;
    public static string Identifier(string? value)=>value is {Length:>=1 and <=64}&&value.All(c=>char.IsAsciiLetterOrDigit(c)||c is '-' or '_')?value:throw Invalid();
    public static string Uuid(string? value)=>Guid.TryParse(value,out var id)&&id!=Guid.Empty?id.ToString("N"):throw Invalid();
    public static string Mode(string? mode)=>mode is "none" or "serial" or "imei"?mode:throw Invalid();
    public static string Reason(string? value)=>value?.Trim() is {Length:>=1 and <=500} reason&&!reason.Any(char.IsControl)?reason:throw Invalid();
    public static string? Version(string? value,bool optional=true)
    {
        if(value is null&&optional)return null;
        try{if(value is {Length:12}&&Convert.ToBase64String(Convert.FromBase64String(value))==value&&Convert.FromBase64String(value).Length==8)return value;}catch(FormatException){}
        throw Invalid();
    }
    private static string Canonical(string value)
    {
        if(value.Length>200||value.Any(char.IsControl))throw Invalid();
        return new string(value.Normalize(NormalizationForm.FormKC).Trim().ToUpperInvariant().Select(c=>c is >= '\u06f0' and <= '\u06f9'?(char)('0'+c-'\u06f0'):c is >= '\u0660' and <= '\u0669'?(char)('0'+c-'\u0660'):c).ToArray());
    }
    public static string? Serial(string? value)
    {
        if(string.IsNullOrWhiteSpace(value))return null;
        var canonical=Canonical(value);if(canonical.Length is <1 or >100||canonical.Any(c=>!char.IsAsciiLetterOrDigit(c)&&c is not ('.' or '_' or '/' or '-')))throw Invalid();return canonical;
    }
    public static string? Imei(string? value)
    {
        if(string.IsNullOrWhiteSpace(value))return null;
        var canonical=Canonical(value);if(canonical.Length!=15||canonical.Any(c=>!char.IsAsciiDigit(c))||canonical.All(c=>c=='0'))throw Invalid();
        var sum=0;for(var i=0;i<canonical.Length;i++){var digit=canonical[i]-'0';if(i%2==1){digit*=2;if(digit>9)digit-=9;}sum+=digit;}if(sum%10!=0)throw Invalid();return canonical;
    }
    public static SerialUnitInput Unit(SerialUnitInput? input)
    {
        if(input is null)throw Invalid();var serial=Serial(input.Serial);var first=Imei(input.Imei1);var second=Imei(input.Imei2);
        if(serial is null&&first is null||second is not null&&(first is null||first==second))throw Invalid();return new(serial,first,second);
    }
    public static string[] Keys(string variantId,SerialUnitInput unit)=>new[]{unit.Serial is null?null:"S:"+Identifier(variantId).ToUpperInvariant()+":"+unit.Serial,unit.Imei1 is null?null:"I:"+unit.Imei1,unit.Imei2 is null?null:"I:"+unit.Imei2}.OfType<string>().ToArray();
    public static SerialUnitInput[] Units(string variantId,SerialUnitInput[]? input)
    {
        if(input is null||input.Length is <1 or >BatchSize)throw Invalid();var rows=input.Select(Unit).OrderBy(u=>string.Join('|',Keys(variantId,u)),StringComparer.Ordinal).ToArray();var keys=rows.SelectMany(u=>Keys(variantId,u)).ToArray();if(keys.Distinct(StringComparer.Ordinal).Count()!=keys.Length)throw Invalid();return rows;
    }
    public static void RequireMode(string mode,IEnumerable<SerialUnitInput> units){if(mode=="none")throw new BusinessException("serial_tracking_required","Enable serial tracking before receiving units.");if(units.Any(u=>mode=="serial"?u.Serial is null:u.Imei1 is null))throw Invalid();}
    public static string Search(string? value){if(value is null)return "";var text=Canonical(value);if(text.Length>100||text.Any(c=>!char.IsAsciiLetterOrDigit(c)&&c is not ('.' or '_' or '/' or '-')))throw Invalid();return text;}
    public static string Hash<T>(T value)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(value))));
    public static void MatchVersion(byte[] current,string? expected){if(Convert.ToBase64String(current)!=expected)throw new BusinessException("version_conflict","Inventory changed. Load the current version.");}
    private static BusinessException Invalid()=>new("invalid_serial_input","Use bounded canonical identifiers, valid IMEI check digits, versions and request UUIDs.");
}

public sealed record SerialPageQuery(string VariantId,string State,string Search)
{
    public static SerialPageQuery Create(string variantId,string? state,string? query)
    {
        state??="all";if(state is not ("all" or "available" or "assigned" or "delivered" or "retired"))throw new BusinessException("invalid_serial_input","Unknown serial state.");return new(SerialRules.Identifier(variantId),state,SerialRules.Search(query));
    }
    public string Binding=>SerialRules.Hash(new{VariantId=VariantId.ToUpperInvariant(),State,Search});
}
public static class SerialPaging
{
    public const int PageSize=50;
    private sealed record Cursor(string After,string Binding);
    public static string Encode(string after,SerialPageQuery query)=>Convert.ToBase64String(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new Cursor(SerialRules.Uuid(after),query.Binding)))).TrimEnd('=').Replace('+','-').Replace('/','_');
    public static string? Decode(string? cursor,SerialPageQuery query)
    {
        if(cursor is null)return null;
        try{if(cursor.Length is <1 or >256||cursor.Any(c=>!char.IsAsciiLetterOrDigit(c)&&c is not ('-' or '_')))throw new FormatException();var raw=cursor.Replace('-','+').Replace('_','/');var value=JsonSerializer.Deserialize<Cursor>(Convert.FromBase64String(raw.PadRight((raw.Length+3)/4*4,'=')));if(value is null||value.Binding!=query.Binding)throw new FormatException();return SerialRules.Uuid(value.After);}catch(Exception e)when(e is FormatException or JsonException or BusinessException){throw new BusinessException("invalid_serial_cursor","Start serial paging again with the current filter.");}
    }
}
