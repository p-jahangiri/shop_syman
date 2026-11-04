using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Identity;
using Shop.Modules.Support;
using Shop.SharedKernel;

// Authored, explicitly labelled Development stories. No host/listener, credentials,
// verified contacts, staff grants, commercial policy or financial-state substitutes.
var recipes = new[] {
    new Recipe("one", "نمونه توسعه · مشتری با گفت‌وگوی باز", true, false),
    new Recipe("two", "نمونه توسعه · مشتری با تیکت بسته", true, true),
    new Recipe("three", "نمونه توسعه · مشتری بدون سابقه", false, false)
};
if (args.Length == 1 && args[0] == "--plan") {
    Console.WriteLine(JsonSerializer.Serialize(new { SyntheticDevelopmentData = true, Accounts = 3, Tickets = 2,
        PasswordsCreated = false, ContactsVerified = false, StaffCreated = false, OrdersCreated = false,
        FinancialPolicyChanged = false, RequiresSchema85 = true, Recipes = recipes }));
    return;
}
if (args.Length != 2 || args[0] is not ("--apply-main-development" or "--self-test"))
    throw new InvalidOperationException("Use --plan, --self-test <repository-root>, or explicit --apply-main-development <repository-root>.");
var root = Path.GetFullPath(args[1]);
if (!File.Exists(Path.Combine(root, "backend/Shop.sln")) || Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT") != "Development")
    throw new InvalidOperationException("Only an explicit local Development checkout is supported.");
var selfTest = args[0] == "--self-test";
var connection = Environment.GetEnvironmentVariable("ConnectionStrings__Shop") ?? throw new InvalidOperationException("Local connection is required.");
var target = new SqlConnectionStringBuilder(connection);
if (target.DataSource != "127.0.0.1,11433" || (selfTest
    ? !target.InitialCatalog.StartsWith("SaymanTest_", StringComparison.Ordinal) || !Guid.TryParseExact(target.InitialCatalog[11..], "N", out _)
    : target.InitialCatalog != "Sayman")) throw new InvalidOperationException("Only the exact owned local database is supported.");
if (selfTest) {
    var master = new SqlConnectionStringBuilder(connection) { InitialCatalog = "master" };
    await using var inspection = new SqlConnection(master.ConnectionString); await inspection.OpenAsync();
    await using var exists = inspection.CreateCommand(); exists.CommandText = "SELECT DB_ID(@name)";
    exists.Parameters.AddWithValue("@name", target.InitialCatalog);
    if (await exists.ExecuteScalarAsync() is not DBNull) throw new InvalidOperationException("The disposable self-test database must not exist.");
}
var temporary = selfTest ? Path.Combine(Path.GetTempPath(), target.InitialCatalog) : null;
if (temporary is not null && (Directory.Exists(temporary) || File.Exists(temporary))) throw new InvalidOperationException("Self-test directory must be fresh.");
var keys = selfTest ? Path.Combine(temporary!, "keys") : Path.Combine(root, "tmp/identity-keys");
if (selfTest) {
    Directory.CreateDirectory(temporary!);
    if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(temporary!, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
} else if (!Directory.Exists(keys) || !Directory.EnumerateFiles(keys, "*.xml").Any()) throw new InvalidOperationException("Existing main keys are required.");
var builder = Host.CreateApplicationBuilder(new HostApplicationBuilderSettings { EnvironmentName = "Development", ContentRootPath = root });
builder.Logging.ClearProviders();
void Configure(DbContextOptionsBuilder options, string schema) => options.UseSqlServer(connection, sql => sql.MigrationsAssembly("Shop.Api").MigrationsHistoryTable("__EFMigrationsHistory", schema));
builder.Services.AddDbContext<IdentityDbContext>(options => Configure(options, "identity"));
builder.Services.AddDbContext<SupportDbContext>(options => Configure(options, "support"));
builder.Services.AddIdentityCore<ShopUser>(options => options.User.RequireUniqueEmail = false).AddRoles<IdentityRole>().AddEntityFrameworkStores<IdentityDbContext>().AddUserValidator<OptionalIdentityEmailValidator>();
builder.Services.AddDataProtection().SetApplicationName("Sayman.Identity").PersistKeysToFileSystem(new DirectoryInfo(keys));
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton(new TicketOptions());
builder.Services.AddScoped<ITicketProtection, DataProtectionTicketProtection>();
builder.Services.AddScoped<ICustomerSupportOverview, CustomerSupportOverviewReader>();
builder.Services.AddScoped<TicketService>();
builder.Services.AddSingleton<IPrivateNotificationWriter, UnavailableSeedNotifications>();
builder.Services.AddSingleton<IPrivateRealtimeEvents, OfflineSeedInvalidations>();
using var host = builder.Build(); // Never Start/Run a second application.
var deleted = false;
try {
    if (selfTest) {
        await using var scope = host.Services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<IdentityDbContext>().Database.MigrateAsync();
        await scope.ServiceProvider.GetRequiredService<SupportDbContext>().Database.MigrateAsync();
    } else {
        await using var scope = host.Services.CreateAsyncScope();
        var identity = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
        if (identity.Database.HasPendingModelChanges() || (await identity.Database.GetPendingMigrationsAsync()).Any()
            || (await scope.ServiceProvider.GetRequiredService<SupportDbContext>().Database.GetPendingMigrationsAsync()).Any())
            throw new InvalidOperationException("Schema must already be accepted; this command never migrates main.");
    }
    async Task<object> Run() {
        await using var scope = host.Services.CreateAsyncScope(); var services = scope.ServiceProvider;
        var users = services.GetRequiredService<UserManager<ShopUser>>(); var identity = services.GetRequiredService<IdentityDbContext>();
        var tickets = services.GetRequiredService<TicketService>(); var overview = services.GetRequiredService<ICustomerSupportOverview>();
        var rows = new List<object>();
        foreach (var recipe in recipes) {
            var id = "dev-d47-" + Stable("customer/" + recipe.Key); var userName = "demo-d47-customer-" + recipe.Key;
            var email = recipe.Key + "@demo.sayman.invalid";
            ShopUser user; bool created;
            await using (var transaction = await identity.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable)) {
            var found = await users.FindByIdAsync(id); created = found is null;
            user = found!;
            if (user is null) {
                user = new ShopUser { Id = id, UserName = userName, DisplayName = recipe.Name, Email = email,
                    EmailConfirmed = false, PhoneNumberConfirmed = false, PhoneNumber = null };
                var result = await users.CreateAsync(user); if (!result.Succeeded) throw new InvalidOperationException("A labelled development identity could not be created.");
                identity.Audit.Add(new() { ActorId = "development-scenarios", Action = "DEVELOPMENT_CUSTOMER_CREATED", Resource = "/development/d47/customers/" + id, TraceId = "d47-business-scenarios-v1" });
                await identity.SaveChangesAsync();
            }
            if (user.UserName != userName || user.Email != email || !user.DisplayName.StartsWith("نمونه توسعه", StringComparison.Ordinal)
                || user.EmailConfirmed || user.PhoneNumberConfirmed || user.PasswordHash is not null || (await users.GetRolesAsync(user)).Count != 0)
                throw new InvalidOperationException("A scenario identity was modified; existing account data was preserved.");
            await transaction.CommitAsync();
            }
            string? ticketId = null;
            if (recipe.HasTicket) {
                var opening = await tickets.CreateAsync(id, Stable("ticket/create/" + recipe.Key),
                    new("نمونه توسعه · " + (recipe.Closed ? "گفت‌وگوی بسته‌شده" : "پیگیری کالای انتخابی"),
                        "این گفت‌وگو تألیفی و مخصوص بررسی پنل است؛ مشتری، خرید یا پیام خارجی واقعی را نشان نمی‌دهد.", "fa"), default);
                ticketId = opening.Ticket.Id;
                if (recipe.Closed) await tickets.StateAsync(id, false, ticketId, Stable("ticket/close/" + recipe.Key), new(opening.Ticket.Version, "Closed"), default);
                else await tickets.ReplyAsync(id, false, ticketId, Stable("ticket/reply/" + recipe.Key), new(opening.Ticket.Version, "پیام دومِ نمونه برای بررسی تاریخچهٔ گفت‌وگو و شمارندهٔ واقعی پیام‌ها.", "fa"), default);
            }
            var counts = (await overview.ReadAsync([id], default)).Single();
            rows.Add(new { Id = id, UserName = userName, Created = created, CanSignIn = false, TicketId = ticketId, Overview = counts });
        }
        return new { SyntheticDevelopmentData = true, Accounts = rows, ContactVerificationPerformed = false,
            PasswordsCreated = false, StaffCreated = false, OrderOrPaymentCreated = false, LiveBroadcastPerformed = false,
            Pending = new[] { "Staff scenarios use the real administrator UI after deployment.", "Orders require the owner's shipping/tax/order policies; no policy is silently activated." } };
    }
    var first = await Run();
    if (selfTest) {
        var repeated = await Run();
        await using var scope = host.Services.CreateAsyncScope(); var services = scope.ServiceProvider;
        var identity = services.GetRequiredService<IdentityDbContext>(); var support = services.GetRequiredService<SupportDbContext>();
        if (await identity.Users.CountAsync() != 3 || await support.Tickets.CountAsync() != 2 || await support.Messages.CountAsync() != 3 || await support.Commands.CountAsync() != 4)
            throw new InvalidOperationException("Scenario replay created unexpected rows.");
        if (await identity.Users.AnyAsync(user => user.EmailConfirmed || user.PhoneNumberConfirmed || user.PasswordHash != null)
            || await identity.UserRoles.AnyAsync()) throw new InvalidOperationException("A scenario created authentication or privilege claims.");
        var values = await services.GetRequiredService<ICustomerSupportOverview>().ReadAsync(recipes.Select(recipe => "dev-d47-" + Stable("customer/" + recipe.Key)).ToArray(), default);
        if (values.Sum(row => long.Parse(row.TotalTickets)) != 2 || values.Sum(row => long.Parse(row.OpenTickets)) != 1)
            throw new InvalidOperationException("Actual customer support summaries differ.");
        Console.WriteLine(JsonSerializer.Serialize(new { SelfTestPassed = true, ReplayPassed = true, ActualSql = true, First = first, Repeated = repeated }));
    } else Console.WriteLine(JsonSerializer.Serialize(first));
} finally {
    if (selfTest) {
        await using var scope = host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<IdentityDbContext>();
        if (db.Database.GetDbConnection().Database != target.InitialCatalog) throw new InvalidOperationException("Fixture database ownership changed.");
        await db.Database.EnsureDeletedAsync(); deleted = true;
    }
    if (deleted && temporary is not null && Directory.Exists(temporary)) {
        if (new DirectoryInfo(temporary).LinkTarget is not null) throw new InvalidOperationException("Fixture key directory ownership changed.");
        SqlConnection.ClearAllPools(); Directory.Delete(temporary, recursive: true);
    }
}
static string Stable(string value) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes("sayman:d47:business-scenarios:v1:" + value)))[..32];
sealed record Recipe(string Key, string Name, bool HasTicket, bool Closed);
sealed class UnavailableSeedNotifications : IPrivateNotificationWriter
{
    public Task RecordSupportAsync(SupportNotificationEvent value, CancellationToken ct) => throw new InvalidOperationException("This offline Development authoring tool cannot send notifications.");
}
sealed class OfflineSeedInvalidations : IPrivateRealtimeEvents
{
    public void SupportChanged(string owner) { }
    public void InboxChanged(string owner) { }
}
