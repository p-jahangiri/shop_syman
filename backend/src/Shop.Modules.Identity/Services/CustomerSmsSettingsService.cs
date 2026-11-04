using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;

namespace Shop.Modules.Identity;

public static class CustomerSmsRules
{
    public static string RequestId(string? value)
    {
        if (value is null || !Guid.TryParseExact(value, "N", out var id)
            || id == Guid.Empty || value != id.ToString("N")) throw Invalid();
        return value;
    }

    public static CustomerSmsSettingsInput Validate(CustomerSmsSettingsInput input, bool development)
    {
        RequestId(input.RequestId);
        if (input.Provider != "smsIr" || input.Mode is not ("live" or "sandbox")
            || input.Mode == "sandbox" && !development
            || input.Mode == "live" && input.TemplateId == 123456
            || input.ApiKeyAction is not ("keep" or "replace" or "clear")
            || input.ApiKeyAction != "replace" && input.ApiKey is not null
            || input.ApiKeyAction == "replace" && input.ApiKey is null
            || input.GenericName is null)
            throw Invalid();
        if (input.Version is not null)
        {
            try
            {
                var version = Convert.FromBase64String(input.Version);
                if (version.Length != 8 || Convert.ToBase64String(version) != input.Version) throw Invalid();
            }
            catch (FormatException) { throw Invalid(); }
        }
        try
        {
            // Reuse the accepted transport's conservative bounds. Never send.
            _ = new CustomerOtpSmsRequest(input.ApiKeyAction == "replace" ? input.ApiKey! : "validation-only",
                "+989120000000", "000000", input.TemplateId, input.CodeParameterName,
                input.NameParameterName, input.NameParameterName is null ? null : input.GenericName);
            if (input.GenericName.Length > 25 || input.NameParameterName is not null && input.GenericName.Length == 0
                || input.GenericName != input.GenericName.Trim()
                || input.GenericName.Any(c => char.IsControl(c) || char.IsSurrogate(c)
                    || char.GetUnicodeCategory(c) == System.Globalization.UnicodeCategory.Format)) throw Invalid();
            // Sandbox has a fixed provider template, not an alternate identity provider.
            if (input.Mode == "sandbox" && (input.TemplateId != 123456 || input.NameParameterName is not null
                || input.CodeParameterName != "Code")) throw Invalid();
        }
        catch (ArgumentException) { throw Invalid(); }
        return input;
    }

    public static bool LoginAvailable(CustomerSmsSettings? row) => row is
        { Enabled: true, Mode: "live", ProtectedApiKey.Length: > 0, TemplateId: > 0 and not 123456 };

    public static CustomerSmsSettingsDto Dto(CustomerSmsSettings? row)
    {
        row ??= new();
        var hasKey = row.ProtectedApiKey is { Length: > 0 };
        return new(1, row.Version.Length == 0 ? null : Convert.ToBase64String(row.Version), "smsIr",
            row.Enabled, row.Mode, row.TemplateId, row.CodeParameterName, row.NameParameterName,
            row.GenericName, hasKey, 300, 60, 5,
            !hasKey ? "unconfigured" : !row.Enabled ? "disabled" : row.Mode == "sandbox" ? "sandbox" : "configured");
    }

    public static BusinessException Invalid() => new("invalid_sms_settings", "Check the SMS settings and key operation.");
    public static BusinessException Unavailable() => new("otp_unavailable", "Mobile verification is unavailable.");

    internal static async Task<IDbContextTransaction?> BeginAsync(IdentityDbContext db, CancellationToken ct)
    {
        if (db.Database.CurrentTransaction is { } current)
        {
            if (current.GetDbTransaction().IsolationLevel != IsolationLevel.Serializable)
                throw new InvalidOperationException("SMS operations require a Serializable Identity transaction.");
            return null;
        }
        return await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
    }

    public static Task LockAsync(IdentityDbContext db, CancellationToken ct) => db.Database.ExecuteSqlRawAsync("""
        DECLARE @result int;
        EXEC @result=sys.sp_getapplock @Resource=N'Sayman.CustomerOtp.v1',
          @LockMode=N'Exclusive', @LockOwner=N'Transaction', @LockTimeout=5000;
        IF @result<0 THROW 51001,'Customer verification is busy.',1;
        """, ct);

    internal static string CommandBinding(string actorId, string requestId) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(actorId + "\0" + requestId)));
}

