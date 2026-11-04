using System.Text.Json.Serialization;
namespace Shop.SharedKernel;

// Post-commit historical projection only. Never a stock or payment capability.
public sealed record SourcingAgreementOrderedEvent(int SchemaVersion,string EventId,string OrderId,string OwnerId,string AgreementId,string RequestId,string TaskId,string OfferId,string AcceptanceId,string AllocationId,bool ContainsDemo,DateTimeOffset At);
public sealed record SourcingOrderLinkData(string OrderId,string TaskId,string OfferId,string AcceptanceId,DateTimeOffset CreatedAt);
public sealed record SourcingOrderLinksData(int SchemaVersion,string RequestId,SourcingOrderLinkData[] Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? NextCursor);
public interface IMarketOrderProjection
{
    Task ApplyAsync(SourcingAgreementOrderedEvent message,CancellationToken ct);
    Task<SourcingOrderLinksData> ReadAsync(string ownerId,string requestId,string? cursor,CancellationToken ct);
}
