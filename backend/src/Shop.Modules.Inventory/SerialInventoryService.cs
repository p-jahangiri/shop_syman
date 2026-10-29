using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Inventory;

public sealed partial class SerialInventoryService(InventoryDbContext db,StockReservationService reservations,TimeProvider clock):IInventorySerialGuard,IStockSerialAssignments,IStockSerialAssignmentsV2,IAdminSerialReader
{
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web);
    internal static SerialStock Stock(StockItem? item,string variant)=>new(variant,item?.TrackingMode??"none",item?.OnHand??0,item?.Reserved??0,item is null?null:Convert.ToBase64String(item.Version));
    internal static SerialUnitData Data(SerialUnit u)=>new(u.Id,u.VariantId,u.Serial,u.Imei1,u.Imei2,u.State,u.OrderId,u.ReservationId,u.WarrantyUntil,u.CreatedAt,u.ChangedAt,Convert.ToBase64String(u.Version));
    private async Task<T?> Replay<T>(string actor,string key,string hash,CancellationToken ct) where T:class
    {
        var previous=await db.SerialCommands.AsNoTracking().SingleOrDefaultAsync(c=>c.ActorId==actor&&c.RequestId==key,ct);if(previous is null)return null;
        using(var document=JsonDocument.Parse(previous.ResponseJson))if(!document.RootElement.TryGetProperty("schemaVersion",out var marker)||!marker.TryGetInt32(out var contract)||contract!=1)throw new BusinessException("serial_contract_upgrade_required","This serial command belongs to another explicit contract.");
        if(previous.PayloadHash!=hash)throw new BusinessException("idempotency_conflict","This serial request id has another payload.");return JsonSerializer.Deserialize<T>(previous.ResponseJson,Json)??throw new InvalidOperationException("Invalid serial command snapshot.");
    }
    private async Task Remember<T>(string actor,string key,string hash,T result,CancellationToken ct)
    {
        db.SerialCommands.Add(new(){ActorId=actor,RequestId=key,PayloadHash=hash,ResponseJson=JsonSerializer.Serialize(result,Json),At=clock.GetUtcNow()});await db.SaveChangesAsync(ct);
    }
    private async Task<StockItem> LockedStock(string variant,string? version,bool create,CancellationToken ct)
    {
        var rows=await reservations.LockStockAsync([variant],ct);if(rows.TryGetValue(variant,out var stock)){SerialRules.MatchVersion(stock.Version,version);return stock;}
        if(!create||version is not null)throw new BusinessException("version_conflict","Stock changed. Load the current version.");stock=new(){VariantId=variant};db.Stock.Add(stock);return stock;
    }
    private async Task<bool> HasActiveUnitClaims(string[] unitIds,CancellationToken ct)=>unitIds.Length>0&&(db.SerialUnitClaims.Local.Any(c=>c.IsActive&&unitIds.Contains(c.UnitId))||await db.SerialUnitClaims.AnyAsync(c=>c.IsActive&&unitIds.Contains(c.UnitId),ct));
    private async Task<bool> HasActiveVariantClaims(string variant,CancellationToken ct)=>db.SerialUnitClaims.Local.Any(c=>c.IsActive&&c.VariantId.Equals(variant,StringComparison.OrdinalIgnoreCase))||await db.SerialUnitClaims.AnyAsync(c=>c.IsActive&&c.VariantId==variant,ct);
    private static void Physical(bool digital){if(digital)throw new BusinessException("serial_digital_conflict","Digital goods cannot use physical serial inventory.");}
    private void AddEvent(SerialUnit unit,string actor,string reason)=>db.SerialEvents.Add(new(){UnitId=unit.Id,State=unit.State,ActorId=actor,Reason=reason,OrderId=unit.OrderId,At=unit.ChangedAt});
    public async Task<SerialCommandResult> ConfigureAsync(string variantId,bool digital,SerialModeInput input,string actorId,CancellationToken ct)
    {
        var variant=SerialRules.Identifier(variantId);var actor=SerialRules.Identifier(actorId).ToUpperInvariant();var key=SerialRules.Uuid(input.RequestId);var mode=SerialRules.Mode(input.Mode);var version=SerialRules.Version(input.Version);var hash=SerialRules.Hash(new{Kind="mode",Variant=variant.ToUpperInvariant(),Mode=mode,Version=version});
        await using var tx=await reservations.BeginAsync(ct);await reservations.LockAsync("serial-command",actor+":"+key,ct);var replay=await Replay<SerialCommandResult>(actor,key,hash,ct);if(replay is not null){if(tx is not null)await tx.CommitAsync(ct);return replay;}
        if(mode!="none")Physical(digital);var stock=await LockedStock(variant,version,true,ct);
        if(mode!=stock.TrackingMode&&(stock.OnHand!=0||stock.Reserved!=0||stock.SourcingReserved!=0||await HasActiveVariantClaims(variant,ct)||await db.SerialUnits.AnyAsync(u=>u.VariantId==variant&&(u.State=="available"||u.State=="assigned"),ct)))throw new BusinessException("serial_mode_conflict","Change tracking only on empty inventory without order or sourcing reservations.");
        stock.TrackingMode=mode;if(db.Entry(stock).State!=EntityState.Added)db.Entry(stock).Property(s=>s.TrackingMode).IsModified=true;await db.SaveChangesAsync(ct);var result=new SerialCommandResult(1,Stock(stock,stock.VariantId),[]);await Remember(actor,key,hash,result,ct);if(tx is not null)await tx.CommitAsync(ct);return result;
    }
    public async Task<SerialCommandResult> ReceiveAsync(string variantId,bool digital,SerialReceiptInput input,string actorId,CancellationToken ct)
    {
        var variant=SerialRules.Identifier(variantId);var actor=SerialRules.Identifier(actorId).ToUpperInvariant();var key=SerialRules.Uuid(input.RequestId);var version=SerialRules.Version(input.Version);var reason=SerialRules.Reason(input.Reason);var rows=SerialRules.Units(variant,input.Units);var hash=SerialRules.Hash(new{Kind="receipt",Variant=variant.ToUpperInvariant(),Version=version,Reason=reason,Units=rows});
        await using var tx=await reservations.BeginAsync(ct);await reservations.LockAsync("serial-command",actor+":"+key,ct);var replay=await Replay<SerialCommandResult>(actor,key,hash,ct);if(replay is not null){if(tx is not null)await tx.CommitAsync(ct);return replay;}
        Physical(digital);var stock=await LockedStock(variant,version,false,ct);var now=clock.GetUtcNow();var units=await ReceiveCoreAsync(stock,rows,actor,reason,now,ct);
        db.Movements.Add(new(){VariantId=stock.VariantId,Delta=units.Length,Balance=stock.OnHand,Reason=reason,ActorId=actor,RequestId=SerialRules.Hash(new{Kind="serial-receipt",Actor=actor,Key=key}),At=now});await db.SaveChangesAsync(ct);var result=new SerialCommandResult(1,Stock(stock,stock.VariantId),units.Select(Data).ToArray());await Remember(actor,key,hash,result,ct);if(tx is not null)await tx.CommitAsync(ct);return result;
    }
    // A caller that already owns the sorted Stock locks may receive several
    // provenance lines in one parent transaction. This core owns no command,
    // transaction, ledger or SaveChanges; both public facades use these rules.
    internal async Task<SerialUnit[]> ReceiveCoreAsync(StockItem stock,SerialUnitInput[] supplied,string actor,string reason,DateTimeOffset at,CancellationToken ct)
    {
        if(db.Database.CurrentTransaction is null)throw new InvalidOperationException("Serial receiving requires the caller's Inventory transaction and Stock locks.");
        var rows=SerialRules.Units(stock.VariantId,supplied);SerialRules.RequireMode(stock.TrackingMode,rows);_=StockAvailability.Available(stock.OnHand,stock.Reserved,stock.SourcingReserved);if(checked((long)stock.OnHand+rows.Length)>int.MaxValue)throw new BusinessException("invalid_serial_input","Inventory count is out of range.");
        var keys=rows.SelectMany(r=>SerialRules.Keys(stock.VariantId,r)).ToArray();
        if(db.SerialIdentifiers.Local.Any(i=>keys.Contains(i.Key,StringComparer.Ordinal))||await db.SerialIdentifiers.AnyAsync(i=>keys.Contains(i.Key),ct))throw new BusinessException("serial_identifier_conflict","A supplied identifier is already registered.");
        var units=rows.Select(r=>new SerialUnit{VariantId=stock.VariantId,Serial=r.Serial,Imei1=r.Imei1,Imei2=r.Imei2,CreatedAt=at,ChangedAt=at}).ToArray();
        foreach(var unit in units){db.SerialUnits.Add(unit);foreach(var alias in SerialRules.Keys(stock.VariantId,new(unit.Serial,unit.Imei1,unit.Imei2)))db.SerialIdentifiers.Add(new(){Key=alias,UnitId=unit.Id});AddEvent(unit,actor,reason);}
        stock.OnHand+=units.Length;return units;
    }
    public async Task<SerialCommandResult> RetireAsync(string variantId,string unitId,SerialRetireInput input,string actorId,CancellationToken ct)
    {
        var variant=SerialRules.Identifier(variantId);var id=SerialRules.Uuid(unitId);var actor=SerialRules.Identifier(actorId).ToUpperInvariant();var key=SerialRules.Uuid(input.RequestId);var version=SerialRules.Version(input.Version);var unitVersion=SerialRules.Version(input.UnitVersion,false);var reason=SerialRules.Reason(input.Reason);var hash=SerialRules.Hash(new{Kind="retire",Variant=variant.ToUpperInvariant(),Unit=id,Version=version,UnitVersion=unitVersion,Reason=reason});
        await using var tx=await reservations.BeginAsync(ct);await reservations.LockAsync("serial-command",actor+":"+key,ct);var replay=await Replay<SerialCommandResult>(actor,key,hash,ct);if(replay is not null){if(tx is not null)await tx.CommitAsync(ct);return replay;}
        var stock=await LockedStock(variant,version,false,ct);var unit=await db.SerialUnits.SingleOrDefaultAsync(u=>u.Id==id&&u.VariantId==variant,ct)??throw new BusinessException("not_found","Serial unit not found.");await db.Entry(unit).ReloadAsync(ct);SerialRules.MatchVersion(unit.Version,unitVersion);
        // A physically available unit may still belong to another customer's
        // active claim, including a due claim awaiting atomic release.
        if(stock.TrackingMode=="none"||unit.State!="available"||StockAvailability.Available(stock.OnHand,stock.Reserved,stock.SourcingReserved)<1||await HasActiveUnitClaims([id],ct))throw new BusinessException("serial_state_conflict","Only unreserved, unclaimed available units can leave inventory.");unit.State="retired";unit.ChangedAt=clock.GetUtcNow();stock.OnHand--;AddEvent(unit,actor,reason);db.Movements.Add(new(){VariantId=stock.VariantId,Delta=-1,Balance=stock.OnHand,Reason=reason,ActorId=actor,RequestId=SerialRules.Hash(new{Kind="serial-retire",Actor=actor,Key=key}),At=unit.ChangedAt});await db.SaveChangesAsync(ct);var result=new SerialCommandResult(1,Stock(stock,stock.VariantId),[Data(unit)]);await Remember(actor,key,hash,result,ct);if(tx is not null)await tx.CommitAsync(ct);return result;
    }
    public async Task AssertDigitalVariantsAllowedAsync(string[] variantIds,CancellationToken ct)
    {
        foreach(var batch in variantIds.Distinct(StringComparer.OrdinalIgnoreCase).Chunk(500))if(db.Stock.Local.Any(s=>batch.Contains(s.VariantId,StringComparer.OrdinalIgnoreCase)&&(s.TrackingMode!="none"||s.SourcingReserved!=0))||db.SerialUnitClaims.Local.Any(c=>c.IsActive&&batch.Contains(c.VariantId,StringComparer.OrdinalIgnoreCase))||await db.Stock.AnyAsync(s=>batch.Contains(s.VariantId)&&(s.TrackingMode!="none"||s.SourcingReserved!=0),ct)||await db.SerialUnitClaims.AnyAsync(c=>c.IsActive&&batch.Contains(c.VariantId),ct))throw new BusinessException("serial_digital_conflict","Release physical sourcing allocations and disable serial tracking before converting a product to digital.");
    }
    public static IQueryable<SerialUnit> Query(InventoryDbContext db,SerialPageQuery query,string? after)
    {
        var rows=db.SerialUnits.AsNoTracking().Where(u=>u.VariantId==query.VariantId);if(query.State!="all")rows=rows.Where(u=>u.State==query.State);if(query.State=="available")rows=rows.Where(u=>!db.SerialUnitClaims.Any(c=>c.UnitId==u.Id&&c.IsActive));if(query.Search.Length>0)rows=rows.Where(u=>u.Serial!=null&&u.Serial.StartsWith(query.Search)||u.Imei1!=null&&u.Imei1.StartsWith(query.Search)||u.Imei2!=null&&u.Imei2.StartsWith(query.Search));if(after is not null)rows=rows.Where(u=>string.Compare(u.Id,after)>0);return rows.OrderBy(u=>u.Id).Take(SerialPaging.PageSize+1);
    }
    public async Task<SerialUnitPage> PageAsync(SerialPageQuery query,string? cursor,CancellationToken ct)
    {
        var after=SerialPaging.Decode(cursor,query);var stock=await db.Stock.AsNoTracking().SingleOrDefaultAsync(s=>s.VariantId==query.VariantId,ct);if(stock?.SourcingReserved>0||await HasActiveVariantClaims(query.VariantId,ct))throw new BusinessException("serial_contract_upgrade_required","Sourcing-held units require the explicit version 2 serial read contract.");var rows=await Query(db,query,after).ToArrayAsync(ct);var current=await db.Stock.AsNoTracking().SingleOrDefaultAsync(s=>s.VariantId==query.VariantId,ct);if(stock is null?current is not null:current is null||!stock.Version.SequenceEqual(current.Version))throw new BusinessException("version_conflict","Inventory changed while reading serial units. Refresh the page.");if(current?.SourcingReserved>0||await HasActiveVariantClaims(query.VariantId,ct))throw new BusinessException("serial_contract_upgrade_required","Sourcing-held units require the explicit version 2 serial read contract.");var page=rows.Take(SerialPaging.PageSize).ToArray();return new(1,SerialPaging.PageSize,Stock(stock,query.VariantId),page.Select(Data).ToArray(),rows.Length>SerialPaging.PageSize?SerialPaging.Encode(page[^1].Id,query):null);
    }
    public async Task<SerialHistoryPage> HistoryAsync(string variantId,string unitId,string? before,CancellationToken ct)
    {
        var variant=SerialRules.Identifier(variantId);var id=SerialRules.Uuid(unitId);long? limit=null;
        if(before is not null){if(before.Length is <1 or >19||before.Any(c=>!char.IsAsciiDigit(c))||!long.TryParse(before,System.Globalization.NumberStyles.None,System.Globalization.CultureInfo.InvariantCulture,out var parsed)||parsed<=0)throw new BusinessException("invalid_serial_cursor","Use a positive bounded history position.");limit=parsed;}
        if(!await db.SerialUnits.AnyAsync(u=>u.Id==id&&u.VariantId==variant,ct))throw new BusinessException("not_found","Serial unit not found.");
        var rows=await db.SerialEvents.AsNoTracking().Where(e=>e.UnitId==id&&(limit==null||e.Id<limit)).OrderByDescending(e=>e.Id).Take(SerialPaging.PageSize+1).ToArrayAsync(ct);var page=rows.Take(SerialPaging.PageSize).ToArray();return new(1,SerialPaging.PageSize,page.Select(e=>new SerialHistoryEntry(e.Id.ToString(System.Globalization.CultureInfo.InvariantCulture),e.UnitId,e.State,e.ActorId,e.Reason,e.OrderId,e.At)).ToArray(),rows.Length>SerialPaging.PageSize?page[^1].Id.ToString(System.Globalization.CultureInfo.InvariantCulture):null);
    }
}
