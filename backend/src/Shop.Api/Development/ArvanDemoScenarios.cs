using System.Data;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Identity;
using Shop.Modules.Notifications;
using Shop.Modules.Sales;
using Shop.Modules.Support;

internal static class ArvanDemoScenarios
{
    private const string Actor = "development-seed:arvan-scenarios";

    public static async Task<object> RunAsync(IServiceProvider root, IHostEnvironment environment, CancellationToken ct)
    {
        await using (var scope = root.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CatalogDbContext>();
            var connection = db.Database.GetDbConnection();
            if (!environment.IsDevelopment() || connection.DataSource != "sql,1433" || connection.Database != "Sayman")
                throw new InvalidOperationException("Online examples require the owned internal SQL service.");
            if ((await db.Database.GetPendingMigrationsAsync(ct)).Any())
                throw new InvalidOperationException("The online catalogue schema must be up to date.");
        }

        await using (var scope = root.CreateAsyncScope())
            await EnableCheckoutAsync(scope.ServiceProvider, ct);
        object catalog, used, reviews, cms;
        await using (var scope = root.CreateAsyncScope())
            catalog = await DevelopmentProductExamples.RunAsync(scope.ServiceProvider, environment, environment.ContentRootPath, ct, arvan: true);
        await using (var scope = root.CreateAsyncScope())
            used = await DevelopmentProductExamples.RunAsync(scope.ServiceProvider, environment, environment.ContentRootPath, ct, usedExamples: true, arvan: true);
        await using (var scope = root.CreateAsyncScope())
            reviews = await DevelopmentReviewExamples.RunAsync(scope.ServiceProvider, environment, ct, arvan: true);
        await using (var scope = root.CreateAsyncScope())
            cms = await DevelopmentCmsExamples.RunAsync(scope.ServiceProvider, environment, ct, arvan: true);
        for (var n = 1; n <= 8; n++)
        {
            await using var scope = root.CreateAsyncScope();
            await AddCustomerStoryAsync(scope.ServiceProvider, n, ct);
        }

        return new { Catalog = catalog, Used = used, Reviews = reviews, Cms = cms, SampleCustomers = 8, SampleTickets = 8 };
    }

    private static async Task EnableCheckoutAsync(IServiceProvider services, CancellationToken ct)
    {
        var db = services.GetRequiredService<SalesDbContext>();
        var identity = services.GetRequiredService<IdentityDbContext>();
        var charges = services.GetRequiredService<CheckoutChargePolicyService>();
        var orders = services.GetRequiredService<CheckoutOrderSettingsService>();
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        identity.Database.SetDbConnection(db.Database.GetDbConnection(), contextOwnsConnection: false);
        await identity.Database.UseTransactionAsync(transaction.GetDbTransaction(), ct);
        var charge = await charges.ReadAsync(ct);
        if (charge.ShippingMode == "unconfigured" || charge.TaxMode == "unconfigured")
        {
            var shippingUnset = charge.ShippingMode == "unconfigured";
            await charges.SaveAsync(new(shippingUnset ? "flat" : charge.ShippingMode,
                shippingUnset ? "ارسال نمونه برای بازبینی" : charge.ShippingNameFa,
                shippingUnset ? "Demo shipping for review" : charge.ShippingNameEn,
                shippingUnset ? "هزینهٔ آزمایشی برای آزمون سفارش" : charge.ShippingDescriptionFa,
                shippingUnset ? "Synthetic shipping fee for order testing" : charge.ShippingDescriptionEn,
                shippingUnset ? "250000" : charge.ShippingFeeRial?.ToString(System.Globalization.CultureInfo.InvariantCulture),
                charge.ShippingFreeFromRial?.ToString(System.Globalization.CultureInfo.InvariantCulture),
                charge.TaxMode == "unconfigured" ? "included_unitemized" : charge.TaxMode,
                charge.TaxRateBasisPoints, charge.TaxBase, charge.TaxRounding, Version(charge.Version)), ct);
            AddAudit(identity, "demo-checkout/charges", "charges");
        }
        var settings = await orders.ReadAsync(ct);
        if (!settings.TemporaryOrdersEnabled)
        {
            var fresh = settings.Version.Length == 0;
            await orders.SaveAsync(new(true, fresh ? 30 : settings.ReservationMinutes,
                fresh ? 3 : settings.MaxOpenOrdersPerCustomer, Version(settings.Version)), ct);
            AddAudit(identity, "demo-checkout/order-settings", "order-settings");
        }
        await identity.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
    }

