using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Identity;

public static class AdminAuditEndpoints
{
    private const int PageSize = 50;
    private static readonly string[] QueryKeys = ["q", "actor", "action", "resource", "trace", "from", "before", "cursor"];

    public static void MapAdminAudit(this RouteGroupBuilder admin)
    {
        admin.MapGet("/audit/events", ReadAsync).RequireAuthorization("staff_mfa", "audit.read");
    }

    private static async Task<IResult> ReadAsync(HttpRequest request, IdentityDbContext db, CancellationToken ct)
    {
        if (request.Query.Any(entry => !QueryKeys.Contains(entry.Key, StringComparer.Ordinal) || entry.Value.Count != 1))
            return Invalid();

        string Get(string key) => request.Query[key].ToString().Trim();
        var search = Get("q");
        var actor = Get("actor");
        var action = Get("action");
        var resource = Get("resource");
        var trace = Get("trace");
        var cursor = Get("cursor");
        if (search.Length > 120 || actor.Length > 450 || action.Length > 100 || resource.Length > 500 || trace.Length > 100 ||
            new[] { search, actor, action, resource, trace }.Any(value => value.Any(char.IsControl)))
            return Invalid();

        if (!TryBound(Get("from"), out var from) || !TryBound(Get("before"), out var before) || from >= before)
            return Invalid();

        long after = 0;
        if (cursor.Length > 0 && (!long.TryParse(cursor, NumberStyles.None, CultureInfo.InvariantCulture, out after) ||
            after <= 0 || cursor != after.ToString(CultureInfo.InvariantCulture)))
            return Invalid();

        // Resolve names only for directory accounts that still have a staff role.
        // Customer and deleted accounts are shown with the original stored actor ID.
        var roles = ShopPermissions.Roles.Keys.ToArray();
        var staff = from membership in db.UserRoles
                    join role in db.Roles on membership.RoleId equals role.Id
                    join account in db.Users on membership.UserId equals account.Id
                    where role.Name != null && roles.Contains(role.Name)
                    select new { account.Id, account.DisplayName };

        var query = db.Audit.AsNoTracking();
        if (after > 0) query = query.Where(row => row.Id < after);
        if (actor.Length > 0) query = query.Where(row => row.ActorId == actor);
        if (action.Length > 0) query = query.Where(row => row.Action.StartsWith(action));
        if (resource.Length > 0) query = query.Where(row => row.Resource.StartsWith(resource));
        if (trace.Length > 0)
            query = query.Where(row => EF.Functions.Collate(row.TraceId, "Latin1_General_100_BIN2") == trace);
        if (from is { } lower) query = query.Where(row => row.At >= lower);
        if (before is { } upper) query = query.Where(row => row.At < upper);
        if (search.Length > 0)
            query = query.Where(row => row.Action.Contains(search) || row.Resource.Contains(search) ||
                row.ActorId.Contains(search) || row.TraceId.Contains(search) ||
                staff.Any(account => account.Id == row.ActorId && account.DisplayName.Contains(search)));

        var rows = await query.OrderByDescending(row => row.Id).Take(PageSize + 1).ToListAsync(ct);
        var hasNext = rows.Count > PageSize;
        if (hasNext) rows.RemoveAt(PageSize);

        var staffIds = rows.Select(row => row.ActorId)
            .Concat(rows.Select(StaffTarget).OfType<string>())
            .Distinct().ToArray();
        var accounts = staffIds.Length == 0
            ? []
            : await staff.Where(account => staffIds.Contains(account.Id)).Distinct().ToArrayAsync(ct);
        var byActor = accounts.ToDictionary(account => account.Id, StringComparer.OrdinalIgnoreCase);
        return Results.Ok(new
        {
            SchemaVersion = 1,
            NextCursor = hasNext ? rows[^1].Id.ToString(CultureInfo.InvariantCulture) : null,
            Items = rows.Select(row =>
            {
                byActor.TryGetValue(row.ActorId, out var account);
                var staffTargetId = StaffTarget(row);
                var target = staffTargetId is null ? null : byActor.GetValueOrDefault(staffTargetId);
                return new
                {
                    Id = row.Id.ToString(CultureInfo.InvariantCulture),
                    row.At,
                    row.Action,
                    row.Resource,
                    row.ActorId,
                    row.TraceId,
                    StaffDisplayName = account?.DisplayName,
                    StaffTargetId = staffTargetId,
                    StaffTargetDisplayName = target?.DisplayName,
                };
            }),
        });
    }

    private static string? StaffTarget(AuditEvent row)
    {
        const string prefix = "/staff/";
        if (!row.Action.StartsWith("STAFF_", StringComparison.Ordinal) ||
            !row.Resource.StartsWith(prefix, StringComparison.Ordinal))
            return null;
        var id = row.Resource[prefix.Length..];
        return id.Length is > 0 and <= 450 && !id.Contains('/') ? id : null;
    }

    private static bool TryBound(string text, out DateTimeOffset? bound)
    {
        bound = null;
        if (text.Length == 0) return true;
        if (!DateTimeOffset.TryParseExact(text, ["yyyy-MM-dd'T'HH:mm:ss'Z'", "yyyy-MM-dd'T'HH:mm:ss.fff'Z'"],
            CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var value))
            return false;
        bound = value;
        return true;
    }

    private static IResult Invalid() =>
        Results.BadRequest(new { Code = "invalid_audit_filters", Message = "Audit filters or pagination are invalid." });
}
