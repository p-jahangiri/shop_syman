using System.Text;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Identity;

public sealed record CustomerAccountProfile(string Id, string UserName, string DisplayName,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? Email, bool EmailConfirmed,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? PhoneNumber, bool PhoneNumberConfirmed,
    DateTimeOffset CreatedAt, bool PasswordEnabled, bool TwoFactorEnabled, string Version);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record UpdateCustomerProfileInput(string DisplayName, string Version);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ChangeCustomerPasswordInput(string CurrentPassword, string NewPassword);

public static class CustomerAccountRules
{
    public static UpdateCustomerProfileInput Validate(UpdateCustomerProfileInput input)
    {
        if (input is null || input.DisplayName is null || input.DisplayName.Length > 200
            || input.Version is null || input.Version.Length is < 1 or > 128
            || input.Version != input.Version.Trim() || input.Version.Any(char.IsControl) || !Finite(input.Version))
            throw InvalidProfile();
        var name = input.DisplayName.Trim();
        if (name.Length == 0 || name.Any(c => char.IsControl(c)
            || c is '\u202a' or '\u202b' or '\u202c' or '\u202d' or '\u202e' or '\u2066' or '\u2067' or '\u2068' or '\u2069')
            || !Finite(name)) throw InvalidProfile();
        return input with { DisplayName = name };
    }

    public static void Validate(ChangeCustomerPasswordInput input)
    {
        if (input is null || input.CurrentPassword is null || input.CurrentPassword.Length is < 1 or > 128
            || !Finite(input.CurrentPassword))
            throw new BusinessException("invalid_current_password", "The current password is not valid.");
        if (input.NewPassword is null || input.NewPassword.Length is < 12 or > 128 || !Finite(input.NewPassword))
            throw new BusinessException("password_policy", "Use a password that meets the account password requirements.");
    }

    private static bool Finite(string value)
    {
        try { _ = new UTF8Encoding(false, true).GetByteCount(value); return true; }
        catch (EncoderFallbackException) { return false; }
    }

    private static BusinessException InvalidProfile() => new("invalid_profile", "Enter a valid display name and the current account version.");
}

public sealed partial class AuthService
{
    public async Task<CustomerAccountProfile> ReadCustomerProfileAsync(string userId, string stamp, string family, CancellationToken ct)
    {
        await using var transaction = await MfaAccount.BeginAsync(db, userId, ct);
        var user = await CustomerAccountCurrentAsync(userId, stamp, family, ct);
        var result = await CustomerAccountProfileAsync(user);
        await transaction.CommitAsync(ct);
        return result;
    }

    public async Task<CustomerAccountProfile> UpdateCustomerProfileAsync(string userId, string stamp, string family,
        UpdateCustomerProfileInput input, string traceId, CancellationToken ct)
    {
        input = CustomerAccountRules.Validate(input);
        await using var transaction = await MfaAccount.BeginAsync(db, userId, ct);
        var user = await CustomerAccountCurrentAsync(userId, stamp, family, ct);
        if (!string.Equals(user.ConcurrencyStamp, input.Version, StringComparison.Ordinal))
            throw new BusinessException("profile_conflict", "The account changed. Reload it before saving again.");
        if (!string.Equals(user.DisplayName, input.DisplayName, StringComparison.Ordinal)) {
            user.DisplayName = input.DisplayName;
            CustomerAccountEnsure(await users.UpdateAsync(user));
            CustomerAccountAudit(userId, "ACCOUNT_PROFILE_UPDATED", "/api/account/profile", traceId);
            await db.SaveChangesAsync(ct);
        }
        var result = await CustomerAccountProfileAsync(user);
        await transaction.CommitAsync(ct);
        return result;
    }

    public async Task ChangeCustomerPasswordAsync(string userId, string stamp, string family,
        ChangeCustomerPasswordInput input, string traceId, CancellationToken ct)
    {
        CustomerAccountRules.Validate(input);
        await using var transaction = await MfaAccount.BeginAsync(db, userId, ct);
        var user = await CustomerAccountCurrentAsync(userId, stamp, family, ct);
        if (!await users.CheckPasswordAsync(user, input.CurrentPassword)) {
            CustomerAccountEnsure(await users.AccessFailedAsync(user));
            CustomerAccountAudit(userId, "ACCOUNT_PASSWORD_FAILED", "/api/account/password", traceId);
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            // A wrong current password is a rejected command, not an expired
            // bearer. Returning 401 here would cause an unsafe automatic retry.
            throw new BusinessException("invalid_current_password", "The current password is not correct.");
        }
        if (await users.CheckPasswordAsync(user, input.NewPassword))
            throw new BusinessException("password_unchanged", "Choose a password different from the current password.");
        foreach (var validator in users.PasswordValidators)
            if (!(await validator.ValidateAsync(users, user, input.NewPassword)).Succeeded)
                throw new BusinessException("password_policy", "Use a password that meets the account password requirements.");

        user.PasswordHash = users.PasswordHasher.HashPassword(user, input.NewPassword);
        CustomerAccountEnsure(await users.ResetAccessFailedCountAsync(user));
        CustomerAccountEnsure(await users.UpdateSecurityStampAsync(user));
        var now = time.GetUtcNow();
        await db.Sessions.Where(session => session.UserId == userId && session.RevokedAt == null)
            .ExecuteUpdateAsync(update => update.SetProperty(session => session.RevokedAt, now), ct);
        CustomerAccountAudit(userId, "ACCOUNT_PASSWORD_CHANGED", "/api/account/password", traceId);
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
    }

    private async Task<ShopUser> CustomerAccountCurrentAsync(string userId, string stamp, string family, CancellationToken ct)
    {
        var user = await MfaAccount.CurrentAsync(users, db, userId, stamp, ct);
        if (user.MustChangePassword || user.MfaRecoveryPending
            || (await users.GetRolesAsync(user)).Any(ShopPermissions.Roles.ContainsKey)
            || !Guid.TryParseExact(family, "N", out _) || family == new string('0', 32)) throw Invalid();
        var now = time.GetUtcNow();
        // Check the persisted session after taking the account lock, rather than
        // relying on middleware's earlier read. Logout and stamp rotation fence it.
        if (!await db.Sessions.AnyAsync(session => session.UserId == userId && session.FamilyId == family
            && session.SecurityStamp == stamp && session.RevokedAt == null && session.ExpiresAt > now
            && (!(user.RequireMfa || user.TwoFactorEnabled) || session.MfaVerified), ct)) throw Invalid();
        return user;
    }

    private async Task<CustomerAccountProfile> CustomerAccountProfileAsync(ShopUser user)
    {
        if (string.IsNullOrEmpty(user.ConcurrencyStamp) || user.ConcurrencyStamp.Length > 128)
            throw new BusinessException("account_unavailable", "The account could not be read safely.");
        return new(user.Id, user.UserName ?? "", user.DisplayName, user.Email, user.EmailConfirmed,
            user.PhoneNumber, user.PhoneNumberConfirmed, user.CreatedAt.ToUniversalTime(),
            await users.HasPasswordAsync(user), user.TwoFactorEnabled, user.ConcurrencyStamp);
    }

    private void CustomerAccountAudit(string userId, string action, string resource, string traceId) =>
        db.Audit.Add(new() { ActorId = userId, Action = action, Resource = resource, TraceId = traceId, At = time.GetUtcNow() });

    private static void CustomerAccountEnsure(IdentityResult result)
    {
        if (!result.Succeeded)
            throw new BusinessException("account_unavailable", "The account operation could not be completed.");
    }
}
