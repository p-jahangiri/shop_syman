using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Media;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Identity;
using Shop.SharedKernel;
using Xunit;
namespace Shop.SqlTests;

public sealed class PublicVideoSqlTests(SqlFixture fixture) : IClassFixture<SqlFixture>
{
    private sealed class Scanner : IImageScanner
    {
        public bool Configured => true; public int Calls; public Task ScanAsync(ReadOnlyMemory<byte> input, CancellationToken ct)
        {
            Calls++;
            return Task.CompletedTask;
        }
    }
    private sealed class Store : IPublicVideoStore
    {
        public bool Configured => true; public bool Fail; public readonly Dictionary<string, byte[]> Objects = new(); public Task PutAsync(string id, SanitizedVideo video, CancellationToken ct)
        {
            if (Fail)
                throw new BusinessException("media_unavailable", "Test store failure.");
            Objects[id] = video.Bytes;
            return Task.CompletedTask;
        }
        public Task<byte[]?> ReadAsync(string id, string extension, int bytes, CancellationToken ct) => Task.FromResult(Objects.GetValueOrDefault(id)); public Task DeleteAsync(string id, string extension, CancellationToken ct)
        {
            Objects.Remove(id);
            return Task.CompletedTask;
        }
    }
    private static string Fixture()
    {
        foreach (var start in new[] { Directory.GetCurrentDirectory(), AppContext.BaseDirectory })
        for (var p = new DirectoryInfo(start); p is not null; p = p.Parent)
        foreach (var relative in new[] { "backend/tests/fixtures/catalog-video/valid.mp4", "tests/fixtures/catalog-video/valid.mp4" })
        {
            var file = Path.Combine(p.FullName, relative);
            if (File.Exists(file))
                return file;
        }
        throw new InvalidOperationException("Video fixture is missing.");
    }
    private static async Task<JsonNode> Json(HttpResponseMessage response)
    {
        using (response)
        {
            var body = await response.Content.ReadAsStringAsync();
            Assert.True(response.IsSuccessStatusCode, body);
            return JsonNode.Parse(body)!;
        }
    }
    private async Task<HttpClient> Staff(WebApplicationFactory<Program> factory)
    {
        var account = await fixture.CreateAdministratorAsync();
        var client = factory.CreateClient(new()
        {
            HandleCookies = false
        });
        client.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:3173");
        client.DefaultRequestHeaders.Add("X-Sayman-Client", "admin");
        client.DefaultRequestHeaders.Add("X-Sayman-Admin", "1");
        var login = await Json(await client.PostAsJsonAsync("/api/auth/password", new
        {
            Identifier = account.Username,
            account.Password
        }));
        client.DefaultRequestHeaders.Authorization = new("Bearer", login["accessToken"]!.GetValue<string>());
        var setup = await Json(await client.PostAsJsonAsync("/api/auth/mfa/setup", new
        {
        }));
        client.DefaultRequestHeaders.Authorization = new("Bearer", setup["accessToken"]!.GetValue<string>());
        var verified = await Json(await client.PostAsJsonAsync("/api/auth/mfa/verify", new
        {
            Code = Totp.Code(setup["secret"]!.GetValue<string>(), DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 30)
        }));
        client.DefaultRequestHeaders.Authorization = new("Bearer", verified["accessToken"]!.GetValue<string>());
        return client;
    }
    private WebApplicationFactory<Program> Factory(Store store, Scanner scanner) => fixture.Factory.WithWebHostBuilder(b => b.ConfigureTestServices(s => { s.AddSingleton<IPublicVideoStore>(store); s.AddSingleton<IImageScanner>(scanner); s.AddSingleton<IVideoSanitizer>(new FfmpegVideoSanitizer(new(OperatingSystem.IsMacOS() ? "/opt/homebrew/bin/ffmpeg" : "/usr/bin/ffmpeg", OperatingSystem.IsMacOS() ? "/opt/homebrew/bin/ffprobe" : "/usr/bin/ffprobe"))); }));
    [Fact]
    public async Task RealMp4UploadRequiresStaffMfaAndPublishesOnlySanitizedReadyBytesWithRanges()
    {
        var store = new Store();
        var scanner = new Scanner();
        await using var factory = Factory(store, scanner);
        using var anonymous = factory.CreateClient();
        using (var denied = new MultipartFormDataContent())
        {
            denied.Add(new ByteArrayContent(await File.ReadAllBytesAsync(Fixture())), "file", "valid.mp4");
            Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PostAsync("/api/admin/media/videos", denied)).StatusCode);
        }
        using var client = await Staff(factory);
        using var content = new MultipartFormDataContent();
        var file = new ByteArrayContent(await File.ReadAllBytesAsync(Fixture()));
        file.Headers.ContentType = new("video/mp4");
        content.Add(file, "file", "valid.mp4");
        var dto = await Json(await client.PostAsync("/api/admin/media/videos", content));
        Assert.Equal(2, scanner.Calls);
        var id = dto["id"]!.GetValue<string>();
        var path = "/api" + dto["url"]!.GetValue<string>();
        using var full = await anonymous.GetAsync(path);
        Assert.Equal(HttpStatusCode.OK, full.StatusCode);
        Assert.Equal("video/mp4", full.Content.Headers.ContentType!.MediaType);
        var clean = await full.Content.ReadAsByteArrayAsync();
        Assert.Equal(store.Objects[id], clean);
        Assert.DoesNotContain("PrivateFixtureMetadata", System.Text.Encoding.UTF8.GetString(clean));
        Assert.Equal('"' + Convert.ToHexStringLower(SHA256.HashData(clean)) + '"', full.Headers.ETag!.Tag);
        Assert.Contains("catalog-video-v1", full.Headers.GetValues("X-Shop-Public-Resource"));
        Assert.False(full.Headers.Contains("Set-Cookie"));
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.Range = new(0, 15);
        using var partial = await anonymous.SendAsync(request);
        Assert.Equal(HttpStatusCode.PartialContent, partial.StatusCode);
        Assert.Equal(clean[..16], await partial.Content.ReadAsByteArrayAsync());
        Assert.Equal(clean.Length, partial.Content.Headers.ContentRange!.Length);
        await using var scope = factory.Services.CreateAsyncScope();
        Assert.Equal("Ready", (await scope.ServiceProvider.GetRequiredService<CatalogDbContext>().Set<PublicVideoAsset>().SingleAsync(a => a.Id == id)).Status);
    }
    [Fact]
    public async Task FailedStorageNeverExposesAStagedVideo()
    {
        var store = new Store { Fail = true };
        var scanner = new Scanner();
        await using var factory = Factory(store, scanner);
        await using var scope = factory.Services.CreateAsyncScope();
        var service = scope.ServiceProvider.GetRequiredService<PublicVideoService>();
        var before = await scope.ServiceProvider.GetRequiredService<CatalogDbContext>().Set<PublicVideoAsset>().Select(a => a.Id).ToArrayAsync();
        await Assert.ThrowsAsync<BusinessException>(() => service.UploadAsync(File.ReadAllBytes(Fixture()), "valid.mp4", "video/mp4", "failed-upload-test", CancellationToken.None));
        var db = scope.ServiceProvider.GetRequiredService<CatalogDbContext>();
        var asset = await db.Set<PublicVideoAsset>().SingleAsync(a => a.CreatedBy == "failed-upload-test" && !before.Contains(a.Id));
        Assert.Equal("Failed", asset.Status);
        Assert.Empty(store.Objects);
        Assert.Null(await service.ReadAsync(asset.Id, "mp4", CancellationToken.None));
    }
    [Fact]
    public async Task VideoReferencesStaySeparateFromImageGalleriesAndLegacyEditsPreserveThem()
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<CatalogDbContext>();
        var service = scope.ServiceProvider.GetRequiredService<ICatalogService>();
        var category = await db.Categories.FirstAsync();
        var brand = await db.Brands.FirstAsync();
        var slug = "video-" + Guid.NewGuid().ToString("N");
        var input = new ProductInput(category.Id, brand.Id, slug, "Draft", false, false, [new("fa", "ویدیوی نمونه"), new("en", "Video demo")], [], [], ["/products/charger.svg"], [], [], null, [new("https://cdn.example.test/video.mp4")]);
        await using var tx = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable);
        var id = await service.SaveProductAsync(null, input, "video-test", CancellationToken.None);
        var detail = await new ProductWorkspaceReader(db).DetailAsync(id, CancellationToken.None);
        Assert.Single(detail.Product.Media);
        Assert.Single(detail.Videos);
        Assert.Equal("https://cdn.example.test/video.mp4", detail.Videos[0].Url);
        await service.SaveProductAsync(id, input with
        {
            Version = detail.Product.Version,
            Videos = null
        }, "video-test", CancellationToken.None);
        Assert.Single((await new ProductWorkspaceReader(db).DetailAsync(id, CancellationToken.None)).Videos);
        await tx.CommitAsync();
    }
    [Fact]
    public async Task DevelopmentExamplesAreVisibleVariedAndIdempotentWithoutChangingAccountsOrPolicies()
    {
        var store = new Store();
        var scanner = new Scanner();
        await using var factory = Factory(store, scanner);
        await using var scope = factory.Services.CreateAsyncScope();
        var services = scope.ServiceProvider;
        var users = services.GetRequiredService<IdentityDbContext>();
        var beforeUsers = await users.Users.CountAsync();
        var db = services.GetRequiredService<CatalogDbContext>();
        var environment = services.GetRequiredService<Microsoft.Extensions.Hosting.IHostEnvironment>();
        var directory = new DirectoryInfo(Path.GetDirectoryName(Fixture())!);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "Seed/development.json")))
            directory = directory.Parent;
        Assert.NotNull(directory);
        var contentRoot = Path.Combine(directory.FullName, "src/Shop.Api");
        await DevelopmentProductExamples.RunAsync(services, environment, contentRoot, CancellationToken.None);
        var first = await services.GetRequiredService<ICatalogService>().ReadAsync("fa", CancellationToken.None);
        var products = first.Products.Where(p => p.Slug.StartsWith("d70-sample-", StringComparison.Ordinal)).ToArray();
        Assert.Equal(6, products.Length);
        Assert.Equal(14, products.Sum(p => p.Variants.Length));
        Assert.Equal(4, products.SelectMany(p => p.Variants).Count(v => v.Stock == 0));
        Assert.Equal(3, products.SelectMany(p => p.Variants).Count(v => v.CompareAtRial != null));
        Assert.All(products, p => Assert.Equal("نمونهٔ آموزشی", p.Badge));
        Assert.Single(products, p => p.Videos?.Length > 0);
        var movements = await services.GetRequiredService<Shop.Modules.Inventory.InventoryDbContext>().Movements.CountAsync(m => m.ActorId == "development-sample:product-workspace");
        Assert.Equal(10, movements);
        await DevelopmentProductExamples.RunAsync(services, environment, contentRoot, CancellationToken.None);
        Assert.Equal(6, await db.Products.CountAsync(p => p.Slug.StartsWith("d70-sample-")));
        Assert.Equal(movements, await services.GetRequiredService<Shop.Modules.Inventory.InventoryDbContext>().Movements.CountAsync(m => m.ActorId == "development-sample:product-workspace"));
        Assert.Equal(beforeUsers, await users.Users.CountAsync());
        Assert.Equal(2, scanner.Calls);
    }
}
