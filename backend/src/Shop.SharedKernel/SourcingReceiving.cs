using System.Text.Json.Serialization;

namespace Shop.SharedKernel;

// Browser input describes an actual physical delivery, never its accepted
// quantity, owner, SKU, price, or entitlement. Those come from the trusted plan.
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ReceivingSerialInput(string? Serial=null,string? Imei1=null,string? Imei2=null);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SourcingReceiptLineInput(string OfferLineId,string SourceReceiptLineKey,string MappingId,string MappingVersion,string SourceQuantity,string TrackingMode,string? StockVersion,ReceivingSerialInput[] Units);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SourcingReceiptInput(string RequestId,string RequestVersion,string TaskVersion,string Channel,string OriginSystem,string CompanyKey,string WarehouseKey,string SourceReceiptKey,DateTimeOffset ReceivedAt,string Reason,bool AcknowledgeHistorical,SourcingReceiptLineInput[] Lines);

// Internal contract: Market supplies this only after its command/request/task
// locks in the shared Serializable transaction. Catalog proves physical identity
// at the root. Inventory never opens another module's context.
public sealed record SourcingReceivingPlanLine(string OfferLineId,string VariantId,string ProductId,int RequiredQuantity,int ReceivedQuantity,string MaterialFingerprint);
public sealed record SourcingReceivingPlan(string RequestId,string TaskId,string OfferId,string AcceptanceId,string OwnerId,string TermsHash,bool ContainsDemo,bool RequiresNewOffer,string RequestVersion,string TaskVersion,SourcingReceivingPlanLine[] Lines);
public sealed record SourcingReceivedLine(string Id,string OfferLineId,string VariantId,int Quantity,string MovementId,string[] UnitIds);
public sealed record SourcingReceivingResult(int SchemaVersion,string ReceiptId,string RequestId,string TaskId,string OfferId,string AcceptanceId,bool RequiresNewOffer,DateTimeOffset ReceivedAt,DateTimeOffset RecordedAt,bool Replayed,SourcingReceivedLine[] Lines);
public sealed record SourcingReceiptLineData(string Id,string OfferLineId,string VariantId,string SourceReceiptLineKey,string MappingId,string MappingVersion,string SourceUnitKey,string UnitNameFa,string UnitNameEn,int Numerator,int Denominator,string SourceQuantity,int Quantity,string TrackingMode,string MovementId,string[] UnitIds);
public sealed record SourcingReceiptData(int SchemaVersion,string Id,string RequestId,string TaskId,string OfferId,string AcceptanceId,string Channel,string OriginSystem,string CompanyKey,string WarehouseKey,string SourceReceiptKey,DateTimeOffset ReceivedAt,DateTimeOffset RecordedAt,string ActorId,string Reason,bool AcknowledgeHistorical,bool RequiresNewOffer,SourcingReceiptLineData[] Lines);
public sealed record ReceivingStockState(string VariantId,string TrackingMode,int OnHand,int Reserved,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? Version);
public interface IInventorySourcingReceiving
{
    // Replay is checked before Market or Stock live-version validation.
    Task<SourcingReceivingResult?> ReplayAsync(string actorId,string requestId,string taskId,string receiptId,SourcingReceiptInput input,CancellationToken ct);
    Task<SourcingReceivingResult> ReceiveAsync(string actorId,string receiptId,SourcingReceivingPlan plan,SourcingReceiptInput input,CancellationToken ct);
    Task<SourcingReceiptData> ReadAsync(string receiptId,CancellationToken ct);
    Task<SourcingReceivingResult> ReadCommandAsync(string actorId,string receiptId,string commandId,CancellationToken ct);
    Task<ReceivingStockState[]> ReadStockAsync(string[] variantIds,CancellationToken ct);
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ReceivingUnitMappingInput(string RequestId,string OriginSystem,string CompanyKey,string WarehouseKey,string SourceUnitKey,string VariantId,int Numerator,int Denominator,string NameFa,string NameEn,bool IsActive,string? Version);
public sealed record ReceivingUnitMappingData(string Id,string OriginSystem,string CompanyKey,string WarehouseKey,string SourceUnitKey,string VariantId,int Numerator,int Denominator,string NameFa,string NameEn,bool IsActive,string Version);
public sealed record ReceivingUnitMappingPage(int SchemaVersion,int PageSize,ReceivingUnitMappingData[] Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? NextCursor);
public sealed record ReceivingUnitMappingMutation(int SchemaVersion,string Id,string Version,string CommandId,DateTimeOffset At,bool Replayed);
public interface IReceivingUnitMappings
{
    Task<ReceivingUnitMappingData> ReadAsync(string id,CancellationToken ct);
    Task<ReceivingUnitMappingPage> PageAsync(string? originSystem,string? companyKey,string? warehouseKey,string? variantId,string? cursor,CancellationToken ct);
    Task<ReceivingUnitMappingMutation?> ReplayAsync(string actorId,string id,ReceivingUnitMappingInput input,CancellationToken ct);
    Task<ReceivingUnitMappingMutation> SaveAsync(string actorId,string id,ReceivingUnitMappingInput input,CancellationToken ct);
    Task<ReceivingUnitMappingMutation> ReadCommandAsync(string actorId,string id,string commandId,CancellationToken ct);
}
