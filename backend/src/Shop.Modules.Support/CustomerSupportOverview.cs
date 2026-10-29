using System.Globalization;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;

namespace Shop.Modules.Support;

public sealed record CustomerSupportOverview(string OwnerId, string TotalTickets, string OpenTickets, [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] DateTimeOffset? LastTicketAt);
public interface ICustomerSupportOverview
{
    Task<CustomerSupportOverview[]> ReadAsync(string[] owners, CancellationToken ct);
}
public sealed class CustomerSupportOverviewReader(SupportDbContext db) : ICustomerSupportOverview
{
    public async Task<CustomerSupportOverview[]> ReadAsync(string[] owners, CancellationToken ct)
    {
        if (owners.Length > 50 || owners.Distinct(StringComparer.Ordinal).Count() != owners.Length
            || owners.Any(x => string.IsNullOrEmpty(x) || x.Length > 450 || x.Any(c => !char.IsAsciiLetterOrDigit(c) && c is not ('-' or '_')))) throw TicketRules.Invalid();
        // TicketRules canonicalizes persisted owners to uppercase. Return the
        // exact directory identity while querying the module's own canonical key.
        var canonical = owners.Select(x => x.ToUpperInvariant()).ToArray();
        var rows = await db.Tickets.AsNoTracking().Where(x => canonical.Contains(x.OwnerId)).GroupBy(x => x.OwnerId)
            .Select(group => new { OwnerId = group.Key, Total = group.LongCount(), Open = group.LongCount(x => x.State != "Closed"), Last = group.Max(x => x.ChangedAt) }).ToArrayAsync(ct);
        return owners.Select(owner => {
            var row = rows.SingleOrDefault(x => x.OwnerId == owner.ToUpperInvariant());
            return new CustomerSupportOverview(owner, (row?.Total ?? 0).ToString(CultureInfo.InvariantCulture),
                (row?.Open ?? 0).ToString(CultureInfo.InvariantCulture), row?.Last);
        }).ToArray();
    }
}
