using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Shop.SharedKernel;
namespace Shop.Modules.Cms;
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]public sealed record CmsBlogTag(string Slug,string NameFa,string NameEn);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]public sealed record CmsBlogContent(CmsPageContent Body,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? AuthorKind,string BylineFa,string BylineEn,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? Cover,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? CoverAltFa,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? CoverAltEn,IReadOnlyList<CmsBlogTag> Tags);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]public sealed record CmsBlogPostWrite(string Action,string? Version=null,string? Slug=null,bool? IsDemo=null,CmsBlogContent? Content=null,string? RestoreRevisionId=null,bool Confirmed=false);
public sealed record CmsBlogPostResult(string CommandId,string PostId,string Slug,string Version,string Action,int Publication,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? RevisionId,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? PublishedRevisionId,string DraftHash,bool Replayed);
public sealed record CmsBlogPostDetail(string Id,string Slug,bool IsDemo,string Version,int Publication,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? PublishedRevisionId,CmsBlogContent Draft,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]CmsBlogContent? Published,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]DateTimeOffset? FirstPublishedAt,string DraftHash);
public sealed record CmsBlogPostListItem(string Id,string Slug,bool IsDemo,string Version,int Publication,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? PublishedRevisionId,DateTimeOffset UpdatedAt);
public sealed record CmsBlogPostList(IReadOnlyList<CmsBlogPostListItem> Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? NextCursor);
public sealed record CmsBlogPostRevisionItem(string Id,int Publication,string Action,DateTimeOffset At);
public sealed record CmsBlogPostHistory(IReadOnlyList<CmsBlogPostRevisionItem> Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]int? NextBefore);
public sealed record CmsBlogPostRevisionDetail(string PostId,string Slug,bool IsDemo,CmsBlogPostRevisionItem Revision,CmsBlogContent Content);
public sealed record CmsBlogPublicTag(string Slug,string Name);
public sealed record CmsPublicBlogPost(string Id,string Slug,string Locale,string RevisionId,DateTimeOffset FirstPublishedAt,DateTimeOffset PublishedAt,bool IsDemo,string Title,string Description,string AuthorKind,string Byline,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? Cover,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? CoverAlt,IReadOnlyList<CmsBlogPublicTag> Tags,IReadOnlyList<CmsPageBlock> Blocks,int SchemaVersion=1);
public static class CmsBlogPostRules
{
    public static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web){MaxDepth=20,UnmappedMemberHandling=JsonUnmappedMemberHandling.Disallow,RespectNullableAnnotations=true,RespectRequiredConstructorParameters=true,Encoder=System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping};
    public static BusinessException Invalid()=>new("invalid_cms_blog","Review the bilingual article, explicit public author, cover alt text, tags and publication confirmation.");
    public static BusinessException Changed()=>new("cms_blog_changed_conflict","The article changed; reload before writing.");
    public static BusinessException Missing()=>new("not_found","Article or revision was not found.");
    public static BusinessException Unavailable()=>new("cms_blog_unavailable","The retained article could not be verified.");
    public static string Id(string x){try{return CmsPageRules.Id(x);}catch(BusinessException){throw Invalid();}}
    public static string Slug(string x){try{return CmsPageRules.Slug(x);}catch(BusinessException){throw Invalid();}}
    public static string Actor(string x){try{return CmsPageRules.Actor(x);}catch(BusinessException){throw Invalid();}}
    public static string Digest(string x)=>CmsPageRules.Digest(x);
    public static string Serialize<T>(T x)=>JsonSerializer.Serialize(x,Json);
    public static T Read<T>(string json){try{return JsonSerializer.Deserialize<T>(json,Json)??throw Unavailable();}catch(Exception e)when(e is JsonException or NullReferenceException){throw Unavailable();}}
    private static void Text(string? x,int length,bool required=false){if(x is null||x.Length>length||x!=x.Trim()||x.Any(c=>char.IsControl(c)||c is >= '\u202a' and <= '\u202e' or >= '\u2066' and <= '\u2069')||required&&string.IsNullOrWhiteSpace(x))throw Invalid();try{_=new UTF8Encoding(false,true).GetByteCount(x);}catch(EncoderFallbackException){throw Invalid();}}
    public static void Content(CmsBlogContent? x,bool publish)
    {
        if(x is null||x.Tags is null||x.Tags.Count>8||Encoding.UTF8.GetByteCount(Serialize(x))>65536||x.AuthorKind is not(null or"Person"or"Organization")||publish&&x.AuthorKind is null)throw Invalid();
        try{CmsPageRules.Content(x.Body,publish);}catch(BusinessException){throw Invalid();}Text(x.BylineFa,120,publish);Text(x.BylineEn,120,publish);
        if(x.AuthorKind is null&&(x.BylineFa.Length>0||x.BylineEn.Length>0))throw Invalid();
        if(x.Cover is null){if(x.CoverAltFa is not null||x.CoverAltEn is not null)throw Invalid();}else{if(!CmsPageRules.PublicImage(x.Cover))throw Invalid();Text(x.CoverAltFa,240,true);Text(x.CoverAltEn,240,true);}
        string? last=null;foreach(var tag in x.Tags){if(tag is null)throw Invalid();Slug(tag.Slug);Text(tag.NameFa,60,true);Text(tag.NameEn,60,true);if(last is not null&&StringComparer.Ordinal.Compare(last,tag.Slug)>=0)throw Invalid();last=tag.Slug;}
    }
    public static void Input(CmsBlogPostWrite x,bool create)
    {
        if(x is null)throw Invalid();try{CmsPageRules.Input(new(x.Action,x.Version,x.Slug,x.IsDemo,x.Content?.Body,x.RestoreRevisionId,x.Confirmed),create);}catch(BusinessException){throw Invalid();}if(x.Content is not null)Content(x.Content,false);
    }
}
