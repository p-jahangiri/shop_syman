using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;

namespace Shop.Modules.Identity;
// Keep authenticator secrets encrypted in SQL; the key ring is backed up separately.
public sealed class ProtectedUserStore(IdentityDbContext context, IDataProtectionProvider protection) : UserStore<ShopUser, IdentityRole, IdentityDbContext>(context)
{
    private readonly IDataProtector protector = protection.CreateProtector("Sayman.Identity.Authenticator.v1");
    public override Task SetAuthenticatorKeyAsync(ShopUser user, string key, CancellationToken cancellationToken) => base.SetAuthenticatorKeyAsync(user, protector.Protect(key), cancellationToken);
    public override async Task<string?> GetAuthenticatorKeyAsync(ShopUser user, CancellationToken cancellationToken)
    {
        var stored = await base.GetAuthenticatorKeyAsync(user, cancellationToken);
        return stored is null ? null : protector.Unprotect(stored);
    }
}
