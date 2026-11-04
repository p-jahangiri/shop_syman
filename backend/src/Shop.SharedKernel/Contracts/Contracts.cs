using System.Text.Json.Nodes;

namespace Shop.SharedKernel;

public sealed class BusinessException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}
public interface IInventoryReader
{
    Task<IReadOnlyDictionary<string, int>> AvailableAsync(IEnumerable<string> variantIds, CancellationToken cancellationToken);
}
// Read-only SQL contract. Inventory owns inventory.AvailableStockV1 and its migrations.
// Consumers map the contract, never write it or access InventoryDbContext.
public sealed class AvailableStockV1
{
    public string VariantId { get; set; } = "";
    public int Available { get; set; }
}
public record PurchaseMethodData(string Id, string Kind, string Name, string Description, bool Enabled, bool RequiresApproval, string[] CategoryIds, long? MinAmountRial, long? MaxAmountRial);
public record CreditPlanData(string Id, string Name, int Months, int MarkupBasisPoints, int DownPaymentBasisPoints, int IntervalMonths, bool Enabled, string[] CategoryIds, long? MinAmountRial, long? MaxAmountRial, int RoundingUnitRial = 10);
public interface IPurchaseConfiguration
{
    Task<IReadOnlyList<PurchaseMethodData>> MethodsAsync(string locale, CancellationToken cancellationToken);
    Task<IReadOnlyList<CreditPlanData>> PlansAsync(string locale, CancellationToken cancellationToken);
}
public interface ISiteContentReader
{
    Task<JsonObject> ReadAsync(string key, string locale, CancellationToken cancellationToken);
}
