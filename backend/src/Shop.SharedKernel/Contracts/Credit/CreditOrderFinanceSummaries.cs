namespace Shop.SharedKernel;
// Private finance read boundary. No contact data or protected financial notes.
public interface ICreditOrderFinanceSummaries
{
    Task<CreditScheduleOrderSummarySource[]> ReadAsync(IReadOnlyList<string> orderIds,CancellationToken ct);
}
