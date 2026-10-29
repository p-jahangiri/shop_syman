using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Identity;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Shop.SqlTests;

namespace Shop.UiHarness;

// Opt-in, in-process HTTP verification of a restored disposable QA database.
// Never migrates/seeds, starts Kestrel, provisions identities or publishes CMS.
internal static class RestoreVerifier
{
    private sealed record Credentials(string Username, string Password);
    public static async Task RunAsync()
    {
        if (OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
        var root = Path.GetFullPath(Required("SHOP_UI_ROOT"));
        var connection = new SqlConnectionStringBuilder(Required("SHOP_RESTORE_SQL_CONNECTION"));
        Check(connection.DataSource == "127.0.0.1,11433", "loopback_sql_guard");
        Check(Regex.IsMatch(connection.InitialCatalog, "^SaymanTest_Restore_[a-f0-9]{32}$"), "restore_database_guard");
        var directory = Path.Combine(root, "tmp", "restore", connection.InitialCatalog);
        Check(Path.GetFullPath(Required("SHOP_RESTORE_DIRECTORY")) == directory, "restore_directory_guard");
        var keys = Path.Combine(directory, "keys");
        Check(Directory.Exists(keys) && Directory.GetFiles(keys, "*.xml").Length > 0, "copied_key_ring_present");
        var credentials = JsonSerializer.Deserialize<Credentials>(await File.ReadAllTextAsync(Path.Combine(directory, "customer.json"))) ?? throw new InvalidOperationException("missing_qa_credentials");
        Check(Regex.IsMatch(credentials.Username, "^cartui[a-f0-9]{32}$"), "temporary_customer_guard");
        var checks = new List<string>();
        var expected = JsonNode.Parse(await File.ReadAllTextAsync(Path.Combine(directory, "expected.json")))!;
        Environment.SetEnvironmentVariable("DataProtection__KeyDirectory", keys);
        await using var factory = new SqlFactory(connection.ConnectionString, credentials.Password, keys)
            .WithWebHostBuilder(builder => builder.UseContentRoot(Path.Combine(root, "backend/src/Shop.Api")));
        await using var scope = factory.Services.CreateAsyncScope();
        var services = scope.ServiceProvider;
        var db = services.GetRequiredService<SalesDbContext>();
        var identity = services.GetRequiredService<IdentityDbContext>();
        var user = await identity.Users.AsNoTracking().SingleAsync(x => x.UserName == credentials.Username);
        // Authenticate the existing generated identity through the real service.
        // The resulting refresh record is confined to the restored copy.
        var session = await services.GetRequiredService<AuthService>().PasswordAsync(new(credentials.Username, credentials.Password), true, true, false, CancellationToken.None);
        Check(!session.RequiresMfa && JsonSerializer.SerializeToNode(session.User)?["Id"]?.GetValue<string>() == user.Id, "restored_customer_password_auth"); checks.Add("restored_customer_password_auth");
        using var client = factory.CreateClient(new() { HandleCookies = false });
        client.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:3000");
        client.DefaultRequestHeaders.Authorization = new("Bearer", session.AccessToken);
        var book = await Read(client, "/api/addresses");
        var addressCount = expected["addressCount"]!.GetValue<int>();
        Check(addressCount > 0 && book["items"]!.AsArray().Count == addressCount, "restored_encrypted_address_http");
        Check(book["items"]!.AsArray().Count(x => x!["isDefault"]!.GetValue<bool>()) == 1, "restored_address_default");
        checks.AddRange(["restored_encrypted_address_http", "restored_address_default"]);
        var cipherHash = await db.Addresses.AsNoTracking().Where(x => x.OwnerId == user.Id).OrderBy(x => x.Id).Select(x => x.ProtectedData).ToArrayAsync();
        var digest = Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(string.Join("\n", cipherHash))));
        Check(digest == expected["addressCipherDigest"]!.GetValue<string>(), "ciphertext_preserved_by_restore"); checks.Add("ciphertext_preserved_by_restore");
        var orders = await db.Orders.AsNoTracking().Where(x => x.OwnerId == user.Id).OrderBy(x => x.Id).ToArrayAsync();
        Check(orders.Length == expected["orders"]!.AsArray().Count && orders.Length > 0, "restored_order_count");
        foreach (var order in orders) {
            var original = expected["orders"]!.AsArray().Single(x => x!["id"]!.GetValue<string>() == order.Id)!;
            var detail = await Read(client, "/api/orders/" + order.Id);
            Check(detail["summary"]!["state"]!.GetValue<string>() == original["state"]!.GetValue<string>(), "restored_order_state");
            Check(detail["payableTotalRial"]!.GetValue<string>() == original["total"]!.GetValue<string>(), "restored_order_money_string");
            Check(detail["shippingRial"]!.GetValue<string>() == original["shipping"]!.GetValue<string>(), "restored_order_shipping");
            Check(detail["shippingRequired"]!.GetValue<bool>() == original["physical"]!.GetValue<bool>() && (detail["delivery"] is not null) == order.ShippingRequired, "restored_delivery_snapshot");
            Check(detail["canPay"]!.GetValue<bool>() == false && detail["paymentAvailability"]!.GetValue<string>() == "gateway_unconfigured", "no_fake_payment_after_restore");
        }
        checks.AddRange(["restored_order_count", "restored_order_state", "restored_order_money_string", "restored_order_shipping", "restored_delivery_snapshot", "no_fake_payment_after_restore"]);
        var staffCredentials = JsonSerializer.Deserialize<Credentials>(await File.ReadAllTextAsync(Path.Combine(directory, "finance.json"))) ?? throw new InvalidOperationException("missing_qa_staff_credentials");
        Check(Regex.IsMatch(staffCredentials.Username, "^financeui[a-f0-9]{32}$"), "temporary_staff_guard");
        var users = services.GetRequiredService<UserManager<ShopUser>>();
        var staff = await users.FindByNameAsync(staffCredentials.Username) ?? throw new InvalidOperationException("restored_staff_missing");
        Check(staff.TwoFactorEnabled && staff.RequireMfa, "restored_staff_mfa_still_required");
        using var staffClient = factory.CreateClient(new() { HandleCookies = false });
        staffClient.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:5173");
        staffClient.DefaultRequestHeaders.Add("X-Sayman-Client", "admin");
        staffClient.DefaultRequestHeaders.Add("X-Sayman-Admin", "1");
        var pending = await Read(await staffClient.PostAsJsonAsync("/api/auth/password", new { Identifier = staffCredentials.Username, staffCredentials.Password }));
        Check(pending["requiresMfa"]!.GetValue<bool>(), "restored_staff_password_requires_mfa");
        staffClient.DefaultRequestHeaders.Authorization = new("Bearer", pending["accessToken"]!.GetValue<string>());
        using (var forbidden = await staffClient.GetAsync("/api/admin/content")) Check(forbidden.StatusCode == HttpStatusCode.Forbidden, "restored_pending_mfa_cannot_read_content");
        var secret = await users.GetAuthenticatorKeyAsync(staff) ?? throw new InvalidOperationException("restored_qa_authenticator_missing");
        var signed = await Read(await staffClient.PostAsJsonAsync("/api/auth/mfa/verify", new { Code = Totp.Code(secret, DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 30) }));
        Check(!signed["requiresMfa"]!.GetValue<bool>(), "restored_staff_mfa_verified");
        staffClient.DefaultRequestHeaders.Authorization = new("Bearer", signed["accessToken"]!.GetValue<string>());
        checks.AddRange(["restored_staff_password_requires_mfa", "restored_pending_mfa_cannot_read_content", "restored_staff_mfa_verified"]);
        var content = await Read(staffClient, "/api/admin/content");
        var document = content["documents"]!.AsArray().Single(x => x!["key"]!.GetValue<string>() == "site" && x["locale"]!.GetValue<string>() == "en")!;
        Check(document["revision"]!.GetValue<int>() == expected["cmsRevision"]!.GetValue<int>(), "restored_cms_revision");
        foreach (var pair in new[] { (Field: "draftJson", Expected: "cmsDraftDigest"), (Field: "publishedJson", Expected: "cmsPublishedDigest") }) {
            var hash = Convert.ToHexString(SHA256.HashData(System.Text.Encoding.Unicode.GetBytes(document[pair.Field]!.GetValue<string>())));
            Check(hash == expected[pair.Expected]!.GetValue<string>(), "restored_cms_draft_published_separation");
        }
        checks.Add("restored_cms_draft_and_published_unchanged");
        var address = await db.Addresses.AsNoTracking().FirstAsync(x => x.OwnerId == user.Id);
        var missing = Path.Combine(directory, "missing-keys"); Directory.CreateDirectory(missing);
        using var missingServices = new ServiceCollection().AddDataProtection().SetApplicationName("Sayman.Identity").PersistKeysToFileSystem(new DirectoryInfo(missing)).DisableAutomaticKeyGeneration().Services.BuildServiceProvider();
        var unavailableBook = new AddressBookService(db, new DataProtectionAddressProtection(missingServices.GetRequiredService<IDataProtectionProvider>()), TimeProvider.System);
        try { await unavailableBook.ReadAsync(user.Id, CancellationToken.None); throw new InvalidOperationException("missing_keys_did_not_fail_closed"); }
        catch (BusinessException e) when (e.Code == "address_unavailable") { checks.Add("missing_key_ring_fails_closed"); }
        var protection = services.GetRequiredService<IAddressProtection>();
        try { protection.Unprotect("different-qa-owner", address.Id, address.ProtectedData); throw new InvalidOperationException("owner_binding_did_not_fail"); }
        catch (CryptographicException) { checks.Add("restored_owner_binding_preserved"); }
        using var wrongApp = new ServiceCollection().AddDataProtection().SetApplicationName("Other.Qa.Application").PersistKeysToFileSystem(new DirectoryInfo(keys)).DisableAutomaticKeyGeneration().Services.BuildServiceProvider();
        try { new DataProtectionAddressProtection(wrongApp.GetRequiredService<IDataProtectionProvider>()).Unprotect(user.Id, address.Id, address.ProtectedData); throw new InvalidOperationException("application_binding_did_not_fail"); }
        catch (CryptographicException) { checks.Add("application_discriminator_required"); }
        await File.WriteAllTextAsync(Path.Combine(directory, "verified.json"), JsonSerializer.Serialize(new { checks, count = checks.Count, passed = true, scope = "In-process HTTP and real restored SQL; own QA identity/key ring only. No Kestrel or production acceptance." }));
        Console.WriteLine("Restored QA database verified; private values were not written to the report.");
    }
    private static async Task<JsonNode> Read(HttpClient client, string path)
    {
        return await Read(await client.GetAsync(path));
    }
    private static async Task<JsonNode> Read(HttpResponseMessage response)
    {
        using var ownedResponse = response;
        Check(response.StatusCode == HttpStatusCode.OK && response.Headers.CacheControl?.NoStore == true, "restored_private_http_contract");
        return JsonNode.Parse(await response.Content.ReadAsStringAsync()) ?? throw new InvalidOperationException("invalid_restored_response");
    }
    private static string Required(string name) => Environment.GetEnvironmentVariable(name) ?? throw new InvalidOperationException("missing_restore_configuration");
    private static void Check(bool value, string name) { if (!value) throw new InvalidOperationException(name); }
}
