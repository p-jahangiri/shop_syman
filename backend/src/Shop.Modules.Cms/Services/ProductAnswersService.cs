using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Cms;

public sealed record ProductQuestionReply(string Id, string Body, string? DisplayName, bool ByStore, DateTimeOffset At);
public sealed record PublishedProductAnswer(string Question, string Answer, DateTimeOffset PublishedAt,
    string? Id = null, string? DisplayName = null, ProductQuestionReply[]? Replies = null);
public sealed record ModeratedProductReply(ProductQuestionReply Reply, string State);
public sealed record StaffProductQuestion(PublishedProductAnswer Question, ModeratedProductReply[] Replies);
internal sealed record RetainedProductAnswer(string TicketId, string CommandId, PublishedProductAnswer Entry,
    RetainedProductReply[]? Posts = null);
internal sealed record RetainedProductReply(string Actor, string CommandId, ProductQuestionReply Reply, string State);

public sealed class ProductAnswersService(CmsDbContext db, TimeProvider time)
{
    public const string Prefix = "product-answers-";
    private const int Capacity = 50;
    private const int ReplyCapacity = 40;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private static string Key(string id) => Prefix + ProductHelpRules.Key(id)[ProductHelpRules.Prefix.Length..];

    private static string ThreadId(string ticketId) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(Prefix + ticketId)))[..32];

    public async Task<PublishedProductAnswer[]> ReadAsync(string id, string locale, CancellationToken ct) =>
        (await ReadAsyncCore(id, locale, ct)).Select(Public).ToArray();

    public async Task<StaffProductQuestion?> ReadForTicketAsync(string id, string locale, string ticketId, CancellationToken ct)
    {
        var row = (await ReadAsyncCore(id, locale, ct)).SingleOrDefault(x => x.TicketId == ticketId);
        return row is null ? null : new(Public(row), Posts(row).Select(x => new ModeratedProductReply(x.Reply, x.State)).ToArray());
    }

    private async Task<RetainedProductAnswer[]> ReadAsyncCore(string id, string locale, CancellationToken ct)
    {
        var key = Key(id);
        var json = await db.Documents.AsNoTracking()
            .Where(x => x.Key == key && x.Locale == locale)
            .Select(x => x.PublishedJson).SingleOrDefaultAsync(ct);
        return Read(json);
    }

    public async Task PublishAsync(string id, string locale, string actor, string ticketId, string commandId,
        string question, string answer, string? displayName, bool ticketVersionMatches, bool replayed, CancellationToken ct)
    {
        if (db.Database.CurrentTransaction is null)
            throw new InvalidOperationException("Publishing a question requires the administrative transaction.");
        if (!ProductHelpRules.ValidText(question, 240) || answer.Length > 0 && !ProductHelpRules.ValidText(answer, 1200))
            throw Invalid();
        var key = Key(id);
        var doc = await LockedDocument(key, locale, ct);
        var rows = Read(doc?.PublishedJson);
        var previous = rows.SingleOrDefault(x => x.TicketId == ticketId);
        var posts = previous is null ? [] : Posts(previous);
        if (previous is not null && (previous.CommandId == commandId || posts.Any(p => p.ByCommand(actor, commandId))))
        {
            var existing = previous.CommandId == commandId
                ? previous.Entry.Answer
                : posts.Single(p => p.ByCommand(actor, commandId)).Reply.Body;
            if (previous.Entry.Question != question || existing != answer) throw Conflict();
            return;
        }
        if (replayed) throw Conflict();
        if (!ticketVersionMatches) throw Conflict();
        if (previous is null && rows.Length >= Capacity)
            throw new BusinessException("product_answers_full", "This product has reached its public question limit.");
        if (previous is not null && (previous.Entry.Question != question || answer.Length == 0)) throw Conflict();

        var now = time.GetUtcNow().ToUniversalTime();
        var next = previous ?? new RetainedProductAnswer(ticketId, commandId,
            new(question, answer, now, DisplayName: DisplayName(displayName)));
        if (answer.Length > 0)
            next = next with { Posts = Append(posts, new(actor, commandId,
                new(Guid.NewGuid().ToString("N"), answer, null, true, now), "Published")) };
        await Save(doc, key, locale, actor, Replace(rows, previous, next), now, ct);
    }

    public async Task SubmitReplyAsync(string id, string locale, string threadId, string actor, string commandId,
        string body, string? displayName, CancellationToken ct)
    {
        ValidateId(threadId);
        ValidateId(commandId);
        if (!ProductHelpRules.ValidText(body, 1200)) throw Invalid();
        displayName = DisplayName(displayName);
        var key = Key(id);
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var doc = await LockedDocument(key, locale, ct);
        var rows = Read(doc?.PublishedJson);
        var row = rows.SingleOrDefault(x => ThreadId(x.TicketId) == threadId) ?? throw Missing();
        var posts = Posts(row);
        var previous = posts.SingleOrDefault(p => p.ByCommand(actor, commandId));
        if (previous is not null)
        {
            if (previous.Reply.Body != body || previous.Reply.DisplayName != displayName) throw Conflict();
            return;
        }

        var now = time.GetUtcNow().ToUniversalTime();
        var next = row with { Posts = Append(posts, new(actor, commandId,
            new(Guid.NewGuid().ToString("N"), body, displayName, false, now), "Pending")) };
        await Save(doc, key, locale, actor, Replace(rows, row, next), now, ct);
        await transaction.CommitAsync(ct);
    }

    public async Task ModerateAsync(string id, string locale, string ticketId, string actor, string replyId,
        bool publish, CancellationToken ct)
    {
        if (db.Database.CurrentTransaction is null)
            throw new InvalidOperationException("Moderating a reply requires the administrative transaction.");
        ValidateId(replyId);
        var key = Key(id);
        var doc = await LockedDocument(key, locale, ct);
        var rows = Read(doc?.PublishedJson);
        var row = rows.SingleOrDefault(x => x.TicketId == ticketId) ?? throw Missing();
        var posts = Posts(row);
        var reply = posts.SingleOrDefault(x => x.Reply.Id == replyId && !x.Reply.ByStore) ?? throw Missing();
        var state = publish ? "Published" : "Rejected";
        if (reply.State == state) return;
        if (publish && reply.State != "Pending") throw Conflict();
        var next = row with { Posts = posts.Select(x => x == reply ? reply with { State = state } : x).ToArray() };
        await Save(doc, key, locale, actor, Replace(rows, row, next), time.GetUtcNow().ToUniversalTime(), ct);
    }

    private Task<ContentDocument?> LockedDocument(string key, string locale, CancellationToken ct) =>
        db.Documents.FromSqlInterpolated($"""
            SELECT * FROM [cms].[Documents] WITH (UPDLOCK,HOLDLOCK) WHERE [Key]={key} AND [Locale]={locale}
            """).SingleOrDefaultAsync(ct);

    private async Task Save(ContentDocument? doc, string key, string locale, string actor,
        RetainedProductAnswer[] rows, DateTimeOffset now, CancellationToken ct)
    {
        var json = JsonSerializer.Serialize(rows, Json);
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

    private static RetainedProductAnswer[] Replace(RetainedProductAnswer[] rows, RetainedProductAnswer? previous,
        RetainedProductAnswer next) => previous is null ? [next, .. rows] : rows.Select(x => x == previous ? next : x).ToArray();

    private static RetainedProductReply[] Append(RetainedProductReply[] posts, RetainedProductReply reply) =>
        posts.Length < ReplyCapacity ? [.. posts, reply] : throw new BusinessException("product_answers_full", "This question has reached its reply limit.");

    private static RetainedProductReply[] Posts(RetainedProductAnswer row) => row.Posts ??
        (row.Entry.Answer.Length == 0 ? [] :
            [new("", row.CommandId, new(ThreadId(row.TicketId), row.Entry.Answer, null, true, row.Entry.PublishedAt), "Published")]);

    private static PublishedProductAnswer Public(RetainedProductAnswer row) => row.Entry with
    {
        Id = ThreadId(row.TicketId),
        Replies = Posts(row).Where(x => x.State == "Published").Select(x => x.Reply).ToArray()
    };

    public static string? DisplayName(string? value)
    {
        value = value?.Trim();
        if (string.IsNullOrEmpty(value)) return null;
        if (!ProductHelpRules.ValidText(value, 60) || value.Any(c => char.IsControl(c) || char.IsDigit(c) || c == '@'))
            throw Invalid();
        return value;
    }

    private static void ValidateId(string id)
    {
        if (!Guid.TryParseExact(id, "N", out var guid) || id != guid.ToString("N")) throw Invalid();
    }

    private static RetainedProductAnswer[] Read(string? json) =>
        json is null ? [] : JsonSerializer.Deserialize<RetainedProductAnswer[]>(json, Json) ?? [];

    private static BusinessException Invalid() => new("invalid_product_answer", "Review the question, reply and public display name.");
    private static BusinessException Conflict() => new("product_answer_conflict", "This question or reply has changed. Refresh and try again.");
    private static BusinessException Missing() => new("not_found", "The public question or reply was not found.");
}

internal static class ProductReplyCommands
{
    internal static bool ByCommand(this RetainedProductReply post, string actor, string commandId) =>
        post.Actor == actor && post.CommandId == commandId;
}
