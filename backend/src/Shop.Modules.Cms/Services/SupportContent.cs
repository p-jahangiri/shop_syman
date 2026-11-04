using System.Text;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;
namespace Shop.Modules.Cms;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SupportFaqDraft(string Id, string Question, string Answer, bool Enabled,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.WhenWritingNull)] string? PurchaseMethodKind = null);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SupportContentDraft(int SchemaVersion, bool IsDemo, string Eyebrow, string Title, string Description, string TicketsAction, string FaqTitle, string FaqDescription, SupportFaqDraft[] Faqs);
public sealed record SupportFaqPublic(string Id, string Question, string Answer,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.WhenWritingNull)] string? PurchaseMethodKind = null);
public sealed record SupportContentPublic(bool IsDemo, string Eyebrow, string Title, string Description, string TicketsAction, string FaqTitle, string FaqDescription, SupportFaqPublic[] Faqs);
public sealed record SupportContentRevision(int SchemaVersion, string Locale, string RevisionId, int Revision, SupportContentDraft Content);
public sealed record SupportContentPage(int SchemaVersion, string Locale, int Revision, [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] SupportContentPublic? Content);

public static class SupportContentRules
{
    private static readonly string[] Keys = ["schemaVersion", "isDemo", "eyebrow", "title", "description", "ticketsAction", "faqTitle", "faqDescription", "faqs"];
    private static readonly string[] FaqKeys = ["id", "question", "answer", "enabled"];
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { PropertyNameCaseInsensitive = false, NumberHandling = JsonNumberHandling.Strict, UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow, MaxDepth = 8 };
    public static BusinessException Invalid() => new("invalid_support_content", "Provide bounded plain support content and unique FAQ ids in the selected language.");
    public static BusinessException Unavailable() => new("support_content_unavailable", "Published support content could not be read safely.");
    public static SupportContentDraft Read(JsonObject value)
    {
        try {
            if (value.Count != Keys.Length || value.Any(x => !Keys.Contains(x.Key, StringComparer.Ordinal)) || JsonSerializer.SerializeToUtf8Bytes(value).Length > 100000 || value["faqs"] is not JsonArray faqs || faqs.Count > 30) throw Invalid();
            foreach (var node in faqs) {
                if (node is not JsonObject item || item.Count < FaqKeys.Length || item.Count > FaqKeys.Length + 1
                    || FaqKeys.Any(key => !item.ContainsKey(key))
                    || item.Any(x => !FaqKeys.Contains(x.Key, StringComparer.Ordinal) && x.Key != "purchaseMethodKind")) throw Invalid();
                if (item.TryGetPropertyValue("purchaseMethodKind", out var dependency)
                    && (dependency is not JsonValue text || !text.TryGetValue<string>(out var kind) || !SitePurchaseRules.IsSupportedKind(kind))) throw Invalid();
            }
            var content = value.Deserialize<SupportContentDraft>(Json) ?? throw Invalid(); if (content.SchemaVersion != 1 || content.Faqs is null || content.Faqs.Length != faqs.Count) throw Invalid();
            Text(content.Eyebrow, 0, 140, true); Text(content.Title, 1, 200, true); Text(content.Description, 0, 1000); Text(content.TicketsAction, 1, 100, true); Text(content.FaqTitle, 1, 150, true); Text(content.FaqDescription, 0, 1000);
            var ids = new HashSet<string>(StringComparer.Ordinal);
            foreach (var item in content.Faqs) {
                if (item is null || item.Id is null || !Guid.TryParseExact(item.Id, "N", out var id) || id == Guid.Empty || item.Id != id.ToString("N") || !ids.Add(item.Id)) throw Invalid();
                Text(item.Question, 1, 240, true); Text(item.Answer, 1, 4000);
            }
            return content;
        } catch (Exception e) when (e is JsonException or InvalidOperationException or ArgumentException) { throw Invalid(); }
    }
    private static void Text(string value, int min, int max, bool singleLine = false)
    {
        if (value is null || value.Length < min || value.Length > max || value.Trim() != value || value.Any(c => char.IsControl(c) && c is not ('\n' or '\t') || c is '\u202a' or '\u202b' or '\u202c' or '\u202d' or '\u202e' or '\u2066' or '\u2067' or '\u2068' or '\u2069') || singleLine && value.Any(c => c is '\n' or '\t')) throw Invalid();
        try { _ = new UTF8Encoding(false, true).GetByteCount(value); } catch (EncoderFallbackException) { throw Invalid(); }
    }
}

public sealed class SupportContentReader(CmsDbContext db, bool showDevelopmentSamples)
{
    public async Task<SupportContentPage> ReadAsync(string locale, CancellationToken ct)
    {
        if (locale is not ("fa" or "en")) throw new BusinessException("invalid_locale", "Use fa or en.");
        var row = await db.Documents.AsNoTracking().Where(x => x.Key == "support" && x.Locale == locale).Select(x => new { x.Revision, Published = x.PublishedJson != null, Oversized = x.PublishedJson != null && EF.Functions.DataLength(x.PublishedJson) > 200000, Json = x.PublishedJson != null && EF.Functions.DataLength(x.PublishedJson) <= 200000 ? x.PublishedJson : null }).SingleOrDefaultAsync(ct);
        if (row is null || !row.Published) return new(1, locale, 0, null);
        try {
            if (row.Oversized || row.Revision < 1 || row.Json is null || JsonNode.Parse(row.Json) is not JsonObject value) throw SupportContentRules.Unavailable();
            var draft = SupportContentRules.Read(value); if (draft.IsDemo && !showDevelopmentSamples) return new(1, locale, 0, null);
            var content = new SupportContentPublic(draft.IsDemo, draft.Eyebrow, draft.Title, draft.Description, draft.TicketsAction, draft.FaqTitle, draft.FaqDescription, draft.Faqs.Where(x => x.Enabled).Select(x => new SupportFaqPublic(x.Id, x.Question, x.Answer, x.PurchaseMethodKind)).ToArray());
            return new(1, locale, row.Revision, content);
        } catch (Exception e) when (e is BusinessException or JsonException or InvalidOperationException) { throw SupportContentRules.Unavailable(); }
    }
    public async Task<SupportContentRevision> RevisionAsync(string locale, string revisionId, CancellationToken ct)
    {
        if (locale is not ("fa" or "en") || !long.TryParse(revisionId, NumberStyles.None, CultureInfo.InvariantCulture, out var id) || id <= 0 || id.ToString(CultureInfo.InvariantCulture) != revisionId) throw new BusinessException("invalid_content_revision", "Use the exact revision id for this support document and language.");
        var row = await db.Revisions.AsNoTracking().Where(x => x.Key == "support" && x.Locale == locale && x.Id == id).Select(x => new { x.Revision, Json = EF.Functions.DataLength(x.Json) <= 200000 ? x.Json : null }).SingleOrDefaultAsync(ct) ?? throw new BusinessException("not_found", "Support content revision was not found.");
        try {
            if (row.Revision < 1 || row.Json is null || JsonNode.Parse(row.Json) is not JsonObject value) throw SupportContentRules.Unavailable();
            return new(1, locale, revisionId, row.Revision, SupportContentRules.Read(value));
        } catch (Exception e) when (e is BusinessException or JsonException or InvalidOperationException) { throw SupportContentRules.Unavailable(); }
    }

}
