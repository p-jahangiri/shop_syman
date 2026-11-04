using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Shop.Modules.Identity;

internal static class StaffAuthorization
{
    internal static async Task<ShopUser> RequireAdministratorAsync(UserManager<ShopUser> users,
        IdentityDbContext db, string actorId, string stamp, CancellationToken ct)
    {
        if (db.Database.CurrentTransaction is null)
            throw new InvalidOperationException("Staff commands require the audited administrative transaction.");
        // Membership changes and provisioning serialize through the same role row.
        await db.Database.ExecuteSqlRawAsync("SELECT [Id] FROM [identity].[AspNetRoles] WITH (UPDLOCK,HOLDLOCK) WHERE [NormalizedName]=N'ADMINISTRATOR'", ct);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT [Id] FROM [identity].[AspNetUsers] WITH (UPDLOCK,HOLDLOCK) WHERE [Id]={actorId}", ct);
        var actor = await MfaAccount.CurrentAsync(users, db, actorId, stamp, ct);
        if (!actor.TwoFactorEnabled || actor.MfaRecoveryPending || actor.MustChangePassword
            || !StaffProvisioningRules.ManagedStaffContact(actor) || !await users.IsInRoleAsync(actor, "Administrator")) throw MfaAccount.Invalid();
        return actor;
    }
}
