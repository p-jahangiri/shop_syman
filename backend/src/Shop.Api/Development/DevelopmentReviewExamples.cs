using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Identity;
using Shop.Modules.Reviews;
using SkiaSharp;

public static class DevelopmentReviewExamples
{
    private const string Actor = "development-seed:review-examples";
    private const string Phone = "d70-sample-galaxy-a10";
    private const string Charger = "d70-sample-usb-c-charger";
    private sealed record Example(string Slug, string Key, string Locale, int Rating, string Name, string Title, string Body, bool Publish, bool Photo = false);
    private static readonly Example[] Examples = [
        new(Phone, "fit", "fa", 5, "کاربر نمونهٔ ۱", "برای تماس و پیام مناسب است",
            "در این نمونهٔ آموزشی، گوشی برای تماس، پیام و استفاده از برنامه‌های سبک بررسی شده است. قبل از خرید، حافظهٔ تنوع انتخابی را بررسی کنید.", true, true),
        new(Phone, "display", "fa", 3, "کاربر نمونهٔ ۲", "نمایشگر خوب، حافظه محدود",
            "برای دیدن پیام‌ها و عکس‌ها تجربهٔ خوبی بود، اما برای نصب بازی‌های حجیم ظرفیت بیشتری ترجیح می‌دهم. این متن نمونهٔ آموزشی است.", true),
        new(Phone, "daily", "en", 4, "Demo reviewer", "A practical phone for light use",
            "This example shows how a review can explain a specific use case: calls, messages and a few everyday apps.", true),
        new(Phone, "pending", "fa", 2, "کاربر نمونهٔ ۳", "نمونهٔ منتظر بررسی با عکس",
            "این نمونه برای دیدن صف بررسی مدیر و کنترل عکس قبل از انتشار ثبت شده است و در فروشگاه نمایش داده نمی‌شود.", false, true),
        new(Charger, "charging", "fa", 4, "کاربر نمونهٔ ۴", "اندازهٔ مناسب برای سفر",
            "در این نمونهٔ آموزشی شارژر به‌خاطر اندازهٔ کوچک انتخاب شده است؛ توان درج‌شده برای هر تنوع باید جداگانه بررسی شود.", true),
    ];

    private static readonly Example[] ArvanMoreExamples = [
        new("d135-demo-galaxy-s24", "s24-camera", "fa", 5, "کاربر نمونهٔ سایمان", "نور روز و خوانایی نمایشگر",
            "این دیدگاه نمونه است. نمایشگر روشن است و هنگام انتخاب نسخه بهتر است ظرفیت ذخیره‌سازی را بررسی کنید.", true, true),
        new("d135-demo-zenbook-14", "zenbook-portability", "fa", 4, "کاربر نمونهٔ سایمان", "برای کار روزمره سبک است",
            "برای نمایش حالت دیدگاه عکس‌دار، تجربهٔ فرضی کار با لپ‌تاپ در سفر و کلاس را نوشته‌ام.", true, true),
        new("d135-demo-switch-oled", "switch-portable", "en", 4, "Sayman demo reviewer", "Portable and docked use",
            "Illustrative feedback for testing both languages and moderation. Check the included accessories for the selected SKU.", true),
        new("d135-demo-travel-powerbank", "powerbank-finish", "fa", 3, "کاربر نمونهٔ سایمان", "صف بازبینی عکس لوازم جانبی",
            "نمونهٔ دیدگاه منتظر تأیید است تا مدیر بتواند عکس و متن را پیش از انتشار مرور کند.", false, true),
        new("d135-demo-studio-headset", "studio-microphone", "fa", 5, "کاربر نمونهٔ سایمان", "میکروفون و نحوهٔ اتصال",
            "در این دیدگاه آموزشی، کیفیت فرضی تماس و سازگاری با رابط دستگاه بررسی شده است.", true),
        new("d135-demo-latitude-5440", "latitude-keyboard", "en", 2, "Sayman demo reviewer", "Keyboard layout needs checking",
            "A pending English review for testing moderation, rating, and customer contribution history.", false),
    ];

