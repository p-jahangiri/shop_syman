using System.Data;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Identity;
using Shop.Modules.Inventory;
using Shop.SharedKernel;
using Xunit;
namespace Shop.SqlTests;

public sealed class ProductWorkspaceSqlTests(SqlFixture fixture) : IClassFixture<SqlFixture>
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private sealed record Scenario(string Product, string Variant, string Category, string Brand, string Version, string VariantVersion, string Prefix);
    private async Task<Scenario> Create(int count = 1)
    {
        var prefix = Guid.NewGuid().ToString("N");
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<CatalogDbContext>();
        Assert.StartsWith("SaymanTest_", db.Database.GetDbConnection().Database);
        var category = new Category { Slug = "c-" + prefix, Translations = [new() { Locale = "fa", Name = "دسته آزمون" }, new() { Locale = "en", Name = "Test" }] };
        var brand = new Brand { Slug = "b-" + prefix, Name = "Brand" };
        db.AddRange(category, brand);
        var products = Enumerable.Range(1, count).Select(i => new Product { Slug = "p-" + prefix + "-" + i, CategoryId = category.Id, BrandId = brand.Id, Status = "Draft", Translations = [new() { Locale = "fa", Name = "مدل " + prefix + " " + i.ToString("D3") }, new() { Locale = "en", Name = "Model" }], Variants = [new() { Sku = prefix + "-" + i, PriceRial = 9007199254740993 + i, Color = "#151515", IsActive = true }] }).ToArray();
        db.Products.AddRange(products);
        await db.SaveChangesAsync(Ct);
        var p = products[0];
        return new(p.Id, p.Variants[0].Id, category.Id, brand.Id, Convert.ToBase64String(p.Version), Convert.ToBase64String(p.Variants[0].Version), prefix);
    }
    private async Task<ProductWorkspaceReceipt> Command(Func<ProductWorkspaceCommands, Task<ProductWorkspaceReceipt>> execute)
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<CatalogDbContext>();
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, Ct);
        var result = await execute(scope.ServiceProvider.GetRequiredService<ProductWorkspaceCommands>());
        await tx.CommitAsync(Ct);
        return result;
    }
    [Fact]
    public async Task TableUsesGlobalServerSortCountFiltersAndReadonlyInventoryView()
    {
        var s = await Create(31);
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<CatalogDbContext>();
        var reader = new ProductWorkspaceReader(db);
        var first = await reader.PageAsync(ProductWorkspaceFilter.Create(categoryId: s.Category, sort: "price", direction: "desc"), Ct);
        Assert.Equal("31", first.TotalCount);
        Assert.Equal(25, first.Items.Length);
        Assert.True(first.Items.Zip(first.Items.Skip(1)).All(pair => long.Parse(pair.First.MinPriceRial!) >= long.Parse(pair.Second.MinPriceRial!)));
        var second = await reader.PageAsync(ProductWorkspaceFilter.Create(categoryId: s.Category, sort: "price", direction: "desc", page: 1), Ct);
        Assert.Equal(6, second.Items.Length);
        Assert.Empty(first.Items.Select(p => p.Id).Intersect(second.Items.Select(p => p.Id)));
        Assert.All(first.Items, p => Assert.Equal("0", p.AvailableQuantity));
        var empty = await reader.PageAsync(ProductWorkspaceFilter.Create(categoryId: s.Category, availability: "available"), Ct);
        Assert.Equal("0", empty.TotalCount);
        var sku = await reader.PageAsync(ProductWorkspaceFilter.Create(s.Prefix + "-1", categoryId: s.Category), Ct);
        Assert.Contains(sku.Items, p => p.Id == s.Product);
    }
    [Fact]
    public async Task ColumnRangesAndSearchAreIntersectedBeforeCountAndPagination()
    {
        var s = await Create(31);
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<CatalogDbContext>();
        var reader = new ProductWorkspaceReader(db);
        var filter = ProductWorkspaceFilter.Create(search: s.Prefix, categoryId: s.Category, brandId: s.Brand,
            status: "Draft", name: "مدل", minPriceRial: "9007199254740998", maxPriceRial: "9007199254741024",
            maxStock: "0", minVariants: "1", maxVariants: "1", sort: "price", direction: "asc",
            updatedFrom: "2000-01-01T00:00:00.000Z", updatedBefore: "2100-01-01T00:00:00.000Z");
        var first = await reader.PageAsync(filter, Ct);
        var second = await reader.PageAsync(filter with { Page = 1 }, Ct);
        Assert.Equal("27", first.TotalCount);
        Assert.Equal("27", second.TotalCount);
        Assert.Equal(25, first.Items.Length);
        Assert.Equal(2, second.Items.Length);
        Assert.Equal("9007199254740998", first.Items[0].MinPriceRial);
        Assert.Equal("9007199254741024", second.Items[^1].MinPriceRial);
        Assert.Equal("0", (await reader.PageAsync(filter with { MinStock = 1, MaxStock = null }, Ct)).TotalCount);
        Assert.Equal("0", (await reader.PageAsync(filter with { Name = "بیتطبیق" }, Ct)).TotalCount);
        Assert.Equal("0", (await reader.PageAsync(filter with { UpdatedBefore = new DateTimeOffset(2001, 1, 1, 0, 0, 0, TimeSpan.Zero) }, Ct)).TotalCount);

        using var staff = await Staff();
        const string path = "/api/admin/catalog/workspace/products?";
        var http = await Json(await staff.GetAsync(path + $"categoryId={s.Category}&minPriceRial=9007199254740998&maxStock=0&sort=price&direction=asc&page=1"));
        Assert.Equal("27", http["totalCount"]!.GetValue<string>());
        Assert.Equal(2, http["items"]!.AsArray().Count);
        Assert.Equal(HttpStatusCode.BadRequest, (await staff.GetAsync(path + "minPriceRial=2&maxPriceRial=1")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await staff.GetAsync(path + "minStock=0&minStock=1")).StatusCode);
    }
    [Fact]
    public async Task MultiSelectUnionsEachColumnAndIntersectsBeforeCountAndPaging()
    {
        var a = await Create(27);
        var b = await Create(3);
        var wrongCategory = await Create();
        var wrongBrand = await Create();
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CatalogDbContext>();
            foreach (var row in await db.Products.Where(p => p.CategoryId == b.Category).ToArrayAsync(Ct))
                row.Status = "Published";
            (await db.Products.SingleAsync(p => p.Slug == "p-" + a.Prefix + "-2", Ct)).Status = "Hidden";
            (await db.Products.SingleAsync(p => p.Id == wrongCategory.Product, Ct)).BrandId = a.Brand;
            (await db.Products.SingleAsync(p => p.Id == wrongBrand.Product, Ct)).CategoryId = b.Category;
            await db.SaveChangesAsync(Ct);
        }
        await Command(c => c.ArchiveAsync("staff", new(Guid.NewGuid().ToString("N"), a.Product, a.Version, false), Ct));
        using var staff = await Staff();
        var path = $"/api/admin/catalog/workspace/products?categoryIds={a.Category}%2C{b.Category}&brandIds={a.Brand}%2C{b.Brand}";
        var first = await Json(await staff.GetAsync(path + "&statuses=Draft%2CPublished%2Carchived&sort=price&direction=asc"));
        var second = await Json(await staff.GetAsync(path + "&statuses=Draft%2CPublished%2Carchived&sort=price&direction=asc&page=1"));
        Assert.Equal("29", first["totalCount"]!.GetValue<string>());
        Assert.Equal("29", second["totalCount"]!.GetValue<string>());
        Assert.Equal(25, first["items"]!.AsArray().Count);
        Assert.Equal(4, second["items"]!.AsArray().Count);
        var rows = first["items"]!.AsArray().Concat(second["items"]!.AsArray()).ToArray();
        Assert.Equal(29, rows.Select(row => row!["id"]!.GetValue<string>()).Distinct().Count());
        Assert.Equal(a.Product, Assert.Single(rows, row => row!["archived"]!.GetValue<bool>())!["id"]!.GetValue<string>());
        Assert.DoesNotContain(rows, row => row!["status"]!.GetValue<string>() == "Hidden" && !row["archived"]!.GetValue<bool>());
        Assert.Equal(3, rows.Count(row => row!["status"]!.GetValue<string>() == "Published"));
        Assert.All(rows, row => Assert.Contains(row!["categoryId"]!.GetValue<string>(), new[] { a.Category, b.Category }));
        Assert.All(rows, row => Assert.Contains(row!["brandId"]!.GetValue<string>(), new[] { a.Brand, b.Brand }));

        var hidden = await Json(await staff.GetAsync(path + "&statuses=Hidden&status=archived"));
        Assert.False(Assert.Single(hidden["items"]!.AsArray())!["archived"]!.GetValue<bool>());
        var archived = await Json(await staff.GetAsync(path + "&statuses=archived"));
        Assert.True(Assert.Single(archived["items"]!.AsArray())!["archived"]!.GetValue<bool>());
        var legacyAll = await Json(await staff.GetAsync(path + "&status=all"));
        Assert.Equal("29", legacyAll["totalCount"]!.GetValue<string>());
        Assert.DoesNotContain(legacyAll["items"]!.AsArray(), row => row!["archived"]!.GetValue<bool>());
        Assert.Equal(HttpStatusCode.BadRequest, (await staff.GetAsync(path + "&statuses=Published&statuses=Draft")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await staff.GetAsync(path + "&statuses=all")).StatusCode);
    }
    [Fact]
    public async Task PricesPreserveExactMoneyAppendHistoryAndSameCommandReplaysOnlyOnce()
    {
        var s = await Create();
        var id = Guid.NewGuid().ToString("N");
        var input = new ProductWorkspacePricesInput(id, s.Product, s.Version, [new(s.Variant, s.VariantVersion, "9223372036854775807", null, true)]);
        var first = await Command(c => c.PricesAsync("staff-a", input, Ct));
        var replay = await Command(c => c.PricesAsync("staff-a", input, Ct));
        Assert.Equal(first.ProductVersion, replay.ProductVersion);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CatalogDbContext>();
            Assert.Equal(long.MaxValue, (await db.Variants.SingleAsync(v => v.Id == s.Variant)).PriceRial);
            Assert.Single(await db.PriceHistory.Where(h => h.VariantId == s.Variant).ToArrayAsync());
            Assert.Single(await db.Set<ProductWorkspaceCommand>().Where(c => c.RequestId == id).ToArrayAsync());
            Assert.Equal("not_found", (await Assert.ThrowsAsync<BusinessException>(() => scope.ServiceProvider.GetRequiredService<ProductWorkspaceCommands>().ReceiptAsync("staff-b", id, Ct))).Code);
        }
        Assert.Equal("product_command_conflict", (await Assert.ThrowsAsync<BusinessException>(() => Command(c => c.PricesAsync("staff-a", input with { Lines = [new(s.Variant, s.VariantVersion, "12", null, true)] }, Ct)))).Code);
        Assert.Equal("version_conflict", (await Assert.ThrowsAsync<BusinessException>(() => Command(c => c.PricesAsync("staff-a", input with { RequestId = Guid.NewGuid().ToString("N") }, Ct)))).Code);
    }
    [Fact]
    public async Task ArchiveHidesPubliclyRestoreIsDraftAndPreservesSkuAndHistory()
    {
        var s = await Create();
        var archived = await Command(c => c.ArchiveAsync("staff", new(Guid.NewGuid().ToString("N"), s.Product, s.Version, false), Ct));
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CatalogDbContext>();
            var reader = new ProductWorkspaceReader(db);
            Assert.Empty((await reader.PageAsync(ProductWorkspaceFilter.Create(categoryId: s.Category), Ct)).Items);
            Assert.Single((await reader.PageAsync(ProductWorkspaceFilter.Create(status: "archived", categoryId: s.Category), Ct)).Items);
            Assert.True((await reader.DetailAsync(s.Product, Ct)).Archived);
            Assert.Equal("Hidden", (await db.Products.SingleAsync(p => p.Id == s.Product)).Status);
        }
        await Command(c => c.ArchiveAsync("staff", new(Guid.NewGuid().ToString("N"), s.Product, archived.ProductVersion!, true), Ct));
        await using var final = fixture.Factory.Services.CreateAsyncScope();
        var product = await final.ServiceProvider.GetRequiredService<CatalogDbContext>().Products.Include(p => p.Variants).SingleAsync(p => p.Id == s.Product);
        Assert.Null(product.ArchivedAt);
        Assert.Equal("Draft", product.Status);
        Assert.Equal(s.Variant, Assert.Single(product.Variants).Id);
    }
    [Fact]
    public async Task FormConfigurationHasCasAndCannotDisableRequiredControls()
    {
        var fields = ProductFormFieldRules.Defaults().Select(f => new ProductFormFieldInput(f.Key, f.Label, f.Help, f.Visible, f.SortOrder)).ToArray();
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var current = await scope.ServiceProvider.GetRequiredService<ProductFormFields>().ReadAsync(Ct);
            var saved = await Command(c => c.FieldsAsync("staff", new(Guid.NewGuid().ToString("N"), current.Version, fields.Select(f => f.Key == "color" ? f with { Label = "رنگ واقعی", Visible = false } : f).ToArray()), Ct));
            Assert.NotNull(saved.ProductVersion);
            Assert.Equal("version_conflict", (await Assert.ThrowsAsync<BusinessException>(() => Command(c => c.FieldsAsync("staff", new(Guid.NewGuid().ToString("N"), current.Version, fields), Ct)))).Code);
        }
        await using var final = fixture.Factory.Services.CreateAsyncScope();
        Assert.False((await final.ServiceProvider.GetRequiredService<ProductFormFields>().ReadAsync(Ct)).Fields.Single(f => f.Key == "color").Visible);
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
    private async Task<HttpClient> Staff()
    {
        var account = await fixture.CreateAdministratorAsync();
        var client = fixture.Factory.CreateClient(new()
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
    [Fact]
    public async Task HttpCommandsAreAuditedAndInvalidFieldsRollbackWithoutInventoryWrites()
    {
        var s = await Create();
        using var anonymous = fixture.Factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/admin/catalog/workspace/products")).StatusCode);
        using var client = await Staff();
        long before;
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
            before = await scope.ServiceProvider.GetRequiredService<IdentityDbContext>().Audit.LongCountAsync();
        var path = "/api/admin/catalog/workspace/archive";
        await Json(await client.PostAsJsonAsync(path, new ProductWorkspaceArchiveInput(Guid.NewGuid().ToString("N"), s.Product, s.Version, false)));
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
            Assert.Equal(before + 1, await scope.ServiceProvider.GetRequiredService<IdentityDbContext>().Audit.LongCountAsync());
        var invalid = new ProductInput(s.Category, s.Brand, "bad slug", "Published", false, false, [new("fa", ""), new("en", "")], [], [], [], [], [], null);
        using var result = await client.PostAsJsonAsync("/api/admin/catalog/workspace/save", new ProductWorkspaceSaveInput(Guid.NewGuid().ToString("N"), null, invalid));
        Assert.Equal(HttpStatusCode.BadRequest, result.StatusCode);
        var body = JsonNode.Parse(await result.Content.ReadAsStringAsync())!;
        Assert.Equal("invalid_product_fields", body["title"]!.GetValue<string>());
        Assert.NotNull(body["errors"]!["nameFa"]);
        Assert.NotNull(body["errors"]!["slug"]);
        await using var final = fixture.Factory.Services.CreateAsyncScope();
        Assert.Equal(before + 1, await final.ServiceProvider.GetRequiredService<IdentityDbContext>().Audit.LongCountAsync());
        var inventory = final.ServiceProvider.GetRequiredService<InventoryDbContext>();
        Assert.False(await inventory.Stock.AnyAsync(row => row.VariantId == s.Variant));
    }
    [Fact]
    public async Task SaveRejectsCollisionWithAnExistingInactiveSkuOfTheSameProduct()
    {
        var s = await Create();
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<CatalogDbContext>();
        var p = await db.Products.Include(p => p.Variants).SingleAsync(p => p.Id == s.Product);
        p.Variants[0].IsActive = false;
        await db.SaveChangesAsync();
        var variant = new VariantInput(null, p.Variants[0].Sku, "100", null, "#151515", "", "", "", "", "", "", true, [], [], null);
        var input = new ProductInput(s.Category, s.Brand, p.Slug, "Draft", false, false, [new("fa", "مدل"), new("en", "Model")], [], [variant], [], [], [], Convert.ToBase64String(p.Version));
        var error = await Assert.ThrowsAsync<ProductFieldValidationException>(() => new ProductFieldValidation(db).ValidateAsync(s.Product, input, Ct));
        Assert.True(error.Errors.ContainsKey("variants.0.sku"));
    }
}
