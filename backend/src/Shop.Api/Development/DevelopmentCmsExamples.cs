using System.Data;
using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Cms;
using Shop.Modules.Identity;

// Explicit local CLI. All content uses the normal versioned CMS commands.
public static partial class DevelopmentCmsExamples
{
    public const string Actor = "development-seed:cms-examples";
    private const string Source = "127.0.0.1,11433";
    private const string Blog = "blog";
    private const string Pages = "pages";

    public sealed record Entry(string Kind, string Slug, string State);
    public sealed record Result(int Published, int ExistingPreserved, IReadOnlyList<Entry> Items);

    [GeneratedRegex("^SaymanTest_[a-f0-9]{32}$", RegexOptions.CultureInvariant)]
    private static partial Regex TestDatabase();

    public static async Task<Result> RunAsync(IServiceProvider services, IHostEnvironment environment, CancellationToken ct)
    {
        if (!environment.IsDevelopment())
            throw new InvalidOperationException("CMS examples are available only in Development.");

        var cms = services.GetRequiredService<CmsDbContext>();
        var identity = services.GetRequiredService<IdentityDbContext>();
        var connection = cms.Database.GetDbConnection();
        var auditConnection = identity.Database.GetDbConnection();
        if (connection.DataSource != Source || (connection.Database != "Sayman" && !TestDatabase().IsMatch(connection.Database)))
            throw new InvalidOperationException("CMS examples require the local SQL service and Sayman or a disposable SQL fixture.");
        if (auditConnection.State != ConnectionState.Closed || auditConnection.Database != connection.Database || auditConnection.DataSource != connection.DataSource)
            throw new InvalidOperationException("CMS example commands and their audit require the same local database.");

        var entries = new List<Entry>();
        await using var transaction = await cms.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        identity.Database.SetDbConnection(connection, contextOwnsConnection: false);
        await identity.Database.UseTransactionAsync(transaction.GetDbTransaction(), ct);
        try
        {
            await using (var gate = connection.CreateCommand())
            {
                gate.Transaction = transaction.GetDbTransaction();
                gate.CommandTimeout = 15;
                gate.CommandText = "DECLARE @result int; EXEC @result=sys.sp_getapplock @Resource=N'sayman:development-cms-examples',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @result;";
                if (Convert.ToInt32(await gate.ExecuteScalarAsync(ct), CultureInfo.InvariantCulture) < 0)
                    throw new InvalidOperationException("The CMS example command is already running. Retry after it finishes.");
            }

            var posts = services.GetRequiredService<CmsBlogPostService>();
            foreach (var (slug, body, tag) in Articles())
            {
                if (await cms.BlogPosts.AnyAsync(row => row.Slug == slug, ct))
                {
                    entries.Add(new(Blog, slug, "existing-preserved"));
                    continue;
                }

                var post = new CmsBlogContent(body, "Organization", "نمونهٔ تحریریهٔ سایمان", "Sayman editorial sample", null, null, null, [tag]);
                var created = await posts.WriteAsync(Actor, null, Id(), new("Create", Slug: slug, IsDemo: true, Content: post), ct);
                var published = await posts.WriteAsync(Actor, created.PostId, Id(), new("Publish", Version: created.Version, Confirmed: true), ct);
                identity.Audit.Add(Audit(Blog, slug, published.CommandId));
                entries.Add(new(Blog, slug, "published"));
            }

            var pages = services.GetRequiredService<CmsPageService>();
            foreach (var (slug, body) in ContentPages())
            {
                if (await cms.Pages.AnyAsync(row => row.Slug == slug, ct))
                {
                    entries.Add(new(Pages, slug, "existing-preserved"));
                    continue;
                }

                var created = await pages.WriteAsync(Actor, null, Id(), new("Create", Slug: slug, IsDemo: true, Content: body), ct);
                var published = await pages.WriteAsync(Actor, created.PageId, Id(), new("Publish", Version: created.Version, Confirmed: true), ct);
                identity.Audit.Add(Audit(Pages, slug, published.CommandId));
                entries.Add(new(Pages, slug, "published"));
            }

            await identity.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        }
        finally { await identity.Database.UseTransactionAsync(null, CancellationToken.None); }

        var count = entries.Count(entry => entry.State == "published");
        return new(count, entries.Count - count, entries);
    }

