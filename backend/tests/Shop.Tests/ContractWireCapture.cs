namespace Shop.Tests;
// Opt-in capture of synthetic test responses; never used by the application.
internal static class ContractWireCapture
{
    public static async Task SaveAsync(string name,string json)
    {
        var directory=Environment.GetEnvironmentVariable("SHOP_ADMIN_CONTRACT_CAPTURE_DIR");if(string.IsNullOrEmpty(directory))return;
        Directory.CreateDirectory(directory);await File.WriteAllTextAsync(Path.Combine(directory,name+".json"),json);
    }
}
