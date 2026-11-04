using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Identity;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ChangeStaffPasswordInput(string CurrentPassword, string NewPassword, string Code);

public interface IStaffPassword
{
    Task ChangeAsync(string userId, string stamp, string family, ChangeStaffPasswordInput input, string traceId, CancellationToken ct);
}

public static class StaffPasswordRules
{
    public static void Validate(ChangeStaffPasswordInput input)
    {
        if (input is null) throw new BusinessException("invalid_input", "Password confirmation is required.");
        CustomerAccountRules.Validate(new ChangeCustomerPasswordInput(input.CurrentPassword, input.NewPassword));
        if (input.Code is null || input.Code.Length != 6 || input.Code.Any(c => c is < '0' or > '9'))
            throw new BusinessException("invalid_staff_confirmation", "Confirm the current password and a fresh authenticator code.");
    }
}

public sealed class StaffPasswordService(UserManager<ShopUser> users, IdentityDbContext db, TimeProvider time) : IStaffPassword
{
    public async Task ChangeAsync(string userId, string stamp, string family, ChangeStaffPasswordInput input, string traceId, CancellationToken ct)
    {
        StaffPasswordRules.Validate(input);
        await using var transaction = await MfaAccount.BeginAsync(db, userId, ct);
        var user = await MfaAccount.CurrentAsync(users, db, userId, stamp, ct);
        var now = time.GetUtcNow();
        if (user.MustChangePassword || user.MfaRecoveryPending || !user.TwoFactorEnabled
            || !(await users.GetRolesAsync(user)).Any(ShopPermissions.Roles.ContainsKey)
            || !Guid.TryParseExact(family, "N", out _) || family == new string('0', 32)
            || !await db.Sessions.AnyAsync(s => s.UserId == userId && s.FamilyId == family && s.SecurityStamp == stamp
                && s.RevokedAt == null && s.ExpiresAt > now && s.MfaVerified, ct)) throw MfaAccount.Invalid();

        var passwordValid = await users.CheckPasswordAsync(user, input.CurrentPassword);
        var key = await users.GetAuthenticatorKeyAsync(user);
        var counter = key is null ? null : Totp.MatchingStep(key, input.Code, now);
        if (!passwordValid || counter is null || user.LastMfaCounter >= counter) {
            MfaAccount.Ensure(await users.AccessFailedAsync(user));
            Audit(userId, "STAFF_PASSWORD_FAILED", traceId, now);
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            // A rejected command must not trigger a refresh/retry and count twice.
            throw new BusinessException("invalid_staff_confirmation", "Confirm the current password and a fresh authenticator code.");
        }
        if (await users.CheckPasswordAsync(user, input.NewPassword))
            throw new BusinessException("password_unchanged", "Choose a password different from the current password.");
        foreach (var validator in users.PasswordValidators)
            if (!(await validator.ValidateAsync(users, user, input.NewPassword)).Succeeded)
                throw new BusinessException("password_policy", "Use a password that meets the account password requirements.");

        user.LastMfaCounter = counter;
        user.PasswordHash = users.PasswordHasher.HashPassword(user, input.NewPassword);
        MfaAccount.Ensure(await users.ResetAccessFailedCountAsync(user));
        MfaAccount.Ensure(await users.UpdateSecurityStampAsync(user));
        await db.Sessions.Where(s => s.UserId == userId && s.RevokedAt == null)
            .ExecuteUpdateAsync(update => update.SetProperty(s => s.RevokedAt, now), ct);
        Audit(userId, "STAFF_PASSWORD_CHANGED", traceId, now);
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
    }

    private void Audit(string actor, string action, string trace, DateTimeOffset at) => db.Audit.Add(new() {
        ActorId = actor, Action = action, Resource = "/api/auth/staff/change-password", TraceId = trace, At = at
    });
}
