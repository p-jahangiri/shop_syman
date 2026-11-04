using System.Globalization;
using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using Shop.SharedKernel;

namespace Shop.Api;

// Private clients intentionally avoid IHttpClientFactory request-URL logging:
// Kavenegar's documented API carries its credential in the fixed-host path.
public sealed class TransactionalSmsGateway : ITransactionalSmsGateway, IDisposable
{
    private readonly HttpClient client;
    private readonly TimeSpan timeout;
    internal const int ResponseLimit = 16 * 1024;
    public TransactionalSmsGateway() : this(SmsIrVerifyGateway.CreateTransport(), TimeSpan.FromSeconds(5)) { }
    internal TransactionalSmsGateway(HttpMessageHandler handler, TimeSpan timeout)
    {
        if (timeout <= TimeSpan.Zero || timeout > TimeSpan.FromSeconds(5)) throw new ArgumentOutOfRangeException(nameof(timeout));
        client = new(handler, disposeHandler: true) { Timeout = Timeout.InfiniteTimeSpan };
        this.timeout = timeout;
    }
    public Task<CustomerOtpSmsResult> SendAsync(TransactionalSmsRequest request, CancellationToken ct) => request.DispatchAsync(DispatchAsync, ct);
    private async Task<CustomerOtpSmsResult> DispatchAsync(string provider, string key, string phone,
        string template, IReadOnlyList<SmsValue> parameters, CancellationToken ct)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(timeout);
        byte[]? body = null;
        try {
            using var request = new HttpRequestMessage(HttpMethod.Post, provider == "smsIr"
                ? "https://api.sms.ir/v1/send/verify"
                : "https://api.kavenegar.com/v1/" + Uri.EscapeDataString(key) + "/verify/lookup.json");
            if (provider == "smsIr") {
                using var buffer = new MemoryStream();
                using (var writer = new Utf8JsonWriter(buffer)) {
                    writer.WriteStartObject(); writer.WriteString("mobile", "0" + phone[3..]);
                    writer.WriteNumber("templateId", int.Parse(template, CultureInfo.InvariantCulture));
                    writer.WriteStartArray("parameters");
                    foreach (var p in parameters) {
                        writer.WriteStartObject(); writer.WriteString("name", p.Name); writer.WriteString("value", p.Value); writer.WriteEndObject();
                    }
                    writer.WriteEndArray(); writer.WriteEndObject();
                }
                body = buffer.ToArray(); CryptographicOperations.ZeroMemory(buffer.GetBuffer());
                request.Headers.Add("x-api-key", key);
                request.Content = new ByteArrayContent(body);
                request.Content.Headers.ContentType = new("application/json") { CharSet = "utf-8" };
            } else {
                var values = new List<KeyValuePair<string, string>> {
                    new("receptor", "0" + phone[3..]), new("template", template), new("type", "sms")
                };
                values.AddRange(parameters.Select(p => new KeyValuePair<string, string>(p.Name, p.Value)));
                using var form = new FormUrlEncodedContent(values);
                body = await form.ReadAsByteArrayAsync(deadline.Token);
                request.Content = new ByteArrayContent(body);
                request.Content.Headers.ContentType = new("application/x-www-form-urlencoded");
            }
            request.Headers.Accept.ParseAdd("application/json");
            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
            if (!response.IsSuccessStatusCode) return response.StatusCode switch {
                HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden => Rejected(CustomerOtpSmsReason.CredentialsRejected),
                HttpStatusCode.TooManyRequests => Rejected(CustomerOtpSmsReason.RateLimited),
                HttpStatusCode.BadRequest or HttpStatusCode.NotFound or HttpStatusCode.MethodNotAllowed or HttpStatusCode.RequestEntityTooLarge => Rejected(CustomerOtpSmsReason.RequestRejected),
                _ => Unknown()
            };
            if (response.Content.Headers.ContentLength > ResponseLimit) return Unknown();
            var bytes = new byte[ResponseLimit + 1];
            try {
                await using var stream = await response.Content.ReadAsStreamAsync(deadline.Token);
                var count = 0;
                while (count < bytes.Length) {
                    var read = await stream.ReadAsync(bytes.AsMemory(count), deadline.Token);
                    if (read == 0) break;
                    count += read;
                }
                if (count > ResponseLimit) return Unknown();
                return provider == "smsIr" ? SmsIrVerifyGateway.ParseResponse(bytes.AsMemory(0, count)) : KavenegarResponse(bytes.AsMemory(0, count));
            } finally { CryptographicOperations.ZeroMemory(bytes); }
        } catch (Exception error) when (error is HttpRequestException or IOException or OperationCanceledException
            or JsonException or InvalidOperationException or NotSupportedException) {
            return Unknown();
        } finally { if (body is not null) CryptographicOperations.ZeroMemory(body); }
    }

    internal static CustomerOtpSmsResult KavenegarResponse(ReadOnlyMemory<byte> bytes)
    {
        using var doc = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 8 });
        var root = doc.RootElement;
        if (!Property(root, "return", out var result) || !Property(result, "status", out var status)
            || status.ValueKind != JsonValueKind.Number || !status.TryGetInt32(out var code)) return Unknown();
        if (code != 200) return code switch {
            401 or 403 => Rejected(CustomerOtpSmsReason.CredentialsRejected),
            429 => Rejected(CustomerOtpSmsReason.RateLimited),
            400 or 402 or 404 or 405 or 411 or 412 or 413 or 414 or 418 or 422 or 424 or 426 or 428 or 431 or 432 or 607 => Rejected(CustomerOtpSmsReason.ProviderRejected),
            _ => Unknown()
        };
        if (!Property(root, "entries", out var entries) || entries.ValueKind != JsonValueKind.Array
            || entries.GetArrayLength() != 1 || !Property(entries[0], "messageid", out var id)
            || id.ValueKind != JsonValueKind.Number || !id.TryGetInt64(out var value) || value <= 0) return Unknown();
        return new(CustomerOtpSmsDisposition.Accepted, CustomerOtpSmsReason.None, value.ToString(CultureInfo.InvariantCulture));
    }
    private static bool Property(JsonElement value, string name, out JsonElement property)
    {
        property = default;
        if (value.ValueKind != JsonValueKind.Object) return false;
        var matches = value.EnumerateObject().Where(p => p.NameEquals(name)).ToArray();
        if (matches.Length != 1) return false;
        property = matches[0].Value; return true;
    }
    private static CustomerOtpSmsResult Unknown() => new(CustomerOtpSmsDisposition.Unknown, CustomerOtpSmsReason.Uncertain);
    private static CustomerOtpSmsResult Rejected(CustomerOtpSmsReason reason) => new(CustomerOtpSmsDisposition.Rejected, reason);
    public void Dispose() => client.Dispose();
}
