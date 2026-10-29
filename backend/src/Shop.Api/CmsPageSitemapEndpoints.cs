using System.Globalization;
using Shop.Modules.Cms;
public sealed record CmsPageSitemapManifest(int Version,string DataSource,string Locale,bool IsPreview,bool AllowIndexing,int PageSize,string PageCount);
public static class CmsPageSitemapEndpoints
{
    public static void MapCmsPageSitemap(this WebApplication app)
    {
        var group=app.MapGroup("/api/content/page-sitemap/{locale}").AllowAnonymous();
        group.MapGet("",async(string locale,HttpContext h,ContentService content,CmsPageSitemapService service,CancellationToken ct)=>{
            if(h.Request.Query.Count!=0)return Results.BadRequest();CmsPageSitemapRules.Validate(locale);var site=await content.ReadAsync("site",locale,ct);var enabled=site["seo"]?["allowIndexing"]?.GetValue<bool>()==true;var count=enabled?await service.CountAsync(locale,ct):0;
            // Match the established catalogue/storefront preview guard. This
            // projection does not authorize a production indexing activation.
            return Results.Ok(new CmsPageSitemapManifest(1,"api",locale,true,enabled,CmsPageSitemapRules.PageSize,count.ToString(CultureInfo.InvariantCulture)));
        });
        group.MapGet("/entries",async(string locale,int? page,HttpContext h,CmsPageSitemapService service,CancellationToken ct)=>{
            if(h.Request.Query.Any(x=>x.Key!="page"||x.Value.Count!=1)||h.Request.Query.ContainsKey("page")&&(page is not(>=1 and<=50000)||h.Request.Query["page"].ToString()!=page.Value.ToString(CultureInfo.InvariantCulture)))return Results.BadRequest();
            return Results.Ok(await service.PageAsync(locale,page??1,ct));
        });
    }
}
