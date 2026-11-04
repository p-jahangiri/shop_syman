using System.Data;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Cms;
using Shop.Modules.Identity;

// Explicit local CLI, never an HTTP endpoint or a startup/production seed.
public static class DevelopmentStoreIdentitySeed
{
    public static async Task<object> RunAsync(IServiceProvider services, IHostEnvironment environment, bool apply, CancellationToken ct)
    {
        if (!environment.IsDevelopment()) throw new InvalidOperationException("Store identity examples are unavailable outside Development.");
        var db = services.GetRequiredService<CmsDbContext>();
        var identity = services.GetRequiredService<IdentityDbContext>();
        var cms = services.GetRequiredService<ContentService>();
        var connection = db.Database.GetDbConnection();
        if (connection.Database != "Sayman" && !System.Text.RegularExpressions.Regex.IsMatch(connection.Database, "^SaymanTest_[a-f0-9]{32}$"))
            throw new InvalidOperationException("Select the canonical local shop or a disposable SQL test fixture.");
        if (connection.DataSource != "127.0.0.1,11433") throw new InvalidOperationException("Store identity examples require the existing local SQL service.");
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var original = identity.Database.GetDbConnection();
        if (original.State != ConnectionState.Closed || original.Database != connection.Database || original.DataSource != connection.DataSource)
            throw new InvalidOperationException("Store identity modules must use closed connections to the same database.");
        identity.Database.SetDbConnection(connection, contextOwnsConnection: false);
        await identity.Database.UseTransactionAsync(transaction.GetDbTransaction(), ct);
        try
        {
            var documents = await db.Documents.Where(d => d.Key == "site").OrderBy(d => d.Locale).ToListAsync(ct);
            if (documents.Count != 2 || documents.Any(d => d.Locale is not ("fa" or "en"))) throw new InvalidOperationException("Both existing site languages are required.");
            var changes = new List<(ContentDocument Document, JsonObject Content)>();
            foreach (var document in documents)
            {
                var content = JsonNode.Parse(document.DraftJson)!.AsObject();
                var published = JsonNode.Parse(document.PublishedJson ?? throw new InvalidOperationException("A published site is required."));
                if (!JsonNode.DeepEquals(content, published)) throw new InvalidOperationException("An unpublished site draft exists. Preserve it and manage store identity from the admin.");
                // Never replace real links, an existing demo, or a removed/disabled owner's choice.
                if (content.ContainsKey("storeIdentity")) continue;
                content["storeIdentity"] = Example(document.Locale);
                ContentService.Validate("site", document.Locale, content);
                changes.Add((document, content));
            }
            if (apply)
            {
                const string actor = "development-seed:store-identity";
                foreach (var (document, content) in changes)
                {
                    await cms.SaveAsync("site", document.Locale, new(content, Convert.ToBase64String(document.Version)), actor, ct);
                    await cms.PublishAsync("site", document.Locale, Convert.ToBase64String(document.Version), actor, null, ct);
                    identity.Audit.Add(new AuditEvent { ActorId = actor, Action = "DevelopmentExample", Resource = $"cms/site/{document.Locale}/storeIdentity", TraceId = "explicit-local-cli" });
                }
                await identity.SaveChangesAsync(ct);
                await transaction.CommitAsync(ct);
            }
            return new { Applied = apply, ChangedLanguages = changes.Count, ExistingIdentityPreserved = documents.Count - changes.Count, RealCertificationsCreated = 0, SocialAccountsCreated = 0 };
        }
        finally { await identity.Database.UseTransactionAsync(null, CancellationToken.None); }
    }

    private static JsonObject Example(string locale)
    {
        var fa = locale == "fa";
        var socials = new JsonArray();
        foreach (var platform in new[] { "instagram", "telegram", "whatsapp", "aparat", "linkedin" })
            socials.Add(new JsonObject { ["platform"] = platform, ["url"] = "", ["enabled"] = false });
        return new JsonObject
        {
            ["demonstration"] = true,
            ["socialLinks"] = socials,
            ["badges"] = new JsonArray(
                new JsonObject { ["id"] = "enamad", ["kind"] = "enamad", ["title"] = fa ? "نماد اعتماد الکترونیکی" : "eNAMAD", ["verificationUrl"] = "", ["enabled"] = false },
                new JsonObject { ["id"] = "store-license", ["kind"] = "license", ["title"] = fa ? "مجوز فروشگاه" : "Store license", ["verificationUrl"] = "", ["enabled"] = false }),
            ["policyLinks"] = new JsonArray(new JsonObject { ["id"] = "purchase-policies", ["title"] = fa ? "شرایط خرید، ارسال و مرجوعی" : "Purchase, shipping and returns", ["href"] = "/support", ["enabled"] = true })
        };
    }
}
