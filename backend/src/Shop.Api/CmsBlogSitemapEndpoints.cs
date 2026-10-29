using System.Globalization;
using Shop.Modules.Cms;
public sealed record CmsBlogSitemapManifest(int Version,string DataSource,string Locale,bool IsPreview,bool AllowIndexing,int PageSize,string PostCount);
public static class CmsBlogSitemapEndpoints
{
    public static void MapCmsBlogSitemap(this WebApplication app)
    {
        var g=app.MapGroup("/api/content/blog-sitemap/{locale}").AllowAnonymous();g.AddEndpointFilter(async(c,next)=>{c.HttpContext.Response.Headers.CacheControl="no-store";c.HttpContext.Response.Headers["X-Robots-Tag"]="noindex, nofollow";return await next(c);});
        g.MapGet("",async(string locale,HttpContext h,ContentService content,CmsBlogSitemapService service,CancellationToken ct)=>{if(h.Request.Query.Count!=0)return Results.BadRequest();CmsPageSitemapRules.Validate(locale);var site=await content.ReadAsync("site",locale,ct);var enabled=site["seo"]?["allowIndexing"]?.GetValue<bool>()==true;var count=enabled?await service.CountAsync(locale,ct):0;return Results.Ok(new CmsBlogSitemapManifest(1,"api",locale,true,enabled,CmsPageSitemapRules.PageSize,count.ToString(CultureInfo.InvariantCulture)));});
        // This mirrors the established preview gate; it never authorizes indexing activation.
        g.MapGet("/entries",async(string locale,int? page,HttpContext h,CmsBlogSitemapService service,CancellationToken ct)=>h.Request.Query.Any(x=>x.Key!="page"||x.Value.Count!=1)||h.Request.Query.ContainsKey("page")&&(page is not(>=1 and<=50000)||h.Request.Query["page"].ToString()!=page.Value.ToString(CultureInfo.InvariantCulture))?Results.BadRequest():Results.Ok(await service.PageAsync(locale,page??1,ct)));
    }
}
