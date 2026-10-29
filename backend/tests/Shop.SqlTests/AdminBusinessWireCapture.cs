using System.Text.Json;
using System.Text.RegularExpressions;
using Xunit;

namespace Shop.SqlTests;
internal static partial class AdminBusinessWireCapture
{
    private static readonly HashSet<string> Forbidden = new(StringComparer.OrdinalIgnoreCase) {
        "accessToken", "refreshToken", "secret", "password", "newPassword", "initialPassword", "passwordHash", "securityStamp", "normalizedEmail"
    };
    internal static async Task SaveAsync(HttpResponseMessage response, string? name, string? kind, object? binding)
    {
        var configured = Environment.GetEnvironmentVariable("SHOP_ADMIN_BUSINESS_WIRE_DIR");
        if (configured is null || name is null) return;
        Assert.Matches(FileName(), name); Assert.NotNull(kind); Assert.NotNull(binding);
        var directory = Path.GetFullPath(configured);
        var workspace = new DirectoryInfo(AppContext.BaseDirectory);
        while (workspace is not null && !File.Exists(Path.Combine(workspace.FullName, "backend/Shop.sln"))) workspace = workspace.Parent;
        Assert.NotNull(workspace);
        var allowed = Path.GetFullPath(Path.Combine(workspace.FullName, "tmp")) + Path.DirectorySeparatorChar;
        Assert.StartsWith(allowed, directory, StringComparison.Ordinal); Assert.Equal("admin-business85-sql-wire", Path.GetFileName(directory));
        Assert.True(Directory.Exists(directory)); Assert.Null(new DirectoryInfo(directory).LinkTarget);
        var bytes = await response.Content.ReadAsByteArrayAsync(); Assert.InRange(bytes.Length, 1, 4194304);
        using var json = JsonDocument.Parse(bytes); Inspect(json.RootElement);
        await using (var output = new FileStream(Path.Combine(directory, name + ".json"), FileMode.CreateNew, FileAccess.Write)) await output.WriteAsync(bytes);
        await File.WriteAllTextAsync(Path.Combine(directory, name + ".meta.json"), JsonSerializer.Serialize(new { Kind = kind, Binding = binding }, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
    }
    private static void Inspect(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Object) foreach (var property in value.EnumerateObject()) { Assert.DoesNotContain(property.Name, Forbidden); Inspect(property.Value); }
        if (value.ValueKind == JsonValueKind.Array) foreach (var item in value.EnumerateArray()) Inspect(item);
    }
    [GeneratedRegex("^[a-z0-9-]{1,80}$", RegexOptions.CultureInvariant)] private static partial Regex FileName();
}
