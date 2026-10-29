using System.Data;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Shop.SharedKernel;

namespace Shop.Modules.Identity;
public sealed class ShopUser : IdentityUser
{
    public string DisplayName { get; set; } = "";
    public bool IsActive { get; set; } = true;
    public bool RequireMfa { get; set; }
    public bool ProvisionedByAdministrator { get; set; }
    public bool MustChangePassword { get; set; }
    public long? LastMfaCounter { get; set; }
    public bool MfaRecoveryPending { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
public sealed class RefreshSession
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string UserId { get; set; } = "";
    public string TokenHash { get; set; } = "";
    public string FamilyId { get; set; } = "";
    public string SecurityStamp { get; set; } = "";
    public bool MfaVerified { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
    public byte[] Version { get; set; } = [];
}
public sealed class AuditEvent
{
    public long Id { get; set; }
    public string ActorId { get; set; } = "";
    public string Action { get; set; } = "";
    public string Resource { get; set; } = "";
    public string TraceId { get; set; } = "";
    public DateTimeOffset At { get; set; } = DateTimeOffset.UtcNow;
}
public sealed partial class IdentityDbContext(DbContextOptions<IdentityDbContext> options) : IdentityDbContext<ShopUser>(options)
{
    public DbSet<RefreshSession> Sessions => Set<RefreshSession>();
    public DbSet<AuditEvent> Audit => Set<AuditEvent>();
    public DbSet<MfaRecoveryCode> MfaRecoveryCodes => Set<MfaRecoveryCode>();
    protected override void OnModelCreating(ModelBuilder b)
    {
        base.OnModelCreating(b); b.HasDefaultSchema("identity");
        b.Entity<ShopUser>(e => { e.Property(x => x.DisplayName).HasMaxLength(200); e.HasIndex(x => x.NormalizedEmail).IsUnique().HasFilter("[NormalizedEmail] IS NOT NULL"); e.HasIndex(x => x.PhoneNumber).IsUnique().HasFilter("[PhoneNumber] IS NOT NULL"); });
        b.Entity<RefreshSession>(e => { e.HasKey(x => x.Id); e.Property(x => x.Id).HasMaxLength(64); e.Property(x => x.UserId).HasMaxLength(450); e.Property(x => x.TokenHash).HasMaxLength(64); e.Property(x => x.FamilyId).HasMaxLength(64); e.Property(x => x.SecurityStamp).HasMaxLength(100); e.Property(x => x.Version).IsRowVersion(); e.HasIndex(x => x.TokenHash).IsUnique(); e.HasIndex(x => x.FamilyId); e.HasOne<ShopUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade); });
        b.Entity<AuditEvent>(e => { e.HasKey(x => x.Id); e.Property(x => x.ActorId).HasMaxLength(450); e.Property(x => x.Action).HasMaxLength(100); e.Property(x => x.Resource).HasMaxLength(500); e.Property(x => x.TraceId).HasMaxLength(100); e.HasIndex(x => x.At); });
        b.Entity<MfaRecoveryCode>(e => { e.HasKey(x => new { x.UserId, x.CodeHash }).IsClustered(false); e.Property(x => x.UserId).HasMaxLength(450); e.Property(x => x.CodeHash).HasMaxLength(64).IsUnicode(false); e.HasOne<ShopUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade); });
        StaffProvisioningModel.Configure(b);
    }
}
public static class ShopPermissions
{
    public static readonly string[] All = ["catalog.read", "catalog.write", "inventory.read", "inventory.write", "cms.read", "cms.write", "finance.read", "finance.write", "sales.read", "sales.write", "audit.read", "customers.read", "staff.read", "staff.write", "support.read", "support.write", "credit.read", "credit.write"];
    public static readonly IReadOnlyDictionary<string, string[]> Roles = new Dictionary<string, string[]> {
        ["Administrator"] = All,
        ["CatalogManager"] = ["catalog.read", "catalog.write", "finance.read"],
        ["InventoryManager"] = ["catalog.read", "inventory.read", "inventory.write"],
        ["ContentManager"] = ["catalog.read", "cms.read", "cms.write"],
        ["FinanceManager"] = ["catalog.read", "finance.read", "finance.write", "sales.read"],
        ["SalesManager"] = ["catalog.read", "sales.read", "sales.write"],
        ["SupportAgent"] = ["support.read", "support.write"],
        ["CreditReviewer"] = ["credit.read", "credit.write"]
    };
}
public record AuthConfiguration(string SigningKey, string Issuer, string Audience);
public record PasswordLogin(string Identifier, string Password);
public record MfaVerification(string Code);
public record AuthResult(string AccessToken, int ExpiresIn, string? RefreshToken, bool RequiresMfa, bool RequiresEnrollment, object User, bool RequiresRecovery = false, bool RequiresPasswordChange = false)
{
    [System.Text.Json.Serialization.JsonIgnore] public DateTimeOffset? RefreshExpiresAt { get; init; }
}
public sealed partial class AuthService(UserManager<ShopUser> users, RoleManager<IdentityRole> roles, IdentityDbContext db, AuthConfiguration configuration, TimeProvider time)
{
    public const int PasswordHashIterations = 220_000;
    private static readonly PasswordHasher<ShopUser> DummyHasher = new(Microsoft.Extensions.Options.Options.Create(new PasswordHasherOptions { IterationCount = PasswordHashIterations }));
    private static readonly string DummyHash = DummyHasher.HashPassword(new(), Convert.ToHexString(RandomNumberGenerator.GetBytes(32)));
    private static string Hash(string token) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
    private static BusinessException Invalid() => new("invalid_credentials", "The supplied credentials or verification are invalid.");
    public async Task<AuthResult> PasswordAsync(PasswordLogin input, bool emailAllowed, bool usernameAllowed, bool adminEntry, CancellationToken ct)
    {
        if (input.Identifier.Length is < 1 or > 256 || input.Password.Length is < 1 or > 128 || input.Identifier.Contains('@') && !emailAllowed || !input.Identifier.Contains('@') && !usernameAllowed) throw Invalid();
        var user = input.Identifier.Contains('@') ? await users.FindByEmailAsync(input.Identifier.Trim()) : await users.FindByNameAsync(input.Identifier.Trim());
        if (user is null) { _ = DummyHasher.VerifyHashedPassword(new(), DummyHash, input.Password); throw Invalid(); }
        if (!user.IsActive || await users.IsLockedOutAsync(user)) throw Invalid();
        if (!await users.CheckPasswordAsync(user, input.Password)) { await users.AccessFailedAsync(user); throw Invalid(); }
        var isAdmin = (await users.GetRolesAsync(user)).Any(ShopPermissions.Roles.ContainsKey);
        if (adminEntry != isAdmin) throw Invalid();
        if (!user.EmailConfirmed && !user.PhoneNumberConfirmed && !(adminEntry && isAdmin && user.ProvisionedByAdministrator)) throw Invalid();
        if (user.MustChangePassword) {
            if (!adminEntry || !user.ProvisionedByAdministrator) throw Invalid();
            return PendingInitialPassword(user);
        }
        if (user.RequireMfa || isAdmin || user.TwoFactorEnabled) return PendingMfa(user);
        await users.ResetAccessFailedCountAsync(user);
        return await IssueAsync(user, null, ct);
    }
    internal AuthResult PendingMfa(ShopUser user, bool recoveryEnrollment = false, DateTimeOffset? recoveryDeadline = null) => new(CreateAccess(user, [], [], "mfa_pending", 5, recoveryEnrollment, recoveryDeadline), 300, null, true, !user.TwoFactorEnabled && (!user.MfaRecoveryPending || recoveryEnrollment), new { user.Id, user.DisplayName, user.UserName }, user.MfaRecoveryPending && !recoveryEnrollment);
    public async Task<object> SetupMfaAsync(string userId, string stamp, bool recoveryEnrollment, DateTimeOffset? recoveryDeadline, CancellationToken ct)
    {
        await using var transaction = await MfaAccount.BeginAsync(db, userId, ct);
        var user = await MfaAccount.CurrentAsync(users, db, userId, stamp, ct);
        if (user.MustChangePassword) throw Invalid();
        if (user.MfaRecoveryPending && !recoveryEnrollment) throw Invalid();
        if (recoveryEnrollment && (recoveryDeadline is null || recoveryDeadline <= DateTimeOffset.UtcNow)) throw Invalid();
        if (user.TwoFactorEnabled) throw new BusinessException("mfa_already_enabled", "Use the existing authenticator. Re-enrollment requires account recovery.");
        var key = await users.GetAuthenticatorKeyAsync(user);
        if (key is null) { Ensure(await users.ResetAuthenticatorKeyAsync(user)); key = await users.GetAuthenticatorKeyAsync(user); }
        await transaction.CommitAsync(ct);
        return new { Secret = key, AccessToken = PendingMfa(user, recoveryEnrollment, recoveryDeadline).AccessToken, Account = user.UserName, Issuer = "Sayman", Algorithm = "SHA1", Digits = 6, Period = 30 };
    }
    public async Task<AuthResult> VerifyMfaAsync(string userId, string stamp, bool recoveryEnrollment, string code, string traceId, CancellationToken ct)
    {
        await using var transaction = await MfaAccount.BeginAsync(db, userId, ct);
        var user = await MfaAccount.CurrentAsync(users, db, userId, stamp, ct);
        if (user.MustChangePassword) throw Invalid();
        if (user.MfaRecoveryPending && !recoveryEnrollment) throw Invalid();
        if (!user.IsActive || await users.IsLockedOutAsync(user) || code.Length != 6 || code.Any(c => c is < '0' or > '9')) throw Invalid();
        var key = await users.GetAuthenticatorKeyAsync(user) ?? throw Invalid();
        var matched = Totp.MatchingStep(key, code, time.GetUtcNow());
        if (matched is null) await MfaAccount.FailedAsync(users, db, user, "MFA_VERIFY_FAILED", traceId, transaction, ct);
        var claimed = await users.Users.Where(u => u.Id == userId && (u.LastMfaCounter == null || u.LastMfaCounter < matched)).ExecuteUpdateAsync(s => s.SetProperty(u => u.LastMfaCounter, matched), ct);
        if (claimed != 1) throw Invalid();
        user.LastMfaCounter = matched;
        var recovered = user.MfaRecoveryPending; user.MfaRecoveryPending = false;
        if (!user.TwoFactorEnabled) Ensure(await users.SetTwoFactorEnabledAsync(user, true));
        if (recovered) {
            await db.MfaRecoveryCodes.Where(x => x.UserId == userId).ExecuteDeleteAsync(ct);
            db.Audit.Add(new() { ActorId = userId, Action = "MFA_RECOVERY_COMPLETED", Resource = "/api/auth/mfa/verify", TraceId = traceId });
        }
        await users.ResetAccessFailedCountAsync(user);
        var result = await IssueAsync(user, null, ct, true); await transaction.CommitAsync(ct); return result;
    }
    private string CreateAccess(ShopUser user, IEnumerable<string> userRoles, IEnumerable<string> permissions, string kind, int minutes, bool recoveryEnrollment = false, DateTimeOffset? recoveryDeadline = null, string? sessionFamily = null, bool mfaVerified = false)
    {
        var claims = new List<Claim> { new("sub", user.Id), new("name", user.UserName!), new("display_name", user.DisplayName), new("sst", user.SecurityStamp!), new("token_kind", kind), new("jti", Guid.NewGuid().ToString("N")) };
        claims.Add(new("iat", DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture), ClaimValueTypes.Integer64));
        if (kind == "access") {
            if (sessionFamily is null) throw new InvalidOperationException("An access token requires a persisted session family.");
            claims.Add(new("sid", sessionFamily));
            if (mfaVerified) claims.Add(new("amr", "mfa"));
        }
        if (recoveryEnrollment && kind == "mfa_pending") claims.Add(new("mfa_recovery", "verified"));
        claims.AddRange(userRoles.Select(r => new Claim("role", r))); claims.AddRange(permissions.Select(p => new Claim("permission", p)));
        var expiry = DateTime.UtcNow.AddMinutes(minutes);
        if (recoveryEnrollment && recoveryDeadline is { } deadline && deadline.UtcDateTime < expiry) expiry = deadline.UtcDateTime;
        var token = new JwtSecurityToken(configuration.Issuer, configuration.Audience, claims, DateTime.UtcNow.AddSeconds(-5), expiry, new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(configuration.SigningKey)), SecurityAlgorithms.HmacSha256));
        return new JwtSecurityTokenHandler().WriteToken(token);
    }
    private async Task<AuthResult> IssueAsync(ShopUser user, string? familyId, CancellationToken ct, bool mfaVerified = false, DateTimeOffset? absoluteExpiry = null)
    {
        if (user.MustChangePassword) throw Invalid();
        var userRoles = await users.GetRolesAsync(user); var permissions = userRoles.Where(ShopPermissions.Roles.ContainsKey).SelectMany(r => ShopPermissions.Roles[r]).Distinct().ToArray();
        var raw = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32));
        var session = new RefreshSession { UserId = user.Id, TokenHash = Hash(raw), FamilyId = familyId ?? Guid.NewGuid().ToString("N"), SecurityStamp = user.SecurityStamp!, MfaVerified = mfaVerified, ExpiresAt = absoluteExpiry ?? DateTimeOffset.UtcNow.AddDays(7) };
        db.Sessions.Add(session); await db.SaveChangesAsync(ct);
        return new(CreateAccess(user, userRoles, permissions, "access", 10, sessionFamily: session.FamilyId, mfaVerified: mfaVerified), 600, raw, false, false, new { user.Id, user.DisplayName, user.UserName, user.Email, Roles = userRoles, Permissions = permissions }) { RefreshExpiresAt = session.ExpiresAt };
    }
    public async Task<AuthResult> RefreshAsync(string token, CancellationToken ct, bool? adminClient = null)
    {
        if (token.Length != 64 || token.Any(c => !char.IsAsciiHexDigit(c))) throw Invalid();
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var hash = Hash(token); var session = await db.Sessions.SingleOrDefaultAsync(s => s.TokenHash == hash, ct);
        if (session is null) throw Invalid();
        if (session.RevokedAt is not null) {
            await db.Sessions.Where(s => s.FamilyId == session.FamilyId && s.RevokedAt == null).ExecuteUpdateAsync(s => s.SetProperty(x => x.RevokedAt, DateTimeOffset.UtcNow), ct);
            var owner = await users.FindByIdAsync(session.UserId); if (owner is not null && owner.SecurityStamp == session.SecurityStamp) Ensure(await users.UpdateSecurityStampAsync(owner));
            await transaction.CommitAsync(ct); throw Invalid();
        }
        var user = await users.FindByIdAsync(session.UserId);
        if (session.ExpiresAt <= DateTimeOffset.UtcNow || user is null || !user.IsActive || user.MustChangePassword || user.SecurityStamp != session.SecurityStamp || await users.IsLockedOutAsync(user)) throw Invalid();
        var isStaff = (await users.GetRolesAsync(user)).Any(ShopPermissions.Roles.ContainsKey);
        if (adminClient is not null && adminClient != isStaff) throw Invalid();
        if ((user.RequireMfa || user.TwoFactorEnabled || isStaff) && !session.MfaVerified) throw Invalid();
        // Rotation must not extend a stolen session indefinitely. The oldest
        // expiry is the original seven-day deadline, including legacy families.
        var absoluteExpiry = await db.Sessions.Where(s => s.FamilyId == session.FamilyId && s.UserId == session.UserId).MinAsync(s => s.ExpiresAt, ct);
        if (absoluteExpiry <= DateTimeOffset.UtcNow) throw Invalid();
        session.RevokedAt = DateTimeOffset.UtcNow; await db.SaveChangesAsync(ct);
        var result = await IssueAsync(user, session.FamilyId, ct, session.MfaVerified, absoluteExpiry); await transaction.CommitAsync(ct); return result;
    }
    public async Task LogoutAsync(string? token, CancellationToken ct)
    {
        if (token is null || token.Length != 64) return;
        var hash = Hash(token); var session = await db.Sessions.AsNoTracking().SingleOrDefaultAsync(s => s.TokenHash == hash, ct);
        if (session is not null) await db.Sessions.Where(s => s.FamilyId == session.FamilyId && s.RevokedAt == null).ExecuteUpdateAsync(s => s.SetProperty(x => x.RevokedAt, DateTimeOffset.UtcNow), ct);
    }
    public async Task BootstrapAdminAsync(string password, CancellationToken ct)
    {
        foreach (var name in ShopPermissions.Roles.Keys) if (!await roles.RoleExistsAsync(name)) Ensure(await roles.CreateAsync(new(name)));
        if ((await users.GetUsersInRoleAsync("Administrator")).Count > 0) return;
        if (password.Length < 16) throw new InvalidOperationException("Bootstrap administrator password must contain at least 16 characters.");
        var admin = new ShopUser { UserName = "admin", Email = "admin@sayman.local", EmailConfirmed = true, DisplayName = "مدیر سایمان", RequireMfa = true };
        Ensure(await users.CreateAsync(admin, password)); Ensure(await users.AddToRoleAsync(admin, "Administrator"));
    }
    private static void Ensure(IdentityResult result) { if (!result.Succeeded) throw new BusinessException("identity_validation", string.Join(" ", result.Errors.Select(e => e.Description))); }
}
