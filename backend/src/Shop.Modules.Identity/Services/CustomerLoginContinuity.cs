using System.Data;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;
namespace Shop.Modules.Identity;

public sealed record CustomerLoginIdentifier(string Value,bool IsEmail);
public static class CustomerLoginContinuityRules
{
    // PasswordAsync checks raw length, dispatches solely on '@', then trims.
    // A username containing '@' is never a username-path candidate. It can only
    // be a usable email alias if the real normalized email lookup resolves self.
    public static CustomerLoginIdentifier[] Identifiers(string? userName,string? email,bool emailEnabled,bool usernameEnabled)
        =>new[]{userName,email}.Where(v=>v is{Length:>0 and<=256}).Select(v=>v!.Trim())
            .Where(v=>v.Length>0&&(v.Contains('@')?emailEnabled:usernameEnabled))
            .Distinct(StringComparer.Ordinal).Select(v=>new CustomerLoginIdentifier(v,v.Contains('@'))).ToArray();
    public static BusinessException Conflict()=>new("customer_login_continuity_conflict","Publishing these login settings would leave an existing customer without a usable sign-in identifier. Keep both supported password methods enabled or review the affected account configuration before publishing.");
}

public sealed class CustomerLoginContinuity(IdentityDbContext db,ILookupNormalizer normalizer,ISmsOtpConfigurationSource? workspace=null):ICustomerLoginContinuity
{
    private sealed record Customer(string Id, string? UserName, string? Email, bool HasPassword,
        string? PhoneNumber, string? CanonicalPhone, bool PhoneConfirmed, bool MustChangePassword,
        bool RecoveryPending);

    public Task RequireAsync(bool emailEnabled, bool usernameEnabled, CancellationToken ct)
    {
        // Compatibility entry point for callers predating OTP support. All live
        // CMS/settings operations use the explicit three-method overload below.
        if (emailEnabled && usernameEnabled) return Task.CompletedTask;
        if (!emailEnabled && !usernameEnabled) throw CustomerLoginContinuityRules.Conflict();
        if (db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel != IsolationLevel.Serializable)
            throw new InvalidOperationException("Restrictive login publication requires the root Serializable Identity/CMS transaction.");
        return RequireAsync(emailEnabled, usernameEnabled, false, ct);
    }

