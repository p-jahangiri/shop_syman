using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json.Serialization;
using Shop.SharedKernel;

namespace Shop.Modules.Identity;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CustomerOtpStartInput(string Mobile, string RequestId)
{
    public override string ToString() => "Customer OTP start [redacted]";
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CustomerOtpVerifyInput(string ChallengeId, string Code)
{
    public override string ToString() => "Customer OTP verification [redacted]";
}

public sealed record CustomerOtpStarted(int SchemaVersion, string ChallengeId, string ExpiresAt,
    string ResendAt, string Delivery);

public interface ICustomerOtpService
{
    Task<CustomerOtpStarted> StartAsync(CustomerOtpStartInput input, string traceId, CancellationToken ct);
    Task<AuthResult> VerifyAsync(CustomerOtpVerifyInput input, string traceId, CancellationToken ct);
}

public static class CustomerOtpRules
{
    public const int LifetimeSeconds = 300;
    public const int CooldownSeconds = 60;
    public const int MaxAttempts = 5;
    public const int PhoneHourlyLimit = 5;
    public const int PhoneDailyLimit = 20;
    public const int GlobalHourlyLimit = 100;
    public const int GlobalDailyLimit = 1000;

    public static string NormalizePhone(string? input) => TryNormalizePhone(input, out var canonical)
        ? canonical : throw new BusinessException("invalid_otp", "Check the mobile verification fields.");

    public static bool TryNormalizePhone(string? input, out string canonical)
    {
        canonical = "";
        if (input is null || input.Length is < 1 or > 32) return false;
        var chars = input.Trim().ToCharArray();
        for (var i = 0; i < chars.Length; i++)
        {
            if (chars[i] is >= '\u06f0' and <= '\u06f9') chars[i] = (char)('0' + chars[i] - '\u06f0');
            else if (chars[i] is >= '\u0660' and <= '\u0669') chars[i] = (char)('0' + chars[i] - '\u0660');
        }
        var value = new string(chars);
        if (value.StartsWith("0098", StringComparison.Ordinal)) value = "+98" + value[4..];
        else if (value.Length == 12 && value.StartsWith("98", StringComparison.Ordinal)) value = "+" + value;
        else if (value.Length == 11 && value.StartsWith("09", StringComparison.Ordinal)) value = "+98" + value[1..];
        if (value.Length != 13 || !value.StartsWith("+989", StringComparison.Ordinal)
            || value.AsSpan(4).IndexOfAnyExceptInRange('0', '9') >= 0) return false;
        canonical = value;
        return true;
    }

    public static string Id(string? value)
    {
        if (value is null || !Guid.TryParseExact(value, "N", out var id) || id == Guid.Empty
            || value != id.ToString("N")) throw new BusinessException("invalid_otp", "Check the mobile verification fields.");
        return value;
    }

    public static void VerifyInput(CustomerOtpVerifyInput input)
    {
        Id(input.ChallengeId);
        if (input.Code is not { Length: 6 } || input.Code.AsSpan().IndexOfAnyExceptInRange('0', '9') >= 0)
            throw new BusinessException("invalid_otp", "Check the mobile verification fields.");
    }

    public static string NewCode() => RandomNumberGenerator.GetInt32(1_000_000).ToString("D6", CultureInfo.InvariantCulture);
    public static BusinessException Invalid() => new("otp_invalid", "The verification is invalid or unavailable.");
    public static string Utc(DateTimeOffset value) => value.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fffffff'Z'", CultureInfo.InvariantCulture);
    public static CustomerOtpStarted Dto(CustomerOtpChallenge row) => new(1, row.Id,
        Utc(row.ExpiresAt), Utc(row.ResendAt), row.State == "Accepted" ? "accepted" : "unknown");
}

public sealed partial class AuthService
{
    internal async Task<AuthResult> CompleteCustomerOtpAsync(string userId, CancellationToken ct)
    {
        var user = await users.FindByIdAsync(userId) ?? throw CustomerOtpRules.Invalid();
        await db.Entry(user).ReloadAsync(ct);
        if (!user.IsActive || !user.PhoneNumberConfirmed || user.CanonicalPhone is null
            || user.MustChangePassword || user.MfaRecoveryPending || await users.IsLockedOutAsync(user)
            || (await users.GetRolesAsync(user)).Count != 0) throw CustomerOtpRules.Invalid();
        if (user.RequireMfa || user.TwoFactorEnabled) return PendingMfa(user);
        return await IssueAsync(user, null, ct);
    }
}
