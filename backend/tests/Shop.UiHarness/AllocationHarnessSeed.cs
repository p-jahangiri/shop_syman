using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.DataProtection.KeyManagement;
using Microsoft.AspNetCore.DataProtection.Repositories;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Identity;
using Shop.Modules.Inventory;
using Shop.Modules.Market;
using Shop.Modules.Sales;

namespace Shop.UiHarness;

// Opt-in disposable prerequisites, not browser acceptance evidence. Consent and
// three real synthetic physical units are created through authenticated HTTP;
// allocation/release must subsequently be performed in the browser itself.
internal static class AllocationHarnessSeed
{
    internal sealed class QaIdentity(string id, string username, string password)
    {
        internal string Id { get; } = id;
        internal string Username { get; } = username;
        internal string Password { get; } = password;
        public override string ToString() => "Generated allocation QA identity";
    }
    internal sealed record QaUnit(string Id, string Serial);
    internal sealed record Result(string Database, bool IsDemo, string SetupKind, string QaPrefix, string ListingId, string ModelId, string VariantId, string Sku, string RequestId, string OfferId, string OfferLineId, string AcceptanceId, string TaskId, int RequestedQuantity, int PhysicalQuantity, QaUnit[] Units, DateTimeOffset PurchaseUntil);
    private sealed record StockState(string VariantId, int OnHand, int Reserved, int SourcingReserved, string TrackingMode);
    private static string Id() => Guid.NewGuid().ToString("N");
    private static string Text(JsonNode node, string name) => node[name]?.GetValue<string>() ?? throw new InvalidOperationException("Allocation QA received an incomplete HTTP prerequisite response.");

