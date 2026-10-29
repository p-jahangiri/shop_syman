using System.Security.Claims;
using Microsoft.EntityFrameworkCore;

namespace Shop.Modules.Identity;

public sealed partial class AuthService
{
    // The signature alone does not keep a logged-out or changed staff session valid.
    // A stable family survives refresh rotation; logout revokes its live SQL rows.
    public async Task<bool> ValidatePrincipalAsync(ClaimsPrincipal principal, CancellationToken ct)
    {
        string? One(string type)
        {
            var values = principal.FindAll(type).Select(c => c.Value).ToArray();
            return values.Length == 1 ? values[0] : null;
        }
        var subject = One("sub");
        var stamp = One("sst");
        var kind = One("token_kind");
        if (subject is null || stamp is null || kind is not ("access" or "mfa_pending" or "staff_password_change")) return false;
        var user = await users.FindByIdAsync(subject);
        if (user is null || !user.IsActive || user.SecurityStamp != stamp || await users.IsLockedOutAsync(user)
            || user.MustChangePassword != (kind == "staff_password_change")) return false;
        if (kind != "access") return true;

        var family = One("sid");
        if (!Guid.TryParseExact(family, "N", out _) || One("jti") is null) return false;
        var currentRoles = await users.GetRolesAsync(user);
        if (!currentRoles.ToHashSet(StringComparer.Ordinal).SetEquals(principal.FindAll("role").Select(c => c.Value))) return false;
        var permissions = currentRoles.Where(ShopPermissions.Roles.ContainsKey).SelectMany(role => ShopPermissions.Roles[role]);
        // A correctly signed, reduced scope may remove privileges, never add
        // privileges absent from the account's current roles.
        if (!permissions.ToHashSet(StringComparer.Ordinal).IsSupersetOf(principal.FindAll("permission").Select(c => c.Value))) return false;
        var requiresMfa = user.RequireMfa || user.TwoFactorEnabled || currentRoles.Any(ShopPermissions.Roles.ContainsKey);
        if (requiresMfa && !principal.HasClaim("amr", "mfa")) return false;
        var now = DateTimeOffset.UtcNow;
        return await db.Sessions.AsNoTracking().AnyAsync(s => s.FamilyId == family && s.UserId == subject
            && s.SecurityStamp == stamp && s.RevokedAt == null && s.ExpiresAt > now && (!requiresMfa || s.MfaVerified), ct);
    }
}
