using System.Data;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Credit;
using Shop.Modules.Identity;
using Shop.Modules.Inventory;
using Shop.Modules.Payments;

// Explicit, idempotent Development data correction, using the accepted Catalog
// commands and their CAS validation. Does not create a server or staff session.
if (Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") != "Development")
    throw new InvalidOperationException("Development examples only.");
var connection = Environment.GetEnvironmentVariable("ConnectionStrings__Shop")
    ?? throw new InvalidOperationException("A private local connection is required.");
DbContextOptions<T> Options<T>() where T : DbContext => new DbContextOptionsBuilder<T>().UseSqlServer(connection).Options;
await using var identity = new IdentityDbContext(Options<IdentityDbContext>());
await using var db = new CatalogDbContext(Options<CatalogDbContext>());
await using var stock = new InventoryDbContext(Options<InventoryDbContext>());
await using var payments = new PaymentsDbContext(Options<PaymentsDbContext>());
await using var credit = new CreditDbContext(Options<CreditDbContext>());
if (db.Database.GetDbConnection().Database != "Sayman")
    throw new InvalidOperationException("Only the canonical local Sayman examples are in scope.");
var clock = TimeProvider.System;
var purchasing = new PurchaseConfiguration(new PurchaseMethodService(payments), new CreditPlanService(credit));
var inventory = new InventoryService(stock);
var serial = new SerialInventoryService(stock, new StockReservationService(stock, clock, true), clock);
var service = new CatalogService(db, inventory, purchasing, clock, serial);
var commands = new ProductWorkspaceCommands(db, service, clock);
var expected = new Dictionary<string, int> {
    ["d70-sample-galaxy-a10"] = 2, ["d70-sample-iphone-15"] = 4,
    ["d70-sample-macbook-air-m1"] = 3, ["d70-sample-ps5-disc"] = 1,
    ["d70-sample-usb-c-charger"] = 2, ["d70-sample-headphones"] = 2,
};
const string actor = "development-sample:product-workspace";
var products = await db.Products.AsNoTracking().Where(p => expected.Keys.Contains(p.Slug)).Select(p => new { p.Id, p.Slug }).ToArrayAsync();
if (products.Length != expected.Count)
    throw new InvalidOperationException("All six existing examples must be present.");
var changed = 0;
foreach (var product in products)
{
    db.ChangeTracker.Clear();
    identity.ChangeTracker.Clear();
    await using var tx = await identity.Database.BeginTransactionAsync(IsolationLevel.Serializable);
    db.Database.SetDbConnection(identity.Database.GetDbConnection(), false);
    await db.Database.UseTransactionAsync(tx.GetDbTransaction());
    try
    {
        var detail = await new ProductWorkspaceReader(db).DetailAsync(product.Id, CancellationToken.None);
        var p = detail.Product;
        if (detail.Archived || p.Variants.Length != expected[product.Slug]
            || p.Variants.Any(v => !v.Sku.StartsWith("D70-DEMO-", StringComparison.Ordinal))
            || !p.Translations.Any(t => t.Locale == "en" && t.Name.EndsWith(" · Demo", StringComparison.Ordinal)))
            throw new InvalidOperationException("The owner has changed an example; preserve it for manual review.");
        string EnglishLabel(AdminVariant v)
        {
            if (!v.LabelEn.Any(c => c is >= '\u0600' and <= '\u06ff')) return v.LabelEn;
            if (v.ColorNameFa.Length == 0 || !v.LabelEn.EndsWith(v.ColorNameFa, StringComparison.Ordinal)
                || v.LabelEn != v.LabelFa || v.ColorNameEn.Length == 0)
                throw new InvalidOperationException("Unexpected example label; do not overwrite an owner edit.");
            return v.LabelEn[..^v.ColorNameFa.Length] + v.ColorNameEn;
        }
        var count = p.Variants.Count(v => EnglishLabel(v) != v.LabelEn);
        if (count == 0) { await tx.CommitAsync(); continue; }
        AttributeValueInput Value(AdminValue v) => new(v.AttributeId, v.ValueTextFa, v.ValueTextEn,
            v.ValueNumber, v.ValueBool, v.ValueOptionId, v.Selections.Select(s => s.OptionId).ToArray());
        var input = new ProductInput(p.CategoryId, p.BrandId, p.Slug, p.Status, p.IsDigital, p.Featured,
            p.Translations.Select(t => new TranslationInput(t.Locale, t.Name, t.Description, t.Badge)).ToArray(),
            p.Attributes.Select(Value).ToArray(),
            p.Variants.Select(v => new VariantInput(v.Id, v.Sku, v.PriceRial, v.CompareAtPriceRial,
                v.Color, v.ColorNameFa, v.ColorNameEn, v.LabelFa, EnglishLabel(v), v.WarrantyFa,
                v.WarrantyEn, v.IsActive, v.Attributes.Select(Value).ToArray(),
                v.PurchaseMethods.Select(m => m.MethodId).ToArray(), v.Version)).ToArray(),
            p.Media.Select(m => m.Url).ToArray(), p.PurchaseMethods.Select(m => m.MethodId).ToArray(),
            p.CreditPlans.Select(plan => plan.PlanId).ToArray(), p.Version,
            detail.Videos.Select(v => new ProductVideoInput(v.Url, v.VariantId)).ToArray());
        var receipt = await commands.SaveAsync(actor, new(Guid.NewGuid().ToString("N"), product.Id, input), CancellationToken.None);
        identity.Audit.Add(new() { ActorId = actor, Action = "development-sample-translation-fix", Resource = "catalog/" + product.Id, TraceId = receipt.RequestId });
        await identity.SaveChangesAsync();
        await tx.CommitAsync();
        changed += count;
    }
    finally { await db.Database.UseTransactionAsync(null); }
}
Console.WriteLine(JsonSerializer.Serialize(new { DevelopmentOnly = true, EnglishVariantLabelsCorrected = changed, FinancialOrInventoryChangesRequested = false }));