    internal static async Task<Result> RunAsync(Func<HttpClient> createClient, IServiceProvider services, IWebHostEnvironment environment, string expectedDatabase, string runDirectory, QaIdentity customer, QaIdentity staff, QaIdentity warehouse, CancellationToken ct)
    {
        if (OperatingSystem.IsWindows() || !environment.IsDevelopment() || Environment.GetEnvironmentVariable("SHOP_UI_RESUME_RUN") is not null || !Regex.IsMatch(expectedDatabase, "^SaymanTest_Ui_[a-f0-9]{32}$") || new[] { "SHOP_UI_ALLOCATION_QA", "SHOP_UI_OPERATIONS_QA", "SHOP_UI_SUPPLY_QA", "SHOP_UI_OFFERS_QA", "SHOP_UI_SOURCING_QA" }.Any(flag => Environment.GetEnvironmentVariable(flag) != "1"))
            throw new InvalidOperationException("Allocation UI prerequisites require a fresh explicitly enabled Development sourcing/offers/supply/operations/allocation GUID QA run.");
        var directory = new DirectoryInfo(runDirectory);
        var keyRepository = services.GetRequiredService<IOptions<KeyManagementOptions>>().Value.XmlRepository as FileSystemXmlRepository;
        if (!directory.Exists || directory.Name != expectedDatabase || directory.Parent?.Name != "ui-cart" || directory.LinkTarget is not null || (File.GetUnixFileMode(runDirectory) & (UnixFileMode)63) != 0 || keyRepository?.Directory.FullName != Path.GetFullPath(Path.Combine(runDirectory, "keys")))
            throw new InvalidOperationException("Allocation UI prerequisites require this fresh run's private directory and key ring.");
        var catalog = services.GetRequiredService<CatalogDbContext>();
        var inventory = services.GetRequiredService<InventoryDbContext>();
        var market = services.GetRequiredService<MarketDbContext>();
        var sales = services.GetRequiredService<SalesDbContext>();
        var identity = services.GetRequiredService<IdentityDbContext>();
        foreach (var context in new DbContext[] { catalog, inventory, market, sales, identity })
            if (context.Database.GetDbConnection().Database != expectedDatabase || context.Database.GetDbConnection().DataSource != "127.0.0.1,11433") throw new InvalidOperationException("Allocation UI prerequisites cannot cross the isolated QA database boundary.");
        await AssertNoPurchaseOrAllocationAsync(inventory, sales, ct);
        if (await market.SourcingRequests.AnyAsync(ct) || await market.SourcingOffers.AnyAsync(ct) || await market.SourcingOfferAcceptances.AnyAsync(ct) || await market.SourcingSupplyTasks.AnyAsync(ct))
            throw new InvalidOperationException("Allocation UI prerequisites cannot append to an existing sourcing scenario.");
        var listing = await market.Listings.AsNoTracking().SingleAsync(l => l.SourceKey == "development-sample" && l.SourceItemKey == "phone-a", ct);
        var product = await catalog.Products.AsNoTracking().Include(p => p.Variants).SingleAsync(p => p.Id == listing.ModelId, ct);
        if (!listing.IsDemo || listing.Status != "Published" || product.Status != "Published" || product.IsDigital || product.Slug != "sample-market-phone-a" || product.Variants.Count != 1)
            throw new InvalidOperationException("Allocation UI prerequisites require the original explicit offer QA sample SKU.");
        var variant = product.Variants.Single();
        if (!variant.IsActive || !Regex.IsMatch(variant.Sku, "^QA-OFFER-[A-F0-9]{32}$") || variant.PriceRial != 9007199254740993L || await inventory.SerialUnits.AnyAsync(u => u.VariantId == variant.Id, ct))
            throw new InvalidOperationException("Allocation UI prerequisites require the untouched actual synthetic QA variant.");
        var beforeStock = await StockAsync(inventory, ct);
        if (beforeStock.Any(s => s.VariantId == variant.Id && (s.OnHand != 0 || s.Reserved != 0 || s.SourcingReserved != 0 || s.TrackingMode != "none")))
            throw new InvalidOperationException("Consent must precede any positive QA sample stock.");

        using var customerClient = await SignInAsync(createClient, services, customer, "cartui", null, ct);
        using var staffClient = await SignInAsync(createClient, services, staff, "financeui", "Administrator", ct);
        using var inventoryClient = await SignInAsync(createClient, services, warehouse, "inventoryui", "InventoryManager", ct);
        var cart = await ReadAsync(await customerClient.GetAsync("/api/cart/fa/sourcing", ct), "read cart", ct);
        cart = await ReadAsync(await customerClient.PutAsJsonAsync("/api/cart/fa/sourcing", new CartSourcingInput([new(listing.Id, 2)], cart["version"]?.GetValue<string>()), ct), "save sourcing cart", ct);
        var candidate = cart["lines"]?.AsArray().SingleOrDefault()?["candidate"] ?? throw new InvalidOperationException("The synthetic listing is not eligible for its sourcing cart.");
        if (Text(candidate["model"]!, "id") != product.Id) throw new InvalidOperationException("The allocation QA cart model changed.");
        var submitted = await ReadAsync(await customerClient.PostAsJsonAsync("/api/cart/fa/sourcing/submit", new SourcingSubmitInput(Id(), Text(cart, "version"), [new(listing.Id, Text(candidate, "fingerprint"))]), ct), "submit sourcing request", ct, HttpStatusCode.Created);
        var request = Text(submitted, "id");
        var parent = await ReadAsync(await staffClient.GetAsync($"/api/admin/sourcing/requests/{request}", ct), "read staff request", ct);
        var sku = await ReadAsync(await staffClient.GetAsync($"/api/admin/sourcing/requests/{request}/offer-skus/{variant.Id}?listingId={listing.Id}", ct), "read offer SKU", ct);
        var offer = Id(); var line = Id(); var task = Id(); var now = DateTimeOffset.UtcNow;
        var offerPath = $"/api/admin/sourcing/requests/{request}/offers/{offer}";
        var termsFa = "پیش‌نیاز مصنوعی QA از HTTP واقعی؛ رضایت صرفاً برای پیگیری تأمین است. هیچ پرداخت یا سفارش خریدی ساخته نشده و این عمل شاهد رضایت از مرورگر نیست.";
        var termsEn = "Synthetic prerequisite created through actual QA HTTP: consent to supply follow-up only, with no payment or purchase order. This setup is not browser-consent acceptance evidence.";
        await ReadAsync(await staffClient.PutAsJsonAsync(offerPath, new SourcingOfferSaveInput(Id(), Text(parent["summary"]!, "version"), null, [new(line, listing.Id, variant.Id, 2, "9007199254740993", Text(sku, "materialFingerprint"), Text(sku, "currentFingerprint"))], termsFa, termsEn, now.AddHours(4), now.AddHours(8)), ct), "save synthetic offer", ct);
        var draft = await ReadAsync(await staffClient.GetAsync(offerPath, ct), "read offer draft", ct);
        await ReadAsync(await staffClient.PostAsJsonAsync(offerPath + "/publish", new SourcingOfferPublishInput(Id(), Text(draft, "requestVersion"), Text(draft["offer"]!["summary"]!, "version"), Text(draft["offer"]!["summary"]!, "termsHash")), ct), "publish synthetic offer", ct);
        var customerOfferPath = $"/api/sourcing/requests/{request}/offers/{offer}";
        var published = await ReadAsync(await customerClient.GetAsync(customerOfferPath, ct), "read customer offer", ct);
        await ReadAsync(await customerClient.PostAsJsonAsync(customerOfferPath + "/accept", new SourcingOfferActionInput(Id(), Text(published, "requestVersion"), Text(published["offer"]!["summary"]!, "version"), Text(published["offer"]!["summary"]!, "termsHash")), ct), "synthetic customer HTTP consent", ct);
        var accepted = await ReadAsync(await customerClient.GetAsync(customerOfferPath, ct), "read accepted offer", ct);
        var summary = accepted["offer"]!["summary"]!;
        var acceptance = Text(accepted["offer"]!, "acceptanceId");
        if (Text(summary, "state") != "Accepted") throw new InvalidOperationException("Allocation QA consent was not accepted by the actual API.");
        await ReadAsync(await staffClient.PutAsJsonAsync(offerPath + "/supply/" + task, new SourcingSupplyStartInput(Id(), Text(accepted, "requestVersion"), Text(summary, "version"), Text(summary, "termsHash")), ct), "start synthetic supply task", ct);

        // Physical custody is a separate actual serial-receipt command, after
        // consent and task creation. It does not claim procurement or receiving
        // against this task and creates no sourcing reservation or agreement.
        var serialPath = $"/api/admin/inventory/variants/{variant.Id}";
        var serialPage = await ReadAsync(await inventoryClient.GetAsync(serialPath + "/serials/v2", ct), "read empty serial stock", ct);
        await ReadAsync(await inventoryClient.PutAsJsonAsync(serialPath + "/serial-mode", new SerialModeInput("serial", serialPage["stock"]!["version"]?.GetValue<string>(), Id()), ct), "enable serial tracking", ct);
        serialPage = await ReadAsync(await inventoryClient.GetAsync(serialPath + "/serials/v2", ct), "read tracked stock", ct);
        var prefix = "QA-ALLOCATION-" + Id().ToUpperInvariant();
        var serials = Enumerable.Range(1, 3).Select(index => prefix + "-" + index).ToArray();
        await ReadAsync(await inventoryClient.PostAsJsonAsync(serialPath + "/serials", new SerialReceiptInput(serials.Select(serial => new SerialUnitInput(serial)).ToArray(), "Synthetic QA prerequisite: three actual serialized devices; no allocation or sourcing receipt", serialPage["stock"]!["version"]?.GetValue<string>(), Id()), ct), "receive three real synthetic units", ct);
        serialPage = await ReadAsync(await inventoryClient.GetAsync(serialPath + "/serials/v2?state=available", ct), "read fresh serialized units", ct);
        var stock = serialPage["stock"]!;
        var units = serialPage["items"]!.AsArray().Select(row => {
            if (row!["hasActiveClaim"]!.GetValue<bool>() || Text(row["unit"]!, "state") != "available" || Text(row["unit"]!, "variantId") != variant.Id) throw new InvalidOperationException("Allocation QA serial units must remain free and physically available.");
            return new QaUnit(Text(row["unit"]!, "id"), Text(row["unit"]!, "serial"));
        }).OrderBy(unit => unit.Serial, StringComparer.Ordinal).ToArray();
        if (serialPage["schemaVersion"]!.GetValue<int>() != 2 || stock["onHand"]!.GetValue<int>() != 3 || stock["reserved"]!.GetValue<int>() != 0 || stock["sourcingReserved"]!.GetValue<int>() != 0 || stock["available"]!.GetValue<int>() != 3 || Text(stock, "mode") != "serial" || units.Length != 3 || !units.Select(unit => unit.Serial).SequenceEqual(serials, StringComparer.Ordinal) || serialPage["nextCursor"] is not null)
            throw new InvalidOperationException("Allocation QA did not produce exactly three actual unclaimed serialized units.");
        var allocation = await ReadAsync(await inventoryClient.GetAsync($"/api/admin/inventory/sourcing-tasks/{task}/allocation", ct), "read allocation prerequisite", ct);
        if (Text(allocation, "requestId") != request || Text(allocation, "acceptanceId") != acceptance || !allocation["canAttemptAllocation"]!.GetValue<bool>() || allocation["allocation"] is not null || allocation["canCheckout"]!.GetValue<bool>() || allocation["canPay"]!.GetValue<bool>() || allocation["lines"]!.AsArray().Count != 1 || allocation["lines"]![0]!["quantity"]!.GetValue<int>() != 2)
            throw new InvalidOperationException("The allocation browser prerequisite is not the untouched accepted two-device task.");

        await AssertNoPurchaseOrAllocationAsync(inventory, sales, ct);
        var afterStock = await StockAsync(inventory, ct);
        if (!beforeStock.Where(s => s.VariantId != variant.Id).SequenceEqual(afterStock.Where(s => s.VariantId != variant.Id)) || await market.SourcingRequests.CountAsync(ct) != 1 || await market.SourcingOffers.CountAsync(ct) != 1 || await market.SourcingOfferAcceptances.CountAsync(ct) != 1 || await market.SourcingSupplyTasks.CountAsync(ct) != 1 || !await market.SourcingOfferAcceptances.AnyAsync(a => a.Id == acceptance && a.OfferId == offer && a.OwnerId == customer.Id, ct) || !await market.SourcingSupplyTasks.AnyAsync(t => t.Id == task && t.RequestId == request && t.AcceptanceId == acceptance && t.OwnerId == customer.Id && t.ContainsDemo && t.IsOpen && t.State == "PendingSupply", ct))
            throw new InvalidOperationException("Allocation QA prerequisites changed unrelated Stock or sourcing state.");
        var result = new Result(expectedDatabase, true, "actualHTTP prerequisite setup only; not browser consent, allocation, release or checkout proof", prefix, listing.Id, product.Id, variant.Id, variant.Sku, request, offer, line, acceptance, task, 2, 3, units, summary["purchaseUntil"]!.GetValue<DateTimeOffset>());
        var output = Path.Combine(runDirectory, "allocation.json");
        await using (var stream = new FileStream(output, new FileStreamOptions { Mode = FileMode.CreateNew, Access = FileAccess.Write, Share = FileShare.None, UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite }))
            await JsonSerializer.SerializeAsync(stream, result, cancellationToken: ct);
        return result;
    }

