using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Shop.Modules.Cms;
using Shop.Modules.Identity;
using Xunit;

namespace Shop.SqlTests;

public sealed class DevelopmentCmsExamplesSqlTests(SqlFixture sql) : IClassFixture<SqlFixture>
{
    [Fact]
    public async Task ExplicitExamplesPublishBothLanguagesAndNeverOverwriteAnUnpublishedExistingSlug()
    {
        var environment = sql.Factory.Services.GetRequiredService<IHostEnvironment>();
        var siteBefore = await SiteDocuments();
        await using (var scope = sql.Factory.Services.CreateAsyncScope())
        {
            await Assert.ThrowsAsync<InvalidOperationException>(() =>
                DevelopmentCmsExamples.RunAsync(scope.ServiceProvider, new ProductionEnvironment(), default));
            var db = scope.ServiceProvider.GetRequiredService<CmsDbContext>();
            Assert.Equal(0, await db.Pages.CountAsync());
            Assert.Equal(0, await db.BlogPosts.CountAsync());
        }

        DevelopmentCmsExamples.Result first;
        await using (var scope = sql.Factory.Services.CreateAsyncScope())
        {
            first = await DevelopmentCmsExamples.RunAsync(scope.ServiceProvider, environment, default);
            Assert.Equal(5, first.Published);
            Assert.Equal(0, first.ExistingPreserved);
        }

        using var storefront = sql.Factory.CreateClient(new() { HandleCookies = false });
        foreach (var item in first.Items)
        {
            using var fa = await storefront.GetAsync($"/api/content/{item.Kind}/fa/{item.Slug}");
            using var en = await storefront.GetAsync($"/api/content/{item.Kind}/en/{item.Slug}");
            Assert.Equal(HttpStatusCode.OK, fa.StatusCode);
            Assert.Equal(HttpStatusCode.OK, en.StatusCode);
            var persian = (await fa.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>());
            var english = (await en.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>());
            Assert.True(persian.GetProperty("isDemo").GetBoolean());
            Assert.True(english.GetProperty("isDemo").GetBoolean());
            Assert.EndsWith("نمونهٔ آموزشی", persian.GetProperty("title").GetString());
            Assert.EndsWith("Demo", english.GetProperty("title").GetString());
            Assert.Equal(persian.GetProperty("revisionId").GetString(), english.GetProperty("revisionId").GetString());
            Assert.Contains(persian.GetProperty("blocks").EnumerateArray(), block => block.GetProperty("kind").GetString() == "Links");
        }

        string slug = first.Items.First(item => item.Kind == "pages").Slug;
        string pageId;
        await using (var scope = sql.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CmsDbContext>();
            var page = await db.Pages.AsNoTracking().SingleAsync(row => row.Slug == slug);
            pageId = page.Id;
            var service = scope.ServiceProvider.GetRequiredService<CmsPageCoordinator>();
            await service.WriteAsync("fixture-staff", page.Id, Guid.NewGuid().ToString("N"),
                new("Unpublish", Version: Convert.ToBase64String(page.Version), Confirmed: true), "/fixture", "fixture-unpublish", default);
        }
        await using (var scope = sql.Factory.Services.CreateAsyncScope())
        {
            var again = await DevelopmentCmsExamples.RunAsync(scope.ServiceProvider, environment, default);
            Assert.Equal(0, again.Published);
            Assert.Equal(5, again.ExistingPreserved);
        }
        await using (var scope = sql.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CmsDbContext>();
            var identity = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
            var page = await db.Pages.AsNoTracking().SingleAsync(row => row.Slug == slug);
            Assert.Equal(pageId, page.Id);
            Assert.Equal(2, page.Publication);
            Assert.Null(page.PublishedRevisionId);
            Assert.Equal(3, await db.BlogPostRevisions.CountAsync());
            Assert.Equal(5, await identity.Audit.CountAsync(row => row.ActorId == DevelopmentCmsExamples.Actor));
        }
        using var unavailable = await storefront.GetAsync($"/api/content/pages/fa/{slug}");
        Assert.Equal(HttpStatusCode.NotFound, unavailable.StatusCode);
        Assert.Equal(siteBefore, await SiteDocuments());
    }

    private async Task<string[]> SiteDocuments()
    {
        await using var scope = sql.Factory.Services.CreateAsyncScope();
        var cms = scope.ServiceProvider.GetRequiredService<CmsDbContext>();
        return await cms.Documents.AsNoTracking().OrderBy(row => row.Key).ThenBy(row => row.Locale)
            .Select(row => row.DraftJson + "|" + row.PublishedJson).ToArrayAsync();
    }

    private sealed class ProductionEnvironment : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = Environments.Production;
        public string ApplicationName { get; set; } = "Shop.Tests";
        public string ContentRootPath { get; set; } = "";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
