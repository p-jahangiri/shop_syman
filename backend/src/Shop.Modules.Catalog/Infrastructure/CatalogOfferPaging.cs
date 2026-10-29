using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Shop.Modules.Catalog.Application;
using Shop.SharedKernel;

namespace Shop.Modules.Catalog.Infrastructure;

public sealed record CatalogOfferLookup
{
    public string ModelId {get;private init;}="";
    public string Search {get;private init;}="";
    private CatalogOfferLookup(){}
    public static CatalogOfferLookup Create(string modelId,string? query)
    {
        ValidateId(modelId);
        if(query is {Length:>120})throw Invalid();
        var search=PersianText.Normalize(query??"");
        if(search.Split(' ',StringSplitOptions.RemoveEmptyEntries).Length>8)throw Invalid();
        return new(){ModelId=modelId,Search=search};
    }
    public string Binding=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new{ModelId,Search}))).AsSpan(0,16));
    public static void ValidateId(string id)
    {
        try{AdminProductQuery.Identifier(id);}catch(BusinessException){throw Invalid();}
    }
    private static BusinessException Invalid()=>new("invalid_offer_catalog","Use a valid model/SKU id and at most eight search terms (120 characters).");
}
public static class CatalogOfferPaging
{
    public const int PageSize=20;
    private sealed record Cursor(string After,string Filter);
    private static readonly JsonSerializerOptions Options=new(){MaxDepth=4,UnmappedMemberHandling=JsonUnmappedMemberHandling.Disallow};
    public static string Encode(string id,CatalogOfferLookup query)
    {
        CatalogOfferLookup.ValidateId(id);
        return Convert.ToBase64String(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new Cursor(id,query.Binding)))).TrimEnd('=').Replace('+','-').Replace('/','_');
    }
    public static string? Decode(string? cursor,CatalogOfferLookup query)
    {
        if(cursor is null)return null;
        try{
            if(cursor.Length is <1 or >200||cursor.Any(c=>!char.IsAsciiLetterOrDigit(c)&&c is not ('-' or '_')))throw Invalid();
            var raw=cursor.Replace('-','+').Replace('_','/');
            var value=JsonSerializer.Deserialize<Cursor>(Convert.FromBase64String(raw.PadRight((raw.Length+3)/4*4,'=')),Options);
            if(value is null||value.Filter!=query.Binding)throw Invalid();
            CatalogOfferLookup.ValidateId(value.After);return value.After;
        }
        catch(Exception e)when(e is FormatException or JsonException or ArgumentException||e is BusinessException{Code:"invalid_offer_catalog"}){throw Invalid();}
    }
    private static BusinessException Invalid()=>new("invalid_offer_cursor","The SKU cursor is invalid or belongs to a different requested model/search.");
}
