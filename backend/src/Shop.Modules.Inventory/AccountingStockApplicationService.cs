using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;
namespace Shop.Modules.Inventory;

public static class AccountingStockApplyRules
{
    private static readonly Regex HashPattern=new("^[A-F0-9]{64}$",RegexOptions.CultureInvariant|RegexOptions.NonBacktracking);
    public static AccountingStockApplyInput Normalize(AccountingStockApplyInput? input)
    {
        if(input is null||!input.AcknowledgeWholeStorePhysical||!input.AcknowledgeUnpostedSalesReconciled||input.RowNumbers is not {Length:>=1 and <=200}||input.RowNumbers.Any(x=>x is <1 or >200)||input.RowNumbers.Distinct().Count()!=input.RowNumbers.Length||input.PreviewFingerprint is null||!HashPattern.IsMatch(input.PreviewFingerprint))throw new BusinessException("invalid_accounting_stock_command","Explicitly select 1–200 distinct rows, a current preview fingerprint and both physical-total/unposted-sales confirmations.");
        return input with{CommandId=SourcingReceivingRules.Id(input.CommandId),RowNumbers=input.RowNumbers.Order().ToArray(),Reason=SourcingReceivingRules.Text(input.Reason,400)};
    }
    public static string Hash(string batchId,AccountingStockApplyInput input)=>SourcingReceivingRules.Hash(new{BatchId=batchId,Input=input});
}
public sealed class AccountingStockApplicationService(InventoryDbContext db,StockReservationService locks,IAccountingInventory inventory,TimeProvider clock,bool allowDemo):IAccountingStockApplications
{
    private bool acquired;
    private Dictionary<string,StockItem>? locked;
    public async Task AcquireAsync(CancellationToken ct)
    {
        ReceivingPersistence.RequireTransaction(db);await locks.LockAsync("accounting-warehouse","whole_store_physical",ct);acquired=true;
    }
    private void RequireLock(){ReceivingPersistence.RequireTransaction(db);if(!acquired)throw new InvalidOperationException("Manual accounting stock writes require the shared warehouse lock before Catalog/Stock reads.");}
    public async Task LockStockAsync(string[] variantIds,CancellationToken ct){RequireLock();locked=await locks.LockStockAsync(variantIds,ct);}
    public async Task<AccountingStockApplied?> ReplayAsync(string actor,string batchId,AccountingStockApplyInput supplied,CancellationToken ct)
    {
        RequireLock();actor=SourcingReceivingRules.Actor(actor);batchId=SourcingReceivingRules.Id(batchId);var input=AccountingStockApplyRules.Normalize(supplied);
        var previous=await db.AccountingStockApplications.FromSqlInterpolated($"SELECT * FROM [inventory].[AccountingStockApplications] WITH (READCOMMITTEDLOCK) WHERE [ActorId]={actor} AND [CommandId]={input.CommandId}").AsNoTracking().SingleOrDefaultAsync(ct);
        if(previous is null)return null;if(previous.IsDemo&&!allowDemo)throw ReceivingPersistence.Missing();
        if(previous.BatchId!=batchId||previous.PayloadHash!=AccountingStockApplyRules.Hash(batchId,input))throw new BusinessException("idempotency_conflict","The stock application command belongs to another batch or payload.");return await DataAsync(previous,true,ct);
    }
    public async Task<AccountingStockPreview> PreviewAsync(AccountingImportDetail source,AccountingStockCatalogProof[] proofs,CancellationToken ct)
    {
        ReceivingPersistence.RequireTransaction(db);if(source.Batch.IsDemo&&!allowDemo)throw ReceivingPersistence.Missing();
        var reconciliation=await inventory.ReconcileAsync(source,ct);var ids=reconciliation.Rows.Where(x=>x.Match is not null).Select(x=>x.Match!.VariantId).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        var proofMap=proofs.ToDictionary(x=>x.VariantId,StringComparer.OrdinalIgnoreCase);
        var prior=await db.AccountingStockApplicationLines.AsNoTracking().Where(x=>x.BatchId==source.Batch.Id).OrderBy(x=>x.RowNumber).Take(201).Select(x=>new{x.RowNumber,x.ApplicationId}).ToArrayAsync(ct);if(prior.Length>200)throw Unavailable();
        var latest=await db.AccountingStockApplicationLines.AsNoTracking().Where(x=>ids.Contains(x.VariantId)).GroupBy(x=>x.VariantId).Select(x=>new{VariantId=x.Key,ObservedAt=x.Max(l=>l.ObservedAt)}).ToDictionaryAsync(x=>x.VariantId,x=>x.ObservedAt,StringComparer.OrdinalIgnoreCase,ct);
        var duplicates=reconciliation.Rows.Where(x=>x.Match is not null).GroupBy(x=>x.Match!.VariantId,StringComparer.OrdinalIgnoreCase).Where(x=>x.Count()>1).Select(x=>x.Key).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var rows=reconciliation.Rows.Select(row=>{
            var issues=row.Issues.ToList();var previous=prior.SingleOrDefault(x=>x.RowNumber==row.RowNumber);DateTimeOffset? last=null;
            if(source.Batch.ObservedAt>clock.GetUtcNow())issues.Add("accounting_observation_future");
            if(previous is not null)issues.Add("accounting_batch_row_applied");
            if(row.Match is not null){
                if(!proofMap.TryGetValue(row.Match.VariantId,out var proof)||!proof.IsActive||proof.IsDigital)issues.Add("accounting_catalog_conflict");else if(proof.IsUsed)issues.Add("single_unit_requires_inspection_flow");
                if(latest.TryGetValue(row.Match.VariantId,out var observed)){last=observed;if(observed>=source.Batch.ObservedAt)issues.Add("accounting_observation_not_newer");}
                if(duplicates.Contains(row.Match.VariantId))issues.Add("accounting_duplicate_sku");
            }
            if(row.Delta is < -1000000 or >1000000)issues.Add("accounting_stock_delta_limit");
            var errors=issues.Distinct().ToArray();return new AccountingStockCandidate(row.RowNumber,errors.Length==0,errors,previous?.ApplicationId,last);
        }).ToArray();
        var ordered=proofs.OrderBy(x=>x.VariantId.ToUpperInvariant(),StringComparer.Ordinal).ToArray();var hash=SourcingReceivingRules.Hash(new{ReconciliationFingerprint=reconciliation.Fingerprint,CatalogProofs=ordered,Candidates=rows});
        return new(1,reconciliation,ordered,rows,hash,rows.Any(x=>x.CanApply),false);
    }
    private sealed record Prepared(AccountingReconciliationRow Row,AccountingStockCatalogProof Proof,StockItem? Stock,int Before,string? BeforeVersion,StockMovement? Movement);
    public async Task<AccountingStockApplied> ApplyAsync(string actor,AccountingStockPreview preview,AccountingStockApplyInput supplied,CancellationToken ct)
    {
        RequireLock();if(locked is null)throw new InvalidOperationException("Lock the actual Stock rows before building the accepted preview.");
        var input=AccountingStockApplyRules.Normalize(supplied);actor=SourcingReceivingRules.Actor(actor);var source=preview.Reconciliation;
        if(source.IsDemo&&!allowDemo)throw ReceivingPersistence.Missing();
        if(input.PreviewFingerprint!=preview.Fingerprint)throw new BusinessException("accounting_stock_version_conflict","The file, mapping, Catalog, stock or application history changed. Read and review a new preview.");
        if(source.Warehouse is not {IsActive:true,Scope:"whole_store_physical"}||source.ObservedAt>clock.GetUtcNow())throw new BusinessException("accounting_stock_conflict","A current explicitly mapped whole-store physical source is required.");
        var applicationId=SourcingReceivingRules.Hash(new{Operation="holoo-stock",Actor=actor,input.CommandId})[..32].ToLowerInvariant();var selected=new List<Prepared>();
        foreach(var number in input.RowNumbers){
            var row=source.Rows.SingleOrDefault(x=>x.RowNumber==number);var candidate=preview.Candidates.SingleOrDefault(x=>x.RowNumber==number);
            if(row is null||candidate is not {CanApply:true}||row.Match is null||row.UnitMapping is null||row.TargetOnHand is null||row.Delta is null)throw new BusinessException("accounting_stock_conflict","Every explicitly selected row must be eligible in the current preview.");
            var proof=preview.CatalogProofs.Single(x=>x.VariantId.Equals(row.Match.VariantId,StringComparison.OrdinalIgnoreCase));locked.TryGetValue(row.Match.VariantId,out var stock);
            if(row.Stock is null?stock is not null:stock is null||Convert.ToBase64String(stock.Version)!=row.Stock.Version)throw new BusinessException("accounting_stock_version_conflict","The locked Stock version differs from the reviewed row.");
            var before=stock?.OnHand??0;var beforeVersion=stock is null?null:Convert.ToBase64String(stock.Version);
            if(stock is {TrackingMode:not "none"}||stock?.IsSingleUnit==true||proof.IsUsed||proof.IsDigital||!proof.IsActive||row.TargetOnHand<(long)(stock?.Reserved??0)+(stock?.SourcingReserved??0))throw new BusinessException("accounting_stock_conflict","Tracked/used/ineligible stock or held commitments cannot be overwritten by a source balance.");
            StockMovement? movement=null;if(row.Delta!=0)movement=new(){VariantId=row.Match.VariantId,Delta=row.Delta.Value,Balance=row.TargetOnHand.Value,ActorId=actor,RequestId=SourcingReceivingRules.Hash(new{Operation="holoo-stock-movement",ApplicationId=applicationId,RowNumber=number}),Reason="Holoo manual stock reconciliation "+applicationId+": "+input.Reason,At=clock.GetUtcNow()};
            selected.Add(new(row,proof,stock,before,beforeVersion,movement));
        }
        // All selected rows are prepared before the first data change.
        var at=clock.GetUtcNow();var header=new AccountingStockApplication{Id=applicationId,ActorId=actor,CommandId=input.CommandId,BatchId=source.BatchId,PayloadHash=AccountingStockApplyRules.Hash(source.BatchId,input),BatchPayloadHash=source.BatchPayloadHash,PreviewFingerprint=input.PreviewFingerprint,CompanyKey=source.CompanyKey,ExternalWarehouseKey=source.ExternalWarehouseKey,WarehouseId=source.Warehouse.Id,WarehouseVersion=source.Warehouse.Version,ObservedAt=source.ObservedAt,AppliedAt=at,Reason=input.Reason,IsDemo=source.IsDemo,AcknowledgeWholeStorePhysical=true,AcknowledgeUnpostedSalesReconciled=true,RowCount=selected.Count};db.AccountingStockApplications.Add(header);
        var afterStock=new Dictionary<int,StockItem?>();
        foreach(var item in selected){var stock=item.Stock;if(item.Movement is not null){if(stock is null){stock=new(){VariantId=item.Row.Match!.VariantId};db.Stock.Add(stock);}stock.OnHand=item.Row.TargetOnHand!.Value;db.Movements.Add(item.Movement);}afterStock[item.Row.RowNumber]=stock;}
        await db.SaveChangesAsync(ct);
        foreach(var item in selected){
            var row=item.Row;var match=row.Match!;var unit=row.UnitMapping!;var stock=afterStock[row.RowNumber];
            db.AccountingStockApplicationLines.Add(new(){ApplicationId=applicationId,BatchId=source.BatchId,RowNumber=row.RowNumber,ObservedAt=source.ObservedAt,ExternalItemId=row.ExternalItemId,ExternalUnitKey=row.ExternalUnitKey,SourceQuantity=row.SourceQuantity!,Numerator=unit.Numerator,Denominator=unit.Denominator,LinkId=match.LinkId,LinkVersion=match.LinkVersion,MappingId=unit.Id,MappingVersion=unit.Version,VariantId=match.VariantId,ProductId=item.Proof.ProductId,VariantVersion=item.Proof.VariantVersion,ProductVersion=item.Proof.ProductVersion,Sku=match.Sku,NameFa=match.NameFa,NameEn=match.NameEn,BeforeOnHand=item.Before,AfterOnHand=row.TargetOnHand!.Value,Reserved=stock?.Reserved??0,SourcingReserved=stock?.SourcingReserved??0,Delta=row.Delta!.Value,BeforeStockVersion=item.BeforeVersion,AfterStockVersion=stock is null?null:Convert.ToBase64String(stock.Version),MovementId=item.Movement?.Id});
        }
        await db.SaveChangesAsync(ct);return await DataAsync(header,false,ct);
    }
    public async Task<AccountingStockApplied> CommandAsync(string actor,string batchId,string commandId,CancellationToken ct)
    {
        actor=SourcingReceivingRules.Actor(actor);batchId=SourcingReceivingRules.Id(batchId);commandId=SourcingReceivingRules.Id(commandId);
        var row=await db.AccountingStockApplications.AsNoTracking().SingleOrDefaultAsync(x=>x.ActorId==actor&&x.BatchId==batchId&&x.CommandId==commandId&&(allowDemo||!x.IsDemo),ct)??throw ReceivingPersistence.Missing();return await DataAsync(row,true,ct);
    }
    public async Task<AccountingStockApplied> ApplicationAsync(string id,CancellationToken ct)
    {
        id=SourcingReceivingRules.Id(id);var row=await db.AccountingStockApplications.AsNoTracking().SingleOrDefaultAsync(x=>x.Id==id&&(allowDemo||!x.IsDemo),ct)??throw ReceivingPersistence.Missing();return await DataAsync(row,false,ct);
    }
    private async Task<AccountingStockApplied> DataAsync(AccountingStockApplication header,bool replayed,CancellationToken ct)
    {
        var rows=await db.AccountingStockApplicationLines.AsNoTracking().Where(x=>x.ApplicationId==header.Id).OrderBy(x=>x.RowNumber).Take(201).ToArrayAsync(ct);
        if(rows.Length!=header.RowCount||rows.Length is <1 or >200||!header.AcknowledgeWholeStorePhysical||!header.AcknowledgeUnpostedSalesReconciled||header.ObservedAt>header.AppliedAt||rows.Any(x=>x.BatchId!=header.BatchId||x.ObservedAt!=header.ObservedAt||x.AfterOnHand-x.BeforeOnHand!=x.Delta||(x.MovementId is null)!=(x.Delta==0)||x.AfterOnHand<(long)x.Reserved+x.SourcingReserved))throw Unavailable();
        foreach(var row in rows){try{if(AccountingInventoryRules.ConvertQuantity(row.SourceQuantity,row.Numerator,row.Denominator)!=row.AfterOnHand)throw Unavailable();}catch(BusinessException){throw Unavailable();}}
        var lines=rows.Select(x=>new AccountingStockAppliedLine(x.RowNumber,x.ExternalItemId,x.ExternalUnitKey,x.SourceQuantity,x.Numerator,x.Denominator,x.LinkId,x.LinkVersion,x.MappingId,x.MappingVersion,x.VariantId,x.ProductId,x.VariantVersion,x.ProductVersion,x.Sku,x.NameFa,x.NameEn,x.BeforeOnHand,x.AfterOnHand,x.Reserved,x.SourcingReserved,x.Delta,x.BeforeStockVersion,x.AfterStockVersion,x.MovementId?.ToString(CultureInfo.InvariantCulture))).ToArray();
        return new(1,header.Id,header.BatchId,header.CommandId,header.PayloadHash,header.BatchPayloadHash,header.PreviewFingerprint,header.CompanyKey,header.ExternalWarehouseKey,header.WarehouseId,header.WarehouseVersion,header.ObservedAt,header.AppliedAt,header.Reason,header.IsDemo,header.AcknowledgeWholeStorePhysical,header.AcknowledgeUnpostedSalesReconciled,lines,replayed);
    }
    private static BusinessException Unavailable()=>new("accounting_stock_receipt_unavailable","The complete immutable stock application could not be verified.");
}
