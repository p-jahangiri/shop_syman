using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Cms;

public sealed record PublishedProductAnswer(string Question, string Answer, DateTimeOffset PublishedAt);
internal sealed record RetainedProductAnswer(string TicketId, string CommandId, PublishedProductAnswer Entry);

public sealed class ProductAnswersService(CmsDbContext db, TimeProvider time)
{
    public const string Prefix = "product-answers-";
    public const int Capacity = 50;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private static string Key(string id) => Prefix + ProductHelpRules.Key(id)[ProductHelpRules.Prefix.Length..];

    public async Task<PublishedProductAnswer[]> ReadAsync(string id, string locale, CancellationToken ct)
    {
        var key = Key(id);
        var json = await db.Documents.AsNoTracking()
            .Where(x => x.Key == key && x.Locale == locale)
            .Select(x => x.PublishedJson).SingleOrDefaultAsync(ct);
        return Read(json).Select(row => row.Entry).ToArray();
    }

    public async Task PublishAsync(string id, string locale, string actor, string ticketId, string commandId,
        string question, string answer, bool replayed, CancellationToken ct)
    {
        if (db.Database.CurrentTransaction is null)
            throw new InvalidOperationException("Publishing an answer requires the administrative transaction.");
        if (!ProductHelpRules.ValidText(question, 240) || !ProductHelpRules.ValidText(answer, 1200))
            throw new BusinessException("invalid_product_answer", "Review the public question and answer.");
        var key = Key(id);
        var doc = await db.Documents.SingleOrDefaultAsync(x => x.Key == key && x.Locale == locale, ct);
        var rows = Read(doc?.PublishedJson);
        var previous = rows.FirstOrDefault(x => x.TicketId == ticketId);
        if (replayed)
        {
            if (previous?.CommandId == commandId && (previous.Entry.Question != question || previous.Entry.Answer != answer))
                throw new BusinessException("product_answer_conflict", "This reply was already published with different text.");
            return;
        }

        if (previous is null && rows.Length >= Capacity)
            throw new BusinessException("product_answers_full", "This product has reached its public question limit.");
        var now = time.GetUtcNow().ToUniversalTime();
        var next = new RetainedProductAnswer(ticketId, commandId, new(question, answer, now));
        var json = JsonSerializer.Serialize(rows.Where(x => x.TicketId != ticketId).Prepend(next).ToArray(), Json);
        if (doc is null)
        {
            doc = new ContentDocument { Key = key, Locale = locale };
            db.Documents.Add(doc);
        }
        doc.DraftJson = doc.PublishedJson = json;
        doc.Revision++;
        doc.UpdatedAt = now;
        doc.UpdatedBy = actor;
        db.Revisions.Add(new ContentRevision
        {
            Key = key, Locale = locale, Revision = doc.Revision, Json = json, PublishedBy = actor, PublishedAt = now
        });
        await db.SaveChangesAsync(ct);
    }

    private static RetainedProductAnswer[] Read(string? json) =>
        json is null ? [] : JsonSerializer.Deserialize<RetainedProductAnswer[]>(json, Json) ?? [];
}