    private static AuditEvent Audit(string kind, string slug, string command) => new()
    {
        ActorId = Actor,
        Action = "DevelopmentExample",
        Resource = $"cms/{kind}/{slug}",
        TraceId = command,
    };

    private static string Id() => Guid.NewGuid().ToString("N");
    private static CmsPageBlock Text(string heading, string text) => new(Id(), "Text", "All", Heading: heading, Text: text);
    private static CmsPageBlock Callout(string heading, string text) => new(Id(), "Callout", "All", Heading: heading, Text: text);
    private static CmsPageBlock Links(string heading, params CmsPageLink[] links) => new(Id(), "Links", "All", Heading: heading, Links: links);
    private static CmsPageLanguage Fa(string title, string description, params CmsPageBlock[] blocks) => new(title + " · نمونهٔ آموزشی", description, blocks);
    private static CmsPageLanguage En(string title, string description, params CmsPageBlock[] blocks) => new(title + " · Demo", description, blocks);

    private static IEnumerable<(string Slug, CmsPageContent Body, CmsBlogTag Tag)> Articles()
    {
        var guide = new CmsBlogTag("buying-guides", "راهنمای انتخاب", "Buying guides");
        yield return ("demo-phone-storage", new(
            Fa("انتخاب حافظهٔ گوشی", "چطور میان تنوع‌های حافظهٔ یک مدل انتخاب کنیم؟",
                Text("از مصرف فعلی شروع کنید", "در تنظیمات دستگاه فعلی ببینید عکس‌ها، ویدیوها و برنامه‌ها چقدر فضا گرفته‌اند. اگر ویدیو و بازی را روی دستگاه نگه می‌دارید، فضای آزاد آینده را هم در نظر بگیرید."),
                Callout("ظرفیت اسمی و فضای آزاد", "بخشی از حافظه به سیستم‌عامل و فایل‌های سیستمی اختصاص دارد. مشخصات تنوع انتخابی را قبل از خرید دوباره بررسی کنید."),
                Links("برای ادامه", new CmsPageLink("کاتالوگ گوشی‌ها", "/catalog?category=phones"), new CmsPageLink("راهنمای مقایسه", "/pages/demo-catalog-guide"))),
            En("Choosing phone storage", "A simple way to compare storage options for the same phone.",
                Text("Start with what you use", "Check the storage breakdown on your current device. If you keep videos and games offline, leave room for new files."),
                Callout("Capacity and free space", "The operating system and system files use some of the listed storage. Check the exact variant before buying."),
                Links("Explore further", new CmsPageLink("Browse phones", "/catalog?category=phones"), new CmsPageLink("Catalogue guide", "/pages/demo-catalog-guide")))), guide);
        yield return ("demo-used-device-checklist", new(
            Fa("خواندن گزارش کالای کارکرده", "به کدام قسمت‌های گزارش سلامت یک دستگاه توجه کنیم؟",
                Text("همان دستگاه را بررسی کنید", "وضعیت فنی، سابقهٔ تعمیر و عکس‌ها را برای SKU همان دستگاه بخوانید. ظاهر یک نمونه، سلامت نمونهٔ دیگری از همان مدل را مشخص نمی‌کند."),
                Callout("وضعیت نامشخص", "اگر بخشی از گزارش نامشخص است، قبل از انتخاب دربارهٔ همان مورد سؤال کنید. درصد باتری را فقط از گزارش اندازه‌گیری همان دستگاه بخوانید."),
                Links("برای ادامه", new CmsPageLink("راهنمای وضعیت دستگاه", "/pages/demo-used-condition-guide"))),
            En("Reading a used-device report", "Know which parts of a condition report to check before choosing.",
                Text("Check the individual unit", "Read the technical state, repair history and photos for the exact SKU. Units of the same model can be in different condition."),
                Callout("When a result is unknown", "Ask about an unknown result before choosing. Use the battery percentage recorded for the individual unit."),
                Links("Explore further", new CmsPageLink("Condition guide", "/pages/demo-used-condition-guide")))), guide);
        yield return ("demo-console-buying-guide", new(
            Fa("مقایسهٔ نسخه‌های کنسول", "نسخهٔ دیسک‌خور و دیجیتال را با توجه به شیوهٔ بازی خود مقایسه کنید.",
                Text("کتابخانهٔ بازی خودتان", "اگر بازی دیسکی دارید، وجود و سازگاری دیسک‌خوان را در مشخصات همان تنوع بررسی کنید. برای خرید دیجیتال، فضای نگهداری بازی‌ها و دسترسی به حساب خود را در نظر بگیرید."),
                Text("محتویات جعبه", "تعداد دسته‌ها، کابل‌های همراه و نوع گارانتی را روی صفحهٔ همان کالا بخوانید."),
                Links("برای ادامه", new CmsPageLink("کنسول‌های فروشگاه", "/catalog?category=gaming"))),
            En("Comparing console editions", "Compare disc and digital editions based on how you play.",
                Text("Consider your game library", "If you own physical games, check the exact variant for a compatible disc drive. For digital purchases, consider storage and access to your account."),
                Text("Check the box contents", "Look up the controllers, included cables and warranty for the individual product."),
                Links("Explore further", new CmsPageLink("Browse consoles", "/catalog?category=gaming")))), guide);
    }

