using System.Globalization;
using System.Text;
using Shop.SharedKernel;

namespace Shop.Modules.Notifications;

public static class SmsWorkspaceRules
{
    public static readonly string[] Events = ["otp", "orderCreated", "orderPaid", "orderShipped", "orderCancelled", "creditApproved", "orderDigitalReady", "chequeReminder"];
    public static readonly string[] Sources = ["code", "genericName", "expiryMinutes", "customerName", "orderNumber", "orderStatus", "amountRial", "dueDate", "trackingCode", "constant"];
    public const string ImportedConnectionId = "d6900000000000000000000000000001";
    public const string ImportedTemplateId = "d6900000000000000000000000000002";
    public static string PersianDueDate(string value)
    {
        if (!DateOnly.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var day)) throw Invalid();
        try {
            var date = day.ToDateTime(TimeOnly.MinValue); var calendar = new PersianCalendar();
            return FormattableString.Invariant($"{calendar.GetYear(date):0000}/{calendar.GetMonth(date):00}/{calendar.GetDayOfMonth(date):00}");
        } catch (ArgumentOutOfRangeException) { throw Invalid(); }
    }

    public static void Id(string? value)
    {
        if (value is null || !Guid.TryParseExact(value, "N", out var parsed) || parsed == Guid.Empty || parsed.ToString("N") != value) throw Invalid();
    }
    public static void Policy(SmsOtpPolicy p)
    {
        if (p is null || p.LifetimeSeconds is < 60 or > 600 || p.ResendSeconds is < 30 or > 300 || p.ResendSeconds >= p.LifetimeSeconds
            || p.MaxAttempts is < 1 or > 10 || p.PhoneHourlyLimit is < 1 or > 20 || p.PhoneDailyLimit < p.PhoneHourlyLimit || p.PhoneDailyLimit > 100
            || p.GlobalHourlyLimit < p.PhoneHourlyLimit || p.GlobalHourlyLimit > 10000
            || p.GlobalDailyLimit < Math.Max(p.GlobalHourlyLimit, p.PhoneDailyLimit) || p.GlobalDailyLimit > 100000
            || p.NotificationHourlyLimit is < 1 or > 10000 || p.NotificationDailyLimit < p.NotificationHourlyLimit || p.NotificationDailyLimit > 100000
            || !Text(p.GenericName, 25)) throw Invalid();
    }
    public static SmsWorkspaceInput Validate(SmsWorkspaceInput input, bool development)
    {
        if (input is null) throw Invalid();
        Id(input.RequestId); Policy(input.Otp);
        if (input.Version is not null) {
            try { var bytes = Convert.FromBase64String(input.Version); if (bytes.Length != 8 || Convert.ToBase64String(bytes) != input.Version) throw Invalid(); }
            catch (FormatException) { throw Invalid(); }
        }
        if (input.Connections is null || input.Connections.Length > 10 || input.Connections.Any(x => x is null)
            || input.Connections.Select(x => x.Id).Distinct(StringComparer.Ordinal).Count() != input.Connections.Length
            || input.Templates is null || input.Templates.Length > 30 || input.Templates.Any(x => x is null)
            || input.Templates.Select(x => x.Id).Distinct(StringComparer.Ordinal).Count() != input.Templates.Length
            || input.Routes is null || input.Routes.Length != Events.Length || input.Routes.Any(x => x is null)
            || !input.Routes.Select(x => x.Event).Order(StringComparer.Ordinal).SequenceEqual(Events.Order(StringComparer.Ordinal))) throw Invalid();
        foreach (var c in input.Connections) {
            Id(c.Id);
            if (!Text(c.Name, 100) || c.Provider is not ("smsIr" or "kavenegar") || c.Mode is not ("live" or "sandbox")
                || c.Mode == "sandbox" && (!development || c.Provider != "smsIr")
                || c.KeyAction is not ("keep" or "replace" or "clear")
                || c.KeyAction != "replace" && c.ApiKey is not null
                || c.KeyAction == "replace" && (c.ApiKey is not { Length: > 0 and <= 512 } || c.ApiKey.Any(ch => ch is < '!' or > '~'))) throw Invalid();
        }
        foreach (var t in input.Templates) {
            Id(t.Id); Id(t.ConnectionId);
            var c = input.Connections.SingleOrDefault(x => x.Id == t.ConnectionId) ?? throw Invalid();
            if (!Text(t.Name, 100) || !Events.Contains(t.Kind, StringComparer.Ordinal) || !Preview(t.PreviewText)
                || t.Parameters is null || t.Parameters.Length is < 1 or > 10 || t.Parameters.Any(p => p is null)
                || t.Parameters.Select(p => p.Name).Distinct(StringComparer.OrdinalIgnoreCase).Count() != t.Parameters.Length) throw Invalid();
            try {
                SmsProviderRules.Template(c.Provider, t.ProviderTemplate);
                foreach (var p in t.Parameters) {
                    SmsProviderRules.Parameter(c.Provider, p.Name);
                    if (!Sources.Contains(p.Source, StringComparer.Ordinal)
                        || p.Source == "constant" && p.Constant is null || p.Source != "constant" && p.Constant is not null
                        || t.Kind == "otp" && p.Source is not ("code" or "genericName" or "expiryMinutes" or "constant")
                        || t.Kind != "otp" && p.Source is "code" or "expiryMinutes"
                        || t.Kind != "chequeReminder" && p.Source == "dueDate"
                        || t.Kind != "orderShipped" && p.Source == "trackingCode"
                        || t.Kind == "chequeReminder" && p.Source == "orderStatus") throw Invalid();
                    if (p.Source == "constant") SmsProviderRules.Value(c.Provider, p.Name, p.Constant!);
                    if (p.Source == "genericName") SmsProviderRules.Value(c.Provider, p.Name, input.Otp.GenericName);
                }
            } catch (ArgumentException) { throw Invalid(); }
            if (t.Kind == "otp" && t.Parameters.Count(p => p.Source == "code") != 1
                || c.Provider == "kavenegar" && !t.Parameters.Any(p => p.Name == "token")
                || c.Mode == "live" && c.Provider == "smsIr" && t.ProviderTemplate == "123456"
                || c.Mode == "sandbox" && (t.ProviderTemplate != "123456" || t.Parameters.Length != 1
                    || t.Parameters[0].Name != "Code" || t.Parameters[0].Source != "code" || t.Kind != "otp")) throw Invalid();
        }
        foreach (var route in input.Routes) {
            if (route.TemplateId is not null) {
                Id(route.TemplateId);
                var template = input.Templates.SingleOrDefault(t => t.Id == route.TemplateId) ?? throw Invalid();
                if (template.Kind != route.Event) throw Invalid();
                if (route.Enabled) {
                    var c = input.Connections.Single(c => c.Id == template.ConnectionId);
                    if (!c.Enabled || c.Mode != "live" || !template.Approved || c.KeyAction == "clear") throw Invalid();
                }
            } else if (route.Enabled) throw Invalid();
        }
        return input with {
            Connections = input.Connections.OrderBy(x => x.Id, StringComparer.Ordinal).ToArray(),
            Templates = input.Templates.OrderBy(x => x.Id, StringComparer.Ordinal)
                .Select(t => t with { Parameters = t.Parameters.OrderBy(p => p.Name, StringComparer.Ordinal).ToArray() }).ToArray(),
            Routes = input.Routes.OrderBy(x => x.Event, StringComparer.Ordinal).ToArray()
        };
    }
    public static SmsOtpPolicy Policy(SmsWorkspaceState row) => new(row.LifetimeSeconds, row.ResendSeconds,
        row.MaxAttempts, row.PhoneHourlyLimit, row.PhoneDailyLimit, row.GlobalHourlyLimit, row.GlobalDailyLimit,
        row.NotificationHourlyLimit, row.NotificationDailyLimit, row.GenericName);
    public static void Apply(SmsWorkspaceState row, SmsOtpPolicy p)
    {
        Policy(p);
        row.LifetimeSeconds = p.LifetimeSeconds; row.ResendSeconds = p.ResendSeconds; row.MaxAttempts = p.MaxAttempts;
        row.PhoneHourlyLimit = p.PhoneHourlyLimit; row.PhoneDailyLimit = p.PhoneDailyLimit;
        row.GlobalHourlyLimit = p.GlobalHourlyLimit; row.GlobalDailyLimit = p.GlobalDailyLimit;
        row.NotificationHourlyLimit = p.NotificationHourlyLimit; row.NotificationDailyLimit = p.NotificationDailyLimit; row.GenericName = p.GenericName;
    }
    public static bool Text(string? value, int max) => value is { Length: > 0 } && value.Length <= max && value == value.Trim()
        && !value.Any(c => char.IsControl(c) || (char.GetUnicodeCategory(c) is UnicodeCategory.Format
            or UnicodeCategory.LineSeparator or UnicodeCategory.ParagraphSeparator) && c != '\u200c') && Finite(value);
    private static bool Preview(string? value) => value is not null && value.Length <= 2000 && Finite(value)
        && !value.Any(c => char.IsControl(c) && c is not ('\n' or '\r' or '\t') || c is >= '\u202a' and <= '\u202e' or >= '\u2066' and <= '\u2069');
    private static bool Finite(string value) { try { _ = new UTF8Encoding(false, true).GetByteCount(value); return true; } catch (EncoderFallbackException) { return false; } }
    public static BusinessException Invalid() => new("invalid_sms_workspace", "Check the connections, templates, variables and delivery rules.");
    public static BusinessException Conflict() => new("sms_workspace_conflict", "SMS settings changed. Reload before saving.");
}
