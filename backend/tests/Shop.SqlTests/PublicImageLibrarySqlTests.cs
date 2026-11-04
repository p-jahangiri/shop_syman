using System.Data.Common;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Catalog.Media;
using Shop.Modules.Identity;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;

public sealed class PublicImageLibrarySqlTests(SqlFixture fixture) : IClassFixture<SqlFixture>
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private sealed class Clock(DateTimeOffset now) : TimeProvider { public override DateTimeOffset GetUtcNow() => now; }
    private sealed record Scenario(string Prefix, DateTimeOffset At);
    private static Scenario ScenarioForTest() => new(Guid.NewGuid().ToString("N")[..24], DateTimeOffset.UtcNow.AddDays(-2));
    private static string Id(Scenario s, int number) => s.Prefix + number.ToString("x8");
    private static PublicImageAsset Asset(Scenario s, int index, string status = "Ready", DateTimeOffset? at = null) => new() {
        Id = Id(s, index), Status = status, CreatedAt = at ?? s.At, CreatedBy = "private-uploader", OriginalSha256 = new('e', 64), InputBytes = 1234, Width = 128, Height = 96,
        Variants = PublicImagePaths.Names.Select(name => new PublicImageVariant { AssetId = Id(s, index), Name = name, Width = 128, Height = 96, Bytes = 1024, Sha256 = new('b', 64) }).ToList()
    };
    private async Task Add(params PublicImageAsset[] assets)
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<CatalogDbContext>(); Assert.StartsWith("SaymanTest_", db.Database.GetDbConnection().Database); db.PublicImages.AddRange(assets); await db.SaveChangesAsync(Ct);
    }
    private async Task<PublicImageLibraryPage> Read(PublicImageLibraryFilter filter, string? cursor = null, DateTimeOffset? now = null)
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); return await new PublicImageLibrary(scope.ServiceProvider.GetRequiredService<CatalogDbContext>(), new Clock(now ?? DateTimeOffset.UtcNow)).ReadAsync(filter, cursor, Ct);
    }
    private async Task<string> Snapshot(string prefix)
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<CatalogDbContext>();
        var rows = await db.PublicImages.AsNoTracking().Include(a => a.Variants).Where(a => a.Id.StartsWith(prefix)).OrderBy(a => a.Id).ToArrayAsync(Ct);
        return JsonSerializer.Serialize(rows.Select(a => new { a.Id, a.Status, a.CreatedAt, a.CreatedBy, a.OriginalSha256, a.InputBytes, a.Width, a.Height, a.Version, a.CleanupLeaseId, a.CleanupLeaseExpiresAt, a.LastCleanupAt, Variants = a.Variants.OrderBy(v => v.Name).Select(v => new { v.AssetId, v.Name, v.Width, v.Height, v.Bytes, v.Sha256 }) }));
    }

    [Fact]
    public async Task ReadyOnlyAndSafeMetadataAreAvailableWithoutConfiguredUploadAndReadsChangeNothing()
    {
        var s = ScenarioForTest(); await Add(new[] { "Ready", "Staged", "Failed", "Cleaning", "Purged" }.Select((status, i) => Asset(s, i, status)).ToArray());
        var before = await Snapshot(s.Prefix); long audit;
        await using (var scope = fixture.Factory.Services.CreateAsyncScope()) audit = await scope.ServiceProvider.GetRequiredService<IdentityDbContext>().Audit.LongCountAsync(Ct);
        var page = await Read(PublicImageLibraryFilter.Create(s.Prefix.ToUpperInvariant())); Assert.Single(page.Items); Assert.Equal(Id(s, 0), page.Items[0].Id); Assert.Equal(PublicImagePaths.Names, page.Items[0].Variants.Select(v => v.Name)); Assert.Null(page.NextCursor);
        Assert.Equal(PublicImagePaths.Url(Id(s, 0), "card"), page.Items[0].Url);
        var json = JsonSerializer.Serialize(page);
        foreach (var forbidden in new[] { "CreatedBy", "OriginalSha256", "InputBytes", "Status", "Cleanup", "private-uploader", new string('e', 64), "catalog-images/" }) Assert.DoesNotContain(forbidden, json);
        Assert.Equal(before, await Snapshot(s.Prefix));
        await using var final = fixture.Factory.Services.CreateAsyncScope(); Assert.Equal(audit, await final.ServiceProvider.GetRequiredService<IdentityDbContext>().Audit.LongCountAsync(Ct));
    }

    [Fact]
    public async Task EqualTimestampsPaginateWithoutDuplicatesAndLaterBackdatedReadyChangesWaitForRefresh()
    {
        var s = ScenarioForTest(); await Add(Enumerable.Range(1, 49).Select(i => Asset(s, i)).Append(Asset(s, 0, "Staged", s.At.AddDays(-1))).ToArray());
        var filter = PublicImageLibraryFilter.Create(s.Prefix); var first = await Read(filter); Assert.Equal(24, first.Items.Length); Assert.NotNull(first.NextCursor);
        await Add(Asset(s, 50, at: s.At.AddDays(-1)));
        await using (var scope = fixture.Factory.Services.CreateAsyncScope()) await scope.ServiceProvider.GetRequiredService<CatalogDbContext>().PublicImages.Where(a => a.Id == Id(s, 0)).ExecuteUpdateAsync(set => set.SetProperty(a => a.Status, "Ready"), Ct);
        var replay = await Read(filter, first.NextCursor); var repeated = await Read(filter, first.NextCursor); Assert.Equal(replay.Items.Select(i => i.Id), repeated.Items.Select(i => i.Id)); Assert.Equal(first.AsOfAt, replay.AsOfAt);
        var final = await Read(filter, replay.NextCursor); Assert.Single(final.Items); Assert.Null(final.NextCursor);
        var ids = first.Items.Concat(replay.Items).Concat(final.Items).Select(i => i.Id).ToArray();
        Assert.Equal(Enumerable.Range(1, 49).Reverse().Select(i => Id(s, i)), ids); Assert.Equal(49, ids.Distinct().Count());
        var refreshed = new List<string>(); string? cursor = null;
        do { var page = await Read(filter, cursor); refreshed.AddRange(page.Items.Select(i => i.Id)); cursor = page.NextCursor; } while (cursor is not null);
        Assert.Equal(51, refreshed.Count); Assert.Contains(Id(s, 0), refreshed); Assert.Contains(Id(s, 50), refreshed);
        var other = ScenarioForTest(); Assert.Equal("invalid_image_library_cursor", (await Assert.ThrowsAsync<BusinessException>(() => Read(PublicImageLibraryFilter.Create(other.Prefix), first.NextCursor))).Code);
    }

    [Fact]
    public async Task ExactlyTwentyFourHasNoContinuationButTwentyFiveHasOneFinalRow()
    {
        var a = ScenarioForTest(); var b = ScenarioForTest(); await Add(Enumerable.Range(0, 24).Select(i => Asset(a, i)).Concat(Enumerable.Range(0, 25).Select(i => Asset(b, i))).ToArray());
        var exact = await Read(PublicImageLibraryFilter.Create(a.Prefix)); Assert.Equal(24, exact.Items.Length); Assert.Null(exact.NextCursor);
        var filter = PublicImageLibraryFilter.Create(b.Prefix); var first = await Read(filter); Assert.Equal(24, first.Items.Length); Assert.NotNull(first.NextCursor);
        var last = await Read(filter, first.NextCursor); Assert.Single(last.Items); Assert.Null(last.NextCursor); Assert.Equal(Id(b, 0), last.Items[0].Id);
    }

    [Fact]
    public async Task PrefixUtcTickBoundsAndAsOfAreAppliedOnTheServer()
    {
        var s = ScenarioForTest(); await Add(Enumerable.Range(0, 4).Select(i => Asset(s, i, at: s.At.AddTicks(i - 1))).ToArray());
        var page = await Read(PublicImageLibraryFilter.Create(s.Prefix.ToUpperInvariant(), PublicImageLibraryFilter.Time(s.At), PublicImageLibraryFilter.Time(s.At.AddTicks(2))));
        Assert.Equal(new[] { Id(s, 2), Id(s, 1) }, page.Items.Select(i => i.Id));
        Assert.Empty((await Read(PublicImageLibraryFilter.Create(s.Prefix, PublicImageLibraryFilter.Time(s.At), PublicImageLibraryFilter.Time(s.At)))).Items);
        Assert.Empty((await Read(PublicImageLibraryFilter.Create(s.Prefix), now: s.At.AddTicks(-2))).Items);
        Assert.Single((await Read(PublicImageLibraryFilter.Create(Id(s, 0)))).Items);
    }

    [Fact]
    public async Task CorruptReadyMetadataFailsTheWholePageAndIsNotSilentlyDropped()
    {
        var s = ScenarioForTest(); var missing = Asset(s, 0); missing.Variants.RemoveAt(0); await Add(missing);
        Assert.Equal("media_unavailable", (await Assert.ThrowsAsync<BusinessException>(() => Read(PublicImageLibraryFilter.Create(s.Prefix)))).Code);
        var t = ScenarioForTest(); var badSha = Asset(t, 0); badSha.Variants[0].Sha256 = "not-a-sanitized-digest"; await Add(badSha);
        Assert.Equal("media_unavailable", (await Assert.ThrowsAsync<BusinessException>(() => Read(PublicImageLibraryFilter.Create(t.Prefix)))).Code);
        var u = ScenarioForTest(); var oversized = Asset(u, 0); oversized.Variants[0].Width = 321; await Add(oversized);
        Assert.Equal("media_unavailable", (await Assert.ThrowsAsync<BusinessException>(() => Read(PublicImageLibraryFilter.Create(u.Prefix)))).Code);
    }

    private sealed class BeforeLibrary(Func<Task> commit) : DbCommandInterceptor
    {
        public int Calls;
        public override async ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            if (command.CommandText.Contains("SELECT * FROM [catalog].[PublicImages] WHERE [Version] <", StringComparison.Ordinal) && Interlocked.CompareExchange(ref Calls, 1, 0) == 0) await commit();
            return result;
        }
    }
    [Fact]
    public async Task UncommittedReadyVersionCapturedAtBoundaryCannotEnterLaterPagesAfterCommit()
    {
        var s = ScenarioForTest(); await Add(Enumerable.Range(1, 30).Select(i => Asset(s, i)).Append(Asset(s, 0, "Staged", s.At.AddDays(-1))).ToArray());
        await using var pendingScope = fixture.Factory.Services.CreateAsyncScope(); var pending = pendingScope.ServiceProvider.GetRequiredService<CatalogDbContext>(); await using var transaction = await pending.Database.BeginTransactionAsync(Ct);
        var staged = await pending.PublicImages.SingleAsync(a => a.Id == Id(s, 0), Ct); staged.Status = "Ready"; await pending.SaveChangesAsync(Ct);
        var intercept = new BeforeLibrary(() => transaction.CommitAsync(Ct)); await using var reading = new CatalogDbContext(new DbContextOptionsBuilder<CatalogDbContext>().UseSqlServer(fixture.Connection).AddInterceptors(intercept).Options);
        var filter = PublicImageLibraryFilter.Create(s.Prefix); var first = await new PublicImageLibrary(reading, new Clock(DateTimeOffset.UtcNow)).ReadAsync(filter, null, Ct);
        Assert.Equal(1, intercept.Calls); Assert.Equal(24, first.Items.Length); Assert.NotNull(first.NextCursor); Assert.Equal(staged.Version, PublicImageLibraryPaging.Decode(first.NextCursor, filter)!.Watermark);
        var second = await Read(filter, first.NextCursor); Assert.Equal(6, second.Items.Length); Assert.Null(second.NextCursor); Assert.DoesNotContain(Id(s, 0), first.Items.Concat(second.Items).Select(i => i.Id));
        var refreshed = await Read(filter); var refreshedLast = await Read(filter, refreshed.NextCursor); Assert.Equal(7, refreshedLast.Items.Length); Assert.Contains(Id(s, 0), refreshedLast.Items.Select(i => i.Id));
    }

    private static async Task<JsonNode> Json(HttpResponseMessage response)
    {
        using (response) { Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync()); return JsonNode.Parse(await response.Content.ReadAsStringAsync())!; }
    }
    [Fact]
    public async Task ActualMfaReadsLibraryWithDisabledStorageAndScannerAndNoAuditOrMetadataMutation()
    {
        var s = ScenarioForTest(); await Add(Asset(s, 0)); var before = await Snapshot(s.Prefix); var account = await fixture.CreateAdministratorAsync();
        using var client = fixture.Factory.CreateClient(new() { HandleCookies = false }); client.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:3173"); client.DefaultRequestHeaders.Add("X-Sayman-Client", "admin"); client.DefaultRequestHeaders.Add("X-Sayman-Admin", "1");
        var route = "/api/admin/media/images?q=" + s.Prefix; Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(route)).StatusCode);
        var login = await Json(await client.PostAsJsonAsync("/api/auth/password", new { Identifier = account.Username, account.Password })); client.DefaultRequestHeaders.Authorization = new("Bearer", login["accessToken"]!.GetValue<string>()); Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync(route)).StatusCode);
        var setup = await Json(await client.PostAsJsonAsync("/api/auth/mfa/setup", new { })); client.DefaultRequestHeaders.Authorization = new("Bearer", setup["accessToken"]!.GetValue<string>());
        var verified = await Json(await client.PostAsJsonAsync("/api/auth/mfa/verify", new { Code = Totp.Code(setup["secret"]!.GetValue<string>(), DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 30) })); client.DefaultRequestHeaders.Authorization = new("Bearer", verified["accessToken"]!.GetValue<string>());
        var capabilities = await Json(await client.GetAsync("/api/admin/media/capabilities")); Assert.False(capabilities["configured"]!.GetValue<bool>());
        long audit; await using (var scope = fixture.Factory.Services.CreateAsyncScope()) audit = await scope.ServiceProvider.GetRequiredService<IdentityDbContext>().Audit.LongCountAsync(Ct);
        using var response = await client.GetAsync(route); Assert.Equal(HttpStatusCode.OK, response.StatusCode); Assert.Contains("private", response.Headers.CacheControl!.ToString()); Assert.Contains("no-store", response.Headers.CacheControl!.ToString()); Assert.Contains("noindex", string.Join(",", response.Headers.GetValues("X-Robots-Tag")));
        var body = await response.Content.ReadAsStringAsync(); var page = JsonNode.Parse(body)!; Assert.Single(page["items"]!.AsArray()); Assert.Equal(Id(s, 0), page["items"]![0]!["id"]!.GetValue<string>()); Assert.Null(page["nextCursor"]);
        foreach (var forbidden in new[] { "createdBy", "originalSha256", "inputBytes", "cleanupLeaseId", "private-uploader", new string('e', 64) }) Assert.DoesNotContain(forbidden, body);
        var directory = Environment.GetEnvironmentVariable("SHOP_PUBLIC_IMAGE_LIBRARY_SQL_WIRE_DIR");
        if (!string.IsNullOrEmpty(directory)) { Directory.CreateDirectory(directory); await using var output = new FileStream(Path.Combine(directory, "public-image-library-sql-page.json"), FileMode.CreateNew, FileAccess.Write); await output.WriteAsync(Encoding.UTF8.GetBytes(body), Ct); }
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync(route + "&q=" + s.Prefix)).StatusCode); Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync(route + "&unknown=1")).StatusCode);
        Assert.Equal(before, await Snapshot(s.Prefix)); await using var final = fixture.Factory.Services.CreateAsyncScope(); Assert.Equal(audit, await final.ServiceProvider.GetRequiredService<IdentityDbContext>().Audit.LongCountAsync(Ct));
    }
}
