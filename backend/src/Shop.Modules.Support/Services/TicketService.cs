using System.Data;
using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;
namespace Shop.Modules.Support;

public sealed partial class TicketService(SupportDbContext db, ITicketProtection protection, TimeProvider time, TicketOptions options, IPrivateNotificationWriter notifications, IPrivateRealtimeEvents realtime)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { MaxDepth = 16 };
    private static BusinessException Missing() => new("not_found", "Support record not found.");
    private static BusinessException Conflict() => new("ticket_version_conflict", "Ticket changed or its current state does not allow this command.");
    public async Task<TicketPage> PageAsync(string actor, bool staff, string? state, string? cursor, CancellationToken ct, string? ticketId = null, int pageSize = 50)
    {
        actor = TicketRules.Actor(actor);
        state = TicketRules.State(state);
        if (ticketId is not null)
        {
            // Tracking IDs are exact lookups across all queues. Never index or bulk decrypt subjects.
            if (!staff || state is not null || cursor is not null) throw TicketRules.Invalid();
            ticketId = TicketRules.Id(ticketId);
        }

        if (pageSize != 50 && (staff || pageSize != 12 || state is not null)) throw TicketRules.Invalid();
        var scope = $"tickets|{(staff ? "support" : actor)}|{state}" + (pageSize == 50 ? "" : "|product-questions");
        var before = TicketRules.Cursor(cursor, scope, false);
        var query = db.Tickets.AsNoTracking().Where(x => x.Sequence < before);
        if (!staff) query = query.Where(x => x.OwnerId == actor);
        if (state is not null) query = query.Where(x => x.State == state);
        if (ticketId is not null) query = query.Where(x => x.Id == ticketId);
        var rows = await query.OrderByDescending(x => x.Sequence).Take(pageSize+1).ToArrayAsync(ct);
        var selected = rows.Take(pageSize).ToArray();

        TicketQueueCounts? queueCounts = null;
        if (staff && cursor is null)
        {
            var counts = await db.Tickets.AsNoTracking().GroupBy(x => x.State)
                .Select(group => new { State = group.Key, Count = group.Count() })
                .ToDictionaryAsync(x => x.State, x => x.Count, ct);
            queueCounts = new(counts.GetValueOrDefault("Open"), counts.GetValueOrDefault("WaitingCustomer"), counts.GetValueOrDefault("Closed"));
        }

        return new(1, state, selected.Select(Summary).ToArray(), rows.Length > pageSize ? TicketRules.Cursor(selected[^1].Sequence, scope) : null, queueCounts);
    }
    public async Task<TicketDetail> DetailAsync(string actor, bool staff, string ticketId, CancellationToken ct) => new(1, Summary(await VisibleAsync(actor, staff, ticketId, false, ct)));
    public async Task<TicketMessagePage> MessagesAsync(string actor, bool staff, string ticketId, string? cursor, CancellationToken ct)
    {
        actor = TicketRules.Actor(actor); await VisibleAsync(actor, staff, ticketId, false, ct); var scope = $"messages|{(staff ? "support" : actor)}|{ticketId}"; var after = TicketRules.Cursor(cursor, scope, true);
        var rows = await db.Messages.AsNoTracking().Where(x => x.TicketId == ticketId && x.Sequence > after).OrderBy(x => x.Sequence).Take(51).ToArrayAsync(ct);
        var selected = rows.Take(50).ToArray(); var items = selected.Select(x => {
            if (x.Author is not ("customer" or "support") || x.Sequence <= 0 || x.At.Offset != TimeSpan.Zero) throw TicketRules.Unavailable();
            var body = protection.Unprotect(ticketId, "message", x.Id, x.ProtectedBody);
            try { TicketRules.Id(x.Id); TicketRules.Locale(x.Locale); if (TicketRules.Text(body, 1, 4000) != body) throw TicketRules.Unavailable(); } catch (BusinessException) { throw TicketRules.Unavailable(); }
            return new TicketMessageData(x.Id, x.Sequence.ToString(CultureInfo.InvariantCulture), x.Author, x.Locale, body, x.At);
        }).ToArray();
        return new(1, ticketId, items, rows.Length > 50 ? TicketRules.Cursor(selected[^1].Sequence, scope) : null);
    }
    public async Task<(string Question, string? Reply)> ProductQuestionMessagesAsync(string actor, string id, CancellationToken ct)
    {
        await VisibleAsync(actor, false, id, false, ct);
        var messages = db.Messages.AsNoTracking().Where(m => m.TicketId == id);
        var first = await messages.Where(m => m.Author == "customer").OrderBy(m => m.Sequence).FirstAsync(ct);
        var reply = await messages.Where(m => m.Author == "support").OrderByDescending(m => m.Sequence).FirstOrDefaultAsync(ct);
        return (protection.Unprotect(id, "message", first.Id, first.ProtectedBody),
            reply is null ? null : protection.Unprotect(id, "message", reply.Id, reply.ProtectedBody));
    }

    public Task<TicketCommandResult> CreateAsync(string actor, string commandId, CreateTicketInput input, CancellationToken ct)
    {
        actor = TicketRules.Actor(actor); input = input with { Subject = TicketRules.Text(input.Subject, 1, 120, true), Body = TicketRules.Text(input.Body, 1, 4000), Locale = TicketRules.Locale(input.Locale) };
        if (input.Subject.StartsWith("[product-question] ", StringComparison.Ordinal))
        {
            var parts = input.Body.Split("\n\n", 2, StringSplitOptions.None);
            var question = parts.Length == 2 ? parts[1] : "";
            if (question.StartsWith("[public-name] ", StringComparison.Ordinal))
                question = question.Split("\n\n", 2, StringSplitOptions.None).ElementAtOrDefault(1) ?? "";
            if (question.Trim().Length is < 10 or > 240) throw TicketRules.Invalid();
        }
        return CommandAsync(actor, false, commandId, null, new { Operation = "create", Input = input }, async () => {
            await CapacityAsync(actor, ct); var now = time.GetUtcNow().ToUniversalTime(); var row = new SupportTicket { OwnerId = actor, Locale = input.Locale, MessageCount = 1, CreatedAt = now, ChangedAt = now };
            row.ProtectedSubject = protection.Protect(row.Id, "subject", row.Id, input.Subject); db.Tickets.Add(row); var message = Message(row, actor, false, input.Body, input.Locale, now); Event(row, actor, "Created", now);
            await db.SaveChangesAsync(ct); realtime.SupportChanged(row.OwnerId); return new(1, false, commandId, Summary(row), message.Id);
        }, ct);
    }
    public Task<TicketCommandResult> ReplyAsync(string actor, bool staff, string ticketId, string commandId, ReplyTicketInput input, CancellationToken ct)
    {
        actor = TicketRules.Actor(actor); TicketRules.Id(ticketId); TicketRules.Version(input.Version); input = input with { Body = TicketRules.Text(input.Body, 1, 4000), Locale = TicketRules.Locale(input.Locale) };
        return CommandAsync(actor, staff, commandId, ticketId, new { Operation = "reply", Staff = staff, TicketId = ticketId, Input = input }, async () => {
            var row = await VisibleAsync(actor, staff, ticketId, true, ct); Match(row, input.Version); if (row.State == "Closed") throw Conflict();
            if (row.MessageCount == int.MaxValue) throw Conflict(); var now = time.GetUtcNow().ToUniversalTime(); row.MessageCount++; row.State = staff ? "WaitingCustomer" : "Open"; row.ChangedAt = now;
            var message = Message(row, actor, staff, input.Body, input.Locale, now); var changed = Event(row, actor, "Replied", now); await db.SaveChangesAsync(ct); if(staff)await notifications.RecordSupportAsync(new(row.OwnerId,row.Id,changed.Sequence,"support_reply",now),ct); realtime.SupportChanged(row.OwnerId); return new(1, false, commandId, Summary(row), message.Id);
        }, ct);
    }
    public Task<TicketCommandResult> StateAsync(string actor, bool staff, string ticketId, string commandId, ChangeTicketStateInput input, CancellationToken ct)
    {
        actor = TicketRules.Actor(actor); TicketRules.Id(ticketId); TicketRules.Version(input.Version); if (input.State is not ("Open" or "Closed")) throw TicketRules.Invalid();
        return CommandAsync(actor, staff, commandId, ticketId, new { Operation = "state", Staff = staff, TicketId = ticketId, Input = input }, async () => {
            var row = await VisibleAsync(actor, staff, ticketId, true, ct); Match(row, input.Version);
            if (input.State == "Closed" && row.State == "Closed" || input.State == "Open" && row.State != "Closed") throw Conflict();
            if (input.State == "Open") await CapacityAsync(row.OwnerId, ct); var now = time.GetUtcNow().ToUniversalTime(); row.State = input.State; row.ChangedAt = now; var changed=Event(row, actor, input.State == "Closed" ? "Closed" : "Reopened", now); await db.SaveChangesAsync(ct); if(staff)await notifications.RecordSupportAsync(new(row.OwnerId,row.Id,changed.Sequence,input.State=="Closed"?"support_closed":"support_reopened",now),ct); realtime.SupportChanged(row.OwnerId); return new(1, false, commandId, Summary(row), null);
        }, ct);
    }
    public async Task<TicketCommandResult> ReceiptAsync(string actor, bool staff, string commandId, CancellationToken ct)
    {
        actor = TicketRules.Actor(actor); TicketRules.Id(commandId); var audience = staff ? "support" : "customer";
        var row = await db.Commands.AsNoTracking().SingleOrDefaultAsync(x => x.ActorId == actor && x.CommandId == commandId && x.Audience == audience, ct) ?? throw Missing();
        await VisibleAsync(actor, staff, row.TicketId, false, ct); return Receipt(row) with { Replayed = true };
    }
    private async Task<TicketCommandResult> CommandAsync(string actor, bool staff, string commandId, string? ticketId, object input, Func<Task<TicketCommandResult>> work, CancellationToken ct)
    {
        TicketRules.Id(commandId); var hash = TicketRules.Hash(JsonSerializer.Serialize(input, Json)); var own = db.Database.CurrentTransaction is null;
        if (staff && own) throw new InvalidOperationException("Staff support commands require the root Serializable audit transaction.");
        await using var owned = own ? await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct) : null; var transaction = db.Database.CurrentTransaction ?? throw new InvalidOperationException("Support transaction required.");
        if (transaction.GetDbTransaction().IsolationLevel != IsolationLevel.Serializable) throw new InvalidOperationException("Support commands require Serializable isolation.");
        // A single bounded module gate also serializes per-owner capacity checks with staff reopen.
        // It touches no other domain and can be partitioned after measured production load.
        await using (var command = db.Database.GetDbConnection().CreateCommand()) {
            command.Transaction = transaction.GetDbTransaction(); command.CommandTimeout = 15; command.CommandText = "DECLARE @r int; EXEC @r=sys.sp_getapplock @Resource=N'sayman:support:commands:v1',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @r;";
            if (Convert.ToInt32(await command.ExecuteScalarAsync(ct), CultureInfo.InvariantCulture) < 0) throw new BusinessException("ticket_busy", "Support is busy. Retry the same command.");
        }
        var previous = await db.Commands.FromSqlInterpolated($"SELECT * FROM [support].[Commands] WITH (READCOMMITTEDLOCK) WHERE [ActorId]={actor} AND [CommandId]={commandId}").AsNoTracking().SingleOrDefaultAsync(ct);
        if (previous is not null) {
            if (previous.PayloadHash != hash || previous.Audience != (staff ? "support" : "customer") || ticketId is not null && previous.TicketId != ticketId) throw new BusinessException("ticket_idempotency_conflict", "This command id was already used with different details.");
            return Receipt(previous) with { Replayed = true };
        }
        var result = await work(); var raw = JsonSerializer.Serialize(result, Json); var row = new TicketCommand { ActorId = actor, Audience = staff ? "support" : "customer", CommandId = commandId, TicketId = result.Ticket.Id, PayloadHash = hash, ResultHash = TicketRules.Hash(raw), At = time.GetUtcNow().ToUniversalTime() };
        row.ProtectedResult = protection.Protect(row.TicketId, "receipt", TicketRules.Hash(actor + ":" + commandId), raw); db.Commands.Add(row); await db.SaveChangesAsync(ct); if (owned is not null) await owned.CommitAsync(ct); return result;
    }
    private async Task<SupportTicket> VisibleAsync(string actor, bool staff, string ticketId, bool tracking, CancellationToken ct)
    {
        actor = TicketRules.Actor(actor); TicketRules.Id(ticketId); var q = tracking ? db.Tickets.AsQueryable() : db.Tickets.AsNoTracking();
        return await q.SingleOrDefaultAsync(x => x.Id == ticketId && (staff || x.OwnerId == actor), ct) ?? throw Missing();
    }
    private async Task CapacityAsync(string owner, CancellationToken ct)
    {
        if (options.MaxOpenPerOwner is < 1 or > 100) throw new InvalidOperationException("Support capacity must be between 1 and 100.");
        if (await db.Tickets.CountAsync(x => x.OwnerId == owner && x.State != "Closed", ct) >= options.MaxOpenPerOwner) throw new BusinessException("ticket_capacity", "Close an existing ticket before opening another.");
    }
    private TicketSummary Summary(SupportTicket row)
    {
        try {
            TicketRules.Id(row.Id); TicketRules.Locale(row.Locale); TicketRules.State(row.State); if (row.Version.Length != 8 || row.MessageCount < 1 || row.CreatedAt.Offset != TimeSpan.Zero || row.ChangedAt.Offset != TimeSpan.Zero) throw TicketRules.Unavailable();
            var subject = protection.Unprotect(row.Id, "subject", row.Id, row.ProtectedSubject); if (TicketRules.Text(subject, 1, 120, true) != subject) throw TicketRules.Unavailable();
            return new(row.Id, subject, row.Locale, row.State, Convert.ToBase64String(row.Version), row.MessageCount, row.CreatedAt, row.ChangedAt);
        } catch (BusinessException) { throw TicketRules.Unavailable(); }
    }
    private TicketCommandResult Receipt(TicketCommand row)
    {
        try {
            var raw = protection.Unprotect(row.TicketId, "receipt", TicketRules.Hash(row.ActorId + ":" + row.CommandId), row.ProtectedResult); if (TicketRules.Hash(raw) != row.ResultHash) throw TicketRules.Unavailable();
            var result = JsonSerializer.Deserialize<TicketCommandResult>(raw, Json) ?? throw TicketRules.Unavailable();
            if (result.SchemaVersion != 1 || result.Replayed || result.CommandId != row.CommandId || result.Ticket.Id != row.TicketId) throw TicketRules.Unavailable();
            return result;
        } catch (Exception e) when (e is JsonException or NotSupportedException) { throw TicketRules.Unavailable(); }
    }
    private TicketMessage Message(SupportTicket row, string actor, bool staff, string body, string locale, DateTimeOffset at)
    {
        var message = new TicketMessage { TicketId = row.Id, ActorId = actor, Author = staff ? "support" : "customer", Locale = locale, At = at }; message.ProtectedBody = protection.Protect(row.Id, "message", message.Id, body); db.Messages.Add(message); return message;
    }
    private TicketEvent Event(SupportTicket row, string actor, string action, DateTimeOffset at) { var value=new TicketEvent { TicketId=row.Id,ActorId=actor,Action=action,State=row.State,At=at };db.Events.Add(value);return value; }
    private static void Match(SupportTicket row, string version) { if (Convert.ToBase64String(row.Version) != version) throw Conflict(); }
}
