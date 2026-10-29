using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Identity;

public sealed partial class AuthService
{
    private AuthResult PendingInitialPassword(ShopUser user) => new(
        CreateAccess(user, [], [], "staff_password_change", 5), 300, null, false, false,
        new { user.Id, user.DisplayName, user.UserName }, RequiresPasswordChange: true);

    public async Task<AuthResult> ChangeInitialStaffPasswordAsync(string userId, string stamp,
        ChangeInitialStaffPasswordInput input, string traceId, CancellationToken ct)
    {
        StaffProvisioningRules.Password(input.NewPassword);
        await using var transaction = await MfaAccount.BeginAsync(db, userId, ct);
        var user = await MfaAccount.CurrentAsync(users, db, userId, stamp, ct);
        if (!user.ProvisionedByAdministrator || !user.MustChangePassword
            || !(await users.GetRolesAsync(user)).Any(ShopPermissions.Roles.ContainsKey)) throw Invalid();
        if (await users.CheckPasswordAsync(user, input.NewPassword))
            throw new BusinessException("staff_password_reused", "Choose a password different from the initial password.");
        foreach (var validator in users.PasswordValidators)
            Ensure(await validator.ValidateAsync(users, user, input.NewPassword));

        // Stamp rotation consumes this grant and fences concurrent password/MFA transitions.
        user.PasswordHash = users.PasswordHasher.HashPassword(user, input.NewPassword);
        user.MustChangePassword = false;
        user.RequireMfa = true;
        Ensure(await users.UpdateSecurityStampAsync(user));
        await db.Sessions.Where(x => x.UserId == userId && x.RevokedAt == null)
            .ExecuteUpdateAsync(update => update.SetProperty(x => x.RevokedAt, time.GetUtcNow()), ct);
        db.Audit.Add(new() { ActorId = userId, Action = "STAFF_INITIAL_PASSWORD_CHANGED",
            Resource = "/staff/" + userId, TraceId = traceId, At = time.GetUtcNow() });
        await db.SaveChangesAsync(ct);
        var result = PendingMfa(user);
        await transaction.CommitAsync(ct);
        return result;
    }
}
