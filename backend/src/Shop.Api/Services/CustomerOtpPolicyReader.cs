using System.Data;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Cms;
using Shop.Modules.Identity;
using Shop.SharedKernel;

// Composition root: CMS retains ownership of the published policy, Identity
// owns the transaction that consumes a challenge or changes SMS availability.
public sealed class CustomerOtpPolicyReader(IdentityDbContext identity, CmsDbContext cms) : ICustomerOtpPolicy
{
    public async Task<CustomerOtpPolicy> ReadAsync(CancellationToken ct)
    {
        var transaction = identity.Database.CurrentTransaction;
        var attachedHere = false;
        if (transaction is not null)
        {
            var root = transaction.GetDbTransaction();
            if (cms.Database.CurrentTransaction is { } existing)
            {
                if (!ReferenceEquals(existing.GetDbTransaction(), root))
                    throw new InvalidOperationException("Customer login policy requires the same administrative transaction.");
            }
            else
            {
                var connection = identity.Database.GetDbConnection();
                var original = cms.Database.GetDbConnection();
                if (!ReferenceEquals(original, connection))
                {
                    if (original.State != ConnectionState.Closed
                        || !string.Equals(original.Database, connection.Database, StringComparison.OrdinalIgnoreCase)
                        || !string.Equals(original.DataSource, connection.DataSource, StringComparison.OrdinalIgnoreCase))
                        throw new InvalidOperationException("Customer login policy requires closed connections to the same database.");
                    cms.Database.SetDbConnection(connection, contextOwnsConnection: false);
                }
                await cms.Database.UseTransactionAsync(root, ct);
                attachedHere = true;
            }
        }

        try
        {
            var documents = transaction is null
                ? cms.Documents.AsNoTracking().Where(x => x.Key == "auth" && x.Locale == "fa")
                : cms.Documents.FromSqlRaw("SELECT * FROM [cms].[Documents] WITH (UPDLOCK,HOLDLOCK) WHERE [Key]=N'auth' AND [Locale]=N'fa'").AsNoTracking();
            var raw = await documents.Select(x => x.PublishedJson).SingleOrDefaultAsync(ct);
            if (raw is null) return new(false, false, false, false);
            if (raw.Length > 8000) throw Unavailable();
            using var parsed = JsonDocument.Parse(raw, new JsonDocumentOptions { MaxDepth = 4 });
            if (parsed.RootElement.ValueKind != JsonValueKind.Object) throw Unavailable();
            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in parsed.RootElement.EnumerateObject())
                if (!names.Add(property.Name) || property.Name is not ("mobileOtp" or "registration" or "emailPassword" or "usernamePassword" or "passwordReset")
                    || property.Value.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) throw Unavailable();
            bool Flag(string name) => parsed.RootElement.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.True;
            return new(Flag("mobileOtp"), Flag("registration"), Flag("emailPassword"), Flag("usernamePassword"));
        }
        catch (JsonException) { throw Unavailable(); }
        finally
        {
            if (attachedHere) await cms.Database.UseTransactionAsync(null, CancellationToken.None);
        }
    }

    private static BusinessException Unavailable() => new("otp_unavailable", "Customer SMS sign-in is unavailable.");
}
