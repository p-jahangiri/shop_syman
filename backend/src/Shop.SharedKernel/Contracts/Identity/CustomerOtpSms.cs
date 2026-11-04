using System.Text.Json;
using System.Text.Json.Serialization;

namespace Shop.SharedKernel;

public enum CustomerOtpSmsDisposition
{
    Accepted,
    Rejected,
    Unknown
}

public enum CustomerOtpSmsReason
{
    None,
    RequestRejected,
    CredentialsRejected,
    RateLimited,
    ProviderRejected,
    Uncertain
}

// Accepted means that the provider accepted a send, never delivered or verified.
// Unknown must not cause an automatic resend: the provider may have accepted it.
public sealed record CustomerOtpSmsResult(
    CustomerOtpSmsDisposition Disposition,
    CustomerOtpSmsReason Reason,
    string? MessageId = null);

public interface ICustomerOtpSmsGateway
{
    Task<CustomerOtpSmsResult> SendAsync(CustomerOtpSmsRequest request, CancellationToken ct);
}

public delegate Task<CustomerOtpSmsResult> CustomerOtpSmsDispatch(
    string apiKey,
    string canonicalMobile,
    string code,
    int templateId,
    string codeParameterName,
    string? nameParameterName,
    string? genericName,
    CancellationToken ct);

// This is an ephemeral transport envelope, not an API DTO or persisted settings.
// No public property, generated record ToString, or serializable projection may
// expose its key, phone, or code. Only the transport callback reads the values.
[JsonConverter(typeof(CustomerOtpSmsRequestJsonConverter))]
public sealed class CustomerOtpSmsRequest
{
    private readonly string _apiKey;
    private readonly string _canonicalMobile;
    private readonly string _code;
    private readonly int _templateId;
    private readonly string _codeParameterName;
    private readonly string? _nameParameterName;
    private readonly string? _genericName;

    public CustomerOtpSmsRequest(
        string apiKey,
        string canonicalMobile,
        string code,
        int templateId,
        string codeParameterName,
        string? nameParameterName = null,
        string? genericName = null)
    {
        if (!ValidKey(apiKey) || !ValidMobile(canonicalMobile) || !ValidCode(code)
            || templateId <= 0 || !ValidParameter(codeParameterName)
            || (nameParameterName is null) != (genericName is null)
            || (nameParameterName is not null && (!ValidParameter(nameParameterName)
                || string.Equals(codeParameterName, nameParameterName, StringComparison.OrdinalIgnoreCase)
                || !ValidName(genericName))))
        {
            throw new ArgumentException("The verification SMS request is invalid.");
        }

        _apiKey = apiKey;
        _canonicalMobile = canonicalMobile;
        _code = code;
        _templateId = templateId;
        _codeParameterName = codeParameterName;
        _nameParameterName = nameParameterName;
        _genericName = genericName;
    }

    public Task<CustomerOtpSmsResult> DispatchAsync(CustomerOtpSmsDispatch dispatch, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(dispatch);
        return dispatch(_apiKey, _canonicalMobile, _code, _templateId,
            _codeParameterName, _nameParameterName, _genericName, ct);
    }

    public override string ToString() => "Customer OTP SMS request [redacted]";

    private static bool ValidKey(string? value) => value is { Length: > 0 and <= 512 }
        && value.All(c => c is >= '!' and <= '~');

    // This transport deliberately accepts only the already-canonical IR form.
    // Parsing customer input and establishing unique phone ownership belong to
    // the future Identity challenge service, not this outbound adapter.
    private static bool ValidMobile(string? value) => value is { Length: 13 }
        && value.StartsWith("+989", StringComparison.Ordinal)
        && value.AsSpan(4).IndexOfAnyExceptInRange('0', '9') < 0;

    private static bool ValidCode(string? value) => value is { Length: 6 }
        && value.AsSpan().IndexOfAnyExceptInRange('0', '9') < 0;

    private static bool ValidParameter(string? value) => value is { Length: > 0 and <= 50 }
        && value.All(c => char.IsAsciiLetterOrDigit(c) || c == '_');

    private static bool ValidName(string? value) => value is { Length: > 0 and <= 25 }
        && value == value.Trim()
        && !string.IsNullOrWhiteSpace(value)
        && value.All(c => char.GetUnicodeCategory(c) is not (
            System.Globalization.UnicodeCategory.Control
            or System.Globalization.UnicodeCategory.Format
            or System.Globalization.UnicodeCategory.LineSeparator
            or System.Globalization.UnicodeCategory.ParagraphSeparator
            or System.Globalization.UnicodeCategory.Surrogate));
}

public sealed class CustomerOtpSmsRequestJsonConverter : JsonConverter<CustomerOtpSmsRequest>
{
    public override CustomerOtpSmsRequest Read(ref Utf8JsonReader reader, Type typeToConvert,
        JsonSerializerOptions options) => throw Unavailable();

    public override void Write(Utf8JsonWriter writer, CustomerOtpSmsRequest value,
        JsonSerializerOptions options) => throw Unavailable();

    private static NotSupportedException Unavailable() =>
        new("Verification SMS requests cannot be serialized or deserialized.");
}
