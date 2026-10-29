using System.Data;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;

namespace Shop.Modules.Identity;

public sealed class MfaRecoveryCode
{
    public string UserId { get; set; } = "";
    public string CodeHash { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? ConsumedAt { get; set; }
}
public sealed record GenerateRecoveryCodesInput(string Password, string Code);
public sealed record RecoverMfaInput(string Password, string RecoveryCode);
public sealed record RecoveryCodeBatch(int SchemaVersion, string[] Codes, DateTimeOffset GeneratedAt);
public sealed record RecoveryCodeStatus(int SchemaVersion, int RemainingCodes);
public interface IMfaRecovery
{
    Task<RecoveryCodeStatus> StatusAsync(string userId, CancellationToken ct);
    Task<RecoveryCodeBatch> GenerateAsync(string userId, string stamp, GenerateRecoveryCodesInput input, string traceId, CancellationToken ct);
    Task<AuthResult> RecoverAsync(string userId, string stamp, RecoverMfaInput input, string traceId, CancellationToken ct);
}

public static class RecoveryCodes
{
    public const int BatchSize = 10;
    public static string NewCode() => Format(Convert.ToHexString(RandomNumberGenerator.GetBytes(16)));
    private static string Format(string raw) => string.Join('-', Enumerable.Range(0, 4).Select(i => raw.Substring(i * 8, 8)));
    public static string? Normalize(string? input)
    {
        if (input is null || input.Length > 64) return null;
        var raw = input.Trim();
        if (raw.Length == 35) {
            if (raw[8] != '-' || raw[17] != '-' || raw[26] != '-') return null;
            raw = raw.Replace("-", "", StringComparison.Ordinal);
        }
        return raw.Length == 32 && raw.All(char.IsAsciiHexDigit) ? raw.ToUpperInvariant() : null;
    }
    // 128 random bits per code; only a user-bound SHA-256 digest is persisted.
    public static string Hash(string userId, string normalizedCode) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes($"Sayman.MfaRecovery.v1:{userId}:{normalizedCode}")));
    public static void Validate(GenerateRecoveryCodesInput input)
    {
        if (input.Password is null || input.Password.Length is < 1 or > 128 || input.Code is null || input.Code.Length != 6 || input.Code.Any(c => c is < '0' or > '9')) throw MfaAccount.Invalid();
    }
    public static string Validate(RecoverMfaInput input)
    {
        if (input.Password is null || input.Password.Length is < 1 or > 128) throw MfaAccount.Invalid();
        return Normalize(input.RecoveryCode) ?? throw MfaAccount.Invalid();
    }
}

internal static class MfaAccount
{
    internal static BusinessException Invalid() => new("invalid_credentials", "The supplied credentials or verification are invalid.");
    internal static void Ensure(IdentityResult result)
    {
        if (!result.Succeeded) throw new BusinessException("identity_validation", "The identity operation could not be completed.");
    }
    internal static async Task<IDbContextTransaction> BeginAsync(IdentityDbContext db, string userId, CancellationToken ct)
    {
        var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        try {
            // Every MFA transition uses the same account lock; refresh tokens remain stamp-bound.
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT [Id] FROM [identity].[AspNetUsers] WITH (UPDLOCK, HOLDLOCK) WHERE [Id] = {userId}", ct);
            return transaction;
        } catch { await transaction.DisposeAsync(); throw; }
    }
    internal static async Task<ShopUser> CurrentAsync(UserManager<ShopUser> users, IdentityDbContext db, string userId, string stamp, CancellationToken ct)
    {
        var user = await users.FindByIdAsync(userId) ?? throw Invalid();
        // JWT middleware may already have tracked this row before the account lock.
        await db.Entry(user).ReloadAsync(ct);
        if (db.Entry(user).State == EntityState.Detached || !user.IsActive || string.IsNullOrEmpty(stamp) || user.SecurityStamp != stamp || await users.IsLockedOutAsync(user)) throw Invalid();
        return user;
    }
    internal static async Task FailedAsync(UserManager<ShopUser> users, IdentityDbContext db, ShopUser user, string action, string traceId, IDbContextTransaction transaction, CancellationToken ct)
    {
        Ensure(await users.AccessFailedAsync(user));
        db.Audit.Add(new() { ActorId = user.Id, Action = action, Resource = "/api/auth/mfa", TraceId = traceId });
        await db.SaveChangesAsync(ct); await transaction.CommitAsync(ct);
        throw Invalid();
    }
}

