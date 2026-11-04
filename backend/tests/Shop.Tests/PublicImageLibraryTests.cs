using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Catalog.Media;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class PublicImageLibraryTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static readonly DateTimeOffset At = DateTimeOffset.Parse("2026-10-31T10:00:00.1234567Z");
    private static string Id => new('a', 32);
    public static PublicImageAsset Asset() => new() {
        Id = Id, Status = "Ready", CreatedAt = At, CreatedBy = "private-uploader", OriginalSha256 = new('e', 64), InputBytes = 1234, Width = 128, Height = 96,
        Variants = PublicImagePaths.Names.Select(name => new PublicImageVariant { AssetId = Id, Name = name, Width = 128, Height = 96, Bytes = 1024, Sha256 = new('b', 64) }).ToList()
    };
    [Theory]
    [InlineData("")][InlineData("abc")][InlineData("abcd ")][InlineData("abcz")][InlineData("۱۲۳۴")][InlineData("abcd/ef")]
    public void InvalidPrefixesFail(string q) => Assert.Equal("invalid_image_library_filter", Assert.Throws<BusinessException>(() => PublicImageLibraryFilter.Create(q)).Code);
    [Theory]
    [InlineData("2026-10-31")][InlineData("2026-10-31T10:00:00+00:00")][InlineData("2026-10-31T10:00:00z")][InlineData("2026-02-30T10:00:00Z")][InlineData("2026-10-31T10:00:00.12345678Z")]
    public void OnlyExactUtcTimeFormatsAreAccepted(string time) => Assert.Throws<BusinessException>(() => PublicImageLibraryFilter.Create(fromAt: time));
    [Fact]
    public void PrefixCaseAndEquivalentFractionsNormalizeAndEqualTimeBoundsAreAllowed()
    {
        var first = PublicImageLibraryFilter.Create("ABCD", "2026-10-31T10:00:00.123Z", "2026-10-31T10:00:00.1230000Z");
        var second = PublicImageLibraryFilter.Create("abcd", "2026-10-31T10:00:00.1230000Z", "2026-10-31T10:00:00.123Z");
        Assert.Equal("abcd", first.Query); Assert.Equal(first.Binding, second.Binding);
        Assert.Equal(7, (PublicImageLibraryFilter.ParseTime("2026-10-31T10:00:00.0000007Z") - PublicImageLibraryFilter.ParseTime("2026-10-31T10:00:00Z")).Ticks);
        Assert.Throws<BusinessException>(() => PublicImageLibraryFilter.Create(new string('a', 33)));
        Assert.Throws<BusinessException>(() => PublicImageLibraryFilter.Create(fromAt: "2026-10-31T10:00:00.0000001Z", toAt: "2026-10-31T10:00:00Z"));
    }
    [Fact]
    public void CursorBindsEveryFilterAndRetainsExactTimeAndExclusiveVersionBoundary()
    {
        var filter = PublicImageLibraryFilter.Create("abcd", "2026-10-30T00:00:00Z", "2026-11-01T00:00:00Z");
        var position = new PublicImageLibraryPosition(At, [0, 0, 0, 0, 0, 0, 0, 9], At.AddTicks(-1), Id);
        var cursor = PublicImageLibraryPaging.Encode(position, filter); var decoded = PublicImageLibraryPaging.Decode(cursor, filter)!;
        Assert.Equal(position.AsOfAt, decoded.AsOfAt); Assert.Equal(position.Watermark, decoded.Watermark); Assert.Equal(position.BeforeAt, decoded.BeforeAt); Assert.Equal(position.BeforeId, decoded.BeforeId); Assert.True(cursor.Length <= 1024);
        foreach (var other in new[] { PublicImageLibraryFilter.Create("abce", "2026-10-30T00:00:00Z", "2026-11-01T00:00:00Z"), PublicImageLibraryFilter.Create("abcd", "2026-10-30T00:00:00.0000001Z", "2026-11-01T00:00:00Z"), PublicImageLibraryFilter.Create("abcd", "2026-10-30T00:00:00Z", "2026-11-01T00:00:00.0000001Z") })
            Assert.Equal("invalid_image_library_cursor", Assert.Throws<BusinessException>(() => PublicImageLibraryPaging.Decode(cursor, other)).Code);
    }
    [Theory]
    [InlineData("")][InlineData("=")][InlineData("bad/cursor")][InlineData("e30")][InlineData("bm90LWpzb24")]
    public async Task MalformedCursorsNeverOpenSql(string cursor)
    {
        await using var db = new CatalogDbContext(DesignTimeOptions.Create<CatalogDbContext>("catalog"));
        Assert.Equal("invalid_image_library_cursor", (await Assert.ThrowsAsync<BusinessException>(() => new PublicImageLibrary(db, TimeProvider.System).ReadAsync(PublicImageLibraryFilter.Create(), cursor, default))).Code);
        Assert.Equal(System.Data.ConnectionState.Closed, db.Database.GetDbConnection().State);
    }
    [Fact]
    public void DuplicateUnknownAndNullCursorFieldsFailClosed()
    {
        var encoded = PublicImageLibraryPaging.Encode(new(At, new byte[8], At, Id), PublicImageLibraryFilter.Create()).Replace('-', '+').Replace('_', '/');
        var json = Encoding.UTF8.GetString(Convert.FromBase64String(encoded.PadRight((encoded.Length + 3) / 4 * 4, '=')));
        foreach (var bad in new[] { json.Insert(1, "\"Version\":1,"), json.Insert(1, "\"extra\":1,"), json.Replace("\"BeforeId\":\"" + Id + "\"", "\"BeforeId\":null"), json.Replace("\"Watermark\":\"AAAAAAAAAAA=\"", "\"Watermark\":\"AQ==\"") }) {
            var token = Convert.ToBase64String(Encoding.UTF8.GetBytes(bad)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
            Assert.Equal("invalid_image_library_cursor", Assert.Throws<BusinessException>(() => PublicImageLibraryPaging.Decode(token, PublicImageLibraryFilter.Create())).Code);
        }
    }
    [Fact]
    public void ProjectionUsesOnlyReadyBoundedKeysetRowsAndIncludesVariantsInOneStatement()
    {
        using var db = new CatalogDbContext(DesignTimeOptions.Create<CatalogDbContext>("catalog"));
        var sql = PublicImageLibraryQuery.Read(db, PublicImageLibraryFilter.Create("abcd", "2026-10-30T00:00:00Z", "2026-11-01T00:00:00Z"), At, new byte[8], new(At, new byte[8], At.AddTicks(-1), Id)).ToQueryString();
        foreach (var expected in new[] { "TOP", "25", "[Version] <", "Ready", "[CreatedAt] >=", "[CreatedAt] <", "LIKE", "COLLATE Latin1_General_100_BIN2", "PublicImageVariants", "ORDER BY", "DESC" }) Assert.Contains(expected, sql);
        foreach (var forbidden in new[] { "OFFSET", "[identity]", "[inventory]", "[Products]", "[Files]" }) Assert.DoesNotContain(forbidden, sql);
    }
    [Fact]
    public void OnlySanitizedCanonicalVariantsAndTimeReachTheDto()
    {
        var asset = Asset(); asset.Variants.Reverse(); var item = PublicImageLibrary.Item(asset);
        Assert.Equal(PublicImagePaths.Names, item.Variants.Select(v => v.Name)); Assert.Equal($"/media/catalog/{Id}/card.webp", item.Url); Assert.Equal("2026-10-31T10:00:00.1234567Z", item.CreatedAt);
        var json = JsonSerializer.Serialize(item);
        foreach (var privateValue in new[] { asset.CreatedBy, asset.OriginalSha256, "CreatedBy", "OriginalSha256", "InputBytes", "Status", "Cleanup", "catalog-images/" }) Assert.DoesNotContain(privateValue, json);
    }
    [Theory]
    [InlineData("bad-id")][InlineData("not-ready")][InlineData("missing")][InlineData("duplicate")][InlineData("unknown")][InlineData("foreign-id")][InlineData("zero-size")][InlineData("oversized-thumb")][InlineData("oversized-card")][InlineData("oversized-zoom")][InlineData("zero-bytes")][InlineData("oversized-bytes")][InlineData("invalid-sha")]
    public void InconsistentReadyMetadataIsUnavailableRatherThanPartiallyReturned(string change)
    {
        var asset = Asset();
        switch (change) {
            case "bad-id": asset.Id = new string('A', 32); break;
            case "not-ready": asset.Status = "Staged"; break;
            case "missing": asset.Variants.RemoveAt(0); break;
            case "duplicate": asset.Variants[0].Name = "card"; break;
            case "unknown": asset.Variants[0].Name = "original"; break;
            case "foreign-id": asset.Variants[0].AssetId = new string('c', 32); break;
            case "zero-size": asset.Variants[0].Width = 0; break;
            case "oversized-thumb": asset.Variants[0].Width = 321; break;
            case "oversized-card": asset.Variants[1].Height = 961; break;
            case "oversized-zoom": asset.Variants[2].Width = 1921; break;
            case "zero-bytes": asset.Variants[0].Bytes = 0; break;
            case "oversized-bytes": asset.Variants[0].Bytes = ImageLimits.MaxOutputBytes + 1; break;
            case "invalid-sha": asset.Variants[0].Sha256 = new string('B', 64); break;
        }
        Assert.Equal("media_unavailable", Assert.Throws<BusinessException>(() => PublicImageLibrary.Item(asset)).Code);
    }
    private sealed class Reader : IPublicImageLibrary
    {
        public int Reads;
        public Task<PublicImageLibraryPage> ReadAsync(PublicImageLibraryFilter filter, string? cursor, CancellationToken ct) { Reads++; return Task.FromResult(new PublicImageLibraryPage(1, PublicImageLibraryFilter.Time(At), 24, [PublicImageLibrary.Item(Asset())], null)); }
    }
    private static HttpClient Client(WebApplicationFactory<Program> app, string? kind = "access", string? permission = "cms.write", string? role = "ContentManager")
    {
        var client = app.CreateClient();
        if (kind is not null) client.DefaultRequestHeaders.Add("X-Test-Kind", kind);
        if (permission is not null) client.DefaultRequestHeaders.Add("X-Test-Permissions", permission);
        if (role is not null) client.DefaultRequestHeaders.Add("X-Test-Roles", role);
        return client;
    }
    [Theory]
    [InlineData(null, null, null, 401)][InlineData("mfa_pending", "cms.write", "ContentManager", 403)][InlineData("staff_password_change", "cms.write", "ContentManager", 403)][InlineData("access", "cms.write", null, 403)][InlineData("access", "catalog.read", "CatalogManager", 403)][InlineData("access", "support.write", "SupportAgent", 403)]
    public async Task SameUploadAuthorityIsRequiredBeforeAnyRead(string? kind, string? permission, string? role, int expected)
    {
        var reader = new Reader(); await using var app = factory.WithWebHostBuilder(b => b.ConfigureTestServices(s => { s.RemoveAll<IPublicImageLibrary>(); s.AddSingleton<IPublicImageLibrary>(reader); }));
        using var client = Client(app, kind, permission, role); using var response = await client.GetAsync("/api/admin/media/images?unknown=1");
        Assert.Equal(expected, (int)response.StatusCode); Assert.Equal(0, reader.Reads); Assert.Contains("private", response.Headers.CacheControl!.ToString()); Assert.Contains("no-store", response.Headers.CacheControl!.ToString()); Assert.Contains("noindex", string.Join(",", response.Headers.GetValues("X-Robots-Tag"))); Assert.Contains("Cookie", response.Headers.Vary); Assert.Contains("Authorization", response.Headers.Vary);
    }
    [Theory]
    [InlineData("cms.write", "ContentManager")][InlineData("catalog.write", "CatalogManager")]
    public async Task ReadWorksWithUploadDisabledAndExposesOnlyBoundedSafeMetadata(string permission, string role)
    {
        var reader = new Reader(); await using var app = factory.WithWebHostBuilder(b => b.ConfigureTestServices(s => { s.RemoveAll<IPublicImageLibrary>(); s.AddSingleton<IPublicImageLibrary>(reader); }));
        using var client = Client(app, permission: permission, role: role);
        var capabilities = JsonNode.Parse(await (await client.GetAsync("/api/admin/media/capabilities")).Content.ReadAsStringAsync())!; Assert.False(capabilities["configured"]!.GetValue<bool>());
        using var response = await client.GetAsync("/api/admin/media/images?q=AAAA"); Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync(); var page = JsonNode.Parse(body)!; Assert.Equal(24, page["pageSize"]!.GetValue<int>()); Assert.True(page.AsObject().ContainsKey("nextCursor")); Assert.Null(page["nextCursor"]); Assert.Equal(3, page["items"]![0]!["variants"]!.AsArray().Count);
        foreach (var key in new[] { "createdBy", "originalSha256", "inputBytes", "cleanupLeaseId", "status" }) Assert.DoesNotContain(key, body);
        if (permission == "cms.write") await ContractWireCapture.SaveAsync("public-image-library-page", body);
        using var anonymous = app.CreateClient(); Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync("/api/media/images")).StatusCode); Assert.Equal(1, reader.Reads);
    }
    [Theory]
    [InlineData("unknown=value")][InlineData("Q=abcd")][InlineData("q=abcd&q=abce")][InlineData("cursor=a&cursor=b")][InlineData("q=")][InlineData("q=abc")][InlineData("q=abcd%20")][InlineData("fromAt=2026-10-31T10%3A00%3A00%2B00%3A00")][InlineData("cursor=bad")]
    public async Task UnsupportedOrAmbiguousQueriesDoNotReachReader(string query)
    {
        var reader = new Reader(); await using var app = factory.WithWebHostBuilder(b => b.ConfigureTestServices(s => { s.RemoveAll<IPublicImageLibrary>(); s.AddSingleton<IPublicImageLibrary>(reader); }));
        using var client = Client(app); using var response = await client.GetAsync("/api/admin/media/images?" + query); Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode); Assert.Equal(0, reader.Reads);
    }
}
