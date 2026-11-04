using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Identity;

public sealed record CustomerIdentityRow(string Id, string UserName, string DisplayName, bool IsActive,
    bool IsStaff, bool EmailVerified, bool PhoneVerified, DateTimeOffset CreatedAt);
public sealed record CustomerIdentityDetail(CustomerIdentityRow Account, [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? Email, [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? PhoneNumber);
public sealed record CustomerIdentityPage(int SchemaVersion, int PageSize, CustomerIdentityRow[] Items,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? NextCursor);
public interface ICustomerDirectory
{
    Task<CustomerIdentityPage> PageAsync(CustomerDirectoryFilter filter, string? cursor, CancellationToken ct);
    Task<CustomerIdentityDetail> DetailAsync(string id, CancellationToken ct);
}
public sealed record CustomerDirectoryFilter(string Search, string Active, string Kind)
{
    public static CustomerDirectoryFilter Create(string? query, string? active, string? kind)
    {
        if (kind is not (null or "all" or "customer" or "staff")) throw Invalid();
        var common = StaffFilter.Create(query, active);
        return new(common.Search, common.Active, kind ?? "customer");
    }
    public string Binding => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
        JsonSerializer.Serialize(new { Scope = "customer-directory-v1", Search, Active, Kind }))));
    internal static BusinessException Invalid() => new("invalid_customer_directory", "Check customer filters and the page cursor.");
}
public static class CustomerDirectoryPaging
{
    private sealed record Cursor(string After, string Binding);
    private static readonly JsonSerializerOptions Options = new() { MaxDepth = 4, UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow };
    public static string Encode(string after, CustomerDirectoryFilter filter) => Convert.ToBase64String(
        JsonSerializer.SerializeToUtf8Bytes(new Cursor(StaffFilter.Id(after), filter.Binding))).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    public static string? Decode(string? cursor, CustomerDirectoryFilter filter)
    {
        if (cursor is null) return null;
        try {
            if (cursor.Length is < 1 or > 2048 || cursor.Any(x => !char.IsAsciiLetterOrDigit(x) && x is not ('-' or '_'))) throw CustomerDirectoryFilter.Invalid();
            var raw = cursor.Replace('-', '+').Replace('_', '/');
            var value = JsonSerializer.Deserialize<Cursor>(Convert.FromBase64String(raw.PadRight((raw.Length + 3) / 4 * 4, '=')), Options);
            if (value is null || value.Binding != filter.Binding) throw CustomerDirectoryFilter.Invalid();
            return StaffFilter.Id(value.After);
        } catch (Exception error) when (error is FormatException or JsonException or ArgumentException) { throw CustomerDirectoryFilter.Invalid(); }
    }
}
public sealed class CustomerDirectory(IdentityDbContext db) : ICustomerDirectory
{
    private static string[] KnownRoles => ShopPermissions.Roles.Keys.ToArray();
    private IQueryable<ShopUser> Accounts(string kind)
    {
        var roleIds = db.Roles.Where(x => x.Name != null && KnownRoles.Contains(x.Name)).Select(x => x.Id);
        var all = db.Users.AsNoTracking();
        return kind == "all" ? all : all.Where(user => db.UserRoles.Any(role => role.UserId == user.Id && roleIds.Contains(role.RoleId)) == (kind == "staff"));
    }
    private IQueryable<CustomerIdentityRow> Project(IQueryable<ShopUser> query)
    {
        var roleIds = db.Roles.Where(x => x.Name != null && KnownRoles.Contains(x.Name)).Select(x => x.Id);
        return query.Select(user => new CustomerIdentityRow(user.Id, user.UserName ?? "", user.DisplayName, user.IsActive,
            db.UserRoles.Any(role => role.UserId == user.Id && roleIds.Contains(role.RoleId)),
            user.EmailConfirmed, user.PhoneNumberConfirmed, user.CreatedAt));
    }
    public async Task<CustomerIdentityPage> PageAsync(CustomerDirectoryFilter filter, string? cursor, CancellationToken ct)
    {
        // Public record constructors cannot bypass server-side validation.
        if (filter != CustomerDirectoryFilter.Create(filter.Search, filter.Active, filter.Kind)) throw CustomerDirectoryFilter.Invalid();
        var after = CustomerDirectoryPaging.Decode(cursor, filter);
        var rows = await Project(IdentityDirectoryQuery.Filter(Accounts(filter.Kind), filter.Search, filter.Active, after)
            .OrderBy(x => x.Id).Take(51)).ToArrayAsync(ct);
        var items = rows.Take(50).ToArray();
        return new(1, 50, items, rows.Length > 50 ? CustomerDirectoryPaging.Encode(items[^1].Id, filter) : null);
    }
    public async Task<CustomerIdentityDetail> DetailAsync(string id, CancellationToken ct)
    {
        StaffFilter.Id(id);
        var user = await Accounts("all").SingleOrDefaultAsync(x => x.Id == id, ct)
            ?? throw new BusinessException("not_found", "Customer account was not found.");
        var row = await Project(Accounts("all").Where(x => x.Id == id)).SingleAsync(ct);
        return new(row, user.Email, user.PhoneNumber);
    }
}
