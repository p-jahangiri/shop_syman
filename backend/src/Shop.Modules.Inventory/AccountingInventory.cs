using System.Globalization;
using System.Numerics;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;
namespace Shop.Modules.Inventory;

public sealed class AccountingWarehouseLink
{
    public string Id {get;set;}="";
    public string CompanyKey {get;set;}="";
    public string ExternalWarehouseKey {get;set;}="";
    public string NameFa {get;set;}="";
    public string NameEn {get;set;}="";
    public string Scope {get;set;}="whole_store_physical";
    public bool IsActive {get;set;}
    public DateTimeOffset ChangedAt {get;set;}
    public byte[] Version {get;set;}=[];
}
public sealed class AccountingWarehouseCommand
{
    public string ActorId {get;set;}="";
    public string CommandId {get;set;}="";
    public string TargetId {get;set;}="";
    public string PayloadHash {get;set;}="";
    public string ResultJson {get;set;}="";
    public DateTimeOffset At {get;set;}
}
internal static class AccountingInventoryModel
{
    internal static void Configure(ModelBuilder b)
    {
        b.Entity<AccountingWarehouseLink>(e=>{
            e.ToTable("AccountingWarehouseLinks",t=>t.HasCheckConstraint("CK_AccountingWarehouse_Scope","[Scope]='whole_store_physical'"));e.HasKey(x=>x.Id);e.Property(x=>x.Id).HasMaxLength(32);e.Property(x=>x.CompanyKey).HasMaxLength(64).UseCollation("Latin1_General_100_BIN2");e.Property(x=>x.ExternalWarehouseKey).HasMaxLength(64).UseCollation("Latin1_General_100_BIN2");e.Property(x=>x.NameFa).HasMaxLength(200);e.Property(x=>x.NameEn).HasMaxLength(200);e.Property(x=>x.Scope).HasMaxLength(24).IsUnicode(false);e.Property(x=>x.Version).IsRowVersion();e.HasIndex(x=>new{x.CompanyKey,x.ExternalWarehouseKey}).IsUnique();e.HasIndex(x=>x.Scope).IsUnique().HasFilter("[IsActive]=1");e.HasIndex(x=>new{x.CompanyKey,x.Id});
        });
        b.Entity<AccountingWarehouseCommand>(e=>{
            e.ToTable("AccountingWarehouseCommands",t=>t.HasCheckConstraint("CK_AccountingWarehouseCommand_Result","ISJSON([ResultJson])=1 AND DATALENGTH([ResultJson])<=8192"));e.HasKey(x=>new{x.ActorId,x.CommandId});e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.CommandId).HasMaxLength(32);e.Property(x=>x.TargetId).HasMaxLength(32);e.Property(x=>x.PayloadHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ResultJson).HasColumnType("nvarchar(max)");
        });
    }
}
public static class AccountingInventoryRules
{
    private static readonly Regex Decimal=new("^[0-9]{1,20}(\\.[0-9]{1,8})?$",RegexOptions.CultureInvariant|RegexOptions.NonBacktracking);
    public static bool IsSourceQuantity(string? raw)=>raw is {Length:<=29}&&Decimal.IsMatch(raw);
    public static int ConvertQuantity(string? raw,int numerator,int denominator)
    {
        SourcingReceivingRules.Ratio(numerator,denominator);
        if(!IsSourceQuantity(raw))throw new BusinessException("accounting_quantity_invalid","A nonnegative bounded decimal source quantity is required.");
        var parts=raw!.Split('.');var divisor=BigInteger.Pow(10,parts.Length==2?parts[1].Length:0)*denominator;
        var whole=BigInteger.DivRem(BigInteger.Parse(string.Concat(parts),NumberStyles.None,CultureInfo.InvariantCulture)*numerator,divisor,out var remainder);
        if(remainder!=0||whole<0||whole>1000000)throw new BusinessException("accounting_quantity_conversion","The explicit unit ratio must produce an exact integer between zero and one million.");
        return (int)whole;
    }
    public static AccountingWarehouseInput Normalize(AccountingWarehouseInput? input)
    {
        if(input is null||input.IsActive&&!input.AcknowledgeWholeStorePhysical)throw new BusinessException("invalid_accounting_warehouse","Explicitly acknowledge the whole-store physical scope before activating a source warehouse.");
        return input with{CommandId=SourcingReceivingRules.Id(input.CommandId),CompanyKey=SourcingReceivingRules.Key(input.CompanyKey,64),ExternalWarehouseKey=SourcingReceivingRules.Key(input.ExternalWarehouseKey,64),NameFa=SourcingReceivingRules.Key(input.NameFa?.Trim(),200),NameEn=SourcingReceivingRules.Key(input.NameEn?.Trim(),200),Version=SourcingReceivingRules.OptionalVersion(input.Version)};
    }
}
public sealed class AccountingInventoryService(InventoryDbContext db,StockReservationService locks,TimeProvider clock):IAccountingInventory
{
    private static AccountingWarehouseData Data(AccountingWarehouseLink x)=>new(x.Id,x.CompanyKey,x.ExternalWarehouseKey,x.NameFa,x.NameEn,x.IsActive,x.Scope,Convert.ToBase64String(x.Version));
    public async Task<AccountingWarehouseData> WarehouseAsync(string id,CancellationToken ct)=>Data(await db.AccountingWarehouses.AsNoTracking().SingleOrDefaultAsync(x=>x.Id==SourcingReceivingRules.Id(id),ct)??throw ReceivingPersistence.Missing());
    public async Task<AccountingWarehousePage> WarehousesAsync(string? companyKey,string? cursor,CancellationToken ct)
    {
        if(companyKey is not null)SourcingReceivingRules.Key(companyKey,64);
        var filter=PurchaseAdminFilter.Create(null);var scope="holoo-warehouse:"+companyKey;var after=PurchaseAdminPaging.Decode(cursor,filter,scope);
        var query=db.AccountingWarehouses.AsNoTracking();if(companyKey is not null)query=query.Where(x=>x.CompanyKey==companyKey);if(after is not null)query=query.Where(x=>string.Compare(x.Id,after)>0);
        var found=await query.OrderBy(x=>x.Id).Take(21).ToArrayAsync(ct);var items=found.Take(20).Select(Data).ToArray();return new(1,20,items,found.Length>20?PurchaseAdminPaging.Encode(items[^1].Id,filter,scope):null);
    }
    public async Task<AccountingWarehouseSaved> WarehouseCommandAsync(string actor,string commandId,CancellationToken ct)
    {
        actor=SourcingReceivingRules.Actor(actor);commandId=SourcingReceivingRules.Id(commandId);
        var row=await db.AccountingWarehouseCommands.AsNoTracking().SingleOrDefaultAsync(x=>x.ActorId==actor&&x.CommandId==commandId,ct)??throw ReceivingPersistence.Missing();return Decode(row) with{Replayed=true};
    }
    private static AccountingWarehouseSaved Decode(AccountingWarehouseCommand x)
    {
        var result=JsonSerializer.Deserialize<AccountingWarehouseSaved>(x.ResultJson,ReceivingPersistence.Json);
        if(result is null||result.SchemaVersion!=1||result.CommandId!=x.CommandId||result.TargetId!=x.TargetId||result.PayloadHash!=x.PayloadHash||result.Warehouse?.Id!=x.TargetId)throw new BusinessException("accounting_receipt_unavailable","The complete warehouse receipt could not be read.");return result;
    }
    public async Task<AccountingWarehouseSaved> SaveWarehouseAsync(string actor,string id,AccountingWarehouseInput supplied,CancellationToken ct)
    {
        var input=AccountingInventoryRules.Normalize(supplied);actor=SourcingReceivingRules.Actor(actor);id=SourcingReceivingRules.Id(id);ReceivingPersistence.RequireTransaction(db);
        var hash=SourcingReceivingRules.Hash(new{Id=id,Input=input});
        // One global scope lock is also held by future manual stock application.
        // Acquire it before receipt/identity lookups to avoid gap-lock cycles.
        await locks.LockAsync("accounting-warehouse","whole_store_physical",ct);
        var prior=await db.AccountingWarehouseCommands.AsNoTracking().SingleOrDefaultAsync(x=>x.ActorId==actor&&x.CommandId==input.CommandId,ct);
        if(prior is not null){if(prior.TargetId!=id||prior.PayloadHash!=hash)throw new BusinessException("idempotency_conflict","The warehouse command belongs to another payload.");return Decode(prior) with{Replayed=true};}
        var row=await db.AccountingWarehouses.SingleOrDefaultAsync(x=>x.Id==id,ct);
        if(row is null?input.Version is not null:input.Version!=Convert.ToBase64String(row.Version))throw new BusinessException("version_conflict","Read the current warehouse mapping before editing.");
        if(row is not null&&(row.CompanyKey!=input.CompanyKey||row.ExternalWarehouseKey!=input.ExternalWarehouseKey))throw new BusinessException("accounting_warehouse_identity_conflict","Company and warehouse identity cannot change.");
        if(await db.AccountingWarehouses.AnyAsync(x=>x.Id!=id&&x.CompanyKey==input.CompanyKey&&x.ExternalWarehouseKey==input.ExternalWarehouseKey,ct))throw new BusinessException("accounting_warehouse_identity_conflict","This source warehouse is already mapped.");
        if(input.IsActive&&await db.AccountingWarehouses.AnyAsync(x=>x.Id!=id&&x.IsActive,ct))throw new BusinessException("accounting_warehouse_scope_conflict","Deactivate the previous whole-store warehouse before activating another. Partial warehouse balances cannot replace the aggregate stock.");
        if(row is null){row=new(){Id=id,CompanyKey=input.CompanyKey,ExternalWarehouseKey=input.ExternalWarehouseKey};db.AccountingWarehouses.Add(row);}
        row.NameFa=input.NameFa;row.NameEn=input.NameEn;row.IsActive=input.IsActive;row.ChangedAt=clock.GetUtcNow();db.Entry(row).Property(x=>x.ChangedAt).IsModified=true;
        await db.SaveChangesAsync(ct);var result=new AccountingWarehouseSaved(1,input.CommandId,id,hash,Data(row),false);
        db.AccountingWarehouseCommands.Add(new(){ActorId=actor,CommandId=input.CommandId,TargetId=id,PayloadHash=hash,ResultJson=JsonSerializer.Serialize(result,ReceivingPersistence.Json),At=row.ChangedAt});await db.SaveChangesAsync(ct);return result;
    }
    public async Task<AccountingReconciliation> ReconcileAsync(AccountingImportDetail source,CancellationToken ct)
    {
        ReceivingPersistence.RequireTransaction(db);
        if(source.SchemaVersion!=1||source.Rows is not {Length:>=1 and <=200}||source.Rows.Length!=source.Batch.RowCount)throw new BusinessException("accounting_import_unavailable","Read the complete immutable batch.");
        var batch=source.Batch;var warehouse=await db.AccountingWarehouses.AsNoTracking().SingleOrDefaultAsync(x=>x.CompanyKey==batch.CompanyKey&&x.ExternalWarehouseKey==batch.ExternalWarehouseKey,ct);
        var ids=source.Rows.Where(x=>x.CurrentMatch is not null).Select(x=>x.CurrentMatch!.VariantId).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        var stocks=await db.Stock.AsNoTracking().Where(x=>ids.Contains(x.VariantId)).ToDictionaryAsync(x=>x.VariantId,StringComparer.OrdinalIgnoreCase,ct);
        var mappingKeys=source.Rows.Where(x=>x.CurrentMatch is not null).Select(x=>SourcingReceivingRules.MappingIdentity("holoo",batch.CompanyKey,batch.ExternalWarehouseKey,x.ExternalUnitKey,x.CurrentMatch!.VariantId)).Distinct().ToArray();
        var mappings=await db.ReceivingUnitMappings.AsNoTracking().Where(x=>mappingKeys.Contains(x.IdentityHash)&&x.IsActive).ToArrayAsync(ct);
        var latest=await db.Movements.AsNoTracking().Where(x=>ids.Contains(x.VariantId)).GroupBy(x=>x.VariantId).Select(x=>new{VariantId=x.Key,At=x.Max(m=>m.At)}).ToDictionaryAsync(x=>x.VariantId,x=>x.At,StringComparer.OrdinalIgnoreCase,ct);
        var rows=source.Rows.Select(row=>{
            var issues=new List<string>();var match=row.CurrentMatch;AccountingStockState? state=null;ReceivingUnitMappingData? unit=null;int? target=null;int? delta=null;
            if(row.QuantityRaw is null)issues.Add("quantity_missing");else if(!AccountingInventoryRules.IsSourceQuantity(row.QuantityRaw))issues.Add("accounting_quantity_invalid");
            if(warehouse is null)issues.Add("warehouse_mapping_required");else if(!warehouse.IsActive)issues.Add("warehouse_mapping_inactive");
            if(batch.QuantityMeaning!="physical")issues.Add(batch.QuantityMeaning=="available"?"available_quantity_requires_reconciliation":"quantity_meaning_unknown");
            if(match is null)issues.Add("item_mapping_required");else{
                if(!match.IsActive||match.IsDigital)issues.Add("mapped_sku_not_eligible");
                var mapping=mappings.SingleOrDefault(x=>x.VariantId.Equals(match.VariantId,StringComparison.OrdinalIgnoreCase)&&x.SourceUnitKey==row.ExternalUnitKey);
                if(mapping is null)issues.Add("unit_mapping_required");else{
                    unit=new(mapping.Id,mapping.OriginSystem,mapping.CompanyKey,mapping.WarehouseKey,mapping.SourceUnitKey,mapping.VariantId,mapping.Numerator,mapping.Denominator,mapping.NameFa,mapping.NameEn,mapping.IsActive,Convert.ToBase64String(mapping.Version));
                    if(AccountingInventoryRules.IsSourceQuantity(row.QuantityRaw))try{target=AccountingInventoryRules.ConvertQuantity(row.QuantityRaw,mapping.Numerator,mapping.Denominator);}catch(BusinessException e){issues.Add(e.Code);}
                }
                if(stocks.TryGetValue(match.VariantId,out var stock)){
                    DateTimeOffset? last=latest.TryGetValue(stock.VariantId,out var at)?at:null;
                    state=new(stock.OnHand,stock.Reserved,stock.SourcingReserved,StockAvailability.Available(stock.OnHand,stock.Reserved,stock.SourcingReserved),stock.IsSingleUnit,stock.TrackingMode,Convert.ToBase64String(stock.Version),last);
                    if(stock.TrackingMode!="none")issues.Add("tracked_stock_requires_serial_receipt");
                    if(stock.IsSingleUnit)issues.Add("single_unit_requires_inspection_flow");
                    if(last>batch.ObservedAt)issues.Add("stock_moved_since_observation");
                    if(target is not null){delta=target-stock.OnHand;if(target<(long)stock.Reserved+stock.SourcingReserved)issues.Add("stock_below_commitments");}
                }else if(target is not null)delta=target;
            }
            return new AccountingReconciliationRow(row.RowNumber,row.ExternalItemId,row.ExternalUnitKey,row.QuantityRaw,match,unit,state,target,delta,issues.Distinct().ToArray());
        }).ToArray();
        var mapped=warehouse is null?null:Data(warehouse);var fingerprint=SourcingReceivingRules.Hash(new{BatchId=batch.Id,BatchPayloadHash=batch.PayloadHash,Warehouse=mapped,Rows=rows});
        // Read-only slice: manual application gets its own explicit command,
        // confirmations, versions and receipt. Live/vendor sync remains disabled.
        return new(1,batch.Id,batch.PayloadHash,batch.CompanyKey,batch.ExternalWarehouseKey,batch.ObservedAt,batch.IsDemo,mapped,rows,fingerprint,false,false);
    }
}
