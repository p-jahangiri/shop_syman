using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Shop.SharedKernel;
namespace Shop.Modules.Support;

public interface ITicketProtection
{
    byte[] Protect(string ticketId, string kind, string recordId, string text);
    string Unprotect(string ticketId, string kind, string recordId, byte[] protectedText);
}
public sealed record TicketOptions(int MaxOpenPerOwner = 20);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CreateTicketInput(string Subject, string Body, string Locale);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ReplyTicketInput(string Version, string Body, string Locale);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ChangeTicketStateInput(string Version, string State);
public sealed record TicketSummary(string Id, string Subject, string Locale, string State, string Version, int MessageCount, DateTimeOffset CreatedAt, DateTimeOffset ChangedAt);
public sealed record TicketQueueCounts(int Open, int WaitingCustomer, int Closed);
public sealed record TicketPage(int SchemaVersion, [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? State, TicketSummary[] Items, [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? NextCursor, [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] TicketQueueCounts? QueueCounts = null, [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Kind = null);
public sealed record TicketDetail(int SchemaVersion, TicketSummary Ticket);
public sealed record TicketMessageData(string Id, string Sequence, string Author, string Locale, string Body, DateTimeOffset At);
public sealed record TicketMessagePage(int SchemaVersion, string TicketId, TicketMessageData[] Items, [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? NextCursor);
public sealed record TicketCommandResult(int SchemaVersion, bool Replayed, string CommandId, TicketSummary Ticket, [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? MessageId);

public static class TicketRules
{
    public static BusinessException Invalid() => new("invalid_ticket", "Ticket fields, version or cursor are invalid.");
    public static BusinessException Unavailable() => new("ticket_unavailable", "The private support record could not be read safely.");
    public static string Id(string value) { if (value is null || !Guid.TryParseExact(value, "N", out var id) || id == Guid.Empty || value != id.ToString("N")) throw Invalid(); return value; }
    public static string Actor(string value) { if (string.IsNullOrWhiteSpace(value) || value.Length > 64 || value != value.Trim() || value.Any(c => !char.IsAsciiLetterOrDigit(c) && c is not ('-' or '_'))) throw Invalid(); return value.ToUpperInvariant(); }
    public static string Text(string value, int min, int max, bool singleLine = false)
    {
        if (value is null || value.Length > max) throw Invalid();
        value = value.Replace("\r\n", "\n", StringComparison.Ordinal).Replace('\r', '\n').Trim();
        if (value.Length < min || value.Any(c => char.IsControl(c) && c is not ('\n' or '\t') || c is '\u202a' or '\u202b' or '\u202c' or '\u202d' or '\u202e' or '\u2066' or '\u2067' or '\u2068' or '\u2069') || singleLine && value.Any(c => c is '\n' or '\t')) throw Invalid();
        try { _ = new UTF8Encoding(false, true).GetByteCount(value); } catch (EncoderFallbackException) { throw Invalid(); }
        return value;
    }
    public static string Locale(string value) => value is "fa" or "en" ? value : throw Invalid();
    public static void Version(string value) { try { if (value is null || value.Length != 12 || Convert.FromBase64String(value).Length != 8 || Convert.ToBase64String(Convert.FromBase64String(value)) != value) throw Invalid(); } catch (FormatException) { throw Invalid(); } }
    public static string? State(string? value) => value is null or "Open" or "WaitingCustomer" or "Closed" ? value : throw Invalid();
    public static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    public static long Cursor(string? cursor, string scope, bool ascending)
    {
        if (cursor is null) return ascending ? 0 : long.MaxValue;
        try {
            if (cursor.Length > 180) throw Invalid();
            var raw = Convert.FromBase64String(cursor); if (Convert.ToBase64String(raw) != cursor) throw Invalid();
            var value = new UTF8Encoding(false, true).GetString(raw).Split(':');
            if (value.Length != 3 || value[0] != "1" || value[1] != Hash(scope) || !long.TryParse(value[2], NumberStyles.None, CultureInfo.InvariantCulture, out var sequence) || sequence <= 0 || sequence.ToString(CultureInfo.InvariantCulture) != value[2]) throw Invalid();
            return sequence;
        } catch (Exception e) when (e is FormatException or DecoderFallbackException) { throw Invalid(); }
    }
    public static string Cursor(long sequence, string scope) { if (sequence <= 0) throw Unavailable(); return Convert.ToBase64String(Encoding.UTF8.GetBytes("1:" + Hash(scope) + ":" + sequence.ToString(CultureInfo.InvariantCulture))); }
}
