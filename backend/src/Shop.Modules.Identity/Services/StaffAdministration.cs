using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Globalization;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Identity;

public sealed record StaffRow(string Id, string UserName, string DisplayName, bool IsActive, bool TwoFactorEnabled, bool MfaRecoveryPending, DateTimeOffset CreatedAt, string Version, string[] Roles,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)] bool RequiresPasswordChange = false,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)] bool ProvisionedByAdministrator = false);
public sealed record StaffPage(int SchemaVersion, int PageSize, StaffRow[] Items, [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? NextCursor);
public sealed record StaffDetail(int SchemaVersion, StaffRow Staff);
public sealed record StaffCandidate(int SchemaVersion, string Id, string UserName, string DisplayName, bool IsActive, bool ContactVerified, bool HasPassword, bool AlreadyStaff, bool MfaRecoveryPending, string Version);
public sealed record StaffRole(string Id, string NameFa, string NameEn, string[] Permissions);
public sealed record StaffRoleCatalog(int SchemaVersion, StaffRole[] Roles);
public sealed record StaffAccessEvent(long Id, string Action, string ActorId, string ActorName, DateTimeOffset At, string TraceId);
public sealed record StaffAccessHistory(int SchemaVersion, int PageSize, StaffAccessEvent[] Items, [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? NextCursor);
public sealed record StaffCandidateInput(string Identifier);
public sealed record StaffGrantInput(string AccountId, string[] Roles, string Version);
public sealed record StaffUpdateInput(string[] Roles, bool? IsActive, string Version);

public interface IStaffAdministration
{
    Task<StaffPage> PageAsync(StaffFilter filter, string? cursor, CancellationToken ct);
    Task<StaffDetail> DetailAsync(string id, CancellationToken ct);
    Task<StaffAccessHistory> HistoryAsync(string id, string? cursor, CancellationToken ct);
    Task<StaffCandidate> CandidateAsync(string actorId, string actorStamp, StaffCandidateInput input, CancellationToken ct);
    Task<StaffDetail> GrantAsync(string actorId, string actorStamp, StaffGrantInput input, string traceId, CancellationToken ct);
    Task<StaffDetail> UpdateAsync(string actorId, string actorStamp, string id, StaffUpdateInput input, string traceId, CancellationToken ct);
}
public sealed record StaffFilter
{
    public string Search { get; private init; } = "";
    public string Active { get; private init; } = "all";
    public string Role { get; private init; } = "all";
    public static StaffFilter Create(string? query = null, string? active = null, string? role = null)
    {
        active ??= "all"; role ??= "all";
        if (query is { Length: > 120 } || active is not ("all" or "true" or "false") || role != "all" && !ShopPermissions.Roles.ContainsKey(role)) throw Invalid();
        var search = PersianText.Normalize(query ?? "");
        if (search.Split(' ', StringSplitOptions.RemoveEmptyEntries).Length > 8) throw Invalid();
        return new() { Search = search, Active = active, Role = role };
    }
    public string Binding => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { Search, Active, Role }))));
    public static string Id(string value)
    {
        if (string.IsNullOrEmpty(value) || value.Length > 450 || value.Any(c => !char.IsAsciiLetterOrDigit(c) && c is not ('-' or '_'))) throw Invalid();
        return value;
    }
    private static BusinessException Invalid() => new("invalid_staff_filter", "Use a valid staff id, role and up to eight search terms (120 characters).");
}
public static class StaffPaging
{
    public const int PageSize = 50;
    private sealed record Cursor(string After, string Filter);
    private static readonly JsonSerializerOptions Options = new() { MaxDepth = 4, UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow };
    public static string Encode(string id, StaffFilter filter) => Convert.ToBase64String(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new Cursor(StaffFilter.Id(id), filter.Binding)))).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    public static string? Decode(string? cursor, StaffFilter filter)
    {
        if (cursor is null) return null;
        try {
            if (cursor.Length is < 1 or > 2048 || cursor.Any(c => !char.IsAsciiLetterOrDigit(c) && c is not ('-' or '_'))) throw Invalid();
            var raw = cursor.Replace('-', '+').Replace('_', '/');
            var value = JsonSerializer.Deserialize<Cursor>(Convert.FromBase64String(raw.PadRight((raw.Length + 3) / 4 * 4, '=')), Options);
            if (value is null || value.Filter != filter.Binding) throw Invalid();
            return StaffFilter.Id(value.After);
        } catch (Exception e) when (e is FormatException or JsonException or ArgumentException || e is BusinessException { Code: "invalid_staff_filter" }) { throw Invalid(); }
    }
    private static BusinessException Invalid() => new("invalid_staff_cursor", "This page belongs to invalid or different staff filters.");
}
public static class StaffHistoryPaging
{
    public static string Encode(long id, string userId) => Convert.ToBase64String(Encoding.UTF8.GetBytes(id.ToString(CultureInfo.InvariantCulture) + ":" + StaffFilter.Id(userId))).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    public static long? Decode(string? cursor, string userId)
    {
        StaffFilter.Id(userId); if (cursor is null) return null;
        try {
            if (cursor.Length is < 1 or > 2048 || cursor.Any(c => !char.IsAsciiLetterOrDigit(c) && c is not ('-' or '_'))) throw Invalid();
            var raw = cursor.Replace('-', '+').Replace('_', '/'); var text = Encoding.UTF8.GetString(Convert.FromBase64String(raw.PadRight((raw.Length + 3) / 4 * 4, '=')));
            var parts = text.Split(':'); if (parts.Length != 2 || parts[1] != userId || !long.TryParse(parts[0], NumberStyles.None, CultureInfo.InvariantCulture, out var id) || id < 1) throw Invalid();
            return id;
        } catch (Exception e) when (e is FormatException or ArgumentException) { throw Invalid(); }
    }
    private static BusinessException Invalid() => new("invalid_staff_cursor", "This staff history cursor is invalid or belongs to another account.");
}
public static class StaffInput
{
    public static string[] Roles(string[]? roles)
    {
        if (roles is null || roles.Length < 1 || roles.Length > ShopPermissions.Roles.Count || roles.Distinct(StringComparer.Ordinal).Count() != roles.Length || roles.Any(r => r is null || !ShopPermissions.Roles.ContainsKey(r))) throw Invalid();
        return roles.Order(StringComparer.Ordinal).ToArray();
    }
    private static void Version(string? version) { if (string.IsNullOrWhiteSpace(version) || version.Length > 100) throw Invalid(); }
    public static void Validate(StaffCandidateInput input) { if (string.IsNullOrWhiteSpace(input.Identifier) || input.Identifier.Length > 256 || input.Identifier.Any(char.IsControl)) throw Invalid(); }
    public static void Validate(StaffGrantInput input) { StaffFilter.Id(input.AccountId); Roles(input.Roles); Version(input.Version); }
    public static void Validate(StaffUpdateInput input) { Roles(input.Roles); Version(input.Version); if (input.IsActive is null) throw Invalid(); }
    public static StaffRoleCatalog Catalog() => new(1, ShopPermissions.Roles.Select(pair => {
        var names = pair.Key switch { "Administrator" => ("مدیر کل", "Administrator"), "CatalogManager" => ("مدیر کالا", "Catalog manager"), "InventoryManager" => ("مدیر انبار", "Inventory manager"), "ContentManager" => ("مدیر محتوا", "Content manager"), "ContentEditor" => ("نویسندهٔ محتوا", "Content editor"), "FinanceManager" => ("مدیر مالی", "Finance manager"), "SalesManager" => ("مدیر فروش", "Sales manager"), "SupportAgent" => ("پشتیبان فروشگاه", "Support agent"), "CreditReviewer" => ("بررسی‌کنندهٔ پروندهٔ چک", "Credit reviewer"), _ => (pair.Key, pair.Key) };
        return new StaffRole(pair.Key, names.Item1, names.Item2, pair.Value.Order(StringComparer.Ordinal).ToArray());
    }).OrderBy(x => x.Id, StringComparer.Ordinal).ToArray());
    private static BusinessException Invalid() => new("invalid_staff_input", "Select one or more distinct supported roles and the current account version.");
}

