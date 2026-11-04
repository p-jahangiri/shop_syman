using Microsoft.EntityFrameworkCore;
namespace Shop.Modules.Cms;
public sealed record CmsBlogSitemapPage(int Version,string Locale,string Kind,int Page,int PageSize,CmsPageSitemapEntry[] Items);
public static class CmsBlogSitemapQuery
{
    public static IQueryable<CmsPageSitemapSource> Published(CmsDbContext db)=>from p in db.BlogPosts.AsNoTracking() join r in db.BlogPostRevisions.AsNoTracking() on new{PostId=p.Id,Id=p.PublishedRevisionId} equals new{r.PostId,Id=(string?)r.Id} where !p.IsDemo&&p.Publication==r.Publication&&p.FirstPublishedAt!=null&&(r.Action=="Publish"||r.Action=="Restore") select new CmsPageSitemapSource{Slug=p.Slug,PublishedAt=r.At};
}
public sealed class CmsBlogSitemapService(CmsDbContext db)
{
    public async Task<long> CountAsync(string locale,CancellationToken ct){CmsPageSitemapRules.Validate(locale);var count=await CmsBlogSitemapQuery.Published(db).LongCountAsync(ct);CmsPageSitemapRules.Pages(count);return count;}
    public async Task<CmsBlogSitemapPage> PageAsync(string locale,int page,CancellationToken ct){CmsPageSitemapRules.Validate(locale,page);var rows=await CmsBlogSitemapQuery.Published(db).OrderBy(x=>x.Slug).Skip(checked((page-1)*CmsPageSitemapRules.PageSize)).Take(CmsPageSitemapRules.PageSize).Select(x=>new CmsPageSitemapEntry(x.Slug,true,true,x.PublishedAt)).ToArrayAsync(ct);return new(1,locale,"blog",page,CmsPageSitemapRules.PageSize,rows);}
}
