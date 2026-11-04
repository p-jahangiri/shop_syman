using System.Text.Json.Serialization;
namespace Shop.SharedKernel;

public sealed record AccountingStockCatalogProof(string VariantId,string ProductId,string VariantVersion,string ProductVersion,bool IsActive,bool IsDigital,bool IsUsed);
public interface IAccountingStockCatalogReader
{
    Task<AccountingStockCatalogProof[]> ReadAsync(string[] variantIds,CancellationToken ct);
}
public sealed record AccountingStockCandidate(int RowNumber,bool CanApply,string[] Issues,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? PriorApplicationId,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]DateTimeOffset? LastAppliedObservationAt);
public sealed record AccountingStockPreview(int SchemaVersion,AccountingReconciliation Reconciliation,AccountingStockCatalogProof[] CatalogProofs,AccountingStockCandidate[] Candidates,string Fingerprint,bool CanApplyManual,bool CanSyncLive);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record AccountingStockApplyInput(string CommandId,string PreviewFingerprint,int[] RowNumbers,string Reason,bool AcknowledgeWholeStorePhysical,bool AcknowledgeUnpostedSalesReconciled);
public sealed record AccountingStockAppliedLine(int RowNumber,string ExternalItemId,string ExternalUnitKey,string SourceQuantity,int Numerator,int Denominator,string LinkId,string LinkVersion,string MappingId,string MappingVersion,string VariantId,string ProductId,string VariantVersion,string ProductVersion,string Sku,string NameFa,string NameEn,int BeforeOnHand,int AfterOnHand,int Reserved,int SourcingReserved,int Delta,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? BeforeStockVersion,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? AfterStockVersion,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? MovementId);
public sealed record AccountingStockApplied(int SchemaVersion,string Id,string BatchId,string CommandId,string PayloadHash,string BatchPayloadHash,string PreviewFingerprint,string CompanyKey,string ExternalWarehouseKey,string WarehouseId,string WarehouseVersion,DateTimeOffset ObservedAt,DateTimeOffset AppliedAt,string Reason,bool IsDemo,bool AcknowledgeWholeStorePhysical,bool AcknowledgeUnpostedSalesReconciled,AccountingStockAppliedLine[] Lines,bool Replayed);
public interface IAccountingStockApplications
{
    Task AcquireAsync(CancellationToken ct);
    Task<AccountingStockApplied?> ReplayAsync(string actor,string batchId,AccountingStockApplyInput input,CancellationToken ct);
    Task LockStockAsync(string[] variantIds,CancellationToken ct);
    Task<AccountingStockPreview> PreviewAsync(AccountingImportDetail batch,AccountingStockCatalogProof[] proofs,CancellationToken ct);
    Task<AccountingStockApplied> ApplyAsync(string actor,AccountingStockPreview preview,AccountingStockApplyInput input,CancellationToken ct);
    Task<AccountingStockApplied> CommandAsync(string actor,string batchId,string commandId,CancellationToken ct);
    Task<AccountingStockApplied> ApplicationAsync(string id,CancellationToken ct);
}
