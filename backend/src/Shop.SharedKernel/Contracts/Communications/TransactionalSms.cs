using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Shop.SharedKernel;

public sealed record SmsValue(string Name, string Value)
{
    public override string ToString() => "SMS parameter [redacted]";
}

public interface ITransactionalSmsGateway
{
    Task<CustomerOtpSmsResult> SendAsync(TransactionalSmsRequest request, CancellationToken ct);
}

public delegate Task<CustomerOtpSmsResult> TransactionalSmsDispatch(string provider, string apiKey,
    string canonicalPhone, string template, IReadOnlyList<SmsValue> parameters, CancellationToken ct);

// This envelope is never an HTTP DTO, a log object, or a persisted outbox row.
[JsonConverter(typeof(TransactionalSmsRequestConverter))]
public sealed class TransactionalSmsRequest
{
    private readonly string provider, apiKey, phone, template;
    private readonly SmsValue[] parameters;
    public TransactionalSmsRequest(string provider, string apiKey, string canonicalPhone, string template, IEnumerable<SmsValue> parameters)
    {
        if (provider is not ("smsIr" or "kavenegar") || apiKey is not { Length: > 0 and <= 512 }
            || apiKey.Any(c => c is < '!' or > '~') || canonicalPhone is not { Length: 13 }
            || !canonicalPhone.StartsWith("+989", StringComparison.Ordinal)
            || canonicalPhone.AsSpan(4).IndexOfAnyExceptInRange('0', '9') >= 0)
            throw Invalid();
        SmsProviderRules.Template(provider, template);
        var values = parameters?.Take(11).ToArray() ?? throw Invalid();
        if (values.Length is < 1 or > 10 || values.Any(v => v is null)
            || values.Select(v => v.Name).Distinct(StringComparer.OrdinalIgnoreCase).Count() != values.Length)
            throw Invalid();
        foreach (var value in values) SmsProviderRules.Value(provider, value.Name, value.Value);
        if (provider == "kavenegar" && !values.Any(v => v.Name == "token")) throw Invalid();
        this.provider = provider; this.apiKey = apiKey; phone = canonicalPhone; this.template = template;
        this.parameters = values;
    }
    public Task<CustomerOtpSmsResult> DispatchAsync(TransactionalSmsDispatch dispatch, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(dispatch);
        return dispatch(provider, apiKey, phone, template, Array.AsReadOnly(parameters), ct);
    }
    public override string ToString() => "Transactional SMS request [redacted]";
    private static ArgumentException Invalid() => new("The transactional SMS envelope is invalid.");
}

public static class SmsProviderRules
{
    public static readonly string[] KavenegarParameters = ["token", "token2", "token3", "token10", "token20"];
    public static void Template(string provider, string template)
    {
        if (provider == "smsIr") {
            if (!int.TryParse(template, NumberStyles.None, CultureInfo.InvariantCulture, out var id)
                || id <= 0 || id.ToString(CultureInfo.InvariantCulture) != template) throw Invalid();
        } else if (provider == "kavenegar") {
            if (template is not { Length: > 0 and <= 100 } || !char.IsAsciiLetter(template[0])
                || template.Any(c => !char.IsAsciiLetterOrDigit(c))) throw Invalid();
        } else throw Invalid();
    }
    public static void Parameter(string provider, string name)
    {
        if (name is not { Length: > 0 and <= 50 }
            || name.Any(c => !char.IsAsciiLetterOrDigit(c) && c != '_')
            || provider == "kavenegar" && !KavenegarParameters.Contains(name, StringComparer.Ordinal)
            || provider is not ("smsIr" or "kavenegar")) throw Invalid();
    }
    public static void Value(string provider, string name, string value)
    {
        Parameter(provider, name);
        var max = provider == "smsIr" ? 25 : 100;
        if (value is null || value.Length < 1 || value.Length > max || value != value.Trim()
            || value.Any(c => char.IsControl(c) || (char.GetUnicodeCategory(c) is UnicodeCategory.Format
                or UnicodeCategory.LineSeparator or UnicodeCategory.ParagraphSeparator) && c != '\u200c')) throw Invalid();
        try { _ = new UTF8Encoding(false, true).GetByteCount(value); }
        catch (EncoderFallbackException) { throw Invalid(); }
        if (provider == "kavenegar") {
            var spaces = value.Count(c => c == ' ');
            var allowed = name == "token10" ? 5 : name == "token20" ? 8 : 0;
            if (spaces > allowed || value.Any(c => char.IsWhiteSpace(c) && c != ' ')) throw Invalid();
        }
    }
    private static ArgumentException Invalid() => new("Check the SMS template and parameter format.");
}

public sealed class TransactionalSmsRequestConverter : JsonConverter<TransactionalSmsRequest>
{
    public override TransactionalSmsRequest Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) => throw Invalid();
    public override void Write(Utf8JsonWriter writer, TransactionalSmsRequest value, JsonSerializerOptions options) => throw Invalid();
    private static NotSupportedException Invalid() => new("SMS transport envelopes cannot be serialized.");
}
