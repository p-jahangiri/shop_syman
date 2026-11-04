using System.Globalization;
using System.Net;
using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using System.Text.Json;
using Shop.SharedKernel;

[assembly: InternalsVisibleTo("Shop.Tests")]

namespace Shop.Api;

// Transport foundation only: not registered and not an OTP/authentication flow.
// No custom endpoint, redirect, retry policy, raw provider error, or logger.
public sealed class SmsIrVerifyGateway : ICustomerOtpSmsGateway, IDisposable
{
    public static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(5);
    public const int MaxResponseBytes = 16 * 1024;
    private static readonly Uri Endpoint = new("https://api.sms.ir/v1/send/verify");
    private readonly HttpClient _client;
    private readonly TimeSpan _requestTimeout;

    public SmsIrVerifyGateway() : this(CreateTransport(), RequestTimeout) { }

    // Fake handlers are an internal unit-test seam, never runtime configuration.
    internal SmsIrVerifyGateway(HttpMessageHandler handler, TimeSpan requestTimeout)
    {
        ArgumentNullException.ThrowIfNull(handler);
        if (requestTimeout <= TimeSpan.Zero || requestTimeout > RequestTimeout)
            throw new ArgumentOutOfRangeException(nameof(requestTimeout));

        _requestTimeout = requestTimeout;
        _client = new HttpClient(handler, disposeHandler: true) { Timeout = Timeout.InfiniteTimeSpan };
    }

    internal static SocketsHttpHandler CreateTransport() => new()
    {
        AllowAutoRedirect = false,
        UseCookies = false,
        UseProxy = false,
        AutomaticDecompression = DecompressionMethods.None,
        ConnectTimeout = TimeSpan.FromSeconds(3),
        MaxResponseHeadersLength = 16,
        MaxConnectionsPerServer = 4,
        PooledConnectionLifetime = TimeSpan.FromMinutes(2)
    };

    public Task<CustomerOtpSmsResult> SendAsync(CustomerOtpSmsRequest request, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(request);
        return request.DispatchAsync(DispatchAsync, ct);
    }

    private async Task<CustomerOtpSmsResult> DispatchAsync(
        string apiKey,
        string canonicalMobile,
        string code,
        int templateId,
        string codeParameterName,
        string? nameParameterName,
        string? genericName,
        CancellationToken ct)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(_requestTimeout);
        byte[]? body = null;

        try
        {
            deadline.Token.ThrowIfCancellationRequested();
            body = CreateBody(canonicalMobile, code, templateId, codeParameterName, nameParameterName, genericName);
            using var request = new HttpRequestMessage(HttpMethod.Post, Endpoint);
            request.Headers.Add("x-api-key", apiKey);
            request.Headers.Accept.ParseAdd("application/json");
            request.Content = new ByteArrayContent(body);
            request.Content.Headers.ContentType = new("application/json") { CharSet = "utf-8" };

            // Exactly one application-level attempt. An unknown outcome is not
            // a rejection and must be reconciled by a future persistent service.
            using var response = await _client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
            if (!response.IsSuccessStatusCode)
                return FromHttpStatus(response.StatusCode);

            if (response.Content.Headers.ContentLength is > MaxResponseBytes)
                return Unknown();

            await using var stream = await response.Content.ReadAsStreamAsync(deadline.Token);
            var bytes = new byte[MaxResponseBytes + 1];
            try
            {
                var count = 0;
                while (count < bytes.Length)
                {
                    var read = await stream.ReadAsync(bytes.AsMemory(count), deadline.Token);
                    if (read == 0) break;
                    count += read;
                }

                if (count > MaxResponseBytes) return Unknown();
                return ParseResponse(bytes.AsMemory(0, count));
            }
            finally
            {
                // Responses can echo input; retain neither raw bytes nor text.
                CryptographicOperations.ZeroMemory(bytes);
            }
        }
        catch (Exception error) when (error is HttpRequestException or IOException
            or OperationCanceledException or JsonException or InvalidOperationException
            or NotSupportedException)
        {
            // Exception messages and provider response bodies may contain input.
            return Unknown();
        }
        finally
        {
            if (body is not null) CryptographicOperations.ZeroMemory(body);
        }
    }

    private static byte[] CreateBody(string canonicalMobile, string code, int templateId,
        string codeParameterName, string? nameParameterName, string? genericName)
    {
        using var buffer = new MemoryStream();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            // The official SDK uses domestic mobile numbers. This adapter only
            // supports canonical Iranian E.164 input and the exact +98 -> 0 map.
            writer.WriteString("mobile", "0" + canonicalMobile[3..]);
            writer.WriteNumber("templateId", templateId);
            writer.WriteStartArray("parameters");
            WriteParameter(writer, codeParameterName, code);
            if (nameParameterName is not null) WriteParameter(writer, nameParameterName, genericName!);
            writer.WriteEndArray();
            writer.WriteEndObject();
        }

        var result = buffer.ToArray();
        CryptographicOperations.ZeroMemory(buffer.GetBuffer());
        return result;
    }

    private static void WriteParameter(Utf8JsonWriter writer, string name, string value)
    {
        writer.WriteStartObject();
        writer.WriteString("name", name);
        writer.WriteString("value", value);
        writer.WriteEndObject();
    }

    internal static CustomerOtpSmsResult ParseResponse(ReadOnlyMemory<byte> bytes)
    {
        using var document = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 8 });
        if (!TryProperty(document.RootElement, "status", out var status)
            || status.ValueKind != JsonValueKind.Number || !status.TryGetInt32(out var value))
            return Unknown();

        if (value != 1)
        {
            // Only documented definite rejections are classified as rejected.
            // Provider/system failure (0) and future status codes stay unknown.
            return value is 10 or 11 or 12 or 20 or 113 or 114 or 117 or 119 or 123
                ? new(CustomerOtpSmsDisposition.Rejected, CustomerOtpSmsReason.ProviderRejected)
                : Unknown();
        }

        if (!TryProperty(document.RootElement, "data", out var data)
            || !TryProperty(data, "messageId", out var id)
            || id.ValueKind != JsonValueKind.Number || !id.TryGetInt64(out var messageId) || messageId <= 0)
            return Unknown();

        return new(CustomerOtpSmsDisposition.Accepted, CustomerOtpSmsReason.None,
            messageId.ToString(CultureInfo.InvariantCulture));
    }

    private static bool TryProperty(JsonElement source, string name, out JsonElement value)
    {
        value = default;
        if (source.ValueKind != JsonValueKind.Object) return false;
        var found = false;
        foreach (var property in source.EnumerateObject())
        {
            if (!string.Equals(property.Name, name, StringComparison.OrdinalIgnoreCase)) continue;
            if (found || property.Name != name) return false;
            value = property.Value;
            found = true;
        }
        return found;
    }

    private static CustomerOtpSmsResult FromHttpStatus(HttpStatusCode status) => (int)status switch
    {
        401 or 403 => new(CustomerOtpSmsDisposition.Rejected, CustomerOtpSmsReason.CredentialsRejected),
        429 => new(CustomerOtpSmsDisposition.Rejected, CustomerOtpSmsReason.RateLimited),
        >= 400 and < 500 when (int)status != 408 =>
            new(CustomerOtpSmsDisposition.Rejected, CustomerOtpSmsReason.RequestRejected),
        _ => Unknown()
    };

    private static CustomerOtpSmsResult Unknown() =>
        new(CustomerOtpSmsDisposition.Unknown, CustomerOtpSmsReason.Uncertain);

    public void Dispose() => _client.Dispose();
}
