using System.Data;
using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Catalog.Media;
using Shop.Modules.Identity;
using Shop.Modules.Inventory;
using Shop.SharedKernel;

// Explicit owner-requested examples. No customer, financial policy, provider or
// existing product is rewritten. Catalog and Inventory use their own services.
public static class DevelopmentProductExamples
{
    private const string Actor = "development-sample:product-workspace";
    private sealed record Variant(string Code, string Storage, string Ram, string Color, string ColorEn, string Hex, string Price, string? Reference, int Quantity);
    private sealed record Model(string Slug, string Category, string Brand, string Name, string NameEn, string Image, string Processor, string Display, Variant[] Variants, InspectionExample? Inspection = null);
    private sealed record InspectionExample(string Technical, string Battery, int? Percent, string Screen, string Body, string Repair, string NoteFa, string NoteEn);
    private static readonly Model[] Models = [
        new("d70-sample-galaxy-a10","phones","Samsung","سامسونگ Galaxy A10","Samsung Galaxy A10","/products/phone-titanium.svg","Exynos 7884","6.2 inches",[
            new("A10-BLACK","32GB","2GB","مشکی","Black","#17191d","39000000",null,0),new("A10-BLUE","32GB","2GB","آبی","Blue","#396082","41000000",null,3)]),
        new("d70-sample-iphone-15","phones","Apple","اپل iPhone 15","Apple iPhone 15","/products/phone-silver.svg","A16 Bionic","6.1 inches",[
            new("IP15-128-BLACK","128GB","","مشکی","Black","#252a2d","830000000","870000000",2),new("IP15-128-BLUE","128GB","","آبی","Blue","#c5d7e0","850000000",null,0),new("IP15-256-BLACK","256GB","","مشکی","Black","#252a2d","950000000",null,3),new("IP15-256-BLUE","256GB","","آبی","Blue","#c5d7e0","970000000",null,1)]),
        new("d70-sample-macbook-air-m1","laptops","Apple","مک‌بوک Air M1 2020","MacBook Air M1 2020","/products/laptop.svg","Apple M1","13.3 inches",[
            new("MBA-8-256-GRAY","256GB","8GB","خاکستری","Space Gray","#73767a","620000000",null,2),new("MBA-8-512-SILVER","512GB","8GB","نقره‌ای","Silver","#c9cbcd","690000000","720000000",1),new("MBA-16-512-GRAY","512GB","16GB","خاکستری","Space Gray","#73767a","770000000",null,0)]),
        new("d70-sample-ps5-disc","gaming","Sony","پلی‌استیشن ۵ دیسک‌خور ۱ترابایت","PlayStation 5 Disc 1TB","/products/console.svg","","",[
            new("PS5-DISC-1TB","1TB","","سفید","White","#e8e7e2","530000000",null,2)]),
        new("d70-sample-usb-c-charger","accessories","Sayman Demo","شارژر USB-C آموزشی","USB-C charger demo","/products/charger.svg","","",[
            new("CHARGER-20-WHITE","","","سفید · ۲۰وات","White /20W","#efefeb","6500000",null,8),new("CHARGER-30-BLACK","","","مشکی · ۳۰وات","Black /30W","#1f2327","8900000","9900000",4)]),
        new("d70-sample-headphones","accessories","Sayman Demo","هدفون آموزشی سایمان","Sayman headphones demo","/products/headphones.svg","","",[
            new("HEADPHONE-OLIVE","","","زیتونی","Olive","#606f47","24000000",null,3),new("HEADPHONE-BLACK","","","مشکی","Black","#1b201d","23000000",null,0)])
    ];
    private static readonly Model[] UsedModels = [
        new("d83-used-phone","phones","Samsung","گلکسی A10 کارکرده","Used Galaxy A10","/products/phone-titanium.svg","","",[
            new("PHONE-01","","","آبی","Blue","#396082","32000000","39000000",1)],
            new("passed","measured",86,"intact","worn","noKnownRepair","خط سطحی کنار قاب؛ آزمون تماس و شارژ انجام شده.","Light frame scratches; calls and charging tested.")),
        new("d83-used-laptop","laptops","Apple","مک‌بوک Air M1 کارکرده","Used MacBook Air M1","/products/laptop.svg","","",[
            new("LAPTOP-01","","","خاکستری","Space Gray","#73767a","550000000",null,1)],
            new("passed","unknown",null,"worn","intact","repaired","نمایشگر تعویض شده است؛ درصد سلامت باتری اندازه‌گیری نشده.","Screen replaced; battery health was not measured.")),
        new("d83-used-console","gaming","Sony","پلی‌استیشن ۵ کارکرده","Used PlayStation 5","/products/console.svg","","",[
            new("CONSOLE-01","","","سفید","White","#e8e7e2","380000000",null,0)],
            new("needsRepair","notApplicable",null,"unknown","damaged","unknown","دیسک‌خوان نیازمند تعمیر است. کنسول نمایشگر داخلی ندارد. نمونهٔ ناموجود.","Disc drive needs repair. No built-in display. Unavailable example.")),
        new("d83-used-accessory","accessories","Sayman Demo","شارژر USB-C کارکرده","Used USB-C charger","/products/charger.svg","","",[
            new("CHARGER-01","","","سفید","White","#efefeb","3900000","6500000",1)],
            new("passed","notApplicable",null,"unknown","worn","unknown","شارژر بدون باتری و نمایشگر؛ روی قاب آثار استفاده دیده می‌شود.","No battery or display; housing shows wear."))
    ];
    public static async Task<object> RunAsync(IServiceProvider services, IHostEnvironment environment, string contentRoot, CancellationToken ct, bool usedExamples = false)
    {
        if (!environment.IsDevelopment())
            throw new InvalidOperationException("Product examples are restricted to Development.");
        var identity = services.GetRequiredService<IdentityDbContext>();
        var catalog = services.GetRequiredService<CatalogDbContext>();
        var inventory = services.GetRequiredService<InventoryDbContext>();
        var name = catalog.Database.GetDbConnection().Database;
        if (name != "Sayman" && !name.StartsWith("SaymanTest_", StringComparison.Ordinal))
            throw new InvalidOperationException("Use the canonical local database or a disposable automated fixture.");
        var results = new List<object>();
        var actor = usedExamples ? "development-sample:used-devices" : Actor;
        var skuPrefix = usedExamples ? "D83-USED-DEMO-" : "D70-DEMO-";
        foreach (var model in usedExamples ? UsedModels : Models)
        {
            if (await catalog.Products.AnyAsync(p => p.Slug == model.Slug, ct))
            {
                results.Add(new
                {
                    model.Slug,
                    Status = "existing-product-preserved"
                });
                continue;
            }
            ProductVideoInput[] videos = [];
            if (model.Slug == "d70-sample-iphone-15")
            {
                var service = services.GetRequiredService<PublicVideoService>();
                var prior = await catalog.Set<PublicVideoAsset>().AsNoTracking().Where(a => a.CreatedBy == Actor && a.Status == "Ready" && a.Extension == "mp4").OrderBy(a => a.CreatedAt).FirstOrDefaultAsync(ct);
                string url;
                if (prior is not null)
                {
                    if (await service.ReadAsync(prior.Id, "mp4", ct) is null)
                        throw new InvalidOperationException("The existing demonstration video object is missing.");
                    url = PublicVideoPaths.Url(prior.Id, "mp4");
                }
                else
                {
                    var file = Path.GetFullPath(Path.Combine(contentRoot, "../../Seed/media/sayman-product-demo.mp4"));
                    if (!File.Exists(file))
                        file = Path.Combine(contentRoot, "Seed/media/sayman-product-demo.mp4");
                    var bytes = await File.ReadAllBytesAsync(file, ct);
                    var uploaded = await service.UploadAsync(bytes, "sayman-product-demo.mp4", "video/mp4", Actor, ct);
                    url = uploaded.Url;
                }
                videos = [new(url)];
            }
            await using var tx = await identity.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
            var connection = identity.Database.GetDbConnection();
            foreach (var db in new DbContext[] { catalog, inventory })
            {
                db.Database.SetDbConnection(connection, false);
                await db.Database.UseTransactionAsync(tx.GetDbTransaction(), ct);
            }
            try
            {
                var service = services.GetRequiredService<ICatalogService>();
                var category = await catalog.Categories.Include(c => c.Attributes).Include(c => c.Translations).SingleAsync(c => c.Id == model.Category, ct);
                var brand = await catalog.Brands.SingleOrDefaultAsync(b => b.Name == model.Brand, ct);
                var brandId = brand?.Id ?? await service.SaveBrandAsync(null, new(model.Brand, "d70-sample-" + model.Brand.ToLowerInvariant().Replace(' ', '-'), "", true, null), ct);
                async Task<AttributeValueInput?> Value(string key, string text)
                {
                    if (string.IsNullOrEmpty(text))
                        return null;
                    var definition = await catalog.AttributeDefinitions.Include(d => d.Options).Include(d => d.Translations).SingleOrDefaultAsync(d => d.Key == key, ct);
                    if (definition is null || !category.Attributes.Any(a => a.AttributeId == definition.Id))
                        return null;
                    if (definition.DataType == AttributeDataType.Text)
                        return new(definition.Id, text, text);
                    if (definition.DataType != AttributeDataType.Select)
                        throw new InvalidOperationException("Sample specification type changed; preserve the administrator's schema.");
                    var option = definition.Options.FirstOrDefault(o => string.Equals(o.LabelEn.Replace(" ", ""), text.Replace(" ", ""), StringComparison.OrdinalIgnoreCase));
                    if (option is null)
                    {
                        var options = definition.Options.Select(o => new OptionInput(o.Id, o.Value, o.LabelFa, o.LabelEn, o.SortOrder)).Append(new(null, "d70-" + text.ToLowerInvariant(), text, text, definition.Options.Count)).ToArray();
                        await service.SaveAttributeAsync(definition.Id, new(definition.Key, definition.DataType, definition.Unit, definition.Translations.Select(t => new TranslationInput(t.Locale, t.Name)).ToArray(), options, Convert.ToBase64String(definition.Version)), ct);
                        option = definition.Options.Single(o => o.Value == "d70-" + text.ToLowerInvariant());
                    }
                    return new(definition.Id, OptionId: option.Id);
                }
                var common = new List<AttributeValueInput>();
                foreach (var pair in new[] { ("processor", model.Processor), ("display", model.Display) })
                if (await Value(pair.Item1, pair.Item2) is { } item)
                    common.Add(item);
                var variants = new List<VariantInput>();
                foreach (var variant in model.Variants)
                {
                    var attrs = new List<AttributeValueInput>();
                    foreach (var pair in new[] { ("storage", variant.Storage), ("ram", variant.Ram) })
                    if (await Value(pair.Item1, pair.Item2) is { } item)
                        attrs.Add(item);
                    var label = string.Join(" / ", new[] { variant.Storage, variant.Ram, variant.Color }.Where(s => s.Length > 0));
                    var labelEn = usedExamples ? variant.ColorEn : label;
                    variants.Add(new(null, skuPrefix + variant.Code, variant.Price, variant.Reference, variant.Hex, variant.Color, variant.ColorEn, label, labelEn, "نمونهٔ آموزشی؛ قرارداد گارانتی واقعی نیست.", "Development example; no real warranty contract.", true, attrs.ToArray(), [], null));
                }
                var online = (await services.GetRequiredService<IPurchaseConfiguration>().MethodsAsync("fa", ct)).FirstOrDefault(m => m.Kind == "online");
                if (online is null)
                    throw new InvalidOperationException("An existing online purchase method is required; examples never enable a payment provider.");
                var input = new ProductInput(category.Id, brandId, model.Slug, "Published", false, true, [new("fa", model.Name + " · نمونهٔ آموزشی", "نمونهٔ Development برای آزمون تنوع، قیمت، تخفیف و انبار. قیمت و تعداد آموزشی‌اند؛ تصویر، طرح مفهومی پروژه است و پیشنهاد فروش واقعی یا قرارداد گارانتی نیست.", "نمونهٔ آموزشی"), new("en", model.NameEn + " · Demo", "Development catalogue example. Prices and warehouse quantities are synthetic; the image is project concept art, not a real sale offer or warranty.", "Development demo")], common.ToArray(), variants.ToArray(), [model.Image], [online.Id], [], null, videos);
                var receipt = await services.GetRequiredService<ProductWorkspaceCommands>().SaveAsync(actor, new(Guid.NewGuid().ToString("N"), null, input), ct);
                var product = await catalog.Products.Include(p => p.Variants).SingleAsync(p => p.Id == receipt.ProductId, ct);
                if (model.Inspection is { } example)
                {
                    var sku = product.Variants.Single();
                    var inspections = services.GetRequiredService<UsedItemConditions>();
                    var inspection = new UsedItemConditionData(Guid.NewGuid().ToString("N"), example.Technical, example.Battery, example.Percent, example.Screen, example.Body, example.Repair,
                        "گزارش ساختگی برای نمایش گردش کار. " + example.NoteFa, "Synthetic inspection for workflow demonstration. " + example.NoteEn,
                        services.GetRequiredService<TimeProvider>().GetUtcNow());
                    await inspections.SaveAsync(actor, sku.Id, Guid.NewGuid().ToString("N"), new(Convert.ToBase64String(sku.Version), inspection), services.GetRequiredService<IUsedItemStockPolicy>(), ct);
                }
                foreach (var row in model.Variants.Where(v => v.Quantity > 0))
                {
                    var sku = product.Variants.Single(v => v.Sku == skuPrefix + row.Code);
                    var stock = usedExamples ? await inventory.Stock.SingleAsync(s => s.VariantId == sku.Id, ct) : null;
                    await services.GetRequiredService<InventoryService>().AdjustAsync(sku.Id, new(row.Quantity, "دریافت نمونهٔ آموزشی؛ موجودی واقعی فروشگاه نیست.", Guid.NewGuid().ToString(), stock is null ? null : Convert.ToBase64String(stock.Version)), actor, ct);
                }
                identity.Audit.Add(new()
                {
                    ActorId = actor,
                    Action = "development-sample-import",
                    Resource = "catalog/" + product.Id,
                    TraceId = receipt.RequestId
                });
                await identity.SaveChangesAsync(ct);
                await tx.CommitAsync(ct);
                results.Add(new
                {
                    model.Slug,
                    product.Id,
                    Status = "development-example-created",
                    Variants = product.Variants.Count
                });
            }
            finally { await catalog.Database.UseTransactionAsync(null, CancellationToken.None); await inventory.Database.UseTransactionAsync(null, CancellationToken.None); }
        }
        return new
        {
            DevelopmentOnly = true,
            FinancialPoliciesChanged = false,
            CustomersChanged = false,
            Products = results
        };
    }
}
