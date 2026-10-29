using Shop.Modules.Identity;

public static class FirstAdministratorCommand
{
    public static async Task<bool> RunAsync(IServiceProvider services, IConfiguration configuration, string[] args, CancellationToken ct)
    {
        if (args.Length != 1 || args[0] != "--bootstrap-admin")
            throw new InvalidOperationException("Run --bootstrap-admin alone and supply its settings through environment variables; do not place credentials in command arguments.");
        var userName = configuration["Bootstrap:AdminUserName"];
        var password = configuration["Bootstrap:AdminPassword"];
        var displayName = configuration["Bootstrap:AdminDisplayName"];
        _ = FirstAdministratorRules.Validate(userName, password, displayName);
        await using var scope = services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<AuthService>()
            .BootstrapFirstAdministratorAsync(userName, password, displayName, ct);
    }
}
