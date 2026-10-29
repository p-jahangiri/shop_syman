namespace Shop.SharedKernel;
// Sales-owned, read-only stage under the shared order-owner transaction gate.
public sealed record CreditUpfrontOrderStage(string OrderId,string OrderVersion,string State,string? ShipmentState);
public interface ICreditUpfrontOrderStages
{
    Task<CreditUpfrontOrderStage> ReadAsync(string owner,string order,CancellationToken ct);
}
