using System.Text.Json.Serialization;

namespace Shop.SharedKernel;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SmsOtpPolicy(int LifetimeSeconds = 300, int ResendSeconds = 60, int MaxAttempts = 5,
    int PhoneHourlyLimit = 5, int PhoneDailyLimit = 20, int GlobalHourlyLimit = 100,
    int GlobalDailyLimit = 1000, int NotificationHourlyLimit = 100, int NotificationDailyLimit = 1000,
    string GenericName = "کاربر سایمان");
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SmsParameterBinding(string Name, string Source,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? Constant = null);
public sealed record SmsConnectionInfo(string Id, string Name, string Provider, string Mode, bool Enabled, bool KeyConfigured);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SmsTemplateInfo(string Id, string Name, string Kind, string ConnectionId,
    string ProviderTemplate, bool Approved, string PreviewText, SmsParameterBinding[] Parameters);
public sealed record SmsRouteInfo(string Event, bool Enabled,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? TemplateId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] DateTimeOffset? EnabledSince);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SmsRouteInput(string Event, bool Enabled, string? TemplateId);
public sealed record SmsWorkspaceInfo(int SchemaVersion,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? Version, SmsOtpPolicy Otp,
    SmsConnectionInfo[] Connections, SmsTemplateInfo[] Templates, SmsRouteInfo[] Routes);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SmsConnectionInput(string Id, string Name, string Provider, string Mode, bool Enabled,
    string KeyAction, string? ApiKey = null)
{
    public override string ToString() => "SMS connection input [redacted]";
}
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SmsWorkspaceInput(string? Version, string RequestId, SmsOtpPolicy Otp,
    SmsConnectionInput[] Connections, SmsTemplateInfo[] Templates, SmsRouteInput[] Routes)
{
    public override string ToString() => "SMS workspace command [redacted]";
}
public interface ISmsWorkspace
{
    Task<SmsWorkspaceInfo> ReadAsync(CancellationToken ct);
    Task<SmsWorkspaceInfo> SaveAsync(string actorId, SmsWorkspaceInput input, string traceId, CancellationToken ct);
}
public interface ISmsAdministratorAuthorization
{
    Task RequireAsync(string actorId, string stamp, CancellationToken ct);
}

// Null means the pre-workspace configuration is still authoritative. An
// existing but unavailable workspace must never fall back to old credentials.
public interface ISmsOtpConfigurationSource
{
    Task<SmsOtpConfiguration?> ReadAsync(CancellationToken ct);
    Task<bool> ExistsAsync(CancellationToken ct);
}
public interface ISmsOtpChallengeInvalidator
{
    Task InvalidateAsync(CancellationToken ct);
}
public sealed class SmsOtpConfiguration(bool available, string generation, SmsOtpPolicy policy,
    Func<string, string, CancellationToken, Task<CustomerOtpSmsResult>> dispatch)
{
    public bool Available { get; } = available;
    public string Generation { get; } = generation;
    public SmsOtpPolicy Policy { get; } = policy;
    public Task<CustomerOtpSmsResult> SendAsync(string phone, string code, CancellationToken ct) => dispatch(phone, code, ct);
    public override string ToString() => "SMS OTP configuration [redacted]";
}
public sealed record SmsBusinessEvent(string Source, string SourceId, string Kind, string OwnerId,
    DateTimeOffset At, IReadOnlyDictionary<string, string> Values, bool ContainsDemo = false);
public interface ISmsBusinessQueue
{
    Task EnqueueAsync(SmsBusinessEvent value, CancellationToken ct);
}
public sealed record SmsVerifiedRecipient(string CanonicalPhone, string ShortName)
{
    public override string ToString() => "Verified SMS recipient [redacted]";
}
public interface ISmsVerifiedRecipientReader
{
    Task<SmsVerifiedRecipient?> ReadAsync(string ownerId, CancellationToken ct);
}
public interface ISmsWorkspaceProtection
{
    byte[] Protect(string purpose, string binding, string plaintext);
    string Unprotect(string purpose, string binding, byte[] ciphertext);
}
public sealed record SmsMessageInfo(string Id, string Sequence, string Kind, string State,
    string? ConnectionName, string? Provider, string? TemplateName, DateTimeOffset CreatedAt,
    DateTimeOffset? AttemptedAt, DateTimeOffset? CompletedAt, string? Reason, string? ProviderMessageId);
public sealed record SmsMessagesPage(int SchemaVersion, SmsMessageInfo[] Items, string? NextCursor);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SmsTestInput(string RequestId, string TemplateId, string Mobile, bool Confirmed = false)
{
    public override string ToString() => "SMS test command [redacted]";
}
public interface ISalesSmsSignals
{
    Task<SmsBusinessEvent[]> PendingAsync(CancellationToken ct);
    Task AcknowledgeAsync(string id, CancellationToken ct);
}
public sealed record SmsOrderFacts(string OwnerId, string Reference, bool ContainsDemo);
public interface ISmsOrderFactsReader
{
    Task<SmsOrderFacts?> ReadAsync(string orderId, CancellationToken ct);
}