public sealed class MfaRecoveryService(UserManager<ShopUser> users, IdentityDbContext db, AuthService auth, TimeProvider time) : IMfaRecovery
{
    private async Task RequireStaff(ShopUser user)
    {
        if (!(await users.GetRolesAsync(user)).Any(ShopPermissions.Roles.ContainsKey)) throw MfaAccount.Invalid();
    }
    public async Task<RecoveryCodeStatus> StatusAsync(string userId, CancellationToken ct)
    {
        var user = await users.FindByIdAsync(userId) ?? throw MfaAccount.Invalid();
        await RequireStaff(user);
        if (!user.IsActive || !user.TwoFactorEnabled || user.MfaRecoveryPending || await users.IsLockedOutAsync(user)) throw MfaAccount.Invalid();
        return new(1, await db.MfaRecoveryCodes.CountAsync(x => x.UserId == userId && x.ConsumedAt == null, ct));
    }
    public async Task<RecoveryCodeBatch> GenerateAsync(string userId, string stamp, GenerateRecoveryCodesInput input, string traceId, CancellationToken ct)
    {
        RecoveryCodes.Validate(input);
        await using var transaction = await MfaAccount.BeginAsync(db, userId, ct);
        var user = await MfaAccount.CurrentAsync(users, db, userId, stamp, ct); await RequireStaff(user);
        if (!user.TwoFactorEnabled || user.MfaRecoveryPending) throw MfaAccount.Invalid();
        var passwordValid = await users.CheckPasswordAsync(user, input.Password);
        var key = await users.GetAuthenticatorKeyAsync(user);
        var counter = key is null ? null : Totp.MatchingStep(key, input.Code, time.GetUtcNow());
        if (!passwordValid || counter is null || user.LastMfaCounter >= counter) await MfaAccount.FailedAsync(users, db, user, "MFA_CODES_FAILED", traceId, transaction, ct);
        user.LastMfaCounter = counter;
        MfaAccount.Ensure(await users.ResetAccessFailedCountAsync(user));
        MfaAccount.Ensure(await users.UpdateAsync(user));
        var codes = Enumerable.Range(0, RecoveryCodes.BatchSize).Select(_ => RecoveryCodes.NewCode()).ToArray();
        var now = time.GetUtcNow();
        await db.MfaRecoveryCodes.Where(x => x.UserId == userId).ExecuteDeleteAsync(ct);
        db.MfaRecoveryCodes.AddRange(codes.Select(code => new MfaRecoveryCode { UserId = userId, CodeHash = RecoveryCodes.Hash(userId, RecoveryCodes.Normalize(code)!), CreatedAt = now }));
        db.Audit.Add(new() { ActorId = userId, Action = "MFA_CODES_GENERATED", Resource = "/api/auth/mfa/recovery-codes", TraceId = traceId, At = now });
        await db.SaveChangesAsync(ct); await transaction.CommitAsync(ct);
        return new(1, codes, now);
    }
    public async Task<AuthResult> RecoverAsync(string userId, string stamp, RecoverMfaInput input, string traceId, CancellationToken ct)
    {
        var normalized = RecoveryCodes.Validate(input);
        await using var transaction = await MfaAccount.BeginAsync(db, userId, ct);
        var user = await MfaAccount.CurrentAsync(users, db, userId, stamp, ct); await RequireStaff(user);
        if (!user.TwoFactorEnabled && !user.MfaRecoveryPending) throw MfaAccount.Invalid();
        var passwordValid = await users.CheckPasswordAsync(user, input.Password);
        var hash = RecoveryCodes.Hash(userId, normalized); var now = time.GetUtcNow();
        // No code is consumed when the password is wrong; concurrent attempts serialize per account.
        var claimed = passwordValid ? await db.MfaRecoveryCodes.Where(x => x.UserId == userId && x.CodeHash == hash && x.ConsumedAt == null).ExecuteUpdateAsync(s => s.SetProperty(x => x.ConsumedAt, now), ct) : 0;
        if (claimed != 1) await MfaAccount.FailedAsync(users, db, user, "MFA_RECOVERY_FAILED", traceId, transaction, ct);
        MfaAccount.Ensure(await users.SetTwoFactorEnabledAsync(user, false));
        MfaAccount.Ensure(await users.ResetAuthenticatorKeyAsync(user));
        user.MfaRecoveryPending = true; user.RequireMfa = true; user.LastMfaCounter = null;
        MfaAccount.Ensure(await users.ResetAccessFailedCountAsync(user));
        MfaAccount.Ensure(await users.UpdateSecurityStampAsync(user));
        await db.Sessions.Where(x => x.UserId == userId && x.RevokedAt == null).ExecuteUpdateAsync(s => s.SetProperty(x => x.RevokedAt, now), ct);
        db.Audit.Add(new() { ActorId = userId, Action = "MFA_RECOVERY_STARTED", Resource = "/api/auth/mfa/recover", TraceId = traceId, At = now });
        await db.SaveChangesAsync(ct); await transaction.CommitAsync(ct);
        // A recovery proof only authorizes enrollment; no refresh token or admin permissions yet.
        return auth.PendingMfa(user, recoveryEnrollment: true);
    }
}
