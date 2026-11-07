using System.Data.Common;
using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Shop.Modules.Cms;
using Shop.SharedKernel;
using Xunit;
namespace Shop.SqlTests;
public sealed class CmsPageSitemapSqlTests:IAsyncLifetime
{
    private readonly SqlFixture sql=new();public Task InitializeAsync()=>sql.InitializeAsync();public Task DisposeAsync()=>sql.DisposeAsync();
    private static string Id()=>Guid.NewGuid().ToString("N");
    private sealed class NoCommerce:IInventoryReader,IPurchaseConfiguration
    {
        public Task<IReadOnlyDictionary<string,int>> AvailableAsync(IEnumerable<string> ids,CancellationToken ct)=>throw new InvalidOperationException("CMS sitemap must not read inventory.");
        public Task<IReadOnlyList<PurchaseMethodData>> MethodsAsync(string locale,CancellationToken ct)=>throw new InvalidOperationException("CMS sitemap must not read finance.");
        public Task<IReadOnlyList<CreditPlanData>> PlansAsync(string locale,CancellationToken ct)=>throw new InvalidOperationException("CMS sitemap must not read credit.");
    }
    private WebApplicationFactory<Program> Public()=>sql.Factory.WithWebHostBuilder(b=>b.ConfigureTestServices(s=>{s.RemoveAll<IInventoryReader>();s.RemoveAll<IPurchaseConfiguration>();var guard=new NoCommerce();s.AddSingleton<IInventoryReader>(guard);s.AddSingleton<IPurchaseConfiguration>(guard);}));
    private static async Task<JsonNode> Read(HttpResponseMessage response)
    {
        using(response){var raw=await response.Content.ReadAsStringAsync();Assert.True(response.IsSuccessStatusCode,$"{(int)response.StatusCode}: {raw}");Assert.Contains("no-store",response.Headers.CacheControl!.ToString());if(Environment.GetEnvironmentVariable("SHOP_CMS_PAGE_SITEMAP_WIRE_DIR")is{Length:>0}dir){Directory.CreateDirectory(dir);var id=Id();await File.WriteAllTextAsync(System.IO.Path.Combine(dir,id+".json"),raw);await File.WriteAllTextAsync(System.IO.Path.Combine(dir,id+".meta.json"),JsonSerializer.Serialize(new{actualSqlHttpResponse=true,syntheticQaOnly=true,status=(int)response.StatusCode,method=response.RequestMessage!.Method.Method,path=response.RequestMessage.RequestUri!.PathAndQuery}));}return JsonNode.Parse(raw)!;}
    }
    private async Task Seo(bool fa,bool en)
    {
        await using var scope=sql.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<CmsDbContext>();foreach(var row in await db.Documents.Where(x=>x.Key=="site").ToListAsync()){var body=JsonNode.Parse(row.PublishedJson!)!.AsObject();body["seo"]=new JsonObject{["allowIndexing"]=row.Locale=="fa"?fa:en};row.PublishedJson=body.ToJsonString();}await db.SaveChangesAsync();
    }
    // Only this fixture's GUID database: synthetic public CMS records, no
    // persons, commerce policy, credentials, production seed or fake payment.
    private async Task<(string Id,DateTimeOffset RestoredAt)> Seed(int count,bool extras=true)
    {
        await using var scope=sql.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<CmsDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);var value=new CmsPageContent(new("عنوان نمونهٔ SQL","",[new(Id(),"Text","All","","Synthetic QA only; not store policy.")]),new("Synthetic SQL page","",[new(Id(),"Text","All","","Synthetic QA only")]));var body=CmsPageRules.Serialize(value);var hash=CmsPageRules.Digest(body);var at=DateTimeOffset.UtcNow.AddMinutes(-1);var heads=new List<CmsPage>();var revisions=new List<CmsPageRevision>();
        for(var n=0;n<count+(extras?3:0);n++){
            var p=new CmsPage{Id=Id(),Slug=n<count?"cms-projection-"+n.ToString("D4"):n==count?"zz-demo":n==count+1?"zz-draft":"zz-unpublished",IsDemo=n==count&&extras,DraftJson=body,DraftHash=hash,CreatedBy="qa-projection",UpdatedBy="qa-projection",CreatedAt=at,UpdatedAt=at};heads.Add(p);
            if(n!=count+1||!extras)revisions.Add(new(){Id=Id(),PageId=p.Id,Publication=1,Action="Publish",BodyJson=body,BodyHash=hash,ActorId="qa-projection",At=at});
        }
        db.Pages.AddRange(heads);await db.SaveChangesAsync();db.PageRevisions.AddRange(revisions);await db.SaveChangesAsync();foreach(var p in heads){var revision=revisions.SingleOrDefault(x=>x.PageId==p.Id);if(revision is null)continue;p.Publication=1;p.PublishedRevisionId=revision.Id;}await db.SaveChangesAsync();
        var restoredAt=at.AddSeconds(1);var first=heads[0];var restore=new CmsPageRevision{Id=Id(),PageId=first.Id,Publication=2,Action="Restore",BodyJson=body,BodyHash=hash,ActorId="qa-projection",At=restoredAt};db.PageRevisions.Add(restore);await db.SaveChangesAsync();first.PublishedRevisionId=restore.Id;first.Publication=2;first.UpdatedAt=restoredAt;
        if(extras){var closed=heads[^1];db.PageRevisions.Add(new(){Id=Id(),PageId=closed.Id,Publication=2,Action="Unpublish",BodyJson=body,BodyHash=hash,ActorId="qa-projection",At=restoredAt});closed.PublishedRevisionId=null;closed.Publication=2;closed.UpdatedAt=restoredAt;}
        await db.SaveChangesAsync();return(first.Id,restoredAt);
    }
    [Fact]public async Task ThousandAndOnePublishedPagesHaveBoundedKeyOnlyPartitionsAndActualRestoredTimestamp()
    {
        var seeded=await Seed(1001);await Seo(true,true);await using var factory=Public();using var c=factory.CreateClient(new(){HandleCookies=false});var manifest=await Read(await c.GetAsync("/api/content/page-sitemap/fa"));Assert.Equal("1001",manifest["pageCount"]!.GetValue<string>());Assert.True(manifest["isPreview"]!.GetValue<bool>());Assert.Equal("1001",(await Read(await c.GetAsync("/api/content/page-sitemap/en")))["pageCount"]!.GetValue<string>());
        var first=await Read(await c.GetAsync("/api/content/page-sitemap/fa/entries?page=1"));var second=await Read(await c.GetAsync("/api/content/page-sitemap/fa/entries?page=2"));Assert.Equal(1000,first["items"]!.AsArray().Count);Assert.Single(second["items"]!.AsArray());var keys=first["items"]!.AsArray().Concat(second["items"]!.AsArray()).Select(x=>x!["key"]!.GetValue<string>()).ToArray();Assert.Equal(1001,keys.Distinct().Count());Assert.DoesNotContain(keys,x=>x.StartsWith("zz-",StringComparison.Ordinal));var restored=first["items"]!.AsArray().Single(x=>x!["key"]!.GetValue<string>()=="cms-projection-0000")!;Assert.Equal(seeded.RestoredAt,restored["lastModified"]!.GetValue<DateTimeOffset>());
        foreach(var row in first["items"]!.AsArray()){Assert.True(row!["fa"]!.GetValue<bool>());Assert.True(row["en"]!.GetValue<bool>());Assert.Equal(4,row.AsObject().Count);}foreach(var forbidden in new[]{"draftJson","bodyJson","actorId","ownerId","priceRial","Synthetic QA","title"})Assert.DoesNotContain(forbidden,first.ToJsonString());var en=await Read(await c.GetAsync("/api/content/page-sitemap/en/entries?page=2"));Assert.Equal(second["items"]!.ToJsonString(),en["items"]!.ToJsonString());Assert.Empty((await Read(await c.GetAsync("/api/content/page-sitemap/fa/entries?page=3")))["items"]!.AsArray());
    }
    [Fact]public async Task PublishedSeoPermissionAndCanonicalInputNeverEnablePreviewOrCollideWithSitemapSlug()
    {
        var seeded=await Seed(1);await Seo(false,false);await using var factory=Public();using var c=factory.CreateClient(new(){HandleCookies=false});var disabled=await Read(await c.GetAsync("/api/content/page-sitemap/fa"));Assert.False(disabled["allowIndexing"]!.GetValue<bool>());Assert.Equal("0",disabled["pageCount"]!.GetValue<string>());await Seo(true,false);Assert.Equal("1",(await Read(await c.GetAsync("/api/content/page-sitemap/fa")))["pageCount"]!.GetValue<string>());Assert.Equal("1",(await Read(await c.GetAsync("/api/content/page-sitemap/en")))["pageCount"]!.GetValue<string>());
        foreach(var path in new[]{"/api/content/page-sitemap/de","/api/content/page-sitemap/fa?draft=true","/api/content/page-sitemap/fa/entries?page=01","/api/content/page-sitemap/fa/entries?page=0","/api/content/page-sitemap/fa/entries?page=50001","/api/content/page-sitemap/fa/entries?page=1&page=2","/api/content/page-sitemap/fa/entries?ownerId=private"}){using var bad=await c.GetAsync(path);Assert.Equal(HttpStatusCode.BadRequest,bad.StatusCode);}
        await using(var scope=sql.Factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<CmsDbContext>();await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE [cms].[Pages] SET [Slug]='sitemap' WHERE [Id]={seeded.Id}");}
        var page=await Read(await c.GetAsync("/api/content/pages/fa/sitemap"));Assert.Equal("sitemap",page["slug"]!.GetValue<string>());Assert.NotNull(page["blocks"]);Assert.Null(page["pageCount"]);
    }
    private sealed class RejectPageReads:DbCommandInterceptor
    {
        public int Calls;public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command,CommandEventData data,InterceptionResult<DbDataReader> result,CancellationToken ct=default){if(command.CommandText.Contains("[cms].[Pages]",StringComparison.Ordinal)||command.CommandText.Contains("[cms].[PageRevisions]",StringComparison.Ordinal)){Calls++;throw new InvalidOperationException("Disabled SEO must not read page projections.");}return base.ReaderExecutingAsync(command,data,result,ct);}
    }
    [Fact]public async Task DisabledManifestDoesNotReadPageTablesAtAll()
    {
        await Seed(1);await Seo(false,false);var guard=new RejectPageReads();await using var factory=sql.Factory.WithWebHostBuilder(b=>b.ConfigureTestServices(s=>s.AddDbContext<CmsDbContext>(o=>o.AddInterceptors(guard))));using var c=factory.CreateClient(new(){HandleCookies=false});foreach(var locale in new[]{"fa","en"})Assert.Equal("0",(await Read(await c.GetAsync("/api/content/page-sitemap/"+locale)))["pageCount"]!.GetValue<string>());Assert.Equal(0,guard.Calls);
    }
}
