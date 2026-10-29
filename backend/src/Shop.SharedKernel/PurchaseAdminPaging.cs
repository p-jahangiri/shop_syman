using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Shop.SharedKernel;
public sealed record PurchaseAdminFilter
{
    public string Search { get; private init; } = "";
    public string Enabled { get; private init; } = "all";
    public string Kind { get; private init; } = "all";
    public string? CategoryId { get; private init; }
    public static PurchaseAdminFilter Create(string? query=null,string? enabled=null,string? categoryId=null,string? kind=null)
    {
        enabled??="all";kind??="all";
        if(query is {Length:>120}||query?.Any(c=>char.IsControl(c)&&!char.IsWhiteSpace(c))==true||enabled is not ("all" or "true" or "false")||kind is not ("all" or "online" or "cheque" or "installment"))throw Invalid();
        string search;try{search=PersianText.Normalize(query??"");}catch(ArgumentException){throw Invalid();}
        if(search.Split(' ',StringSplitOptions.RemoveEmptyEntries).Length>8)throw Invalid();
        if(categoryId is not null)Id(categoryId);
        return new(){Search=search,Enabled=enabled,Kind=kind,CategoryId=categoryId};
    }
    public static string Id(string id)=>id is {Length:>0 and <=64}&&id.All(c=>char.IsAsciiLetterOrDigit(c)||c is '-' or '_')?id:throw Invalid();
    public string Binding(string scope)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new{Scope=scope,Search,Enabled,Kind,CategoryId}))));
    private static BusinessException Invalid()=>new("invalid_purchase_filter","Use known purchase filters and up to eight search terms (120 characters).");
}
public static class PurchaseAdminPaging
{
    public const int PageSize=50;
    public const int CategoryLimit=500;
    private sealed record Cursor(string After,string Filter);
    private static readonly JsonSerializerOptions Options=new(){MaxDepth=4,UnmappedMemberHandling=JsonUnmappedMemberHandling.Disallow};
    public static string Encode(string id,PurchaseAdminFilter filter,string scope)=>Convert.ToBase64String(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new Cursor(PurchaseAdminFilter.Id(id),filter.Binding(scope))))).TrimEnd('=').Replace('+','-').Replace('/','_');
    public static string? Decode(string? cursor,PurchaseAdminFilter filter,string scope)
    {
        if(cursor is null)return null;
        try{
            if(cursor.Length is <1 or >512||cursor.Any(c=>!char.IsAsciiLetterOrDigit(c)&&c is not ('-' or '_')))throw Invalid();
            var raw=cursor.Replace('-','+').Replace('_','/');var value=JsonSerializer.Deserialize<Cursor>(Convert.FromBase64String(raw.PadRight((raw.Length+3)/4*4,'=')),Options);
            if(value is null||value.Filter!=filter.Binding(scope))throw Invalid();return PurchaseAdminFilter.Id(value.After);
        }catch(Exception e)when(e is FormatException or JsonException or ArgumentException||e is BusinessException{Code:"invalid_purchase_filter"}){throw Invalid();}
    }
    private static BusinessException Invalid()=>new("invalid_purchase_cursor","This page belongs to invalid or different purchase filters.");
}
public sealed record PurchaseCounts(string Total,string Enabled);
