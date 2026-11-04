using System.Data.Common;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Identity;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;

public sealed class AdminPriceHistorySqlTests(SqlFixture fixture) : IClassFixture<SqlFixture>
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private sealed class Clock(DateTimeOffset at) : TimeProvider { public override DateTimeOffset GetUtcNow() => at; }
    private sealed record Scenario(string Product, string First, string Second, string Prefix, DateTimeOffset At);
    private async Task<Scenario> Create(string status = "Draft")
    {
        var prefix = Guid.NewGuid().ToString("N"); var at = DateTimeOffset.UtcNow.AddDays(-2);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<CatalogDbContext>();
        Assert.StartsWith("SaymanTest_", db.Database.GetDbConnection().Database);
        db.Categories.Add(new() { Id = "c" + prefix, Slug = "c-" + prefix, Translations = [new() { Locale = "fa", Name = "نمونهٔ تاریخچه" }] });
        db.Brands.Add(new() { Id = "b" + prefix, Slug = "b-" + prefix, Name = "History " + prefix });
        var product = new Product { Id = "p" + prefix, Slug = "p-" + prefix, Status = status, CategoryId = "c" + prefix, BrandId = "b" + prefix, Translations = [new() { Locale = "fa", Name = "تاریخچهٔ قیمت" }], Variants = [new() { Id = "v1" + prefix, Sku = "CURRENT-A-" + prefix, PriceRial = long.MaxValue, IsActive = true }, new() { Id = "v2" + prefix, Sku = "CURRENT-B-" + prefix, PriceRial = 9007199254740993, IsActive = false }] };
        db.Products.Add(product); await db.SaveChangesAsync(Ct);
        return new(product.Id, product.Variants[0].Id, product.Variants[1].Id, prefix, at);
    }
    private static PriceHistory Event(Scenario s, int index, string? variant = null, DateTimeOffset? at = null, bool decrease = false) => new() { Id = "h" + s.Prefix + index.ToString("D3"), VariantId = variant ?? s.First, OldPrice = decrease ? 9007199254740994 : 9007199254740993, NewPrice = decrease ? 9007199254740993 : 9007199254740994, ChangedBy = "private-staff", CreatedAt = at ?? s.At, UpdatedAt = at ?? s.At };
    private async Task<AdminPriceHistoryPage> Read(AdminPriceHistoryFilter filter, string? cursor = null, DateTimeOffset? now = null)
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        return await new AdminPriceHistory(scope.ServiceProvider.GetRequiredService<CatalogDbContext>(), new Clock(now ?? DateTimeOffset.UtcNow)).ReadAsync(filter, cursor, Ct);
    }

    [Fact]
    public async Task DraftAndHiddenProductsKeepInactiveVariantsExactMoneyAndNoInventedCreationPoint()
    {
        foreach (var status in new[] { "Draft", "Hidden" }) {
            var s = await Create(status);
            var empty = await Read(AdminPriceHistoryFilter.Create(s.Product));
            Assert.Empty(empty.Items); Assert.Null(empty.NextCursor); Assert.Equal(2, empty.Variants.Length);
            Assert.Equal("9223372036854775807", empty.Variants.Single(v => v.Id == s.First).CurrentPriceRial);
            Assert.False(empty.Variants.Single(v => v.Id == s.Second).IsActive);
            await using (var scope = fixture.Factory.Services.CreateAsyncScope()) { var db = scope.ServiceProvider.GetRequiredService<CatalogDbContext>(); db.PriceHistory.Add(Event(s, 1, s.Second)); await db.SaveChangesAsync(Ct); }
            var selected = await Read(AdminPriceHistoryFilter.Create(s.Product, s.Second));
            Assert.Single(selected.Items); Assert.Equal(s.Second, selected.Items[0].VariantId);
            Assert.Equal("9007199254740993", selected.Items[0].OldPriceRial); Assert.Equal("9007199254740994", selected.Items[0].NewPriceRial); Assert.Equal("private-staff", selected.Items[0].ChangedBy);
            var foreign = await Create();
            Assert.Equal("not_found", (await Assert.ThrowsAsync<BusinessException>(() => Read(AdminPriceHistoryFilter.Create(s.Product, foreign.First)))).Code);
        }
        Assert.Equal("not_found", (await Assert.ThrowsAsync<BusinessException>(() => Read(AdminPriceHistoryFilter.Create("missing-product")))).Code);
    }

    [Fact]
    public async Task FiltersArePerVariantDirectionAndHalfOpenWithExactSubMillisecondBoundaries()
    {
        var s = await Create();
        await using (var scope = fixture.Factory.Services.CreateAsyncScope()) {
            var db = scope.ServiceProvider.GetRequiredService<CatalogDbContext>();
            foreach (var ticks in new[] { -1, 0, 1, 2 }) { db.PriceHistory.Add(Event(s, ticks + 10, at: s.At.AddTicks(ticks))); db.PriceHistory.Add(Event(s, ticks + 20, at: s.At.AddTicks(ticks), decrease: true)); }
            db.PriceHistory.Add(Event(s, 30, s.Second, s.At)); await db.SaveChangesAsync(Ct);
        }
        var page = await Read(AdminPriceHistoryFilter.Create(s.Product, s.First, "increase", AdminPriceHistoryFilter.Time(s.At), AdminPriceHistoryFilter.Time(s.At.AddTicks(2))));
        Assert.Equal(2, page.Items.Length); Assert.Equal(new[] { AdminPriceHistoryFilter.Time(s.At.AddTicks(1)), AdminPriceHistoryFilter.Time(s.At) }, page.Items.Select(e => e.ChangedAt));
        Assert.All(page.Items, e => { Assert.Equal(s.First, e.VariantId); Assert.True(long.Parse(e.NewPriceRial) > long.Parse(e.OldPriceRial)); });
        Assert.Equal(4, (await Read(AdminPriceHistoryFilter.Create(s.Product, s.First, "decrease"))).Items.Length);
        Assert.Empty((await Read(AdminPriceHistoryFilter.Create(s.Product, fromAt: AdminPriceHistoryFilter.Time(s.At), toAt: AdminPriceHistoryFilter.Time(s.At)))).Items);
        Assert.Single((await Read(AdminPriceHistoryFilter.Create(s.Product, s.Second))).Items);
        Assert.Empty((await Read(AdminPriceHistoryFilter.Create(s.Product), now: s.At.AddTicks(-2))).Items);
    }

    [Fact]
    public async Task KeysetPagesTiesDoNotDuplicateOrAdmitLaterBackdatedAppendsAndReadsDoNotMutate()
    {
        var s = await Create(); string[] expected; byte[] productVersion; Dictionary<string, string> variantVersions; long audit;
        await using (var scope = fixture.Factory.Services.CreateAsyncScope()) {
            var db = scope.ServiceProvider.GetRequiredService<CatalogDbContext>(); db.PriceHistory.AddRange(Enumerable.Range(0, 121).Select(i => Event(s, i))); await db.SaveChangesAsync(Ct);
            expected = await db.PriceHistory.Where(h => h.VariantId == s.First).OrderByDescending(h => h.CreatedAt).ThenByDescending(h => EF.Functions.Collate(h.Id, AdminPriceHistoryQuery.OrdinalCollation)).Select(h => h.Id).ToArrayAsync(Ct);
            productVersion = (await db.Products.SingleAsync(p => p.Id == s.Product, Ct)).Version;
            variantVersions = (await db.Variants.Where(v => v.ProductId == s.Product).ToArrayAsync(Ct)).ToDictionary(v => v.Id, v => Convert.ToBase64String(v.Version));
            audit = await scope.ServiceProvider.GetRequiredService<IdentityDbContext>().Audit.LongCountAsync(Ct);
        }
        var filter = AdminPriceHistoryFilter.Create(s.Product, s.First); string? cursor = null; string? asOfAt = null; var seen = new List<string>(); var sizes = new List<int>();
        do {
            var page = await Read(filter, cursor, s.At.AddDays(3)); sizes.Add(page.Items.Length); seen.AddRange(page.Items.Select(e => e.Id)); cursor = page.NextCursor;
            if (asOfAt is null) asOfAt = page.AsOfAt; else Assert.Equal(asOfAt, page.AsOfAt);
            if (sizes.Count == 1) {
                Assert.NotNull(cursor); var replay = await Read(filter, cursor, s.At.AddDays(5));
                await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<CatalogDbContext>();
                db.PriceHistory.Add(new() { Id = "0" + s.Prefix, VariantId = s.First, OldPrice = 1, NewPrice = 2, ChangedBy = "newer-append", CreatedAt = s.At.AddDays(-1), UpdatedAt = s.At.AddDays(-1) }); await db.SaveChangesAsync(Ct);
                var after = await Read(filter, cursor, s.At.AddDays(5)); Assert.Equal(replay.Items.Select(e => e.Id), after.Items.Select(e => e.Id));
                Assert.Equal("invalid_price_history_cursor", (await Assert.ThrowsAsync<BusinessException>(() => Read(AdminPriceHistoryFilter.Create(s.Product, s.Second), cursor))).Code);
            }
        } while (cursor is not null);
        Assert.Equal(new[] { 50, 50, 21 }, sizes); Assert.Equal(expected, seen); Assert.Equal(121, seen.Distinct().Count());
        var refreshed = new List<string>(); string? freshCursor = null;
        do { var page = await Read(filter, freshCursor); refreshed.AddRange(page.Items.Select(e => e.Id)); freshCursor = page.NextCursor; } while (freshCursor is not null);
        Assert.Equal(122, refreshed.Count); Assert.Contains("0" + s.Prefix, refreshed);
        await using var final = fixture.Factory.Services.CreateAsyncScope(); var context = final.ServiceProvider.GetRequiredService<CatalogDbContext>();
        Assert.Equal(122, await context.PriceHistory.CountAsync(h => h.VariantId == s.First, Ct));
        Assert.Equal(productVersion, (await context.Products.SingleAsync(p => p.Id == s.Product, Ct)).Version);
        foreach (var v in await context.Variants.Where(v => v.ProductId == s.Product).ToArrayAsync(Ct)) Assert.Equal(variantVersions[v.Id], Convert.ToBase64String(v.Version));
        Assert.Equal(audit, await final.ServiceProvider.GetRequiredService<IdentityDbContext>().Audit.LongCountAsync(Ct));
    }

    [Fact]
    public async Task ExactlyFiftyHasNoCursorWhileFiftyOneHasOneThenAnExplicitFinalNull()
    {
        var s = await Create();
        await using (var scope = fixture.Factory.Services.CreateAsyncScope()) { var db = scope.ServiceProvider.GetRequiredService<CatalogDbContext>(); db.PriceHistory.AddRange(Enumerable.Range(0, 50).Select(i => Event(s, i))); db.PriceHistory.AddRange(Enumerable.Range(100, 51).Select(i => Event(s, i, s.Second))); await db.SaveChangesAsync(Ct); }
        var fifty = await Read(AdminPriceHistoryFilter.Create(s.Product, s.First)); Assert.Equal(50, fifty.Items.Length); Assert.Null(fifty.NextCursor);
        var filter = AdminPriceHistoryFilter.Create(s.Product, s.Second); var first = await Read(filter); Assert.Equal(50, first.Items.Length); Assert.NotNull(first.NextCursor);
        var last = await Read(filter, first.NextCursor); Assert.Single(last.Items); Assert.Null(last.NextCursor); Assert.DoesNotContain(last.Items[0].Id, first.Items.Select(e => e.Id));
        var foreign = await Create(); Assert.Equal("invalid_price_history_cursor", (await Assert.ThrowsAsync<BusinessException>(() => Read(AdminPriceHistoryFilter.Create(foreign.Product, foreign.Second), first.NextCursor))).Code);
    }

    private sealed class BeforeHistory(Func<Task> completePending) : DbCommandInterceptor
    {
        public int Calls;
        public override async ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            if (command.CommandText.Contains("SELECT * FROM [catalog].[PriceHistory] WHERE [Version] <", StringComparison.Ordinal) && Interlocked.CompareExchange(ref Calls, 1, 0) == 0) await completePending();
            return result;
        }
    }

    [Fact]
    public async Task RowversionReservedBeforeFirstPageButCommittedAfterBoundaryCannotEnterLaterPages()
    {
        var s = await Create();
        await using (var setup = fixture.Factory.Services.CreateAsyncScope()) { var db = setup.ServiceProvider.GetRequiredService<CatalogDbContext>(); db.PriceHistory.AddRange(Enumerable.Range(0, 80).Select(i => Event(s, i))); await db.SaveChangesAsync(Ct); }
        await using var pendingScope = fixture.Factory.Services.CreateAsyncScope(); var pending = pendingScope.ServiceProvider.GetRequiredService<CatalogDbContext>();
        await using var transaction = await pending.Database.BeginTransactionAsync(Ct);
        var uncommitted = new PriceHistory { Id = "0" + s.Prefix, VariantId = s.First, OldPrice = 1, NewPrice = 2, ChangedBy = "uncommitted-at-boundary", CreatedAt = s.At.AddDays(-1), UpdatedAt = s.At.AddDays(-1) };
        pending.PriceHistory.Add(uncommitted); await pending.SaveChangesAsync(Ct);
        var intercept = new BeforeHistory(() => transaction.CommitAsync(Ct));
        await using var reading = new CatalogDbContext(new DbContextOptionsBuilder<CatalogDbContext>().UseSqlServer(fixture.Connection).AddInterceptors(intercept).Options);
        var filter = AdminPriceHistoryFilter.Create(s.Product, s.First);
        var first = await new AdminPriceHistory(reading, new Clock(s.At.AddDays(3))).ReadAsync(filter, null, Ct);
        Assert.Equal(1, intercept.Calls); Assert.Equal(50, first.Items.Length); Assert.NotNull(first.NextCursor);
        var cutoff = AdminPriceHistoryPaging.Decode(first.NextCursor, filter)!;
        Assert.Equal(uncommitted.Version, cutoff.Watermark);
        var second = await Read(filter, first.NextCursor); Assert.Equal(30, second.Items.Length); Assert.Null(second.NextCursor);
        Assert.DoesNotContain(uncommitted.Id, first.Items.Concat(second.Items).Select(e => e.Id));
        var refreshedFirst = await Read(filter); var refreshedSecond = await Read(filter, refreshedFirst.NextCursor);
        Assert.Contains(uncommitted.Id, refreshedSecond.Items.Select(e => e.Id));
    }

    private static async Task<JsonNode> Json(HttpResponseMessage response)
    {
        using (response) { Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync()); return JsonNode.Parse(await response.Content.ReadAsStringAsync())!; }
    }
    [Fact]
    public async Task ActualStaffMfaReadsPrivateHistoryButPendingAndAnonymousDoNotAndNoReadAuditIsWritten()
    {
        var s = await Create("Hidden"); await using (var scope = fixture.Factory.Services.CreateAsyncScope()) { var db = scope.ServiceProvider.GetRequiredService<CatalogDbContext>(); db.PriceHistory.Add(Event(s, 1, s.Second)); await db.SaveChangesAsync(Ct); }
        var account = await fixture.CreateAdministratorAsync();
        using var client = fixture.Factory.CreateClient(new() { HandleCookies = false }); client.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:3173"); client.DefaultRequestHeaders.Add("X-Sayman-Client", "admin"); client.DefaultRequestHeaders.Add("X-Sayman-Admin", "1");
        var route = "/api/admin/products/" + s.Product + "/price-history?variantId=" + s.Second;
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(route)).StatusCode);
        var login = await Json(await client.PostAsJsonAsync("/api/auth/password", new { Identifier = account.Username, account.Password })); client.DefaultRequestHeaders.Authorization = new("Bearer", login["accessToken"]!.GetValue<string>());
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync(route)).StatusCode);
        var setup = await Json(await client.PostAsJsonAsync("/api/auth/mfa/setup", new { })); client.DefaultRequestHeaders.Authorization = new("Bearer", setup["accessToken"]!.GetValue<string>());
        var verified = await Json(await client.PostAsJsonAsync("/api/auth/mfa/verify", new { Code = Totp.Code(setup["secret"]!.GetValue<string>(), DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 30) })); client.DefaultRequestHeaders.Authorization = new("Bearer", verified["accessToken"]!.GetValue<string>());
        long audit; await using (var scope = fixture.Factory.Services.CreateAsyncScope()) audit = await scope.ServiceProvider.GetRequiredService<IdentityDbContext>().Audit.LongCountAsync(Ct);
        using var response = await client.GetAsync(route); Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl!.ToString()); Assert.Contains("private", response.Headers.CacheControl!.ToString()); Assert.Contains("noindex", string.Join(",", response.Headers.GetValues("X-Robots-Tag")));
        var body = await response.Content.ReadAsStringAsync();
        var wireDirectory = Environment.GetEnvironmentVariable("SHOP_ADMIN_PRICE_HISTORY_SQL_WIRE_DIR");
        if (!string.IsNullOrEmpty(wireDirectory)) { Directory.CreateDirectory(wireDirectory); await using var output = new FileStream(Path.Combine(wireDirectory, "admin-price-history-sql-page.json"), FileMode.CreateNew, FileAccess.Write); await output.WriteAsync(System.Text.Encoding.UTF8.GetBytes(body), Ct); }
        var page = JsonNode.Parse(body)!; Assert.Equal(s.Product, page["productId"]!.GetValue<string>()); Assert.Single(page["items"]!.AsArray()); Assert.Equal("9007199254740993", page["items"]![0]!["oldPriceRial"]!.GetValue<string>());
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync(route + "&unknown=value")).StatusCode); Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync(route + "&variantId=" + s.First)).StatusCode);
        await using var final = fixture.Factory.Services.CreateAsyncScope(); Assert.Equal(audit, await final.ServiceProvider.GetRequiredService<IdentityDbContext>().Audit.LongCountAsync(Ct));
    }
}
