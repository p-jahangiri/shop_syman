using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Shop.SharedKernel;

namespace Shop.Modules.Catalog.Application;
public sealed record AdminProductSummary(string Id,string Slug,string NameFa,string NameEn,string CategoryId,string BrandId,string Status,bool Featured,int VariantCount);
public sealed record AdminProductPage(int SchemaVersion,int PageSize,AdminProductSummary[] Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] string? NextCursor);
public interface IAdminProducts
{
    Task<AdminProductPage> PageAsync(AdminProductQuery query,string? cursor,CancellationToken ct);
    Task<AdminProductSummary[]> LookupAsync(string[] ids,CancellationToken ct);
    Task<AdminProductDetail> DetailAsync(string id,CancellationToken ct);
}
public sealed record AdminProductQuery
{
    public string Search {get;private init;}="";
    public string Status {get;private init;}="all";
    public string? CategoryId {get;private init;}
    public string? BrandId {get;private init;}
    private AdminProductQuery(){}
    public static AdminProductQuery Create(string? query=null,string? status=null,string? categoryId=null,string? brandId=null)
    {
        status??="all";if(query is {Length:>120}||status is not ("all" or "Draft" or "Published" or "Hidden"))throw Invalid();
        var search=PersianText.Normalize(query??"");if(search.Split(' ',StringSplitOptions.RemoveEmptyEntries).Length>8)throw Invalid();
        categoryId=string.IsNullOrWhiteSpace(categoryId)?null:AdminProductQuery.Identifier(categoryId.Trim());brandId=string.IsNullOrWhiteSpace(brandId)?null:AdminProductQuery.Identifier(brandId.Trim());
        return new(){Search=search,Status=status,CategoryId=categoryId,BrandId=brandId};
    }
    public string Binding=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new{Search,Status,CategoryId,BrandId}))));
    public static string Identifier(string id){if(string.IsNullOrEmpty(id)||id.Length>64||id.Any(c=>!char.IsAsciiLetterOrDigit(c)&&c is not ('-' or '_')))throw Invalid();return id;}
    private static BusinessException Invalid()=>new("invalid_product_filter","Use up to eight terms (120 characters), a valid status and category/brand ids.");
}
public static class AdminProductPaging
{
    public const int PageSize=50;
    private sealed record Cursor(string After,string Filter);
    private static readonly JsonSerializerOptions Options=new(){MaxDepth=4,UnmappedMemberHandling=JsonUnmappedMemberHandling.Disallow};
    public static string Encode(string id,AdminProductQuery query)=>Convert.ToBase64String(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new Cursor(AdminProductQuery.Identifier(id),query.Binding)))).TrimEnd('=').Replace('+','-').Replace('/','_');
    public static string? Decode(string? cursor,AdminProductQuery query)
    {
        if(cursor is null)return null;
        try{if(cursor.Length is <1 or >300||cursor.Any(c=>!char.IsAsciiLetterOrDigit(c)&&c is not ('-' or '_')))throw Invalid();var raw=cursor.Replace('-','+').Replace('_','/');var value=JsonSerializer.Deserialize<Cursor>(Convert.FromBase64String(raw.PadRight((raw.Length+3)/4*4,'=')),Options);if(value is null||value.Filter!=query.Binding)throw Invalid();return AdminProductQuery.Identifier(value.After);}
        catch(Exception e)when(e is FormatException or JsonException or ArgumentException||e is BusinessException{Code:"invalid_product_filter"}){throw Invalid();}
    }
    private static BusinessException Invalid()=>new("invalid_product_cursor","The product cursor is invalid or belongs to different filters.");
}