    private static async Task AddCustomerStoryAsync(IServiceProvider services, int n, CancellationToken ct)
    {
        var users = services.GetRequiredService<UserManager<ShopUser>>();
        var identity = services.GetRequiredService<IdentityDbContext>();
        var tickets = services.GetRequiredService<TicketService>();
        var id = "arvan-demo-" + Id($"customer/{n}");
        var username = $"arvan-demo-customer-{n}";
        await using (var transaction = await identity.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct))
        {
            var user = await users.FindByIdAsync(id);
            if (user is null)
            {
                var result = await users.CreateAsync(new ShopUser { Id = id, UserName = username, DisplayName = $"نمونهٔ سایمان · مشتری {n}" });
                if (!result.Succeeded) throw new InvalidOperationException("A demo customer could not be created.");
                AddAudit(identity, "demo-customers/" + id, $"customer/{n}");
                await identity.SaveChangesAsync(ct);
            }
            else if (user.UserName != username || user.PasswordHash is not null || user.PhoneNumber is not null || user.Email is not null)
                throw new InvalidOperationException("The sample customer identifier is already in use.");
            await transaction.CommitAsync(ct);
        }
        var (subject, message) = (n % 4) switch
        {
            0 => ("[phone] درخواست نمونهٔ Pixel 9", "مدل — Pixel 9\nرنگ — مشکی\nحافظه — ۱۲۸ گیگابایت\nسقف بودجه (تومان) — ۴۵۰۰۰۰۰۰"),
            1 => ("[product-question] پرسش نمونه دربارهٔ Galaxy A10", "d70-sample-galaxy-a10\n\nاین گوشی برای تماس و پیام‌رسانی سبک مناسب است؟"),
            2 => ("نمونهٔ پشتیبانی · پیگیری بسته", "این گفت‌وگوی نمونه برای بررسی گردش پیگیری بسته در پنل است."),
            _ => ("نمونهٔ پشتیبانی · تغییر نشانی", "می‌خواهم پیش از ارسال، گردش تغییر نشانی سفارش را بررسی کنم.")
        };
        var command = $"ticket/{n}";
        var created = await tickets.CreateAsync(id, Id(command), new(subject, message, "fa"), ct);
        if (n % 3 == 1) return;
        var participants = new DbContext[] { services.GetRequiredService<SupportDbContext>(), services.GetRequiredService<NotificationsDbContext>() };
        await using var staffTransaction = await identity.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        foreach (var db in participants)
        {
            db.Database.SetDbConnection(identity.Database.GetDbConnection(), contextOwnsConnection: false);
            await db.Database.UseTransactionAsync(staffTransaction.GetDbTransaction(), ct);
        }
        var reply = await tickets.ReplyAsync(Actor, true, created.Ticket.Id, Id(command + "/reply"),
            new(created.Ticket.Version, "پاسخ نمونهٔ سایمان برای بازبینی صندوق پیام و اعلان مشتری ثبت شد.", "fa"), ct);
        if (!reply.Replayed) AddAudit(identity, "demo-support/" + created.Ticket.Id, command + "/reply");
        if (n % 3 == 0)
        {
            var closed = await tickets.StateAsync(Actor, true, created.Ticket.Id, Id(command + "/close"), new(reply.Ticket.Version, "Closed"), ct);
            if (!closed.Replayed) AddAudit(identity, "demo-support/" + created.Ticket.Id, command + "/close");
        }
        await identity.SaveChangesAsync(ct);
        await staffTransaction.CommitAsync(ct);
    }

    private static void AddAudit(IdentityDbContext db, string resource, string key) =>
        db.Audit.Add(new() { ActorId = Actor, Action = "DevelopmentExample", Resource = resource, TraceId = Id(key) });

    private static string? Version(byte[] bytes) => bytes.Length == 0 ? null : Convert.ToBase64String(bytes);
    private static string Id(string name) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("sayman:d134:" + name)))[..32].ToLowerInvariant();
}
