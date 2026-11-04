using System.Net;
using System.Text;
using System.Text.Json;
using Shop.Api;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class SmsIrVerifyGatewayTests
{
    // All values are synthetic. These tests use in-memory handlers, never a key
    // from configuration or a live provider connection.
    private const string Key = "synthetic-sms-key-not-a-real-credential";
    private const string Mobile = "+989120000000";
    private const string Code = "001234";

    private static CustomerOtpSmsRequest Request(string key = Key, string? name = "کاربر سایمان") =>
        new(key, Mobile, Code, 170274, "CODE", name is null ? null : "NAME", name);

    private static HttpResponseMessage Json(string body, HttpStatusCode status = HttpStatusCode.OK) =>
        new(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    private static HttpResponseMessage Accepted() => Json("""
        {"status":1,"message":"accepted","data":{"messageId":9223372036854775807,"cost":0}}
        """);

    [Fact]
    public async Task SendsTheFixedVerifyRequestWithPerRequestHeaderAndLeadingZeroCode()
    {
        var payloads = new List<string>();
        var keys = new List<string>();
        using var handler = new Handler(async (request, ct) =>
        {
            Assert.Equal(HttpMethod.Post, request.Method);
            Assert.Equal("https://api.sms.ir/v1/send/verify", request.RequestUri!.AbsoluteUri);
            Assert.Empty(request.RequestUri.Query);
            Assert.Equal("application/json", request.Content!.Headers.ContentType!.MediaType);
            Assert.Equal("utf-8", request.Content.Headers.ContentType.CharSet);
            Assert.Equal("application/json", Assert.Single(request.Headers.Accept).MediaType);
            keys.Add(Assert.Single(request.Headers.GetValues("x-api-key")));
            payloads.Add(await request.Content.ReadAsStringAsync(ct));
            return Accepted();
        });
        using var gateway = new SmsIrVerifyGateway(handler, SmsIrVerifyGateway.RequestTimeout);

        var first = await gateway.SendAsync(Request(), default);
        var second = await gateway.SendAsync(Request("other-synthetic-key", name: null), default);

        Assert.Equal(2, handler.Attempts);
        Assert.Equal(new[] { Key, "other-synthetic-key" }, keys);
        Assert.Equal(new(CustomerOtpSmsDisposition.Accepted, CustomerOtpSmsReason.None, "9223372036854775807"), first);
        Assert.Equal(first, second);
        using var body = JsonDocument.Parse(payloads[0]);
        Assert.Equal(new[] { "mobile", "templateId", "parameters" }, body.RootElement.EnumerateObject().Select(p => p.Name));
        Assert.Equal("09120000000", body.RootElement.GetProperty("mobile").GetString());
        Assert.Equal(170274, body.RootElement.GetProperty("templateId").GetInt32());
        var parameters = body.RootElement.GetProperty("parameters").EnumerateArray().ToArray();
        Assert.Equal(2, parameters.Length);
        Assert.Equal("CODE", parameters[0].GetProperty("name").GetString());
        Assert.Equal(Code, parameters[0].GetProperty("value").GetString());
        Assert.Equal("NAME", parameters[1].GetProperty("name").GetString());
        Assert.Equal("کاربر سایمان", parameters[1].GetProperty("value").GetString());
        using var withoutName = JsonDocument.Parse(payloads[1]);
        Assert.Single(withoutName.RootElement.GetProperty("parameters").EnumerateArray());
        Assert.DoesNotContain(Key, payloads[0]);
    }

    [Fact]
    public async Task ParameterNamesAreConfigurableAndNameIsOptional()
    {
        using var handler = new Handler(async (request, ct) =>
        {
            using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(ct));
            Assert.Equal(123456, body.RootElement.GetProperty("templateId").GetInt32());
            var parameter = Assert.Single(body.RootElement.GetProperty("parameters").EnumerateArray());
            Assert.Equal("Code", parameter.GetProperty("name").GetString());
            Assert.Equal("000000", parameter.GetProperty("value").GetString());
            return Accepted();
        });
        using var gateway = new SmsIrVerifyGateway(handler, SmsIrVerifyGateway.RequestTimeout);
        Assert.Equal(CustomerOtpSmsDisposition.Accepted,
            (await gateway.SendAsync(new(Key, Mobile, "000000", 123456, "Code"), default)).Disposition);
        Assert.Equal(1, handler.Attempts);
    }

    public static IEnumerable<object[]> InvalidInputs()
    {
        foreach (var key in new[] { null, "", "has space", "line\r\ninjection", new string('x', 513), "کلید" })
            yield return new object[] { key!, Mobile, Code, 170274, "CODE", "NAME", "کاربر سایمان" };
        foreach (var phone in new[] { null, "", "09120000000", "989120000000", "+98۹120000000", "+98912000000", "+9891200000000", "+98912000000x", "+989120000000\n" })
            yield return new object[] { Key, phone!, Code, 170274, "CODE", "NAME", "کاربر سایمان" };
        foreach (var code in new[] { null, "", "12345", "1234567", "۱۲۳۴۵۶", "12345x", "12345\n" })
            yield return new object[] { Key, Mobile, code!, 170274, "CODE", "NAME", "کاربر سایمان" };
        foreach (var template in new[] { 0, -1 })
            yield return new object[] { Key, Mobile, Code, template, "CODE", "NAME", "کاربر سایمان" };
        foreach (var parameter in new[] { null, "", "#CODE#", "bad name", "CODE\n", new string('x', 51), "کد" })
            yield return new object[] { Key, Mobile, Code, 170274, parameter!, "NAME", "کاربر سایمان" };
        yield return new object[] { Key, Mobile, Code, 170274, "CODE", "code", "کاربر سایمان" };
        yield return new object[] { Key, Mobile, Code, 170274, "CODE", "#NAME#", "کاربر سایمان" };
        yield return new object[] { Key, Mobile, Code, 170274, "CODE", null!, "کاربر سایمان" };
        yield return new object[] { Key, Mobile, Code, 170274, "CODE", "NAME", null! };
        foreach (var name in new[] { "", " ", " trailing ", new string('x', 26), "line\nname", "hidden\u202ename" })
            yield return new object[] { Key, Mobile, Code, 170274, "CODE", "NAME", name };
    }

    [Theory]
    [MemberData(nameof(InvalidInputs))]
    public async Task InvalidInputsFailBeforeHttpWithoutEchoingAnyValue(string key, string mobile,
        string code, int template, string codeParameter, string? nameParameter, string? name)
    {
        using var handler = new Handler((_, _) => Task.FromResult(Accepted()));
        using var gateway = new SmsIrVerifyGateway(handler, SmsIrVerifyGateway.RequestTimeout);
        var error = await Assert.ThrowsAsync<ArgumentException>(() => gateway.SendAsync(
            new(key, mobile, code, template, codeParameter, nameParameter, name), default));
        Assert.Equal("The verification SMS request is invalid.", error.Message);
        Assert.Equal(0, handler.Attempts);
    }

    [Fact]
    public async Task InvalidUtf16IsRejectedBeforeHttpWithoutTestDataSerialization()
    {
        // Keep the malformed UTF-16 in-process: theory discovery normalizes
        // unpaired surrogates when it serializes its data for the test host.
        using var handler = new Handler((_, _) => Task.FromResult(Accepted()));
        using var gateway = new SmsIrVerifyGateway(handler, SmsIrVerifyGateway.RequestTimeout);
        var error = await Assert.ThrowsAsync<ArgumentException>(() => gateway.SendAsync(
            new(Key, Mobile, Code, 170274, "CODE", "NAME", "unpaired\ud800"), default));
        Assert.Equal("The verification SMS request is invalid.", error.Message);
        Assert.Equal(0, handler.Attempts);
    }

    [Theory]
    [InlineData(400, CustomerOtpSmsDisposition.Rejected, CustomerOtpSmsReason.RequestRejected)]
    [InlineData(401, CustomerOtpSmsDisposition.Rejected, CustomerOtpSmsReason.CredentialsRejected)]
    [InlineData(403, CustomerOtpSmsDisposition.Rejected, CustomerOtpSmsReason.CredentialsRejected)]
    [InlineData(404, CustomerOtpSmsDisposition.Rejected, CustomerOtpSmsReason.RequestRejected)]
    [InlineData(408, CustomerOtpSmsDisposition.Unknown, CustomerOtpSmsReason.Uncertain)]
    [InlineData(429, CustomerOtpSmsDisposition.Rejected, CustomerOtpSmsReason.RateLimited)]
    [InlineData(500, CustomerOtpSmsDisposition.Unknown, CustomerOtpSmsReason.Uncertain)]
    [InlineData(502, CustomerOtpSmsDisposition.Unknown, CustomerOtpSmsReason.Uncertain)]
    [InlineData(503, CustomerOtpSmsDisposition.Unknown, CustomerOtpSmsReason.Uncertain)]
    public async Task HttpFailuresAreSafeAndNeverRetried(int status, CustomerOtpSmsDisposition disposition,
        CustomerOtpSmsReason reason)
    {
        using var handler = new Handler((_, _) => Task.FromResult(Json(
            $"{Key} {Mobile} {Code}", (HttpStatusCode)status)));
        using var gateway = new SmsIrVerifyGateway(handler, SmsIrVerifyGateway.RequestTimeout);
        var result = await gateway.SendAsync(Request(), default);
        Assert.Equal(new(disposition, reason), result);
        Assert.Equal(1, handler.Attempts);
        AssertRedacted(result);
    }

    [Theory]
    [InlineData(10)] [InlineData(11)] [InlineData(12)] [InlineData(20)]
    [InlineData(113)] [InlineData(114)] [InlineData(117)] [InlineData(119)] [InlineData(123)]
    public async Task ExplicitProviderRejectionIsNotAcceptance(int status)
    {
        using var handler = new Handler((_, _) => Task.FromResult(Json(
            JsonSerializer.Serialize(new { status, message = $"{Key} {Mobile} {Code}", data = new { messageId = 999 } }))));
        using var gateway = new SmsIrVerifyGateway(handler, SmsIrVerifyGateway.RequestTimeout);
        var result = await gateway.SendAsync(Request(), default);
        Assert.Equal(new(CustomerOtpSmsDisposition.Rejected, CustomerOtpSmsReason.ProviderRejected), result);
        Assert.Equal(1, handler.Attempts);
        AssertRedacted(result);
    }

    [Theory]
    [InlineData(200)] [InlineData(201)] [InlineData(202)]
    public async Task SuccessfulHttpAndPositiveMessageIdMeanAcceptedOnly(int status)
    {
        using var handler = new Handler((_, _) =>
        {
            var response = Accepted();
            response.StatusCode = (HttpStatusCode)status;
            return Task.FromResult(response);
        });
        using var gateway = new SmsIrVerifyGateway(handler, SmsIrVerifyGateway.RequestTimeout);
        var result = await gateway.SendAsync(Request(), default);
        Assert.Equal(CustomerOtpSmsDisposition.Accepted, result.Disposition);
        Assert.Equal("9223372036854775807", result.MessageId);
        Assert.DoesNotContain("delivered", result.ToString(), StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("verified", result.ToString(), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData("")]
    [InlineData("not-json")]
    [InlineData("[]")]
    [InlineData("null")]
    [InlineData("{\"status\":0}")]
    [InlineData("{\"status\":-1}")]
    [InlineData("{\"status\":999}")]
    [InlineData("{\"status\":2147483648}")]
    [InlineData("{\"status\":null}")]
    [InlineData("{\"status\":\"1\"}")]
    [InlineData("{\"status\":1.1}")]
    [InlineData("{\"status\":1,\"status\":10,\"data\":{\"messageId\":12}}")]
    [InlineData("{\"status\":1,\"Status\":10,\"data\":{\"messageId\":12}}")]
    [InlineData("{\"Status\":1,\"data\":{\"messageId\":12}}")]
    [InlineData("{\"status\":1}")]
    [InlineData("{\"status\":1,\"data\":null}")]
    [InlineData("{\"status\":1,\"data\":{}}")]
    [InlineData("{\"status\":1,\"data\":{\"messageId\":0}}")]
    [InlineData("{\"status\":1,\"data\":{\"messageId\":-1}}")]
    [InlineData("{\"status\":1,\"data\":{\"messageId\":1.5}}")]
    [InlineData("{\"status\":1,\"data\":{\"messageId\":\"12\"}}")]
    [InlineData("{\"status\":1,\"data\":{\"messageId\":9223372036854775808}}")]
    [InlineData("{\"status\":1,\"data\":{\"messageId\":12,\"messageId\":13}}")]
    [InlineData("{\"status\":1,\"data\":{\"messageId\":12},\"data\":{\"messageId\":13}}")]
    public async Task AmbiguousOrMalformedSuccessIsUnknownWithoutRetry(string body)
    {
        using var handler = new Handler((_, _) => Task.FromResult(Json(body)));
        using var gateway = new SmsIrVerifyGateway(handler, SmsIrVerifyGateway.RequestTimeout);
        Assert.Equal(new(CustomerOtpSmsDisposition.Unknown, CustomerOtpSmsReason.Uncertain),
            await gateway.SendAsync(Request(), default));
        Assert.Equal(1, handler.Attempts);
    }

    [Theory]
    [InlineData(true)] [InlineData(false)]
    public async Task BothDeclaredAndStreamingOversizedResponsesAreUnknownAndBounded(bool declared)
    {
        var source = new NonSeekableStream(Enumerable.Repeat((byte)'x', SmsIrVerifyGateway.MaxResponseBytes * 4).ToArray());
        using var handler = new Handler((_, _) =>
        {
            var response = new HttpResponseMessage(HttpStatusCode.OK) { Content = new StreamContent(source) };
            if (declared) response.Content.Headers.ContentLength = SmsIrVerifyGateway.MaxResponseBytes * 4;
            return Task.FromResult(response);
        });
        using var gateway = new SmsIrVerifyGateway(handler, SmsIrVerifyGateway.RequestTimeout);
        Assert.Equal(CustomerOtpSmsDisposition.Unknown, (await gateway.SendAsync(Request(), default)).Disposition);
        Assert.Equal(declared ? 0 : SmsIrVerifyGateway.MaxResponseBytes + 1, source.BytesRead);
        Assert.Equal(1, handler.Attempts);
    }

    [Fact]
    public async Task ExcessiveJsonDepthAndInvalidUtf8AreUnknown()
    {
        foreach (var bytes in new[] {
            Encoding.UTF8.GetBytes("{\"status\":1,\"data\":{\"messageId\":12},\"other\":" + new string('[', 10) + "0" + new string(']', 10) + "}"),
            new byte[] { 0xff, 0xfe, 0xff }
        })
        {
            using var handler = new Handler((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(bytes) }));
            using var gateway = new SmsIrVerifyGateway(handler, SmsIrVerifyGateway.RequestTimeout);
            Assert.Equal(CustomerOtpSmsDisposition.Unknown, (await gateway.SendAsync(Request(), default)).Disposition);
            Assert.Equal(1, handler.Attempts);
        }
    }

    [Fact]
    public async Task TimeoutAndIoFailureAreUnknownAndNeverRetriedOrEchoed()
    {
        foreach (var failure in new[] { "timeout", "http", "io" })
        {
            using var handler = new Handler(async (_, ct) =>
            {
                if (failure == "timeout") await Task.Delay(Timeout.InfiniteTimeSpan, ct);
                if (failure == "http") throw new HttpRequestException($"{Key} {Mobile} {Code}");
                throw new IOException($"{Key} {Mobile} {Code}");
            });
            using var gateway = new SmsIrVerifyGateway(handler, TimeSpan.FromMilliseconds(25));
            var result = await gateway.SendAsync(Request(), default);
            Assert.Equal(CustomerOtpSmsDisposition.Unknown, result.Disposition);
            Assert.Equal(1, handler.Attempts);
            AssertRedacted(result);
        }
    }

    [Fact]
    public async Task ResponseBodyReadHasTheSameDeadlineAndIsNotRetried()
    {
        using var handler = new Handler((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StreamContent(new BlockingStream())
        }));
        using var gateway = new SmsIrVerifyGateway(handler, TimeSpan.FromMilliseconds(25));
        Assert.Equal(CustomerOtpSmsDisposition.Unknown, (await gateway.SendAsync(Request(), default)).Disposition);
        Assert.Equal(1, handler.Attempts);
    }

    [Fact]
    public async Task CallerCancellationBeforeSendMakesNoAttemptAndCancellationAfterSendIsUnknown()
    {
        using var cancellation = new CancellationTokenSource();
        using var handler = new Handler(async (_, ct) =>
        {
            cancellation.Cancel();
            await Task.Delay(Timeout.InfiniteTimeSpan, ct);
            return Accepted();
        });
        using var gateway = new SmsIrVerifyGateway(handler, SmsIrVerifyGateway.RequestTimeout);
        Assert.Equal(CustomerOtpSmsDisposition.Unknown, (await gateway.SendAsync(Request(), cancellation.Token)).Disposition);
        Assert.Equal(1, handler.Attempts);
        Assert.Equal(CustomerOtpSmsDisposition.Unknown, (await gateway.SendAsync(Request(), cancellation.Token)).Disposition);
        Assert.Equal(1, handler.Attempts);
    }

    [Theory]
    [InlineData(301)] [InlineData(302)] [InlineData(307)] [InlineData(308)]
    public async Task RedirectResponsesAreUnknownAndNeverFollowed(int status)
    {
        using var handler = new Handler((_, _) =>
        {
            var response = Accepted();
            response.StatusCode = (HttpStatusCode)status;
            response.Headers.Location = new Uri("https://untrusted.example.invalid/collect");
            return Task.FromResult(response);
        });
        using var gateway = new SmsIrVerifyGateway(handler, SmsIrVerifyGateway.RequestTimeout);
        Assert.Equal(CustomerOtpSmsDisposition.Unknown, (await gateway.SendAsync(Request(), default)).Disposition);
        Assert.Equal(1, handler.Attempts);
    }

    [Fact]
    public void ProductionTransportOwnsRedirectCookieProxyAndHeaderBounds()
    {
        using var transport = SmsIrVerifyGateway.CreateTransport();
        Assert.False(transport.AllowAutoRedirect);
        Assert.False(transport.UseCookies);
        Assert.False(transport.UseProxy);
        Assert.Equal(DecompressionMethods.None, transport.AutomaticDecompression);
        Assert.Equal(TimeSpan.FromSeconds(3), transport.ConnectTimeout);
        Assert.Equal(16, transport.MaxResponseHeadersLength);
        Assert.Null(transport.SslOptions.RemoteCertificateValidationCallback);
        Assert.Single(typeof(SmsIrVerifyGateway).GetConstructors());
        Assert.Empty(typeof(SmsIrVerifyGateway).GetConstructors()[0].GetParameters());
    }

    [Fact]
    public void PrivateEnvelopeRefusesSerializationAndNeverIncludesSensitiveValuesInToString()
    {
        var request = Request();
        Assert.Empty(typeof(CustomerOtpSmsRequest).GetProperties());
        Assert.Equal("Customer OTP SMS request [redacted]", request.ToString());
        var serialized = Assert.Throws<NotSupportedException>(() => JsonSerializer.Serialize(request));
        var boxed = Assert.Throws<NotSupportedException>(() => JsonSerializer.Serialize<object>(request));
        var deserialized = Assert.Throws<NotSupportedException>(() => JsonSerializer.Deserialize<CustomerOtpSmsRequest>("{}"));
        foreach (var value in new[] { Key, Mobile, Code })
        {
            Assert.DoesNotContain(value, request.ToString());
            Assert.DoesNotContain(value, serialized.ToString());
            Assert.DoesNotContain(value, boxed.ToString());
            Assert.DoesNotContain(value, deserialized.ToString());
        }
    }

    private static void AssertRedacted(CustomerOtpSmsResult result)
    {
        foreach (var value in new[] { Key, Mobile, Code })
        {
            Assert.DoesNotContain(value, result.ToString());
            Assert.DoesNotContain(value, JsonSerializer.Serialize(result));
        }
    }

    private sealed class Handler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> send) : HttpMessageHandler
    {
        public int Attempts { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Attempts++;
            return send(request, cancellationToken);
        }
    }

    private sealed class NonSeekableStream(byte[] bytes) : Stream
    {
        private readonly MemoryStream _inner = new(bytes);
        public int BytesRead { get; private set; }
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override int Read(byte[] buffer, int offset, int count)
        {
            var read = _inner.Read(buffer, offset, count);
            BytesRead += read;
            return read;
        }
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken ct = default)
        {
            var read = await _inner.ReadAsync(buffer, ct);
            BytesRead += read;
            return read;
        }
        public override void Flush() => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        protected override void Dispose(bool disposing)
        {
            if (disposing) _inner.Dispose();
            base.Dispose(disposing);
        }
    }

    private sealed class BlockingStream : Stream
    {
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken ct = default)
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, ct);
            return 0;
        }
        public override void Flush() => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }
}
