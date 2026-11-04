using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Identity;

public sealed class SmsAdministratorAuthorization(UserManager<ShopUser> users, IdentityDbContext db) : ISmsAdministratorAuthorization
{
    public async Task RequireAsync(string actorId, string stamp, CancellationToken ct) =>
        _ = await StaffAuthorization.RequireAdministratorAsync(users, db, actorId, stamp, ct);
}

public sealed class SmsOtpChallengeInvalidator(IdentityDbContext db, TimeProvider clock) : ISmsOtpChallengeInvalidator
{
    public async Task InvalidateAsync(CancellationToken ct)
    {
        if (db.Database.CurrentTransaction is null)
            throw new InvalidOperationException("SMS changes require the shared audited transaction.");
        await db.CustomerOtpChallenges.Where(c => c.ConsumedAt == null && c.SupersededAt == null)
            .ExecuteUpdateAsync(set => set.SetProperty(c => c.SupersededAt, clock.GetUtcNow()), ct);
    }
}

public sealed class SmsVerifiedRecipientReader(IdentityDbContext db, UserManager<ShopUser> users) : ISmsVerifiedRecipientReader
{
    public async Task<SmsVerifiedRecipient?> ReadAsync(string ownerId, CancellationToken ct)
    {
        var user = await users.FindByIdAsync(ownerId);
        if (user is null || !user.IsActive || !user.PhoneNumberConfirmed || user.MfaRecoveryPending || user.MustChangePassword
            || !CustomerOtpRules.TryNormalizePhone(user.PhoneNumber, out var phone)
            || user.CanonicalPhone is not null && user.CanonicalPhone != phone || (await users.GetRolesAsync(user)).Count != 0) return null;
        var owners = await CustomerPhoneOwnership.FindAsync(db, phone, ct);
        if (owners.Length != 1 || owners[0] != user.Id) return null;
        var name = user.DisplayName.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? "مشتری";
        // A display name is optional. Avoid cutting UTF-16 pairs or sending
        // controls/format marks; use the generic name when it cannot fit.
        if (name.Length > 25 || !name.All(c => !char.IsSurrogate(c) && !char.IsControl(c)
            && char.GetUnicodeCategory(c) != System.Globalization.UnicodeCategory.Format)) name = "مشتری";
        return new(phone, name);
    }
}
