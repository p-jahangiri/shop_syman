using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Shop.SharedKernel;
namespace Shop.Modules.Cms;
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CmsPageLink(string Label,string Href);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CmsPageBlock(string Id,string Kind,string Visibility,string? Heading=null,string? Text=null,string? Image=null,string? Alt=null,IReadOnlyList<CmsPageLink>? Links=null);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CmsPageLanguage(string Title,string Description,IReadOnlyList<CmsPageBlock> Blocks);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CmsPageContent(CmsPageLanguage Fa,CmsPageLanguage En);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CmsPageWrite(string Action,string? Version=null,string? Slug=null,bool? IsDemo=null,CmsPageContent? Content=null,string? RestoreRevisionId=null,bool Confirmed=false);
public sealed record CmsPageResult(string CommandId,string PageId,string Slug,string Version,string Action,int Publication,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] string? RevisionId,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] string? PublishedRevisionId,string DraftHash,bool Replayed);
public sealed record CmsPageDetail(string Id,string Slug,bool IsDemo,string Version,int Publication,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] string? PublishedRevisionId,CmsPageContent Draft,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] CmsPageContent? Published);
public sealed record CmsPageListItem(string Id,string Slug,bool IsDemo,string Version,int Publication,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] string? PublishedRevisionId,DateTimeOffset UpdatedAt);
public sealed record CmsPageList(IReadOnlyList<CmsPageListItem> Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] string? NextCursor);
public sealed record CmsPageRevisionItem(string Id,int Publication,string Action,DateTimeOffset At);
public sealed record CmsPageHistory(IReadOnlyList<CmsPageRevisionItem> Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] int? NextBefore);
public sealed record CmsPageRevisionDetail(string PageId,string Slug,bool IsDemo,CmsPageRevisionItem Revision,CmsPageContent Content);
public sealed record CmsPublicPage(string Id,string Slug,string Locale,string RevisionId,DateTimeOffset PublishedAt,bool IsDemo,string Title,string Description,IReadOnlyList<CmsPageBlock> Blocks);
public static partial class CmsPageRules
{
    public static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web){UnmappedMemberHandling=JsonUnmappedMemberHandling.Disallow,Encoder=System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping};
    [GeneratedRegex("^[a-z0-9]+(?:-[a-z0-9]+)*$",RegexOptions.CultureInvariant)]private static partial Regex SlugPattern();
    [GeneratedRegex("^[a-f0-9]{32}$",RegexOptions.CultureInvariant)]private static partial Regex IdPattern();
    [GeneratedRegex("\\A/(?:products/[a-zA-Z0-9-]+\\.(?:svg|png|jpg|webp)|media/catalog/[a-f0-9]{32}/(?:thumb|card|zoom)\\.webp)\\z",RegexOptions.CultureInvariant)]private static partial Regex ImagePattern();
    public static BusinessException Invalid()=>new("invalid_cms_page","Check page fields, approved blocks and explicit publication confirmation.");
    public static BusinessException Changed()=>new("cms_page_changed_conflict","The page changed; reload before writing.");
    public static BusinessException Missing()=>new("not_found","Page or revision was not found.");
    public static BusinessException Unavailable()=>new("cms_page_unavailable","Page facts could not be verified.");
    public static string Id(string value)=>value is not null&&value!=new string('0',32)&&IdPattern().IsMatch(value)?value:throw Invalid();
    public static string Slug(string value)=>value is not null&&value.Length is>=1 and<=80&&SlugPattern().IsMatch(value)?value:throw Invalid();
    public static string Actor(string value)=>!string.IsNullOrWhiteSpace(value)&&value.Length<=64&&!value.Any(char.IsControl)?value:throw Invalid();
    public static string Digest(string value)=>Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    public static string Serialize<T>(T value)=>JsonSerializer.Serialize(value,Json);
    public static T Read<T>(string json){try{return JsonSerializer.Deserialize<T>(json,Json)??throw Unavailable();}catch(JsonException){throw Unavailable();}}
    public static bool InternalPath(string? value)=>value is not null&&value.Length is>=1 and<=1500&&value.StartsWith('/')&&!value.StartsWith("//",StringComparison.Ordinal)&&!value.Contains('\\')&&!value.Any(c=>char.IsControl(c)||char.IsWhiteSpace(c))&&!value.Contains('%');
    public static bool PublicImage(string? value)=>value is not null&&value.Length<=160&&ImagePattern().IsMatch(value);
    private static void Text(string? value,int max,bool required=false){if(value is null||value.Length>max||(required&&string.IsNullOrWhiteSpace(value))||value.Any(c=>(char.IsControl(c)&&c!='\n'&&c!='\t')||c is >= '\u202a' and <= '\u202e' or >= '\u2066' and <= '\u2069'))throw Invalid();try{_=new UTF8Encoding(false,true).GetByteCount(value);}catch(EncoderFallbackException){throw Invalid();}}
    public static void Content(CmsPageContent? value,bool publish)
    {
        if(value?.Fa is null||value.En is null||Encoding.UTF8.GetByteCount(Serialize(value))>65536)throw Invalid();
        foreach(var lang in new[]{value.Fa,value.En}){
            Text(lang.Title,200,publish);Text(lang.Description,400);if(lang.Blocks is null||lang.Blocks.Count>20||(publish&&lang.Blocks.Count==0))throw Invalid();
            var ids=new HashSet<string>(StringComparer.Ordinal);
            foreach(var b in lang.Blocks){if(b is null||!ids.Add(Id(b.Id))||b.Visibility is not("All"or"Mobile"or"Desktop"))throw Invalid();
                switch(b.Kind){
                    case "Text":case "Callout":Text(b.Heading,240);Text(b.Text,8000,true);if(b.Image is not null||b.Alt is not null||b.Links is not null)throw Invalid();break;
                    case "Image":if(!PublicImage(b.Image))throw Invalid();Text(b.Alt,240,true);if(b.Heading is not null||b.Text is not null||b.Links is not null)throw Invalid();break;
                    case "Links":Text(b.Heading,240);if(b.Links is null||b.Links.Count is<1 or>12||b.Image is not null||b.Alt is not null||b.Text is not null)throw Invalid();foreach(var link in b.Links){if(link is null||!InternalPath(link.Href))throw Invalid();Text(link.Label,150,true);}break;
                    default:throw Invalid();
                }
            }
        }
    }
    public static void Input(CmsPageWrite input,bool create)
    {
        if(input is null)throw Invalid();
        if(create){if(input.Action!="Create"||input.Version is not null||input.Slug is null||input.IsDemo is null||input.RestoreRevisionId is not null||input.Confirmed)throw Invalid();Slug(input.Slug);Content(input.Content,false);return;}
        if(input.Slug is not null||input.IsDemo is not null||input.Version is null)throw Invalid();
        try{if(Convert.FromBase64String(input.Version).Length!=8||Convert.ToBase64String(Convert.FromBase64String(input.Version))!=input.Version)throw Invalid();}catch(FormatException){throw Invalid();}
        switch(input.Action){case "Save":if(input.RestoreRevisionId is not null||input.Confirmed)throw Invalid();Content(input.Content,false);break;
            case "Publish":case "Unpublish":if(!input.Confirmed||input.Content is not null||input.RestoreRevisionId is not null)throw Invalid();break;
            case "Restore":if(!input.Confirmed||input.Content is not null||input.RestoreRevisionId is null)throw Invalid();Id(input.RestoreRevisionId);break;default:throw Invalid();}
    }
}
