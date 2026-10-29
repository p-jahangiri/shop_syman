using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Cms;
using Shop.Modules.Credit;
using Shop.Modules.Identity;
using Shop.Modules.Inventory;
using Shop.Modules.Market;
using Shop.Modules.Payments;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Shop.SqlTests;

namespace Shop.UiHarness;

// A fresh process/TestServer over only a restored disposable copy. No Kestrel,
// seed, migration, enrollment, business command, owner credential or publication.
internal static class Cart34RestoreVerifier
{
    private sealed record Credentials(string Username, string Password);
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);
    internal static async Task RunAsync()
    {
        if (OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
        var root = Path.GetFullPath(Required("SHOP_UI_ROOT"));
        var connection = new SqlConnectionStringBuilder(Required("SHOP_RESTORE_SQL_CONNECTION"));
        Check(connection.DataSource == "127.0.0.1,11433" && Regex.IsMatch(connection.InitialCatalog, "^SaymanTest_Restore_[a-f0-9]{32}$"), "restore_loopback_guid_guard");
        var directory = Path.Combine(root, "tmp", "restore", connection.InitialCatalog);
        Check(Path.GetFullPath(Required("SHOP_RESTORE_DIRECTORY")) == directory, "restore_directory_guard");
        CheckPrivate(directory);
        var keys = Path.Combine(directory, "keys");
        Check(Directory.GetFiles(keys, "*.xml").Length > 0, "copied_key_ring_required");
        var customer = await CredentialsFrom(directory, "customer.json", "cartui");
        var warehouse = await CredentialsFrom(directory, "inventory.json", "inventoryui");
        var expected = JsonNode.Parse(await File.ReadAllTextAsync(Path.Combine(directory, "expected-cart34.json")))!;
        var metadata = expected["metadata"]!;
        Check(Regex.IsMatch(Text(expected, "sourceDatabase"), "^SaymanTest_Ui_[a-f0-9]{32}$") && Text(metadata, "Database") == Text(expected, "sourceDatabase") && Flag(metadata, "QaOnly") && !Flag(metadata, "MainPromoted"), "restored_fresh_cart2_metadata_guard");
        var customerId = Text(metadata, "CustomerId"); var warehouseId = Text(metadata, "WarehouseId");
        var requestId = Text(metadata, "RequestId"); var taskId = Text(metadata, "TaskId"); var offerId = Text(metadata, "OfferId");
        var agreementId = Text(metadata, "AgreementId"); var cartId = Text(metadata, "CartId"); var variantId = Text(metadata, "VariantId");
        foreach (var id in new[] { requestId, taskId, offerId, agreementId, cartId, variantId }) Check(Regex.IsMatch(id, "^[a-f0-9]{32}$"), "canonical_resource_bindings");
        var facts = expected["facts"]!;
        var checks = new List<string>();
        Environment.SetEnvironmentVariable("DataProtection__KeyDirectory", keys);
        Environment.SetEnvironmentVariable("Cors__Origins__0", "http://127.0.0.1:3000");
        Environment.SetEnvironmentVariable("Cors__Origins__1", "http://127.0.0.1:5173");
        Environment.SetEnvironmentVariable("Cors__AdminOrigins__0", "http://127.0.0.1:5173");
        await using var factory = new SqlFactory(connection.ConnectionString, customer.Password, keys)
            .WithWebHostBuilder(builder => builder.UseContentRoot(Path.Combine(root, "backend/src/Shop.Api"))
                .ConfigureTestServices(services => services.AddDataProtection().DisableAutomaticKeyGeneration()));
        await using var scope = factory.Services.CreateAsyncScope();
        var services = scope.ServiceProvider;
        foreach (var type in new[] { typeof(IdentityDbContext), typeof(PaymentsDbContext), typeof(CreditDbContext), typeof(CmsDbContext), typeof(InventoryDbContext), typeof(CatalogDbContext), typeof(SalesDbContext), typeof(MarketDbContext) }) {
            var context = (DbContext)services.GetRequiredService(type);
            Check(context.Database.GetDbConnection().Database == connection.InitialCatalog && !(await context.Database.GetPendingMigrationsAsync()).Any(), "restored_exact_model_without_migration");
        }
        checks.Add("all_eight_contexts_restored_and_no_pending_migration");
        var users = services.GetRequiredService<UserManager<ShopUser>>();
        var customerUser = await users.FindByNameAsync(customer.Username);
        var warehouseUser = await users.FindByNameAsync(warehouse.Username);
        Check(customerUser is not null && customerUser.Id == customerId && customerUser.IsActive && !customerUser.RequireMfa && !customerUser.TwoFactorEnabled && (await users.GetRolesAsync(customerUser)).Count == 0, "restored_generated_customer_identity");
        Check(warehouseUser is not null && warehouseUser.Id == warehouseId && warehouseUser.IsActive && warehouseUser.RequireMfa && warehouseUser.TwoFactorEnabled && (await users.GetRolesAsync(warehouseUser)).SequenceEqual(["InventoryManager"]), "restored_generated_inventory_only_identity");
        using var customerClient = factory.CreateClient(new() { HandleCookies = false });
        customerClient.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:3000");
        var signed = await Read(await customerClient.PostAsJsonAsync("/api/auth/password", new { Identifier = customer.Username, customer.Password }));
        Check(!Flag(signed, "requiresMfa") && !Flag(signed, "requiresEnrollment") && Text(signed["user"]!, "id") == customerId, "restored_customer_actual_password_http");
        customerClient.DefaultRequestHeaders.Authorization = new("Bearer", Text(signed, "accessToken"));
        checks.Add("restored_customer_actual_password_http");
        var market = services.GetRequiredService<MarketDbContext>(); var sales = services.GetRequiredService<SalesDbContext>();
        var request = await market.SourcingRequests.AsNoTracking().SingleAsync(r => r.Id == requestId && r.OwnerId == customerId);
        var task = await market.SourcingSupplyTasks.AsNoTracking().SingleAsync(t => t.Id == taskId && t.OwnerId == customerId && t.RequestId == requestId);
        var note = services.GetRequiredService<ISourcingNoteProtection>().Unprotect(customerId, requestId, request.ProtectedNote);
        var internalNote = services.GetRequiredService<ISourcingSupplyNoteProtection>().Unprotect(customerId, taskId, task.ProtectedNote);
        // The fixture notes can be empty. Successful authenticated decryption
        // (rather than ciphertext presence) proves the copied keys are usable.
        var detail = await Read(customerClient, "/api/sourcing/requests/" + requestId);
        Check(Text(detail, "note") == note && !Flag(detail, "canPay"), "restored_request_note_decrypt_and_private_http");
        checks.Add("restored_request_note_decrypt_and_private_http");
        Check(internalNote.Length <= 2000, "restored_supply_note_decrypted");
        foreach (var supplyEvent in await market.SourcingSupplyEvents.AsNoTracking().Where(e => e.TaskId == taskId).ToArrayAsync())
            _ = services.GetRequiredService<ISourcingSupplyNoteProtection>().Unprotect(customerId, taskId, supplyEvent.ProtectedNote);
        checks.Add("restored_supply_note_and_event_history_decrypted");
        var agreement = await services.GetRequiredService<SourcingPriceAgreementService>().ReadAsync(agreementId, requestId, customerId, CancellationToken.None);
        var accepted = agreement.Lines.Single();
        Check(agreement.AcceptanceId == Text(metadata, "AcceptanceId") && agreement.TaskId == taskId && agreement.OfferId == offerId && !agreement.CanPay && accepted.Sku.VariantId == variantId && accepted.Quantity == 2 && accepted.UnitPriceRial == "9007199254740993" && accepted.LineTotalRial == "18014398509481986", "restored_immutable_accepted_snapshot_exact_rial");
        var retained = await sales.SourcingPriceAgreementLines.AsNoTracking().SingleAsync(l => l.AgreementId == agreementId);
        var retainedSku = JsonSerializer.Deserialize<OfferSkuSnapshot>(retained.SkuSnapshotJson, Web)!;
        Check(retainedSku == accepted.Sku || JsonSerializer.Serialize(retainedSku, Web) == JsonSerializer.Serialize(accepted.Sku, Web), "restored_retained_sku_json_deserialized");
        checks.Add("restored_immutable_accepted_snapshot_exact_rial_and_deserialization");
        foreach (var locale in new[] { "fa", "en" }) {
            var cart = await Read(customerClient, "/api/cart/" + locale + "/v2");
            Check(cart["schemaVersion"]!.GetValue<int>() == 2 && cart["ordinaryLines"]!.AsArray().Count == 1 && cart["inquiry"]!["lines"]!.AsArray().Count == 1 && cart["offerLines"]!.AsArray().Count == facts["offerLines"]!.GetValue<int>() && !Flag(cart, "canPay"), "restored_cart2_all_lanes_private_http");
            Check(Text(cart["ordinaryLines"]![0]!, "unitPriceRial") == "123" && Text(cart, "ordinarySubtotalRial") == "123", "restored_independent_ordinary_price");
            if (cart["offerLines"]!.AsArray().Count == 1) {
                var line = cart["offerLines"]![0]!;
                Check(Text(line, "agreementId") == agreementId && Text(line, "unitPriceRial") == accepted.UnitPriceRial && Text(line, "lineTotalRial") == accepted.LineTotalRial && !Flag(cart, "canCheckout"), "restored_exact_accepted_cart_money_and_checkout_gate");
            }
        }
        checks.AddRange(["restored_cart2_fa_en_all_lanes_private_http", "restored_independent_prices_and_offer_checkout_gate"]);
        var conversion = await sales.SourcingConversions.AsNoTracking().SingleAsync(c => c.AcceptanceId == agreement.AcceptanceId && c.CartId == cartId);
        var receipt = await Read(customerClient, $"/api/sourcing/requests/{requestId}/offers/{offerId}/commands/convert/{conversion.CommandId}");
        Check(Text(receipt, "conversionId") == conversion.Id && Flag(receipt, "replayed") && !Flag(receipt, "canPay") && !Flag(receipt, "canCheckout"), "restored_historical_conversion_receipt_get");
        var removal = await sales.CartOfferCommandReceipts.AsNoTracking().SingleOrDefaultAsync(c => c.Operation == "remove");
        if (removal is not null) {
            var removed = await Read(customerClient, $"/api/cart/en/v2/offers/{agreementId}/commands/remove/{removal.CommandId}");
            Check(Flag(removed, "replayed") && Text(removed, "agreementId") == agreementId && !Flag(removed, "canPay") && !Flag(removed, "canCheckout"), "restored_historical_remove_receipt_get");
            checks.Add("restored_historical_remove_receipt_get_without_readding_group");
        }
        checks.Add("restored_historical_conversion_receipt_get_without_mutation");
        using var inventoryClient = factory.CreateClient(new() { HandleCookies = false });
        inventoryClient.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:5173");
        inventoryClient.DefaultRequestHeaders.Add("X-Sayman-Client", "admin");
        inventoryClient.DefaultRequestHeaders.Add("X-Sayman-Admin", "1");
        var pending = await Read(await inventoryClient.PostAsJsonAsync("/api/auth/password", new { Identifier = warehouse.Username, warehouse.Password }));
        Check(Flag(pending, "requiresMfa") && !Flag(pending, "requiresEnrollment"), "restored_inventory_password_still_requires_mfa");
        inventoryClient.DefaultRequestHeaders.Authorization = new("Bearer", Text(pending, "accessToken"));
        using (var forbidden = await inventoryClient.GetAsync($"/api/admin/inventory/variants/{variantId}/serials/v2")) Check(forbidden.StatusCode == HttpStatusCode.Forbidden, "restored_pending_mfa_forbidden");
        // Only the bound generated QA account's restored key is read. Wait for
        // a fresh current window rather than replaying a source-consumed code.
        var step = DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 30;
        if (warehouseUser!.LastMfaCounter is long consumed && step <= consumed) {
            Check(consumed - step <= 1, "restored_qa_mfa_counter_not_future");
            await Task.Delay(TimeSpan.FromSeconds((consumed + 1) * 30 - DateTimeOffset.UtcNow.ToUnixTimeSeconds() + 1));
            step = DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 30;
        }
        var secret = await users.GetAuthenticatorKeyAsync(warehouseUser) ?? throw new InvalidOperationException("restored_generated_qa_authenticator_missing");
        var verified = await Read(await inventoryClient.PostAsJsonAsync("/api/auth/mfa/verify", new { Code = Totp.Code(secret, step) }));
        Check(!Flag(verified, "requiresMfa") && !Flag(verified, "requiresEnrollment"), "restored_inventory_current_mfa_http");
        inventoryClient.DefaultRequestHeaders.Authorization = new("Bearer", Text(verified, "accessToken"));
        var serials = await Read(inventoryClient, $"/api/admin/inventory/variants/{variantId}/serials/v2");
        var stock = serials["stock"]!;
        Check(stock["onHand"]!.GetValue<int>() == facts["onHand"]!.GetValue<int>() && stock["reserved"]!.GetValue<int>() == 0 && stock["sourcingReserved"]!.GetValue<int>() == facts["sourcingReserved"]!.GetValue<int>() && serials["items"]!.AsArray().Count == 3, "restored_inventory_actual_serial_v2_http");
        using (var forbidden = await inventoryClient.GetAsync($"/api/admin/sourcing/requests/{requestId}/supply/v2/{taskId}")) Check(forbidden.StatusCode == HttpStatusCode.Forbidden, "restored_inventory_cannot_read_accepted_finance_or_internal_note");
        checks.AddRange(["restored_inventory_password_still_requires_mfa", "restored_pending_mfa_forbidden", "restored_inventory_current_mfa_http", "restored_inventory_actual_serial_v2_http", "restored_inventory_cannot_read_accepted_finance_or_internal_note"]);
        var missing = Path.Combine(directory, "missing-keys"); Directory.CreateDirectory(missing, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        using var missingServices = new ServiceCollection().AddDataProtection().SetApplicationName("Sayman.Identity").PersistKeysToFileSystem(new DirectoryInfo(missing)).DisableAutomaticKeyGeneration().Services.BuildServiceProvider();
        AssertClosed(() => new SourcingSupplyNoteProtection(missingServices.GetRequiredService<IDataProtectionProvider>()).Unprotect(customerId, taskId, task.ProtectedNote), "sourcing_supply_note_unavailable", "missing_key_ring_fails_closed");
        AssertClosed(() => services.GetRequiredService<ISourcingSupplyNoteProtection>().Unprotect("different-qa-owner", taskId, task.ProtectedNote), "sourcing_supply_note_unavailable", "restored_note_owner_binding");
        using var wrongApp = new ServiceCollection().AddDataProtection().SetApplicationName("Other.Qa.Application").PersistKeysToFileSystem(new DirectoryInfo(keys)).DisableAutomaticKeyGeneration().Services.BuildServiceProvider();
        AssertClosed(() => new SourcingSupplyNoteProtection(wrongApp.GetRequiredService<IDataProtectionProvider>()).Unprotect(customerId, taskId, task.ProtectedNote), "sourcing_supply_note_unavailable", "restored_note_application_binding");
        checks.AddRange(["missing_key_ring_fails_closed", "restored_note_owner_binding", "restored_note_application_binding"]);
        var output = Path.Combine(directory, "verified-cart34.json");
        await using var file = new FileStream(output, new FileStreamOptions { Mode = FileMode.CreateNew, Access = FileAccess.Write, Share = FileShare.None, UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite });
        await JsonSerializer.SerializeAsync(file, new { passed = true, checks, count = checks.Count, scope = "Fresh TestServer and restored GUID SQL; generated customer/InventoryManager password/current MFA; copied QA keyring. Accepted SKU JSON is deserialized, not encrypted. No business command or production acceptance." });
        Console.WriteLine("Cart34 restored QA HTTP/key verification passed; private values were not reported.");
    }
    private static void AssertClosed(Func<string> action, string code, string stage)
    {
        try { _ = action(); } catch (BusinessException error) when (error.Code == code) { return; }
        throw new InvalidOperationException(stage);
    }
    private static void CheckPrivate(string directory)
    {
        if (OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
        Check(Directory.Exists(directory) && (File.GetAttributes(directory) & FileAttributes.ReparsePoint) == 0 && File.GetUnixFileMode(directory) == (UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute), "private_restore_directory_required");
        foreach (var entry in Directory.EnumerateFileSystemEntries(directory)) {
            Check((File.GetAttributes(entry) & FileAttributes.ReparsePoint) == 0, "restore_symlink_rejected");
            if (Directory.Exists(entry)) CheckPrivate(entry);
            else Check(File.GetUnixFileMode(entry) == (UnixFileMode.UserRead | UnixFileMode.UserWrite), "private_restore_file_required");
        }
    }
    private static async Task<Credentials> CredentialsFrom(string directory, string name, string prefix)
    {
        var value = JsonSerializer.Deserialize<Credentials>(await File.ReadAllTextAsync(Path.Combine(directory, name))) ?? throw new InvalidOperationException("restored_generated_credentials_missing");
        Check(Regex.IsMatch(value.Username, "^" + prefix + "[a-f0-9]{32}$") && value.Password.Length >= 32, "generated_qa_credential_guard"); return value;
    }
    private static async Task<JsonNode> Read(HttpClient client, string path) => await Read(await client.GetAsync(path));
    private static async Task<JsonNode> Read(HttpResponseMessage response)
    {
        using (response) {
            Check(response.StatusCode == HttpStatusCode.OK && response.Headers.CacheControl?.NoStore == true, "restored_private_http_contract");
            return JsonNode.Parse(await response.Content.ReadAsStringAsync()) ?? throw new InvalidOperationException("restored_json_missing");
        }
    }
    private static string Text(JsonNode node, string field) => node[field]?.GetValue<string>() ?? throw new InvalidOperationException("restored_expected_string_missing");
    private static bool Flag(JsonNode node, string field) => node[field]?.GetValue<bool>() ?? throw new InvalidOperationException("restored_expected_flag_missing");
    private static string Required(string name) => Environment.GetEnvironmentVariable(name) ?? throw new InvalidOperationException("missing_cart34_restore_configuration");
    private static void Check(bool condition, string stage) { if (!condition) throw new InvalidOperationException(stage); }
}
