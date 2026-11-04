using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;
namespace Shop.Modules.Cms;
public interface ICmsBlogCursorProtection{string Protect(string locale,string? tag,bool demo,string json);string Unprotect(string locale,string? tag,bool demo,string token);}
public sealed record CmsBlogPublicSummary(string Id,string Slug,string Locale,string RevisionId,DateTimeOffset FirstPublishedAt,DateTimeOffset PublishedAt,bool IsDemo,string Title,string Description,string AuthorKind,string Byline,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? Cover,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? CoverAlt,IReadOnlyList<CmsBlogPublicTag> Tags);
public sealed record CmsBlogPublicList(int SchemaVersion,string Locale,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? Tag,CmsBlogPublicSummary[] Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? NextCursor);
public sealed partial class CmsBlogPostService
{
    private sealed record PublicCursor(int SchemaVersion,string Locale,string? Tag,bool Demo,DateTimeOffset Cutoff,DateTimeOffset LastAt,string LastId);
    public async Task<CmsBlogPublicList> PublicListAsync(string locale,string? tag,string? cursor,CancellationToken ct)
    {
        if(locale is not("fa"or"en"))throw CmsBlogPostRules.Invalid();if(tag is not null)CmsBlogPostRules.Slug(tag);var now=clock.GetUtcNow().ToUniversalTime();PublicCursor? saved=null;
        if(cursor is not null){try{saved=CmsBlogPostRules.Read<PublicCursor>(cursors.Unprotect(locale,tag,development,cursor));}catch(Exception e)when(e is JsonException or BusinessException){throw CmsBlogPostRules.Invalid();}if(saved.SchemaVersion!=1||saved.Locale!=locale||saved.Tag!=tag||saved.Demo!=development||saved.Cutoff.Offset!=TimeSpan.Zero||saved.Cutoff.Year<2000||saved.Cutoff>now||saved.LastAt.Offset!=TimeSpan.Zero||saved.LastAt>saved.Cutoff||saved.LastAt.Year<2000)throw CmsBlogPostRules.Invalid();CmsBlogPostRules.Id(saved.LastId);if(saved.Cutoff.AddMinutes(15)<=now)throw new BusinessException("cms_blog_cursor_expired_conflict","Start a fresh article list; this technical cursor expired.");}
        var cutoff=saved?.Cutoff??now;var last=saved?.LastAt??cutoff;var lastId=saved?.LastId??"";var hasCursor=saved is not null;
        var rows=await(from p in db.BlogPosts.AsNoTracking() join rev in db.BlogPostRevisions.AsNoTracking() on new{PostId=p.Id,Id=p.PublishedRevisionId} equals new{rev.PostId,Id=(string?)rev.Id}
            where (!p.IsDemo||development)&&p.FirstPublishedAt!=null&&p.FirstPublishedAt<=cutoff&&(tag==null||db.BlogRevisionTags.Any(t=>t.RevisionId==rev.Id&&t.Slug==tag))&&(!hasCursor||p.FirstPublishedAt<last||p.FirstPublishedAt==last&&string.Compare(p.Id,lastId)<0)
            orderby p.FirstPublishedAt descending,p.Id descending select new{Post=p,Revision=rev}).Take(21).ToArrayAsync(ct);
        var result=new List<CmsBlogPublicSummary>();foreach(var row in rows.Take(20)){var p=row.Post;var rev=row.Revision;if(rev.Action=="Unpublish"||rev.Publication!=p.Publication||p.FirstPublishedAt<p.CreatedAt||p.FirstPublishedAt>rev.At||rev.At>p.UpdatedAt)throw CmsBlogPostRules.Unavailable();var content=await VerifiedBody(rev,ct);if(tag is not null&&!content.Tags.Any(t=>t.Slug==tag))throw CmsBlogPostRules.Unavailable();var lang=locale=="fa"?content.Body.Fa:content.Body.En;result.Add(new(p.Id,p.Slug,locale,rev.Id,p.FirstPublishedAt!.Value,rev.At,p.IsDemo,lang.Title,lang.Description,content.AuthorKind!,locale=="fa"?content.BylineFa:content.BylineEn,content.Cover,locale=="fa"?content.CoverAltFa:content.CoverAltEn,content.Tags.Select(t=>new CmsBlogPublicTag(t.Slug,locale=="fa"?t.NameFa:t.NameEn)).ToArray()));}
        var next=rows.Length>20?cursors.Protect(locale,tag,development,CmsBlogPostRules.Serialize(new PublicCursor(1,locale,tag,development,cutoff,result[^1].FirstPublishedAt,result[^1].Id))):null;return new(1,locale,tag,result.ToArray(),next);
    }
}
