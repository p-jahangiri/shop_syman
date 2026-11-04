using System.Text.Json.Serialization;

namespace Shop.SharedKernel;

public sealed record CustomerSmsSettingsDto(int SchemaVersion,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? Version,
    string Provider, bool Enabled, string Mode, int TemplateId, string CodeParameterName,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? NameParameterName,
    string GenericName, bool KeyConfigured, int OtpLifetimeSeconds, int ResendAfterSeconds,
    int MaxAttempts, string Availability);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CustomerSmsSettingsInput(string? Version, string RequestId, string Provider,
    bool Enabled, string Mode, int TemplateId, string CodeParameterName,
    string? NameParameterName, string GenericName, string ApiKeyAction, string? ApiKey = null)
{
    public override string ToString() => "Customer SMS settings input [redacted]";
}

public interface ICustomerSmsSettings
{
    Task<CustomerSmsSettingsDto> GetAsync(string actorId, string stamp, CancellationToken ct);
    Task<CustomerSmsSettingsDto> SaveAsync(string actorId, string stamp, CustomerSmsSettingsInput input,
        string traceId, CancellationToken ct);
    Task<bool> CustomerLoginAvailableAsync(CancellationToken ct);
}

// The host owns its persistent DataProtection key ring. Bindings distinguish
// key revisions, commands, and challenge ids; no unprotected digest is persisted.
public interface ICustomerOtpProtection
{
    byte[] Protect(string purpose, string binding, string value);
    string Unprotect(string purpose, string binding, byte[] value);
}

public sealed record CustomerOtpPolicy(bool MobileOtpEnabled, bool RegistrationEnabled,
    bool EmailPasswordEnabled = true, bool UsernamePasswordEnabled = true);

public interface ICustomerOtpPolicy
{
    Task<CustomerOtpPolicy> ReadAsync(CancellationToken ct);
}