    private static Task<StockState[]> StockAsync(InventoryDbContext inventory, CancellationToken ct) => inventory.Stock.AsNoTracking().OrderBy(s => s.VariantId).Select(s => new StockState(s.VariantId, s.OnHand, s.Reserved, s.SourcingReserved, s.TrackingMode)).ToArrayAsync(ct);
    private static async Task AssertNoPurchaseOrAllocationAsync(InventoryDbContext inventory, SalesDbContext sales, CancellationToken ct)
    {
        if (await sales.Orders.AnyAsync(ct) || await sales.Quotes.AnyAsync(ct) || await sales.OrderSettings.AnyAsync(ct) || await sales.ChargePolicies.AnyAsync(ct) || await sales.SourcingPriceAgreements.AnyAsync(ct) || await sales.SourcingPriceAgreementLines.AnyAsync(ct) || await inventory.Reservations.AnyAsync(ct) || await inventory.SourcingAllocations.AnyAsync(ct) || await inventory.SourcingAllocationLines.AnyAsync(ct) || await inventory.SourcingAllocationCommands.AnyAsync(ct) || await inventory.SourcingAllocationEvents.AnyAsync(ct) || await inventory.SerialUnitClaims.AnyAsync(ct) || await inventory.SourcingReceipts.AnyAsync(ct) || await inventory.ReceivingUnitMappings.AnyAsync(ct))
            throw new InvalidOperationException("Allocation QA prerequisites must leave purchase policies, orders, quotes, reservations, agreements, allocations, claims and sourcing receiving empty.");
    }
    internal static async Task<HttpClient> SignInAsync(Func<HttpClient> createClient, IServiceProvider services, QaIdentity identity, string prefix, string? role, CancellationToken ct)
    {
        if (!Regex.IsMatch(identity.Username, "^" + prefix + "[a-f0-9]{32}$") || identity.Password.Length < 32) throw new InvalidOperationException("Only this run's generated QA identities may prepare allocation.");
        var users = services.GetRequiredService<UserManager<ShopUser>>();
        var user = await users.FindByNameAsync(identity.Username);
        if (user is null || user.Id != identity.Id || !user.IsActive || !user.EmailConfirmed || !await users.CheckPasswordAsync(user, identity.Password) || user.RequireMfa != (role is not null) || user.TwoFactorEnabled != (role is not null) || user.LastMfaCounter is not null || !(await users.GetRolesAsync(user)).Order(StringComparer.Ordinal).SequenceEqual(role is null ? Array.Empty<string>() : [role], StringComparer.Ordinal))
            throw new InvalidOperationException("The fresh generated allocation QA identity or its exact role could not be verified.");
        var client = createClient();
        try {
            if (client.BaseAddress is not { IsLoopback: true, Port: 5181 }) throw new InvalidOperationException("Allocation prerequisites use only this harness's loopback API listener.");
            client.DefaultRequestHeaders.Add("Origin", role is null ? "http://sayman-ui.localhost:3105" : "http://sayman-admin-ui.localhost:3175");
            if (role is not null) { client.DefaultRequestHeaders.Add("X-Sayman-Client", "admin"); client.DefaultRequestHeaders.Add("X-Sayman-Admin", "1"); }
            var session = await ReadAsync(await client.PostAsJsonAsync("/api/auth/password", new PasswordLogin(identity.Username, identity.Password), ct), "generated QA password login", ct);
            if (session["requiresMfa"]!.GetValue<bool>() != (role is not null) || session["requiresEnrollment"]!.GetValue<bool>()) throw new InvalidOperationException("Generated QA authentication did not return its expected MFA state.");
            client.DefaultRequestHeaders.Authorization = new("Bearer", Text(session, "accessToken"));
            if (role is not null) {
                var secret = await users.GetAuthenticatorKeyAsync(user) ?? throw new InvalidOperationException("This fresh generated QA authenticator is missing.");
                // Consume a previous accepted time window in this unused QA
                // identity; leave the current code available for browser login.
                var step = DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 30;
                var currentCode = Totp.Code(secret, step);
                var code = Totp.Code(secret, step - 1);
                if (code == currentCode) code = Totp.Code(secret, step - 2);
                if (code == currentCode) throw new InvalidOperationException("The generated QA authenticator needs a later window before prerequisite setup.");
                session = await ReadAsync(await client.PostAsJsonAsync("/api/auth/mfa/verify", new MfaVerification(code), ct), "generated QA MFA login", ct);
                if (session["requiresMfa"]!.GetValue<bool>() || session["requiresEnrollment"]!.GetValue<bool>()) throw new InvalidOperationException("The generated QA session is still pending MFA.");
                client.DefaultRequestHeaders.Authorization = new("Bearer", Text(session, "accessToken"));
            }
            return client;
        } catch { client.Dispose(); throw; }
    }
    private static async Task<JsonNode> ReadAsync(HttpResponseMessage response, string phase, CancellationToken ct, HttpStatusCode expected = HttpStatusCode.OK)
    {
        using (response) {
            // Authentication responses contain tokens. Never include response
            // bodies, headers, credentials or authenticator material in logs.
            if (response.StatusCode != expected) throw new InvalidOperationException($"Allocation QA prerequisite '{phase}' failed with HTTP {(int)response.StatusCode}.");
            return await response.Content.ReadFromJsonAsync<JsonNode>(ct) ?? throw new InvalidOperationException("Allocation QA received an empty prerequisite response.");
        }
    }
}