    public static async Task<object> RunAsync(IServiceProvider services, IHostEnvironment environment, CancellationToken ct, bool arvan = false)
    {
        if (!environment.IsDevelopment()) throw new InvalidOperationException("Review examples require Development.");
        var reviews = services.GetRequiredService<ReviewsDbContext>();
        var catalog = services.GetRequiredService<CatalogDbContext>();
        var identity = services.GetRequiredService<IdentityDbContext>();
        var connection = reviews.Database.GetDbConnection();
        var source = arvan ? "sql,1433" : "127.0.0.1,11433";
        if (connection.DataSource != source || connection.Database != "Sayman" ||
            new DbContext[] { catalog, identity }.Any(context => context.Database.GetDbConnection().DataSource != source ||
                context.Database.GetDbConnection().Database != "Sayman" || context.Database.GetDbConnection().State != ConnectionState.Closed))
            throw new InvalidOperationException("Review examples require the canonical local Sayman database.");

        var examples = arvan ? Examples.Concat(ArvanMoreExamples).ToArray() : Examples;
        var slugs = examples.Select(item => item.Slug).Distinct(StringComparer.Ordinal).ToArray();
        var products = await catalog.Products.AsNoTracking().Where(p => slugs.Contains(p.Slug))
            .ToDictionaryAsync(p => p.Slug, p => p.Id, ct);
        if (products.Count != slugs.Length) throw new InvalidOperationException("The expected development catalogue examples are missing.");
        var service = services.GetRequiredService<ReviewService>();
        var entries = new List<object>();
        await using var transaction = await reviews.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        identity.Database.SetDbConnection(connection, contextOwnsConnection: false);
        await identity.Database.UseTransactionAsync(transaction.GetDbTransaction(), ct);
        try
        {
            await using (var gate = connection.CreateCommand())
            {
                gate.Transaction = transaction.GetDbTransaction();
                gate.CommandTimeout = 15;
                gate.CommandText = "DECLARE @result int; EXEC @result=sys.sp_getapplock @Resource=N'sayman:development-review-examples',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @result;";
                if (Convert.ToInt32(await gate.ExecuteScalarAsync(ct), CultureInfo.InvariantCulture) < 0)
                    throw new InvalidOperationException("Review examples are already being prepared.");
            }

            foreach (var example in examples)
            {
                var productId = products[example.Slug];
                var owner = "demo-review:d86:" + example.Key;
                if (await service.OwnAsync(owner, productId, ct) is not null)
                {
                    entries.Add(new { example.Slug, Status = "existing-preserved" });
                    continue;
                }
                var command = Id();
                var input = new SaveReviewInput(null, example.Locale, example.Rating, example.Name, example.Title, example.Body, true,
                    example.Photo ? new ReviewPhotoInput("replace", "demo-phone.png", "image/png", Illustration(example.Key)) : null);
                var row = (await service.SaveAsync(owner, productId, command, input, ct)).Review!;
                if (example.Publish)
                {
                    command = Id();
                    row = (await service.ModerateAsync(Actor, row.Id, command,
                        new(row.Version, row.Content.RevisionId, "Approve", "نمونهٔ آموزشی", null), ct)).Review!;
                }
                identity.Audit.Add(new AuditEvent { ActorId = Actor, Action = "DevelopmentExample", Resource = "reviews/" + row.Id, TraceId = command });
                entries.Add(new { example.Slug, Status = row.State, example.Photo });
            }
            await identity.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        }
        finally { await identity.Database.UseTransactionAsync(null, CancellationToken.None); }
        return new { Items = entries };
    }

    private static string Id() => Guid.NewGuid().ToString("N");

    // A synthetic review attachment, with no camera metadata, brand claims, or personal data.
    private static string Illustration(string key)
    {
        var tint = SHA256.HashData(Encoding.UTF8.GetBytes(key));
        using var bitmap = new SKBitmap(480, 320);
        using var canvas = new SKCanvas(bitmap);
        canvas.Clear(new SKColor((byte)(213 + tint[0] % 38), (byte)(205 + tint[1] % 43), (byte)(198 + tint[2] % 45)));
        using var paint = new SKPaint { IsAntialias = true, Color = new SKColor(191, 198, 166) };
        canvas.DrawCircle(245 + tint[3] % 65, 158, 103 + tint[4] % 28, paint);
        paint.Color = new SKColor(44, 64, 55);
        canvas.DrawRoundRect(new SKRect(174, 44, 306, 276), 19, 19, paint);
        paint.Color = new SKColor(121, 153, 134);
        canvas.DrawRoundRect(new SKRect(182, 52, 298, 265), 14, 14, paint);
        paint.Color = new SKColor(37, 44, 40);
        canvas.DrawCircle(197, 68, 7, paint);
        canvas.DrawCircle(197, 87, 7, paint);
        paint.Color = new SKColor(218, 228, 203);
        canvas.DrawCircle(240, 164, 19, paint);
        using var data = bitmap.Encode(SKEncodedImageFormat.Png, 100);
        return Convert.ToBase64String(data.ToArray());
    }
}
