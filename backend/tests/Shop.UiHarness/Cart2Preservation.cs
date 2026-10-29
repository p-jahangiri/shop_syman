using System.Text.Json;
using System.Text.RegularExpressions;

namespace Shop.UiHarness;

// Lifecycle marker for this harness's opt-in fresh GUID only. Never changes
// product cleanup behavior, accepts an owner key ring or resumes seed data.
internal static class Cart2Preservation
{
    internal static async Task WriteAsync(string root, string directory, string database, string state)
    {
        if (OperatingSystem.IsWindows() || state is not ("running" or "stopped-preserved") ||
            !Regex.IsMatch(database, "^SaymanTest_Ui_[a-f0-9]{32}$") ||
            Path.GetFullPath(directory) != Path.Combine(Path.GetFullPath(root), "tmp", "ui-cart", database) ||
            Environment.GetEnvironmentVariable("SHOP_UI_RESUME_RUN") is not null ||
            new[] { "SHOP_UI_PRESERVE_CART34_ON_STOP", "SHOP_UI_CART2_QA", "SHOP_UI_ALLOCATION_QA", "SHOP_UI_OPERATIONS_QA", "SHOP_UI_SUPPLY_QA", "SHOP_UI_OFFERS_QA", "SHOP_UI_SOURCING_QA" }.Any(f => Environment.GetEnvironmentVariable(f) != "1"))
            throw new InvalidOperationException("invalid_cart34_preservation_scope");
        foreach (var component in new[] { Path.Combine(root, "tmp"), Path.Combine(root, "tmp", "ui-cart"), directory })
            if (!Directory.Exists(component) || (File.GetAttributes(component) & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("preservation_symlink_or_missing_directory");
        var entries = new List<string>();
        Collect(directory, entries);
        foreach (var name in new[] { "customer.json", "inventory.json", "finance.json", "allocation.json", "cart2.json" })
            if (!File.Exists(Path.Combine(directory, name))) throw new InvalidOperationException("preservation_missing_fresh_qa_metadata");
        if (!Directory.EnumerateFiles(Path.Combine(directory, "keys"), "*.xml").Any()) throw new InvalidOperationException("preservation_missing_qa_key_ring");
        using (var metadata = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(directory, "cart2.json")))) {
            var value = metadata.RootElement;
            if (value.GetProperty("Database").GetString() != database || !value.GetProperty("QaOnly").GetBoolean() || value.GetProperty("MainPromoted").GetBoolean()) throw new InvalidOperationException("preservation_metadata_binding");
        }
        // Every entry belongs to the freshly-created run. Tighten generated
        // key repository permissions before copying; never chmod outside it.
        foreach (var entry in entries)
            File.SetUnixFileMode(entry, Directory.Exists(entry) ? UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute : UnixFileMode.UserRead | UnixFileMode.UserWrite);
        var file = Path.Combine(directory, "preserved-cart34.json");
        if (state == "running" && File.Exists(file)) throw new InvalidOperationException("preservation_marker_must_be_new");
        if (state == "stopped-preserved") {
            using var previous = JsonDocument.Parse(await File.ReadAllTextAsync(file));
            if (previous.RootElement.GetProperty("database").GetString() != database || previous.RootElement.GetProperty("state").GetString() != "running") throw new InvalidOperationException("preservation_marker_lifecycle");
        }
        var bytes = JsonSerializer.SerializeToUtf8Bytes(new { schemaVersion = 1, sourceSchema = 34, database, qaOnly = true, mainPromoted = false, freshRun = true, state, apiPort = 5181, at = DateTimeOffset.UtcNow });
        var options = new FileStreamOptions { Mode = state == "running" ? FileMode.CreateNew : FileMode.Truncate, Access = FileAccess.Write, Share = FileShare.None };
        if (state == "running") options.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite;
        await using var stream = new FileStream(file, options);
        await stream.WriteAsync(bytes);
    }
    private static void Collect(string directory, List<string> result)
    {
        if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("preservation_symlink_rejected");
        result.Add(directory);
        foreach (var entry in Directory.EnumerateFileSystemEntries(directory)) {
            var attributes = File.GetAttributes(entry);
            if ((attributes & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("preservation_symlink_rejected");
            if ((attributes & FileAttributes.Directory) != 0) Collect(entry, result); else result.Add(entry);
        }
    }
}