    private static IEnumerable<(string Slug, CmsPageContent Body)> ContentPages()
    {
        yield return ("demo-catalog-guide", new(
            Fa("راهنمای انتخاب و مقایسهٔ کالا", "از کاتالوگ به انتخاب تنوع مناسب برسید.",
                Text("دسته و تنوع را مشخص کنید", "کالا را از کاتالوگ باز کنید و رنگ، حافظه و سایر گزینه‌ها را جداگانه بررسی کنید. قیمت و موجودی ممکن است بین تنوع‌های یک مدل متفاوت باشد."),
                Callout("قبل از افزودن به سبد", "قیمت، گارانتی و موجودی تنوع انتخابی را روی صفحهٔ کالا بازبینی کنید."),
                Links("میان‌برها", new CmsPageLink("کاتالوگ", "/catalog"), new CmsPageLink("مقایسه", "/compare"), new CmsPageLink("انتخاب حافظهٔ گوشی", "/blog/demo-phone-storage"))),
            En("Catalogue and comparison guide", "Go from browsing the catalogue to picking the right variant.",
                Text("Choose the category and variant", "Open a product from the catalogue and check colour, storage and other options separately. Price and availability can differ by variant."),
                Callout("Before adding to the cart", "Review the price, warranty and availability for your selected variant on the product page."),
                Links("Shortcuts", new CmsPageLink("Catalogue", "/catalog"), new CmsPageLink("Compare products", "/compare"), new CmsPageLink("Choosing phone storage", "/blog/demo-phone-storage")))));
        yield return ("demo-used-condition-guide", new(
            Fa("راهنمای وضعیت کالای کارکرده", "معنی وضعیت‌های رایج در گزارش یک دستگاه کارکرده.",
                Text("وضعیت ظاهری و فنی", "آثار استفاده به ظاهر دستگاه مربوط است. نتیجهٔ بررسی فنی و تعمیرهای ثبت‌شده را جداگانه بخوانید و به توضیح هر دستگاه توجه کنید."),
                Callout("باتری نامشخص یا فاقد باتری", "نامشخص یعنی نتیجهٔ اندازه‌گیری ثبت نشده است. «فاقد این ویژگی» برای دستگاهی به کار می‌رود که باتری ندارد."),
                Links("برای ادامه", new CmsPageLink("چک‌لیست گزارش سلامت", "/blog/demo-used-device-checklist"), new CmsPageLink("پشتیبانی سایمان", "/support"))),
            En("Used-device condition guide", "Understand common labels in a used-device report.",
                Text("Appearance and function", "Signs of wear describe appearance. Read the technical result and recorded repairs separately, alongside the notes for that unit."),
                Callout("Unknown or not applicable", "Unknown means a measurement was not recorded. Not applicable means the device has no battery."),
                Links("Explore further", new CmsPageLink("Condition report checklist", "/blog/demo-used-device-checklist"), new CmsPageLink("Sayman support", "/support")))));
    }
}
