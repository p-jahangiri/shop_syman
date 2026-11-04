using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Notifications;

internal sealed record SmsQueuedPayload(SmsBusinessEvent? Event, string? TestTemplate, string? TestMobile);
public sealed class SmsMessageService(NotificationsDbContext db, ISmsWorkspaceProtection protection,
    SmsDeliveryPlanner planner, ISmsVerifiedRecipientReader recipients, TimeProvider clock) : ISmsBusinessQueue
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static SmsMessageInfo Data(SmsMessage row) => new(row.Id, row.Sequence.ToString(CultureInfo.InvariantCulture),
        row.Kind, row.State, row.ConnectionName, row.Provider, row.TemplateName, row.CreatedAt,
        row.AttemptedAt, row.CompletedAt, row.Reason, row.ProviderMessageId);
    private static void Event(SmsBusinessEvent value)
    {
        if (value is null || value.Source is not ("sales" or "credit") || !SmsWorkspaceRules.Text(value.SourceId, 64)
            || !SmsWorkspaceRules.Text(value.OwnerId, 64) || value.Kind == "otp" || !SmsWorkspaceRules.Events.Contains(value.Kind)
            || value.At.Offset != TimeSpan.Zero || value.Values is null || value.Values.Count > 10
            || value.Values.Any(p => !SmsWorkspaceRules.Sources.Contains(p.Key) || p.Key is "code" or "constant"
                || !SmsWorkspaceRules.Text(p.Value, 120))) throw SmsWorkspaceRules.Invalid();
    }
    private SmsQueuedPayload Open(SmsMessage row) => JsonSerializer.Deserialize<SmsQueuedPayload>(
        protection.Unprotect("message", row.Id, row.ProtectedPayload), Json) ?? throw SmsWorkspaceRules.Invalid();
    public async Task EnqueueAsync(SmsBusinessEvent value, CancellationToken ct)
    {
        Event(value);
        value = value with { Values = value.Values.OrderBy(p => p.Key, StringComparer.Ordinal)
            .ToDictionary(p => p.Key, p => p.Value, StringComparer.Ordinal) };
        await StoreAsync(value.Source, value.SourceId, value.Kind, value.OwnerId,
            new(value, null, null), ct);
    }
    public async Task<SmsMessageInfo> TestAsync(string actor, SmsTestInput input, CancellationToken ct)
    {
        SmsWorkspaceRules.Id(input.RequestId); SmsWorkspaceRules.Id(input.TemplateId);
        if (!input.Confirmed || input.Mobile is not { Length: 13 } || !input.Mobile.StartsWith("+989", StringComparison.Ordinal)
            || input.Mobile.AsSpan(4).IndexOfAnyExceptInRange('0', '9') >= 0) throw SmsWorkspaceRules.Invalid();
        if (await planner.TemplateAsync(input.TemplateId, true, ct) is null)
            throw new BusinessException("sms_template_unavailable", "Enable a configured connection and approved template first.");
        var sourceId = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(actor + ":" + input.RequestId))).ToLowerInvariant();
        return Data(await StoreAsync("test", sourceId, "test", actor, new(null, input.TemplateId, input.Mobile), ct));
    }
    private async Task<SmsMessage> StoreAsync(string source, string sourceId, string kind, string owner, SmsQueuedPayload payload, CancellationToken ct)
    {
        var own = db.Database.CurrentTransaction is null;
        await using var tx = own ? await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct) : null;
        await SmsWorkspaceService.LockAsync(db, ct);
        var previous = await db.SmsMessages.AsNoTracking().SingleOrDefaultAsync(x => x.Source == source && x.SourceId == sourceId, ct);
        var raw = JsonSerializer.Serialize(payload, Json);
        if (previous is not null) {
            // Decrypt and compare canonical payload, never a guess based on event time.
            if (JsonSerializer.Serialize(Open(previous), Json) != raw || previous.OwnerId != owner || previous.Kind != kind)
                throw new BusinessException("sms_event_conflict", "This SMS reference already has a different payload.");
            if (tx is not null) await tx.CommitAsync(ct);
            return previous;
        }
        var row = new SmsMessage { Source = source, SourceId = sourceId, Kind = kind, OwnerId = owner,
            CreatedAt = clock.GetUtcNow().ToUniversalTime() };
        row.ProtectedPayload = protection.Protect("message", row.Id, raw);
        db.SmsMessages.Add(row); await db.SaveChangesAsync(ct);
        if (tx is not null) await tx.CommitAsync(ct);
        return row;
    }
    public async Task<SmsMessagesPage> PageAsync(string? state, string? kind, string? cursor, CancellationToken ct)
    {
        if (state is not null && state is not ("queued" or "dispatching" or "accepted" or "rejected" or "unknown" or "skipped")
            || kind is not null && kind != "test" && !SmsWorkspaceRules.Events.Contains(kind)) throw SmsWorkspaceRules.Invalid();
        var before = long.MaxValue;
        if (cursor is not null && (!long.TryParse(cursor, NumberStyles.None, CultureInfo.InvariantCulture, out before)
            || before < 1 || before.ToString(CultureInfo.InvariantCulture) != cursor)) throw SmsWorkspaceRules.Invalid();
        var query = db.SmsMessages.AsNoTracking().Where(x => x.Sequence < before);
        if (state is not null) query = query.Where(x => x.State == state);
        if (kind is not null) query = query.Where(x => x.Kind == kind);
        var rows = await query.OrderByDescending(x => x.Sequence).Take(51).ToArrayAsync(ct);
        return new(1, rows.Take(50).Select(Data).ToArray(), rows.Length > 50 ? rows[49].Sequence.ToString(CultureInfo.InvariantCulture) : null);
    }
    public Task<string[]> PendingAsync(CancellationToken ct) => db.SmsMessages.AsNoTracking()
        .Where(x => x.State == "queued" || x.State == "dispatching" && x.AttemptedAt < clock.GetUtcNow().AddMinutes(-2))
        .OrderBy(x => x.Sequence).Take(100).Select(x => x.Id).ToArrayAsync(ct);

    public async Task<bool> ProcessAsync(string id, CancellationToken ct)
    {
        SmsWorkspaceRules.Id(id);
        SmsExecutionPlan? plan = null; string? phone = null; Dictionary<string, string>? facts = null;
        await using (var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct)) {
            await SmsWorkspaceService.LockAsync(db, ct);
            var row = await db.SmsMessages.SingleOrDefaultAsync(x => x.Id == id, ct);
            if (row is null || row.State is not ("queued" or "dispatching")) return false;
            var now = clock.GetUtcNow().ToUniversalTime();
            if (row.State == "dispatching") {
                if (row.AttemptedAt > now.AddMinutes(-2)) return false;
                row.State = "unknown"; row.Reason = "interrupted"; row.CompletedAt = now;
            } else {
                try {
                    var payload = Open(row);
                    if (payload.Event is { } ev) {
                        Event(ev);
                        if (ev.OwnerId != row.OwnerId || ev.SourceId != row.SourceId || ev.Source != row.Source || ev.Kind != row.Kind) throw SmsWorkspaceRules.Invalid();
                        if (ev.ContainsDemo) { row.State = "skipped"; row.Reason = "demo_record"; }
                        else {
                            plan = await planner.RouteAsync(ev.Kind, ev.At, ct);
                            var recipient = plan is null ? null : await recipients.ReadAsync(ev.OwnerId, ct);
                            phone = recipient?.CanonicalPhone;
                            facts = new(ev.Values, StringComparer.Ordinal);
                            if (recipient is not null) facts["customerName"] = recipient.ShortName;
                        }
                    } else if (payload.TestTemplate is not null && payload.TestMobile is not null && row.Source == "test") {
                        plan = await planner.TemplateAsync(payload.TestTemplate, true, ct); phone = payload.TestMobile;
                        facts = new(StringComparer.Ordinal) { ["code"] = "123456", ["customerName"] = "کاربر آزمایش",
                            ["orderNumber"] = "SM-1000", ["orderStatus"] = "آزمایشی", ["amountRial"] = "1000000",
                            ["dueDate"] = "1405/08/10", ["trackingCode"] = "1234567890" };
                    } else throw SmsWorkspaceRules.Invalid();
                } catch (Exception e) when (e is CryptographicException or JsonException or BusinessException) {
                    row.State = "skipped"; row.Reason = "payload_unavailable";
                }
                if (row.State == "queued") {
                    if (plan is null) { row.State = "skipped"; row.Reason = "route_unavailable"; }
                    else if (phone is null) { row.State = "skipped"; row.Reason = "recipient_unavailable"; }
                    else {
                        var hour = now.AddHours(-1); var day = now.AddDays(-1);
                        var hourly = await db.SmsMessages.CountAsync(x => x.AttemptedAt >= hour, ct);
                        var daily = await db.SmsMessages.CountAsync(x => x.AttemptedAt >= day, ct);
                        if (hourly >= plan.Policy.NotificationHourlyLimit || daily >= plan.Policy.NotificationDailyLimit) {
                            row.State = "skipped"; row.Reason = "notification_limit";
                        } else {
                            row.State = "dispatching"; row.AttemptedAt = now; row.Provider = plan.Connection.Provider;
                            row.ConnectionName = plan.Connection.Name; row.TemplateName = plan.Template.Name;
                        }
                    }
                }
                if (row.State == "skipped") row.CompletedAt = now;
            }
            await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
            db.Entry(row).State = EntityState.Detached;
            if (row.State != "dispatching") return false;
        }
        CustomerOtpSmsResult result;
        try { result = await planner.SendAsync(plan!, phone!, facts!, ct); }
        catch (Exception e) when (e is not OutOfMemoryException) { result = new(CustomerOtpSmsDisposition.Unknown, CustomerOtpSmsReason.Uncertain); }
        // An attempted external side effect is never automatically retried, even
        // if request cancellation or process failure prevents its final receipt.
        using var finish = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var state = result.Disposition switch { CustomerOtpSmsDisposition.Accepted => "accepted", CustomerOtpSmsDisposition.Rejected => "rejected", _ => "unknown" };
        await db.SmsMessages.Where(x => x.Id == id && x.State == "dispatching")
            .ExecuteUpdateAsync(update => update.SetProperty(x => x.State, state)
                .SetProperty(x => x.Reason, result.Reason.ToString()).SetProperty(x => x.ProviderMessageId, result.MessageId)
                .SetProperty(x => x.CompletedAt, clock.GetUtcNow()), finish.Token);
        return true;
    }
}