    public async Task RequireAsync(bool emailEnabled, bool usernameEnabled, bool mobileOtpEnabled, CancellationToken ct)
    {
        var names=ShopPermissions.Roles.Keys.ToArray();
        var candidateRoles=await db.Roles.AsNoTracking().Where(r=>r.Name!=null&&names.Contains(r.Name)).Select(r=>new{r.Id,r.Name}).ToArrayAsync(ct);
        // Match AuthService's exact known-role membership after the SQL lookup;
        // a legacy differently-cased unknown role must not evade customer checks.
        var staffRoles=candidateRoles.Where(r=>r.Name is not null&&ShopPermissions.Roles.ContainsKey(r.Name)).Select(r=>r.Id).ToArray();
        var eligible = db.Users.AsNoTracking().Where(u => u.IsActive && (u.EmailConfirmed || u.PhoneNumberConfirmed)
            && !db.UserRoles.Any(role => role.UserId == u.Id && staffRoles.Contains(role.RoleId)));
        // Keep legacy seed/no-op calls compatible, but passwordless OTP-only
        // customers must participate even when both password flags remain on.
        if (emailEnabled && usernameEnabled
            && !await eligible.AnyAsync(u => u.PasswordHash == null, ct)) return;
        if (!emailEnabled && !usernameEnabled && !mobileOtpEnabled) throw CustomerLoginContinuityRules.Conflict();
        if(db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel!=IsolationLevel.Serializable)
            throw new InvalidOperationException("Restrictive login publication requires the root Serializable Identity/CMS transaction.");
        var configured = workspace is null ? null : await workspace.ReadAsync(ct);
        var mobileAvailable = mobileOtpEnabled && (configured is not null ? configured.Available : await db.CustomerSmsSettings.AsNoTracking()
            .AnyAsync(x => x.Id == "customer-sms" && x.Enabled && x.Mode == "live" && x.TemplateId != 123456 && x.ProtectedApiKey != null, ct));
        if (!emailEnabled && !usernameEnabled && !mobileAvailable)
            throw CustomerLoginContinuityRules.Conflict();
        string? after=null;
        while(true){
            // Only a non-null password predicate goes to SQL. Hash values are
            // never materialized, compared, logged or returned by this guard.
            var page = after is null ? eligible : eligible.Where(u => string.Compare(u.Id, after) > 0);
            var customers=await page.OrderBy(u=>u.Id).Select(u=>new Customer(u.Id,u.UserName,u.Email,
                u.PasswordHash != null, u.PhoneNumber, u.CanonicalPhone, u.PhoneNumberConfirmed,
                u.MustChangePassword, u.MfaRecoveryPending)).Take(256).ToArrayAsync(ct);
            foreach(var customer in customers){
                var reachable=false;
                foreach(var identifier in CustomerLoginContinuityRules.Identifiers(customer.UserName,customer.Email,
                    emailEnabled && customer.HasPassword,usernameEnabled && customer.HasPassword)){
                    string? normalized;
                    try{normalized=identifier.IsEmail?normalizer.NormalizeEmail(identifier.Value):normalizer.NormalizeName(identifier.Value);}
                    catch(ArgumentException){continue;}
                    if(string.IsNullOrEmpty(normalized))continue;
                    // Include ALL users in lookup uniqueness, including inactive,
                    // unverified and staff identities. Do not rely solely on the
                    // optional-email validator or filtered SQL unique index.
                    var lookup=identifier.IsEmail?db.Users.AsNoTracking().Where(u=>u.NormalizedEmail==normalized):db.Users.AsNoTracking().Where(u=>u.NormalizedUserName==normalized);
                    var ids=await lookup.Select(u=>u.Id).Take(2).ToArrayAsync(ct);
                    if(ids.Length==1&&ids[0]==customer.Id){reachable=true;break;}
                }
                if (!reachable && mobileAvailable && customer.PhoneConfirmed && !customer.MustChangePassword
                    && !customer.RecoveryPending && CustomerOtpRules.TryNormalizePhone(customer.PhoneNumber, out var canonical)
                    && (customer.CanonicalPhone is null || customer.CanonicalPhone == canonical)
                    && !await db.UserRoles.AnyAsync(x => x.UserId == customer.Id, ct))
                {
                    var matches = await CustomerPhoneOwnership.FindAsync(db, canonical, ct);
                    reachable = matches.Length == 1 && matches[0] == customer.Id;
                }
                if(!reachable)throw CustomerLoginContinuityRules.Conflict();
            }
            if(customers.Length<256)return;
            after=customers[^1].Id;
        }
    }
}

internal static class CustomerPhoneOwnership
{
    internal static async Task<string[]> FindAsync(IdentityDbContext db, string phone, CancellationToken ct)
    {
        var matches = new List<string>();
        string? after = null;
        while (true)
        {
            var query = db.Users.AsNoTracking().Where(x => x.PhoneNumber != null || x.CanonicalPhone != null);
            if (after is not null) query = query.Where(x => string.Compare(x.Id, after) > 0);
            var rows = await query.OrderBy(x => x.Id).Select(x => new { x.Id, x.PhoneNumber, x.CanonicalPhone })
                .Take(256).ToArrayAsync(ct);
            foreach (var user in rows)
                if (user.CanonicalPhone == phone || CustomerOtpRules.TryNormalizePhone(user.PhoneNumber, out var normalized) && normalized == phone)
                    matches.Add(user.Id);
            if (matches.Count > 1 || rows.Length < 256) return matches.ToArray();
            after = rows[^1].Id;
        }
    }
}