public sealed class StaffAdministration(UserManager<ShopUser> users, IdentityDbContext db, TimeProvider time, RoleManager<IdentityRole> roles) : IStaffAdministration
{
    private static string[] KnownRoles => ShopPermissions.Roles.Keys.ToArray();
    public IQueryable<ShopUser> Match(StaffFilter filter, string? after)
    {
        var roleIds = db.Roles.Where(r => r.Name != null && KnownRoles.Contains(r.Name) && (filter.Role == "all" || r.Name == filter.Role)).Select(r => r.Id);
        var query = db.Users.AsNoTracking().Where(u => db.UserRoles.Any(ur => ur.UserId == u.Id && roleIds.Contains(ur.RoleId)));
        query = IdentityDirectoryQuery.Filter(query, filter.Search, filter.Active, after);
        return query;
    }
    public static IQueryable<StaffRow> Project(IQueryable<ShopUser> query) => query.Select(u => new StaffRow(u.Id, u.UserName ?? "", u.DisplayName, u.IsActive, u.TwoFactorEnabled, u.MfaRecoveryPending, u.CreatedAt, u.ConcurrencyStamp ?? "", Array.Empty<string>(), u.MustChangePassword, u.ProvisionedByAdministrator));
    private async Task<StaffRow[]> WithRoles(StaffRow[] rows, CancellationToken ct)
    {
        if (rows.Length == 0) return rows;
        var ids = rows.Select(x => x.Id).ToArray();
        var pairs = await (from ur in db.UserRoles.AsNoTracking() join role in db.Roles.AsNoTracking() on ur.RoleId equals role.Id where ids.Contains(ur.UserId) && role.Name != null && KnownRoles.Contains(role.Name) select new { ur.UserId, Name = role.Name! }).ToArrayAsync(ct);
        return rows.Select(row => row with { Roles = pairs.Where(x => x.UserId == row.Id).Select(x => x.Name).Order(StringComparer.Ordinal).ToArray() }).ToArray();
    }
    public async Task<StaffPage> PageAsync(StaffFilter filter, string? cursor, CancellationToken ct)
    {
        var after = StaffPaging.Decode(cursor, filter);
        var rows = await Project(Match(filter, after).OrderBy(u => u.Id).Take(StaffPaging.PageSize + 1)).ToArrayAsync(ct);
        var more = rows.Length > StaffPaging.PageSize;
        var result = await WithRoles(rows.Take(StaffPaging.PageSize).ToArray(), ct);
        return new(1, StaffPaging.PageSize, result, more ? StaffPaging.Encode(result[^1].Id, filter) : null);
    }
    public async Task<StaffDetail> DetailAsync(string id, CancellationToken ct)
    {
        StaffFilter.Id(id);
        var row = await Project(Match(StaffFilter.Create(), null).Where(u => u.Id == id)).SingleOrDefaultAsync(ct) ?? throw Missing();
        return new(1, (await WithRoles([row], ct))[0]);
    }
    public async Task<StaffAccessHistory> HistoryAsync(string id, string? cursor, CancellationToken ct)
    {
        var after = StaffHistoryPaging.Decode(cursor, id);
        if (!await Match(StaffFilter.Create(), null).AnyAsync(u => u.Id == id, ct)) throw Missing();
        var query = db.Audit.AsNoTracking().Where(x => x.Resource == "/staff/" + id && x.Action.StartsWith("STAFF_"));
        if (after is not null) query = query.Where(x => x.Id < after);
        var rows = await query.OrderByDescending(x => x.Id).Take(51).Select(x => new StaffAccessEvent(x.Id, x.Action, x.ActorId, db.Users.Where(u => u.Id == x.ActorId).Select(u => u.DisplayName != "" ? u.DisplayName : u.UserName).FirstOrDefault() ?? x.ActorId, x.At, x.TraceId)).ToArrayAsync(ct);
        var more = rows.Length > 50; var items = rows.Take(50).ToArray();
        return new(1, 50, items, more ? StaffHistoryPaging.Encode(items[^1].Id, id) : null);
    }
    public async Task<StaffCandidate> CandidateAsync(string actorId, string actorStamp, StaffCandidateInput input, CancellationToken ct)
    {
        StaffInput.Validate(input); await ActorAsync(actorId, actorStamp, ct);
        var value = input.Identifier.Trim();
        var user = value.Contains('@') ? await users.FindByEmailAsync(value) : await users.FindByNameAsync(value);
        if (user is null) throw Missing();
        return new(1, user.Id, user.UserName ?? "", user.DisplayName, user.IsActive, user.EmailConfirmed || user.PhoneNumberConfirmed, await users.HasPasswordAsync(user), (await users.GetRolesAsync(user)).Any(ShopPermissions.Roles.ContainsKey), user.MfaRecoveryPending, user.ConcurrencyStamp ?? "");
    }
    private async Task LockUser(string id, CancellationToken ct) => await db.Database.ExecuteSqlInterpolatedAsync($"SELECT [Id] FROM [identity].[AspNetUsers] WITH (UPDLOCK,HOLDLOCK) WHERE [Id]={id}", ct);
    private async Task<ShopUser> ActorAsync(string actorId, string stamp, CancellationToken ct)
    {
        return await StaffAuthorization.RequireAdministratorAsync(users, db, actorId, stamp, ct);
    }
    private async Task<ShopUser> TargetAsync(string actorId, string id, string version, CancellationToken ct)
    {
        if (string.Equals(actorId, id, StringComparison.OrdinalIgnoreCase)) throw new BusinessException("staff_self_change", "Use a different administrator to change your own staff access.");
        await LockUser(id, ct); var user = await users.FindByIdAsync(id) ?? throw Missing(); await db.Entry(user).ReloadAsync(ct);
        if (db.Entry(user).State == EntityState.Detached) throw Missing();
        if (user.Id == actorId) throw new BusinessException("staff_self_change", "Use a different administrator to change your own staff access.");
        if (user.ConcurrencyStamp != version) throw new BusinessException("version_conflict", "The account changed. Reload before changing its access.");
        return user;
    }
    public async Task<StaffDetail> GrantAsync(string actorId, string actorStamp, StaffGrantInput input, string traceId, CancellationToken ct)
    {
        StaffInput.Validate(input); await ActorAsync(actorId, actorStamp, ct);
        var target = await TargetAsync(actorId, input.AccountId, input.Version, ct);
        if (!target.IsActive || !target.EmailConfirmed && !target.PhoneNumberConfirmed || !await users.HasPasswordAsync(target) || target.MfaRecoveryPending || string.IsNullOrEmpty(target.UserName) || (await users.GetRolesAsync(target)).Any(ShopPermissions.Roles.ContainsKey)) throw new BusinessException("staff_candidate_unavailable", "Use an active verified account with an existing password that is not already staff.");
        Event(actorId, target.Id, "STAFF_GRANTED", traceId);
        await ApplyAsync(actorId, target, StaffInput.Roles(input.Roles), true, traceId, ct);
        return await DetailAsync(target.Id, ct);
    }
    public async Task<StaffDetail> UpdateAsync(string actorId, string actorStamp, string id, StaffUpdateInput input, string traceId, CancellationToken ct)
    {
        StaffInput.Validate(input); StaffFilter.Id(id); await ActorAsync(actorId, actorStamp, ct);
        var target = await TargetAsync(actorId, id, input.Version, ct);
        var previous = (await users.GetRolesAsync(target)).Where(ShopPermissions.Roles.ContainsKey).ToArray(); if (previous.Length == 0) throw Missing();
        var wanted = StaffInput.Roles(input.Roles); var active = input.IsActive!.Value;
        if (active && (!StaffProvisioningRules.ManagedStaffContact(target) || string.IsNullOrEmpty(target.UserName) || !await users.HasPasswordAsync(target))) throw new BusinessException("staff_activation_unavailable", "An active staff account requires a verified or administratively provisioned identity and an existing password.");
        if (target.IsActive && previous.Contains("Administrator") && (!active || !wanted.Contains("Administrator"))) {
            var adminRoleId = await db.Roles.Where(r => r.NormalizedName == "ADMINISTRATOR").Select(r => r.Id).SingleAsync(ct);
            if (!await db.Users.AnyAsync(u => u.Id != id && u.IsActive && db.UserRoles.Any(ur => ur.UserId == u.Id && ur.RoleId == adminRoleId), ct)) throw new BusinessException("last_administrator", "At least one active administrator must remain.");
        }
        await ApplyAsync(actorId, target, wanted, active, traceId, ct);
        return await DetailAsync(id, ct);
    }
    private void Event(string actorId, string targetId, string action, string traceId) => db.Audit.Add(new() { ActorId = actorId, Resource = "/staff/" + targetId, Action = action, TraceId = traceId, At = time.GetUtcNow() });
    private async Task ApplyAsync(string actorId, ShopUser user, string[] wanted, bool active, string traceId, CancellationToken ct)
    {
        var previous = (await users.GetRolesAsync(user)).Where(ShopPermissions.Roles.ContainsKey).ToArray();
        var remove = previous.Except(wanted).ToArray(); var add = wanted.Except(previous).ToArray();
        foreach (var role in remove) Event(actorId, user.Id, "STAFF_ROLE_REMOVED:" + role, traceId);
        foreach (var role in add) Event(actorId, user.Id, "STAFF_ROLE_ADDED:" + role, traceId);
        if (user.IsActive != active) Event(actorId, user.Id, active ? "STAFF_ENABLED" : "STAFF_DISABLED", traceId);
        Event(actorId, user.Id, "STAFF_SESSIONS_REVOKED", traceId);
        if (remove.Length > 0) MfaAccount.Ensure(await users.RemoveFromRolesAsync(user, remove));
        // A newly supported role may not exist in an upgraded database. Only an
        // explicit Administrator grant provisions it, in the same locked/audited
        // transaction as membership; startup never grants or changes authority.
        foreach (var role in add) if (!await roles.RoleExistsAsync(role)) MfaAccount.Ensure(await roles.CreateAsync(new IdentityRole(role)));
        if (add.Length > 0) MfaAccount.Ensure(await users.AddToRolesAsync(user, add));
        user.IsActive = active; user.RequireMfa = true;
        MfaAccount.Ensure(await users.UpdateSecurityStampAsync(user));
        var now = time.GetUtcNow(); await db.Sessions.Where(s => s.UserId == user.Id && s.RevokedAt == null).ExecuteUpdateAsync(s => s.SetProperty(x => x.RevokedAt, now), ct);
        // The root filter commits account, membership, session revocation and audit together.
    }
    private static BusinessException Missing() => new("not_found", "The account or staff member was not found.");
}
