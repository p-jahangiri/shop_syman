using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;

namespace Shop.UiHarness;

// Only repairs lifecycle metadata after the opt-in stopped harness failed to
// write its final marker. Does not start the application or consume identities.
internal static class Cart34PreservationRecovery
{
    private sealed record Credentials(string Username, string Password);
    internal static async Task RunAsync()
    {
        if (OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
        var root = Path.GetFullPath(Required("SHOP_UI_ROOT"));
        var database = Required("SHOP_UI_FINALIZE_CART34_RUN");
        Check(Regex.IsMatch(database, "^SaymanTest_Ui_[a-f0-9]{32}$"), "recovery_exact_owned_guid_required");
        Check(!new[] { "SHOP_UI_RESUME_RUN", "SHOP_UI_PRESERVE_CART34_ON_STOP", "SHOP_UI_VERIFY_RESTORE", "SHOP_UI_VERIFY_CART34_RESTORE", "SHOP_UI_CART2_QA", "SHOP_UI_ALLOCATION_QA", "SHOP_UI_OPERATIONS_QA", "SHOP_UI_SUPPLY_QA", "SHOP_UI_OFFERS_QA", "SHOP_UI_SOURCING_QA" }.Any(flag => Environment.GetEnvironmentVariable(flag) is not null), "recovery_rejects_other_modes");
        foreach (var parent in new[] { Path.Combine(root, "tmp"), Path.Combine(root, "tmp", "ui-cart") })
            Check(Directory.Exists(parent) && (File.GetAttributes(parent) & FileAttributes.ReparsePoint) == 0, "recovery_parent_symlink_rejected");
        var directory = Path.Combine(root, "tmp", "ui-cart", database);
        CheckPrivate(directory);
        var markerFile = Path.Combine(directory, "preserved-cart34.json");
        var originalBytes = await File.ReadAllBytesAsync(markerFile);
        using var marker = JsonDocument.Parse(originalBytes);
        var value = marker.RootElement;
        Check(value.GetProperty("schemaVersion").GetInt32() == 1 && value.GetProperty("sourceSchema").GetInt32() == 34 &&
              Text(value, "database") == database && value.GetProperty("qaOnly").GetBoolean() && !value.GetProperty("mainPromoted").GetBoolean() &&
              value.GetProperty("freshRun").GetBoolean() && Text(value, "state") == "running" && value.GetProperty("apiPort").GetInt32() == 5181,
              "recovery_requires_original_fresh_running_marker");
        using var metadata = JsonDocument.Parse(await File.ReadAllBytesAsync(Path.Combine(directory, "cart2.json")));
        var meta = metadata.RootElement;
        Check(Text(meta, "Database") == database && meta.GetProperty("SchemaVersion").GetInt32() == 1 && meta.GetProperty("QaOnly").GetBoolean() && !meta.GetProperty("MainPromoted").GetBoolean(), "recovery_fresh_cart2_metadata_binding");
        foreach (var field in new[] { "RequestId", "TaskId", "OfferId", "AcceptanceId", "AgreementId", "CartId", "VariantId" })
            Check(Regex.IsMatch(Text(meta, field), "^[a-f0-9]{32}$"), "recovery_canonical_cart2_ids_required");
        Check(Guid.TryParseExact(Text(meta, "CustomerId"), "D", out _) && Guid.TryParseExact(Text(meta, "WarehouseId"), "D", out _), "recovery_generated_identity_ids_required");
        Check(Directory.GetFiles(Path.Combine(directory, "keys"), "*.xml").Length > 0, "recovery_original_private_key_ring_required");
        var customer = await CredentialsFrom(directory, "customer.json", "cartui");
        var warehouse = await CredentialsFrom(directory, "inventory.json", "inventoryui");
        await AssertPortsClosed();
        var settings = new SqlConnectionStringBuilder(Required("SHOP_TEST_SQL_CONNECTION"));
        Check(settings.DataSource == "127.0.0.1,11433", "recovery_loopback_sql_required");
        settings.InitialCatalog = database; settings.ConnectTimeout = 8; settings.ApplicationIntent = ApplicationIntent.ReadOnly;
        await using var connection = new SqlConnection(settings.ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandTimeout = 15;
        command.CommandText = """
SET NOCOUNT ON;
IF (SELECT COUNT(*) FROM sys.dm_exec_sessions WHERE database_id=DB_ID() AND session_id<>@@SPID AND is_user_process=1)<>0 THROW 51000,'Recovery requires no other QA database sessions.',1;
IF (SELECT COUNT(*) FROM sys.tables WHERE name=N'__EFMigrationsHistory')<>8 THROW 51000,'Recovery requires eight migration schemas.',1;
IF (SELECT COUNT(*) FROM [identity].__EFMigrationsHistory)<>3 OR (SELECT COUNT(*) FROM payments.__EFMigrationsHistory)<>1 OR
 (SELECT COUNT(*) FROM credit.__EFMigrationsHistory)<>2 OR (SELECT COUNT(*) FROM cms.__EFMigrationsHistory)<>1 OR
 (SELECT COUNT(*) FROM catalog.__EFMigrationsHistory)<>8 OR (SELECT COUNT(*) FROM inventory.__EFMigrationsHistory)<>6 OR
 (SELECT COUNT(*) FROM sales.__EFMigrationsHistory)<>8 OR (SELECT COUNT(*) FROM market.__EFMigrationsHistory)<>5 OR
 NOT EXISTS(SELECT 1 FROM sales.__EFMigrationsHistory WHERE MigrationId=N'20261024025922_CartAcceptedOffers') THROW 51000,'Recovery requires exact source schema34.',1;
IF NOT EXISTS(SELECT 1 FROM [identity].AspNetUsers WHERE Id=@customer AND UserName=@customerName AND IsActive=1 AND RequireMfa=0 AND TwoFactorEnabled=0) OR
 NOT EXISTS(SELECT 1 FROM [identity].AspNetUsers WHERE Id=@warehouse AND UserName=@warehouseName AND IsActive=1 AND RequireMfa=1 AND TwoFactorEnabled=1) THROW 51000,'Recovery requires the bound generated identities.',1;
IF EXISTS(SELECT 1 FROM [identity].AspNetUserRoles WHERE UserId=@customer) OR
 (SELECT COUNT(*) FROM [identity].AspNetUserRoles WHERE UserId=@warehouse)<>1 OR
 NOT EXISTS(SELECT 1 FROM [identity].AspNetUserRoles ur JOIN [identity].AspNetRoles r ON r.Id=ur.RoleId WHERE ur.UserId=@warehouse AND r.Name=N'InventoryManager') THROW 51000,'Recovery generated role binding failed.',1;
IF (SELECT COUNT(*) FROM sales.SourcingConversions)<>1 OR
 NOT EXISTS(SELECT 1 FROM sales.SourcingConversions WHERE OwnerId=@customer AND CartId=@cart AND RequestId=@request AND TaskId=@task AND OfferId=@offer AND AcceptanceId=@acceptance AND AgreementId=@agreement) OR
 (SELECT COUNT(*) FROM sales.CartOfferCommandReceipts WHERE Operation='convert')<>1 OR
 (SELECT COUNT(*) FROM market.SourcingSupplyEvents WHERE TaskId=@task AND ReasonCode='cart_converted')<>1 THROW 51000,'Recovery requires actual retained conversion history.',1;
IF NOT EXISTS(SELECT 1 FROM sales.Carts WHERE Id=@cart AND OwnerId=@customer) OR
 NOT EXISTS(SELECT 1 FROM sales.SourcingPriceAgreements WHERE Id=@agreement AND OwnerId=@customer AND RequestId=@request AND TaskId=@task AND OfferId=@offer AND AcceptanceId=@acceptance) OR
 NOT EXISTS(SELECT 1 FROM sales.SourcingPriceAgreementLines WHERE AgreementId=@agreement AND VariantId=@variant AND Quantity=2 AND UnitPriceRial=9007199254740993 AND LineTotalRial=18014398509481986) THROW 51000,'Recovery accepted terms binding failed.',1;
IF EXISTS(SELECT 1 FROM sales.Orders) OR EXISTS(SELECT 1 FROM sales.CheckoutQuotes) OR EXISTS(SELECT 1 FROM inventory.Reservations) OR
 EXISTS(SELECT 1 FROM sales.CheckoutOrderSettings) OR EXISTS(SELECT 1 FROM sales.CheckoutChargePolicies) THROW 51000,'Recovery refuses financial configuration or purchase data.',1;
SELECT CAST(34 AS int);
""";
        foreach (var pair in new[] { ("@customer", Text(meta, "CustomerId")), ("@customerName", customer.Username), ("@warehouse", Text(meta, "WarehouseId")), ("@warehouseName", warehouse.Username), ("@request", Text(meta, "RequestId")), ("@task", Text(meta, "TaskId")), ("@offer", Text(meta, "OfferId")), ("@acceptance", Text(meta, "AcceptanceId")), ("@agreement", Text(meta, "AgreementId")), ("@cart", Text(meta, "CartId")), ("@variant", Text(meta, "VariantId")) })
            command.Parameters.AddWithValue(pair.Item1, pair.Item2);
        Check(Convert.ToInt32(await command.ExecuteScalarAsync(), System.Globalization.CultureInfo.InvariantCulture) == 34, "recovery_source34_readonly_sql_verified");
        await connection.CloseAsync();
        await AssertPortsClosed();
        CheckPrivate(directory);
        var currentMarkerBytes = await File.ReadAllBytesAsync(markerFile);
        Check(originalBytes.SequenceEqual(currentMarkerBytes), "recovery_marker_changed_during_verification");
        var backupFile = Path.Combine(directory, "preserved-cart34.running-before-recovery.json");
        await WriteNewPrivate(backupFile, originalBytes);
        var originalHash = Convert.ToHexString(SHA256.HashData(originalBytes));
        var at = DateTimeOffset.UtcNow;
        var bytes = JsonSerializer.SerializeToUtf8Bytes(new {
            schemaVersion = 1, sourceSchema = 34, database, qaOnly = true, mainPromoted = false, freshRun = true,
            state = "stopped-preserved", apiPort = 5181, at,
            recovery = new { kind = "finalize_after_shutdown_marker_write_failure", originalState = "running", originalMarkerSha256 = originalHash,
                allFourQaPortsClosed = true, source34ReadOnlySqlVerified = true, databaseMutations = 0, authAttempts = 0,
                note = "Original failed shutdown is preserved as separate evidence; this recovery verifies the stopped source and repairs only lifecycle metadata." }
        });
        var replacement = markerFile + ".recovered";
        await WriteNewPrivate(replacement, bytes);
        File.Move(replacement, markerFile, overwrite: true);
        var report = Path.Combine(root, "artifacts", "checks", "cart34-preserve-finalize-" + database[14..] + ".json");
        await using (var output = new FileStream(report, new FileStreamOptions { Mode = FileMode.CreateNew, Access = FileAccess.Write, Share = FileShare.None }))
            await JsonSerializer.SerializeAsync(output, new { passed = true, database, sourceSchema = 34, at, recoveryOnly = true,
                originalMarkerSha256 = originalHash, originalRunningMarkerPreserved = true, allFourQaPortsClosed = true,
                source34ReadOnlySqlVerified = true, databaseMutations = 0, authAttempts = 0, sourceDatabaseAndPrivateFilesRetained = true,
                scope = "Explicit recovery after shutdown marker write failure; not an ordinary successful shutdown, restore, CHECKDB or product acceptance." });
        Console.WriteLine("Cart34 stopped-source marker recovery passed; original marker and failure evidence are retained. No SQL write, auth, seed, migration or API was run.");
    }
    private static async Task AssertPortsClosed()
    {
        foreach (var port in new[] { 5181, 5182, 3105, 3175 }) {
            using var probe = new TcpClient(); using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(1));
            try { await probe.ConnectAsync(IPAddress.Loopback, port, timeout.Token); }
            catch (SocketException error) when (error.SocketErrorCode == SocketError.ConnectionRefused) { continue; }
            throw new InvalidOperationException("recovery_requires_all_four_qa_ports_closed");
        }
    }
    private static void CheckPrivate(string directory)
    {
        if (OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
        Check(Directory.Exists(directory) && (File.GetAttributes(directory) & FileAttributes.ReparsePoint) == 0 && File.GetUnixFileMode(directory) == (UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute), "recovery_private_directory_required");
        foreach (var entry in Directory.EnumerateFileSystemEntries(directory)) {
            Check((File.GetAttributes(entry) & FileAttributes.ReparsePoint) == 0, "recovery_private_symlink_rejected");
            if (Directory.Exists(entry)) CheckPrivate(entry);
            else Check(File.GetUnixFileMode(entry) == (UnixFileMode.UserRead | UnixFileMode.UserWrite), "recovery_private_file_required");
        }
    }
    private static async Task<Credentials> CredentialsFrom(string directory, string name, string prefix)
    {
        var result = JsonSerializer.Deserialize<Credentials>(await File.ReadAllTextAsync(Path.Combine(directory, name))) ?? throw new InvalidOperationException("recovery_missing_generated_credential_metadata");
        Check(Regex.IsMatch(result.Username, "^" + prefix + "[a-f0-9]{32}$") && result.Password.Length >= 32, "recovery_generated_credential_metadata_required");
        return result;
    }
    private static async Task WriteNewPrivate(string path, byte[] bytes)
    {
        if (OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
        await using var output = new FileStream(path, new FileStreamOptions { Mode = FileMode.CreateNew, Access = FileAccess.Write, Share = FileShare.None, UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite });
        await output.WriteAsync(bytes);
    }
    private static string Text(JsonElement value, string name) => value.GetProperty(name).GetString() ?? throw new InvalidOperationException("recovery_metadata_string_required");
    private static string Required(string name) => Environment.GetEnvironmentVariable(name) ?? throw new InvalidOperationException("recovery_configuration_required");
    private static void Check(bool value, string stage) { if (!value) throw new InvalidOperationException(stage); }
}
