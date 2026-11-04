using System.Data;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Identity;

public static class FirstAdministratorRules
{
    public static CreateStaffAccountInput Validate(string? userName, string? password, string? displayName)
    {
        if (string.IsNullOrWhiteSpace(userName) || password is null || password.Length < 16)
            throw new InvalidOperationException("Set Bootstrap__AdminUserName and Bootstrap__AdminPassword (at least 16 characters) for the explicit first-administrator command.");
        return StaffProvisioningRules.Validate(new(
            "11111111-1111-4111-8111-111111111111", userName,
            displayName ?? "مدیر فروشگاه", password, ["Administrator"]));
    }
}

public sealed partial class AuthService
{
    public async Task<bool> BootstrapFirstAdministratorAsync(string? userName, string? password, string? displayName, CancellationToken ct)
    {
        var input = FirstAdministratorRules.Validate(userName, password, displayName);
        if (!db.Database.IsSqlServer()) throw new InvalidOperationException("First-administrator bootstrap requires SQL Server.");
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        // The one-shot operator command must also remain create-only when two
        // operators run it concurrently against an empty installation.
        await db.Database.ExecuteSqlRawAsync("""
            DECLARE @result int;
            EXEC @result = sys.sp_getapplock @Resource = N'Sayman.FirstAdministrator',
                @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 15000;
            IF @result < 0 THROW 51000, 'Could not acquire the first-administrator bootstrap lock.', 1;
            """, ct);
        if (await roles.RoleExistsAsync("Administrator") && (await users.GetUsersInRoleAsync("Administrator")).Count > 0) {
            await transaction.CommitAsync(ct);
            return false;
        }
        if (await users.FindByNameAsync(input.UserName) is not null)
            throw new BusinessException("bootstrap_username_conflict", "The bootstrap username already exists. Existing accounts are never changed or promoted by this command.");
        foreach (var role in ShopPermissions.Roles.Keys)
            if (!await roles.RoleExistsAsync(role)) MfaAccount.Ensure(await roles.CreateAsync(new IdentityRole(role)));
        var admin = new ShopUser {
            UserName = input.UserName, DisplayName = input.DisplayName, IsActive = true,
            ProvisionedByAdministrator = true, MustChangePassword = true, RequireMfa = true,
            CreatedAt = time.GetUtcNow()
        };
        MfaAccount.Ensure(await users.CreateAsync(admin, input.InitialPassword));
        MfaAccount.Ensure(await users.AddToRoleAsync(admin, "Administrator"));
        db.Audit.Add(new() {
            ActorId = admin.Id, Action = "FIRST_ADMINISTRATOR_BOOTSTRAPPED",
            Resource = "operator/first-administrator", TraceId = "bootstrap-admin", At = time.GetUtcNow()
        });
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return true;
    }
}
