using System.Text.Json.Serialization;
namespace Shop.SharedKernel;

// Inventory currently has one aggregate store balance, not warehouse balances.
// Activating this mapping explicitly declares that a source warehouse contains
// the whole physical total represented by that balance. It never enables sync.
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record AccountingWarehouseInput(string CommandId,string CompanyKey,string ExternalWarehouseKey,string NameFa,string NameEn,bool IsActive,bool AcknowledgeWholeStorePhysical,string? Version);
public sealed record AccountingWarehouseData(string Id,string CompanyKey,string ExternalWarehouseKey,string NameFa,string NameEn,bool IsActive,string Scope,string Version);
public sealed record AccountingWarehousePage(int SchemaVersion,int PageSize,AccountingWarehouseData[] Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? NextCursor);
public sealed record AccountingWarehouseSaved(int SchemaVersion,string CommandId,string TargetId,string PayloadHash,AccountingWarehouseData Warehouse,bool Replayed);
public sealed record AccountingStockState(int OnHand,int Reserved,int SourcingReserved,int Available,bool IsSingleUnit,string TrackingMode,string Version,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]DateTimeOffset? LastMovementAt);
public sealed record AccountingReconciliationRow(int RowNumber,string ExternalItemId,string ExternalUnitKey,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? SourceQuantity,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]AccountingImportMatch? Match,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]ReceivingUnitMappingData? UnitMapping,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]AccountingStockState? Stock,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]int? TargetOnHand,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]int? Delta,string[] Issues);
public sealed record AccountingReconciliation(int SchemaVersion,string BatchId,string BatchPayloadHash,string CompanyKey,string ExternalWarehouseKey,DateTimeOffset ObservedAt,bool IsDemo,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]AccountingWarehouseData? Warehouse,AccountingReconciliationRow[] Rows,string Fingerprint,bool CanApplyManual,bool CanSyncLive);
public interface IAccountingInventory
{
    Task<AccountingWarehousePage> WarehousesAsync(string? companyKey,string? cursor,CancellationToken ct);
    Task<AccountingWarehouseData> WarehouseAsync(string id,CancellationToken ct);
    Task<AccountingWarehouseSaved> SaveWarehouseAsync(string actor,string id,AccountingWarehouseInput input,CancellationToken ct);
    Task<AccountingWarehouseSaved> WarehouseCommandAsync(string actor,string commandId,CancellationToken ct);
    Task<AccountingReconciliation> ReconcileAsync(AccountingImportDetail source,CancellationToken ct);
}
