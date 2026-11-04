using System.Data;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Identity;
using Shop.Modules.Notifications;
using Shop.SharedKernel;

public sealed class DataProtectionSmsWorkspaceProtection(IDataProtectionProvider provider) : ISmsWorkspaceProtection
{
    private static readonly UTF8Encoding Utf8 = new(false, true);
    private IDataProtector Protector(string purpose, string binding)
    {
        if (purpose is not ("key" or "fingerprint" or "receipt" or "message")
            || binding is not { Length: > 0 and <= 256 } || binding.Any(char.IsControl)) throw Invalid();
        return provider.CreateProtector("Sayman.Messaging.SmsWorkspace.v1", purpose, binding);
    }
    private static int Limit(string purpose) => purpose == "receipt" ? 384 * 1024 : 24 * 1024;
    public byte[] Protect(string purpose, string binding, string plaintext)
    {
        var protector = Protector(purpose, binding);
        var bytes = Utf8.GetBytes(plaintext);
        try {
            if (bytes.Length < 1 || bytes.Length > Limit(purpose)) throw Invalid();
            return protector.Protect(bytes);
        } finally { CryptographicOperations.ZeroMemory(bytes); }
    }
    public string Unprotect(string purpose, string binding, byte[] ciphertext)
    {
        if (ciphertext is null || ciphertext.Length < 1 || ciphertext.Length > (purpose == "receipt" ? 512 * 1024 : 32 * 1024)) throw Invalid();
        var bytes = Protector(purpose, binding).Unprotect(ciphertext);
        try {
            if (bytes.Length < 1 || bytes.Length > Limit(purpose)) throw Invalid();
            return Utf8.GetString(bytes);
        } finally { CryptographicOperations.ZeroMemory(bytes); }
    }
    private static CryptographicException Invalid() => new("The private SMS envelope is unavailable.");
}

// Only the composition root shares module connections. Modules exchange their
// contracts and never access another module's DbContext.
public sealed class SmsOtpConfigurationSource(IdentityDbContext identity, NotificationsDbContext notifications,
    SmsDeliveryPlanner planner) : ISmsOtpConfigurationSource
{
    public Task<bool> ExistsAsync(CancellationToken ct) => planner.ExistsAsync(ct);
    public async Task<SmsOtpConfiguration?> ReadAsync(CancellationToken ct)
    {
        var root = identity.Database.CurrentTransaction;
        var attached = false;
        Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction? own = null;
        try {
            if (root is not null) {
                if (notifications.Database.CurrentTransaction is { } existing) {
                    if (!ReferenceEquals(existing.GetDbTransaction(), root.GetDbTransaction())) throw new InvalidOperationException("SMS configuration needs the same transaction.");
                } else {
                    var connection = identity.Database.GetDbConnection(); var previous = notifications.Database.GetDbConnection();
                    if (!ReferenceEquals(connection, previous)) {
                        if (previous.State != ConnectionState.Closed || previous.Database != connection.Database || previous.DataSource != connection.DataSource)
                            throw new InvalidOperationException("SMS configuration needs closed connections to the same database.");
                        notifications.Database.SetDbConnection(connection, contextOwnsConnection: false);
                    }
                    await notifications.Database.UseTransactionAsync(root.GetDbTransaction(), ct); attached = true;
                }
            } else if (notifications.Database.CurrentTransaction is null) {
                own = await notifications.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
            }
            await SmsWorkspaceService.LockAsync(notifications, ct);
            var value = await planner.ReadAsync(ct);
            if (own is not null) await own.CommitAsync(ct);
            return value;
        } finally {
            if (attached) await notifications.Database.UseTransactionAsync(null, CancellationToken.None);
            if (own is not null) await own.DisposeAsync();
        }
    }
}
