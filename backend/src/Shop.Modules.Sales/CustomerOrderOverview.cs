using System.Globalization;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Sales;

public sealed record CustomerOrderOverview(string OwnerId, string TotalOrders, string ConfirmedPurchases,
    string AwaitingPaymentOrders, string DemoOrders, [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] DateTimeOffset? LastOrderAt);
public interface ICustomerOrderOverview
{
    Task<CustomerOrderOverview[]> ReadAsync(string[] owners, CancellationToken ct);
}
public sealed class CustomerOrderOverviewReader(SalesDbContext db, TimeProvider clock, bool allowDemo) : ICustomerOrderOverview
{
    public async Task<CustomerOrderOverview[]> ReadAsync(string[] owners, CancellationToken ct)
    {
        if (owners.Length > 50 || owners.Distinct(StringComparer.Ordinal).Count() != owners.Length
            || owners.Any(x => string.IsNullOrEmpty(x) || x.Length > 450 || x.Any(c => !char.IsAsciiLetterOrDigit(c) && c is not ('-' or '_'))))
            throw new BusinessException("invalid_customer_directory", "Supply up to fifty distinct customer identities.");
        var now = clock.GetUtcNow();
        var rows = await db.Orders.AsNoTracking().Where(x => owners.Contains(x.OwnerId) && (allowDemo || !x.ContainsDemo))
            .GroupBy(x => x.OwnerId).Select(group => new {
                OwnerId = group.Key, Total = group.LongCount(),
                Confirmed = group.LongCount(x => x.State == OrderState.Paid || x.State == OrderState.CreditApproved || x.State == OrderState.Fulfilled),
                Pending = group.LongCount(x => x.State == OrderState.AwaitingPayment && x.ExpiresAt > now), Demo = group.LongCount(x => x.ContainsDemo),
                Last = group.Max(x => x.CreatedAt)
            }).ToArrayAsync(ct);
        return owners.Select(owner => {
            var row = rows.SingleOrDefault(x => x.OwnerId == owner);
            return new CustomerOrderOverview(owner, (row?.Total ?? 0).ToString(CultureInfo.InvariantCulture),
                (row?.Confirmed ?? 0).ToString(CultureInfo.InvariantCulture), (row?.Pending ?? 0).ToString(CultureInfo.InvariantCulture),
                (row?.Demo ?? 0).ToString(CultureInfo.InvariantCulture), row?.Last);
        }).ToArray();
    }
}
