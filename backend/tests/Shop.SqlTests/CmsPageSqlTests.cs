using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Cms;
using Shop.Modules.Identity;
using Shop.SharedKernel;
using Xunit;
namespace Shop.SqlTests;
public sealed class CmsPageSqlTests:IClassFixture<SqlFixture>,IDisposable
{
    private Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactory<Program>? auth;public void Dispose()=>auth?.Dispose();
    private readonly SqlFixture sql;public CmsPageSqlTests(SqlFixture fixture)=>sql=fixture;
    private static string Id()=>Guid.NewGuid().ToString("N");private static string S(JsonNode n,string key)=>n[key]!.GetValue<string>();
    private static CmsPageContent Content(string title="صفحهٔ نمونهٔ QA")=>new(new(title,"نمونهٔ موقت؛ سیاست تجاری نیست",[new(Id(),"Text","All","عنوان","<b>متن ساده</b>\nخط دوم 🎮"),new(Id(),"Image","Mobile",Image:"/products/phone-titanium.svg",Alt:"تصویر نمونه")]),new("Synthetic QA page","Temporary sample only",[new(Id(),"Links","Desktop","Related",Links:[new("Catalog","/catalog")])]));
    private static async Task<JsonNode> Read(HttpResponseMessage response)
    {
        using(response){var raw=await response.Content.ReadAsStringAsync();Assert.True(response.IsSuccessStatusCode,$"{(int)response.StatusCode}: {raw}");Assert.Contains("no-store",response.Headers.CacheControl!.ToString());var path=response.RequestMessage!.RequestUri!.PathAndQuery;
            if(path.StartsWith("/api/admin/pages",StringComparison.Ordinal)){Assert.Contains("private",response.Headers.CacheControl.ToString());Assert.Contains("noindex",response.Headers.GetValues("X-Robots-Tag").Single());}
            if(Environment.GetEnvironmentVariable("SHOP_CMS_PAGES_WIRE_DIR")is{Length:>0}dir&&(path.StartsWith("/api/admin/pages",StringComparison.Ordinal)||path.StartsWith("/api/content/pages",StringComparison.Ordinal))){Directory.CreateDirectory(dir);var id=Id();await File.WriteAllTextAsync(System.IO.Path.Combine(dir,id+".json"),raw);await File.WriteAllTextAsync(System.IO.Path.Combine(dir,id+".meta.json"),JsonSerializer.Serialize(new{syntheticQaOnly=true,actualSqlHttpResponse=true,status=(int)response.StatusCode,method=response.RequestMessage.Method.Method,path}));}return JsonNode.Parse(raw)!;}
    }
    private async Task<HttpClient> Staff(string role="ContentManager")
    {
        await using var scope=sql.Factory.Services.CreateAsyncScope();var users=scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>();var name="pageqa"+Id();var user=new ShopUser{UserName=name,Email=name+"@example.test",EmailConfirmed=true,RequireMfa=true};Assert.True((await users.CreateAsync(user,sql.Password)).Succeeded);Assert.True((await users.AddToRoleAsync(user,role)).Succeeded);
        var c=(auth??=sql.Factory.WithWebHostBuilder(_=>{})).CreateClient(new(){HandleCookies=false});c.DefaultRequestHeaders.Add("Origin","http://127.0.0.1:3173");c.DefaultRequestHeaders.Add("X-Sayman-Client","admin");c.DefaultRequestHeaders.Add("X-Sayman-Admin","1");var pending=await Read(await c.PostAsJsonAsync("/api/auth/password",new{Identifier=name,Password=sql.Password}));c.DefaultRequestHeaders.Authorization=new("Bearer",S(pending,"accessToken"));var setup=await Read(await c.PostAsJsonAsync("/api/auth/mfa/setup",new{}));c.DefaultRequestHeaders.Authorization=new("Bearer",S(setup,"accessToken"));var signed=await Read(await c.PostAsJsonAsync("/api/auth/mfa/verify",new{Code=Totp.Code(S(setup,"secret"),DateTimeOffset.UtcNow.ToUnixTimeSeconds()/30)}));c.DefaultRequestHeaders.Authorization=new("Bearer",S(signed,"accessToken"));return c;
    }
    private static string Path(JsonNode p)=>"/api/admin/pages/"+S(p,"pageId");
    private static async Task<JsonNode> Create(HttpClient c,string? slug=null,bool demo=true)=>await Read(await c.PostAsJsonAsync("/api/admin/pages/commands/"+Id(),new CmsPageWrite("Create",Slug:slug??"qa-"+Id(),IsDemo:demo,Content:Content())));
    private static Task<JsonNode> Write(HttpClient c,JsonNode p,string action,CmsPageContent? content=null,string? restore=null,string? command=null)=>ReadWrite(c,Path(p)+"/commands/"+(command??Id()),new(action,S(p,"version"),Content:content,RestoreRevisionId:restore,Confirmed:action!="Save"));
    private static async Task<JsonNode> ReadWrite(HttpClient c,string path,CmsPageWrite input)=>await Read(await c.PostAsJsonAsync(path,input));
    [Fact]
    public async Task ContentEditorCanPrepareAndRecoverPageDraftButCannotChangePublicationOrSettings()
    {
        using var writer = await Staff("ContentEditor");
        using var publisher = await Staff();
        using var anonymous = sql.Factory.CreateClient(new() { HandleCookies = false });
        var page = await Create(writer);
        var path = Path(page);
        var publishedPath = "/api/content/pages/fa/" + S(page, "slug");
        page = await Write(writer, page, "Save", Content("پیش‌نویس نویسنده"));
        var receipt = await Read(await writer.GetAsync(path + "/commands/" + S(page, "commandId")));
        Assert.Equal("Save", S(receipt, "action"));
        using (var hidden = await anonymous.GetAsync(publishedPath))
            Assert.Equal(HttpStatusCode.NotFound, hidden.StatusCode);
        foreach (var action in new[] { "Publish", "Restore", "Unpublish" })
        {
            using var denied = await writer.PostAsJsonAsync(path + "/commands/" + Id(),
                new CmsPageWrite(action, S(page, "version"), RestoreRevisionId: action == "Restore" ? Id() : null, Confirmed: true));
            Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
        }
        foreach (var endpoint in new[] { "/api/admin/content", "/api/admin/redirects", "/api/admin/reviews" })
        {
            using var denied = await writer.GetAsync(endpoint);
            Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
        }
        using var images = await writer.GetAsync("/api/admin/media/capabilities");
        Assert.Equal(HttpStatusCode.OK, images.StatusCode);
        using var videos = await writer.GetAsync("/api/admin/media/videos/capabilities");
        Assert.Equal(HttpStatusCode.Forbidden, videos.StatusCode);
        await Write(publisher, page, "Publish");
        Assert.Equal("پیش‌نویس نویسنده", S(await Read(await anonymous.GetAsync(publishedPath)), "title"));
    }
    [Fact]public async Task DraftIsPrivatePublishIsBilingualAndRestorePreservesIndependentDraft()
    {
        using var staff=await Staff();using var anon=sql.Factory.CreateClient(new(){HandleCookies=false});var p=await Create(staff);var pub="/api/content/pages/fa/"+S(p,"slug");using(var missing=await anon.GetAsync(pub))Assert.Equal(HttpStatusCode.NotFound,missing.StatusCode);
        var draft=await Read(await staff.GetAsync(Path(p)));Assert.NotNull(draft["draft"]);Assert.Null(draft["published"]);p=await Write(staff,p,"Publish");var first=p.DeepClone();var fa=await Read(await anon.GetAsync(pub));var en=await Read(await anon.GetAsync(pub.Replace("/fa/","/en/")));Assert.Equal("fa",S(fa,"locale"));Assert.Equal("en",S(en,"locale"));Assert.Equal(S(fa,"revisionId"),S(en,"revisionId"));Assert.DoesNotContain("actorId",fa.ToJsonString());Assert.DoesNotContain("draft",fa.ToJsonString());
        await using(var scope=sql.Factory.Services.CreateAsyncScope())await Assert.ThrowsAsync<BusinessException>(()=>new CmsPageService(scope.ServiceProvider.GetRequiredService<CmsDbContext>(),false,scope.ServiceProvider.GetRequiredService<IPublicImageReferences>()).PublicAsync(S(p,"slug"),"fa",default));
        p=await Write(staff,p,"Save",Content("پیش‌نویس منتشرنشده"));Assert.Equal(S(fa,"title"),S(await Read(await anon.GetAsync(pub)),"title"));p=await Write(staff,p,"Publish");Assert.Equal("پیش‌نویس منتشرنشده",S(await Read(await anon.GetAsync(pub)),"title"));p=await Write(staff,p,"Save",Content("این پیش‌نویس باید بماند"));p=await Write(staff,p,"Restore",restore:S(first,"revisionId"));Assert.NotEqual(S(first,"revisionId"),S(p,"revisionId"));Assert.Equal(S(fa,"title"),S(await Read(await anon.GetAsync(pub)),"title"));draft=await Read(await staff.GetAsync(Path(p)));Assert.Equal("این پیش‌نویس باید بماند",S(draft["draft"]!["fa"]!,"title"));
        var publishedReceipt=p.DeepClone();p=await Write(staff,p,"Unpublish");using(var hidden=await anon.GetAsync(pub))Assert.Equal(HttpStatusCode.NotFound,hidden.StatusCode);var receipt=await Read(await staff.GetAsync(Path(p)+"/commands/"+S(publishedReceipt,"commandId")));Assert.Equal(S(publishedReceipt,"revisionId"),S(receipt,"revisionId"));Assert.True(receipt["replayed"]!.GetValue<bool>());var history=await Read(await staff.GetAsync(Path(p)+"/history"));Assert.Equal(4,history["items"]!.AsArray().Count);Assert.Equal("Unpublish",S(history["items"]![0]!,"action"));
    }
    [Fact]public async Task ConcurrentReplayAndStaleVersionAndAuditFailureAreAtomic()
    {
        using var staff=await Staff();var cmd=Id();var slug="atomic-"+Id();var input=new CmsPageWrite("Create",Slug:slug,IsDemo:true,Content:Content());var path="/api/admin/pages/commands/"+cmd;
        await using(var scope=sql.Factory.Services.CreateAsyncScope())await scope.ServiceProvider.GetRequiredService<IdentityDbContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] WITH NOCHECK ADD CONSTRAINT CK_QA_PageAudit CHECK ([Action]<>'CMS_PAGE_CREATE')");
        try{using var failed=await staff.PostAsJsonAsync(path,input);Assert.Equal(HttpStatusCode.Conflict,failed.StatusCode);}finally{await using var scope=sql.Factory.Services.CreateAsyncScope();await scope.ServiceProvider.GetRequiredService<IdentityDbContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] DROP CONSTRAINT CK_QA_PageAudit");}
        await using(var scope=sql.Factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<CmsDbContext>();Assert.False(await db.Pages.AnyAsync(x=>x.Slug==slug));Assert.False(await db.PageCommands.AnyAsync(x=>x.CommandId==cmd));}
        var responses=await Task.WhenAll(staff.PostAsJsonAsync(path,input),staff.PostAsJsonAsync(path,input));var bodies=await Task.WhenAll(responses.Select(Read));Assert.Single(bodies,x=>x["replayed"]!.GetValue<bool>());Assert.Equal(S(bodies[0],"pageId"),S(bodies[1],"pageId"));
        using(var changed=await staff.PostAsJsonAsync(path,input with{Slug="changed-"+Id()}))Assert.Equal(HttpStatusCode.Conflict,changed.StatusCode);
        var p=bodies[0];var concurrent=await Task.WhenAll(staff.PostAsJsonAsync(Path(p)+"/commands/"+Id(),new CmsPageWrite("Publish",S(p,"version"),Confirmed:true)),staff.PostAsJsonAsync(Path(p)+"/commands/"+Id(),new CmsPageWrite("Publish",S(p,"version"),Confirmed:true)));Assert.Single(concurrent,x=>x.StatusCode==HttpStatusCode.OK);Assert.Single(concurrent,x=>x.StatusCode==HttpStatusCode.Conflict);foreach(var r in concurrent){if(r.IsSuccessStatusCode)await Read(r);else r.Dispose();}
        await using var final=sql.Factory.Services.CreateAsyncScope();var cms=final.ServiceProvider.GetRequiredService<CmsDbContext>();Assert.Equal(1,await cms.PageRevisions.CountAsync(x=>x.PageId==S(p,"pageId")));Assert.Equal(2,await cms.PageCommands.CountAsync(x=>x.PageId==S(p,"pageId")));Assert.Equal(1,await final.ServiceProvider.GetRequiredService<IdentityDbContext>().Audit.CountAsync(x=>x.Resource==path));
    }
    [Fact]public async Task AuthorizationOriginUnknownFieldsAndCrossPageRestoreFailClosed()
    {
        using var staff=await Staff();using var other=await Staff();using var finance=await Staff("FinanceManager");using var anon=sql.Factory.CreateClient(new(){HandleCookies=false});var p=await Create(staff);using(var unauth=await anon.GetAsync(Path(p)))Assert.Equal(HttpStatusCode.Unauthorized,unauth.StatusCode);using(var forbidden=await finance.GetAsync(Path(p)))Assert.Equal(HttpStatusCode.Forbidden,forbidden.StatusCode);using(var receipt=await other.GetAsync("/api/admin/pages/commands/"+S(p,"commandId")))Assert.Equal(HttpStatusCode.NotFound,receipt.StatusCode);
        using(var unknown=await staff.PostAsJsonAsync(Path(p)+"/commands/"+Id(),new{action="Publish",version=S(p,"version"),confirmed=true,paid=true}))Assert.Equal(HttpStatusCode.BadRequest,unknown.StatusCode);
        using(var query=await staff.GetAsync(Path(p)+"/history?beforePublication=01"))Assert.Equal(HttpStatusCode.BadRequest,query.StatusCode);using(var duplicate=await staff.GetAsync("/api/admin/pages?cursor=a&cursor=b"))Assert.Equal(HttpStatusCode.BadRequest,duplicate.StatusCode);
        var q=await Create(staff);q=await Write(staff,q,"Publish");using(var cross=await staff.PostAsJsonAsync(Path(p)+"/commands/"+Id(),new CmsPageWrite("Restore",S(p,"version"),RestoreRevisionId:S(q,"revisionId"),Confirmed:true)))Assert.Equal(HttpStatusCode.NotFound,cross.StatusCode);
        staff.DefaultRequestHeaders.Remove("Origin");staff.DefaultRequestHeaders.Add("Origin","https://untrusted.example");using(var origin=await staff.PostAsJsonAsync(Path(p)+"/commands/"+Id(),new CmsPageWrite("Publish",S(p,"version"),Confirmed:true)))Assert.Equal(HttpStatusCode.Forbidden,origin.StatusCode);
    }
    [Fact]public async Task ImmutableRowsSamePageForeignKeysTamperAndDownGuardProtectHistory()
    {
        using var staff=await Staff();var p=await Create(staff);p=await Write(staff,p,"Publish");var q=await Create(staff);q=await Write(staff,q,"Publish");
        await using(var scope=sql.Factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<CmsDbContext>();var revision=await db.PageRevisions.SingleAsync(x=>x.Id==S(p,"revisionId"));revision.Action="Restore";Assert.Equal("cms_page_immutable",Assert.Throws<BusinessException>(()=>db.SaveChanges()).Code);db.ChangeTracker.Clear();var head=await db.Pages.SingleAsync(x=>x.Id==S(p,"pageId"));head.Slug="renamed";Assert.Equal("cms_page_immutable",Assert.Throws<BusinessException>(()=>db.SaveChanges()).Code);db.ChangeTracker.Clear();await Assert.ThrowsAsync<Microsoft.Data.SqlClient.SqlException>(()=>db.Database.ExecuteSqlInterpolatedAsync($"UPDATE [cms].[Pages] SET [PublishedRevisionId]={S(q,"revisionId")} WHERE [Id]={S(p,"pageId")}"));await Assert.ThrowsAsync<Microsoft.Data.SqlClient.SqlException>(()=>db.GetService<IMigrator>().MigrateAsync("20261022094909_CmsInitial"));Assert.True(await db.Pages.AnyAsync(x=>x.Id==S(p,"pageId")));
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE [cms].[PageRevisions] SET [BodyHash]={new string('0',64)} WHERE [Id]={S(p,"revisionId")}");}
        using var anon=sql.Factory.CreateClient(new(){HandleCookies=false});using(var broken=await anon.GetAsync("/api/content/pages/fa/"+S(p,"slug")))Assert.Equal(HttpStatusCode.ServiceUnavailable,broken.StatusCode);
        await using(var scope=sql.Factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<CmsDbContext>();await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE [cms].[PageCommands] SET [ResultHash]={new string('0',64)} WHERE [CommandId]={S(p,"commandId")}");}
        using(var brokenReceipt=await staff.GetAsync(Path(p)+"/commands/"+S(p,"commandId")))Assert.Equal(HttpStatusCode.ServiceUnavailable,brokenReceipt.StatusCode);
    }
    [Fact]public async Task PublicationHistoryUsesBoundedSeekAndRestoreCreatesAnotherRevision()
    {
        using var staff=await Staff();var p=await Create(staff);string? first=null;for(var i=0;i<22;i++){p=await Write(staff,p,"Publish");first??=S(p,"revisionId");}var h=await Read(await staff.GetAsync(Path(p)+"/history"));Assert.Equal(20,h["items"]!.AsArray().Count);Assert.Equal(3,h["nextBefore"]!.GetValue<int>());var old=await Read(await staff.GetAsync(Path(p)+"/history?beforePublication=3"));Assert.Equal(2,old["items"]!.AsArray().Count);Assert.Null(old["nextBefore"]);var preview=await Read(await staff.GetAsync(Path(p)+"/revisions/"+first));Assert.Equal(S(p,"pageId"),S(preview,"pageId"));p=await Write(staff,p,"Restore",restore:first);Assert.Equal(23,p["publication"]!.GetValue<int>());Assert.NotEqual(first,S(p,"revisionId"));await Read(await staff.GetAsync("/api/admin/pages"));
    }
}