public sealed class CustomerSmsSettingsService(UserManager<ShopUser> users, IdentityDbContext db,
    ICustomerOtpProtection protection, ICustomerOtpPolicy policy, ICustomerLoginContinuity continuity,
    TimeProvider time, bool development = false, ISmsOtpConfigurationSource? workspace = null) : ICustomerSmsSettings
{
    public async Task<bool> CustomerLoginAvailableAsync(CancellationToken ct)
    {
        var configured = workspace is null ? null : await workspace.ReadAsync(ct);
        return configured is not null ? configured.Available : await db.CustomerSmsSettings.AsNoTracking()
            .AnyAsync(x => x.Id == "customer-sms" && x.Enabled && x.Mode == "live" && x.TemplateId != 123456 && x.ProtectedApiKey != null, ct);
    }

    public async Task<CustomerSmsSettingsDto> GetAsync(string actorId, string stamp, CancellationToken ct)
    {
        await using var owned = await CustomerSmsRules.BeginAsync(db, ct);
        await CustomerSmsRules.LockAsync(db, ct);
        await StaffAuthorization.RequireAdministratorAsync(users, db, actorId, stamp, ct);
        var result = CustomerSmsRules.Dto(await db.CustomerSmsSettings.AsNoTracking().SingleOrDefaultAsync(ct));
        if (owned is not null) await owned.CommitAsync(ct);
        return result;
    }

    public async Task<CustomerSmsSettingsDto> SaveAsync(string actorId, string stamp,
        CustomerSmsSettingsInput supplied, string traceId, CancellationToken ct)
    {
        var input = CustomerSmsRules.Validate(supplied, development);
        if (workspace is not null && await workspace.ExistsAsync(ct))
            throw new BusinessException("sms_workspace_upgrade_required", "Reload the current SMS management workspace before changing settings.");
        await using var owned = await CustomerSmsRules.BeginAsync(db, ct);
        await CustomerSmsRules.LockAsync(db, ct);
        await StaffAuthorization.RequireAdministratorAsync(users, db, actorId, stamp, ct);
        var binding = CustomerSmsRules.CommandBinding(actorId, input.RequestId);
        var raw = JsonSerializer.SerializeToUtf8Bytes(input);
        string fingerprint;
        try { fingerprint = Convert.ToHexStringLower(SHA256.HashData(raw)); }
        finally { CryptographicOperations.ZeroMemory(raw); }
        var command = await db.CustomerSmsSettingsCommands.AsNoTracking()
            .SingleOrDefaultAsync(x => x.ActorId == actorId && x.RequestId == input.RequestId, ct);
        if (command is not null)
        {
            try
            {
                var expected = protection.Unprotect("fingerprint", binding, command.ProtectedFingerprint);
                if (!CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(expected), Encoding.ASCII.GetBytes(fingerprint)))
                    throw new BusinessException("sms_settings_conflict", "The settings request has different fields.");
                var receipt = JsonSerializer.Deserialize<CustomerSmsSettingsDto>(protection.Unprotect("receipt", binding, command.ProtectedReceipt));
                if (receipt is null || receipt.SchemaVersion != 1 || receipt.Provider != "smsIr") throw new JsonException();
                if (owned is not null) await owned.CommitAsync(ct);
                return receipt;
            }
            catch (Exception error) when (error is CryptographicException or JsonException or ArgumentException)
            {
                throw CustomerSmsRules.Unavailable();
            }
        }

        var row = await db.CustomerSmsSettings.SingleOrDefaultAsync(ct);
        var version = row is null ? null : Convert.ToBase64String(row.Version);
        if (input.Version != version)
            throw new BusinessException("sms_settings_conflict", "The SMS settings changed. Refresh before saving.");
        if (row is null) { row = new(); db.CustomerSmsSettings.Add(row); }
        row.Enabled = input.Enabled;
        row.Mode = input.Mode;
        row.TemplateId = input.TemplateId;
        row.CodeParameterName = input.CodeParameterName;
        row.NameParameterName = input.NameParameterName;
        row.GenericName = input.GenericName;
        if (input.ApiKeyAction is "replace" or "clear")
        {
            row.KeyRevision = Guid.NewGuid().ToString("N");
            row.ProtectedApiKey = input.ApiKeyAction == "replace"
                ? protection.Protect("key", row.KeyRevision, input.ApiKey!) : null;
        }
        await db.SaveChangesAsync(ct);
        var currentPolicy = await policy.ReadAsync(ct);
        await continuity.RequireAsync(currentPolicy.EmailPasswordEnabled, currentPolicy.UsernamePasswordEnabled,
            currentPolicy.MobileOtpEnabled, ct);
        // Every new successful settings command invalidates outstanding codes;
        // exact idempotent replay returned above does not invalidate again.
        var changedAt = time.GetUtcNow();
        await db.CustomerOtpChallenges.Where(x => x.ConsumedAt == null && x.SupersededAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.SupersededAt, changedAt), ct);
        var result = CustomerSmsRules.Dto(row);
        db.CustomerSmsSettingsCommands.Add(new()
        {
            ActorId = actorId, RequestId = input.RequestId, CreatedAt = time.GetUtcNow(),
            ProtectedFingerprint = protection.Protect("fingerprint", binding, fingerprint),
            ProtectedReceipt = protection.Protect("receipt", binding, JsonSerializer.Serialize(result))
        });
        db.Audit.Add(new() { ActorId = actorId, Action = "CUSTOMER_SMS_SETTINGS_SAVED",
            Resource = "/api/admin/sms/settings", TraceId = traceId, At = time.GetUtcNow() });
        await db.SaveChangesAsync(ct);
        if (owned is not null) await owned.CommitAsync(ct);
        return result;
    }
}
