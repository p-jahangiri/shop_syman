using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;
namespace Shop.Modules.Cms;
public sealed record CmsPageSitemapEntry(string Key,bool Fa,bool En,DateTimeOffset LastModified);
public sealed record CmsPageSitemapPage(int Version,string Locale,string Kind,int Page,int PageSize,CmsPageSitemapEntry[] Items);
public static class CmsPageSitemapRules
{
    public const int PageSize=1000,MaximumPages=50000;
    public static void Validate(string locale,int page=1){if(locale is not("fa"or"en")||page is<1 or>MaximumPages)throw new BusinessException("invalid_sitemap_page","Use fa/en and a canonical page between 1 and 50000.");}
    public static int Pages(long count){if(count<0||count>(long)PageSize*MaximumPages)throw new BusinessException("sitemap_capacity_unavailable","CMS pages exceed the current sitemap capacity.");return(int)((count+PageSize-1)/PageSize);}
}
public sealed record CmsPageSitemapSource{public string Slug{get;init;}="";public DateTimeOffset PublishedAt{get;init;}}
public static class CmsPageSitemapQuery
{
    public static IQueryable<CmsPageSitemapSource> Published(CmsDbContext db)=>from p in db.Pages.AsNoTracking() join r in db.PageRevisions.AsNoTracking() on new{PageId=p.Id,Id=p.PublishedRevisionId} equals new{r.PageId,Id=(string?)r.Id} where !p.IsDemo&&p.Publication==r.Publication&&(r.Action=="Publish"||r.Action=="Restore") select new CmsPageSitemapSource{Slug=p.Slug,PublishedAt=r.At};
    public static IQueryable<CmsPageSitemapEntry> Page(CmsDbContext db,string locale,int page)
    {
        CmsPageSitemapRules.Validate(locale,page);return Published(db).OrderBy(x=>x.Slug).Skip(checked((page-1)*CmsPageSitemapRules.PageSize)).Take(CmsPageSitemapRules.PageSize).Select(x=>new CmsPageSitemapEntry(x.Slug,true,true,x.PublishedAt));
    }
}
public sealed class CmsPageSitemapService(CmsDbContext db)
{
    public async Task<long> CountAsync(string locale,CancellationToken ct){CmsPageSitemapRules.Validate(locale);var count=await CmsPageSitemapQuery.Published(db).LongCountAsync(ct);CmsPageSitemapRules.Pages(count);return count;}
    public async Task<CmsPageSitemapPage> PageAsync(string locale,int page,CancellationToken ct){var rows=await CmsPageSitemapQuery.Page(db,locale,page).ToArrayAsync(ct);return new(1,locale,"pages",page,CmsPageSitemapRules.PageSize,rows);}
}
