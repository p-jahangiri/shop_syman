using System.Data;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;

namespace Shop.Modules.Inventory;

public sealed class SourcingAllocationService(InventoryDbContext db,StockReservationService reservations,TimeProvider clock,bool allowDemo):IInventorySourcingAllocations
{
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web){UnmappedMemberHandling=JsonUnmappedMemberHandling.Disallow,MaxDepth=12};
    private sealed record EventCursor(string After,string Binding);
    private static string Version(byte[] value)=>Convert.ToBase64String(value);
    private IQueryable<SourcingStockAllocation> Rows(string? owner)=>db.Set<SourcingStockAllocation>().Where(a=>(allowDemo||!a.ContainsDemo)&&(owner==null||a.OwnerId==owner));
    private static IQueryable<SourcingStockAllocation> Graph(IQueryable<SourcingStockAllocation> rows)=>rows.Include(a=>a.Lines.OrderBy(l=>l.OfferLineId).Take(65));
    private void RequireTransaction(){if(db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel!=IsolationLevel.Serializable)throw new InvalidOperationException("Allocation commands require the root Serializable transaction shared with Market, Sales and audit.");}
    private Task Lock(string kind,string value,CancellationToken ct)=>reservations.LockAsync("sourcing-allocation-"+kind,value,ct);
    private static string Payload(string requestId,string taskId,string allocationId,SourcingAllocationInput input)=>SourcingAllocationRules.Hash(new{Request=requestId,Task=taskId,Allocation=allocationId,Input=input});
    private async Task<SourcingAllocationCommand?> Command(string actor,string operation,string command,string allocationId,string hash,string? request,string? task,CancellationToken ct)
    {
        RequireTransaction();await Lock("command",actor+":"+operation+":"+command,ct);var row=await db.Set<SourcingAllocationCommand>().FromSqlInterpolated($"SELECT * FROM [inventory].[SourcingAllocationCommands] WITH (UPDLOCK,HOLDLOCK) WHERE [ActorId]={actor} AND [Operation]={operation} AND [CommandId]={command}").AsNoTracking().SingleOrDefaultAsync(ct);
        if(row is not null){if(row.ContainsDemo&&!allowDemo)throw Missing();if(row.AllocationId!=allocationId||row.PayloadHash!=hash||request is not null&&row.RequestId!=request||task is not null&&row.TaskId!=task)throw new BusinessException("idempotency_conflict","This allocation command belongs to another target or payload.");}return row;
    }
    private static SourcingAllocationMutation Replay(SourcingAllocationCommand command)=>(JsonSerializer.Deserialize<SourcingAllocationMutation>(command.ResultJson,Json)??throw new InvalidOperationException("Saved allocation command result is invalid.")) with{Replayed=true};
    public async Task<SourcingAllocationMutation?> ReplayAsync(string actor,string requestId,string taskId,string allocationId,SourcingAllocationInput supplied,CancellationToken ct)
    {
        actor=SourcingAllocationRules.Actor(actor);requestId=SourcingAllocationRules.Id(requestId);taskId=SourcingAllocationRules.Id(taskId);allocationId=SourcingAllocationRules.Id(allocationId);var input=SourcingAllocationRules.Normalize(supplied);var previous=await Command(actor,"allocate",input.RequestId,allocationId,Payload(requestId,taskId,allocationId,input),requestId,taskId,ct);return previous is null?null:Replay(previous);
    }
    public async Task<SourcingAllocationMutation> AllocateAsync(string actor,string allocationId,SourcingStockAllocationPlan suppliedPlan,SourcingAllocationInput supplied,CancellationToken ct)
    {
        actor=SourcingAllocationRules.Actor(actor);allocationId=SourcingAllocationRules.Id(allocationId);var input=SourcingAllocationRules.Normalize(supplied);if(suppliedPlan is null)throw SourcingAllocationRules.Invalid();var historical=await ReplayAsync(actor,suppliedPlan.RequestId,suppliedPlan.TaskId,allocationId,input,ct);if(historical is not null)return historical;var plan=SourcingAllocationRules.NormalizePlan(suppliedPlan);SourcingAllocationRules.ValidateCoverage(plan,input);if(plan.ContainsDemo&&!allowDemo)throw Missing();
        await Lock("acceptance",plan.AcceptanceId,ct);await Lock("resource",allocationId,ct);
        if(await db.Set<SourcingStockAllocation>().FromSqlInterpolated($"SELECT * FROM [inventory].[SourcingAllocations] WITH (UPDLOCK,HOLDLOCK) WHERE [Id]={allocationId}").AnyAsync(ct))throw new BusinessException("sourcing_allocation_resource_conflict","This allocation resource already has immutable history.");
        if(await db.Set<SourcingStockAllocation>().FromSqlInterpolated($"SELECT * FROM [inventory].[SourcingAllocations] WITH (UPDLOCK,HOLDLOCK) WHERE [AcceptanceId]={plan.AcceptanceId} AND [IsActive]=1").AnyAsync(ct))throw new BusinessException("sourcing_allocation_active_conflict","This acceptance already has an active allocation. Release or expire it explicitly first.");
        var picks=input.Lines.ToDictionary(l=>l.OfferLineId,StringComparer.Ordinal);var groups=plan.Lines.GroupBy(l=>l.VariantId,StringComparer.OrdinalIgnoreCase).OrderBy(g=>g.Key,StringComparer.Ordinal).ToArray();var stocks=await reservations.LockStockAsync(groups.Select(g=>g.Key),ct);
        foreach(var group in groups){if(!stocks.TryGetValue(group.Key,out var stock))throw new BusinessException("insufficient_stock","Allocation requires actual existing Stock. No units were allocated.");var pick=picks[group.First().OfferLineId];SerialRules.MatchVersion(stock.Version,pick.StockVersion);if(stock.TrackingMode!=pick.TrackingMode)throw new BusinessException("sourcing_allocation_tracking_conflict","The physical tracking mode changed. Reload Stock before choosing units.");var quantity=group.Sum(l=>(long)l.Quantity);if((long)stock.OnHand-stock.Reserved-stock.SourcingReserved<quantity)throw new BusinessException("insufficient_stock","Actual public Stock is insufficient for the complete accepted allocation.");}
        var units=await LockUnits(input.Lines.SelectMany(l=>l.Units).Select(u=>u.UnitId),ct);var claims=new List<SerialUnitClaim>();
        foreach(var line in plan.Lines){var pick=picks[line.OfferLineId];if(pick.TrackingMode=="none")continue;foreach(var selected in pick.Units){if(!units.TryGetValue(selected.UnitId,out var unit))throw Missing();SerialRules.MatchVersion(unit.Version,selected.Version);if(!unit.VariantId.Equals(line.VariantId,StringComparison.OrdinalIgnoreCase)||unit.State!="available"||unit.ReservationId is not null||unit.OrderId is not null)throw new BusinessException("sourcing_allocation_unit_conflict","The selected physical unit is not available for this exact accepted SKU.");if(await db.Set<SerialUnitClaim>().FromSqlInterpolated($"SELECT * FROM [inventory].[SerialUnitClaims] WITH (UPDLOCK,HOLDLOCK) WHERE [UnitId]={selected.UnitId} AND [IsActive]=1").AsNoTracking().AnyAsync(ct))throw new BusinessException("sourcing_allocation_unit_conflict","The selected unit already has an active claim.");claims.Add(new(){UnitId=unit.Id,VariantId=line.VariantId,OriginAllocationId=allocationId,OfferLineId=line.OfferLineId});}}
        // Absolute deadline is checked after every Stock/unit/claim lock. A wait
        // can never turn an earlier duration into a later accepted deadline.
        var now=clock.GetUtcNow();SourcingAllocationRules.ValidateDeadline(input.ExpiresAt,plan.PurchaseUntil,now);var row=new SourcingStockAllocation{Id=allocationId,RequestId=plan.RequestId,TaskId=plan.TaskId,OfferId=plan.OfferId,AcceptanceId=plan.AcceptanceId,OwnerId=plan.OwnerId,TermsHash=plan.TermsHash,ContainsDemo=plan.ContainsDemo,CreatedAt=now,ChangedAt=now,ExpiresAt=input.ExpiresAt,Lines=plan.Lines.Select(l=>new SourcingStockAllocationLine{AllocationId=allocationId,OfferLineId=l.OfferLineId,VariantId=l.VariantId,Quantity=l.Quantity,TrackingMode=picks[l.OfferLineId].TrackingMode}).ToList()};
        foreach(var group in groups){var stock=stocks[group.Key];stock.SourcingReserved=checked(stock.SourcingReserved+(int)group.Sum(l=>(long)l.Quantity));}
        foreach(var claim in claims){claim.CreatedAt=now;claim.ChangedAt=now;db.Set<SerialUnitClaim>().Add(claim);}db.Set<SourcingStockAllocation>().Add(row);Event(row,actor,input.Reason,now);await db.SaveChangesAsync(ct);return await Remember(row,actor,"allocate",input.RequestId,Payload(plan.RequestId,plan.TaskId,allocationId,input),now,ct);
    }
    private async Task<Dictionary<string,SerialUnit>> LockUnits(IEnumerable<string> unitIds,CancellationToken ct)
    {
        var found=new Dictionary<string,SerialUnit>(StringComparer.Ordinal);foreach(var id in unitIds.Distinct(StringComparer.Ordinal).OrderBy(x=>x,StringComparer.Ordinal)){var unit=await db.SerialUnits.FromSqlInterpolated($"SELECT * FROM [inventory].[SerialUnits] WITH (UPDLOCK,HOLDLOCK) WHERE [Id]={id}").SingleOrDefaultAsync(ct);if(unit is null)continue;await db.Entry(unit).ReloadAsync(ct);found.Add(unit.Id,unit);}return found;
    }
    private async Task<SourcingStockAllocation> Load(string allocationId,CancellationToken ct)
    {
        var row=await db.Set<SourcingStockAllocation>().FromSqlInterpolated($"SELECT * FROM [inventory].[SourcingAllocations] WITH (UPDLOCK,HOLDLOCK) WHERE [Id]={allocationId}").SingleOrDefaultAsync(ct)??throw Missing();if(row.ContainsDemo&&!allowDemo)throw Missing();await db.Entry(row).ReloadAsync(ct);await db.Entry(row).Collection(a=>a.Lines).Query().OrderBy(l=>l.OfferLineId).Take(65).LoadAsync(ct);Bound(row);return row;
    }
    private async Task<bool> ReleaseCore(SourcingStockAllocation row,string actor,string reason,bool expire,CancellationToken ct)
    {
        if(row.State=="Transferred")throw new BusinessException("sourcing_allocation_transferred_conflict","The allocation belongs to a real order and cannot be released from sourcing.");if(row.State!="Active")return false;
        var stocks=await reservations.LockStockAsync(row.Lines.Select(l=>l.VariantId).Distinct(StringComparer.OrdinalIgnoreCase),ct);var active=await db.Set<SerialUnitClaim>().Where(c=>c.OriginAllocationId==row.Id&&c.IsActive).OrderBy(c=>c.UnitId).Take(101).ToArrayAsync(ct);if(active.Length>100)throw Capacity();if(active.Any(c=>c.State!="AllocationHeld"||c.ReservationId is not null||c.OrderId is not null||c.OrderLineId is not null))throw new BusinessException("sourcing_allocation_transferred_conflict","A claimed unit already belongs to an order.");
        foreach(var line in row.Lines)if(active.Count(c=>c.OfferLineId==line.OfferLineId)!=(line.TrackingMode=="none"?0:line.Quantity))throw new InvalidOperationException("Allocation physical unit claims are inconsistent.");
        foreach(var group in row.Lines.GroupBy(l=>l.VariantId,StringComparer.OrdinalIgnoreCase)){if(!stocks.TryGetValue(group.Key,out var stock)||stock.SourcingReserved<group.Sum(l=>(long)l.Quantity))throw new InvalidOperationException("Sourcing allocation Stock counter is inconsistent.");}
        var now=clock.GetUtcNow();if(expire&&row.ExpiresAt>now)return false;foreach(var group in row.Lines.GroupBy(l=>l.VariantId,StringComparer.OrdinalIgnoreCase))stocks[group.Key].SourcingReserved-=checked((int)group.Sum(l=>(long)l.Quantity));foreach(var claim in active){claim.State=expire?"Expired":"Released";claim.IsActive=false;claim.ChangedAt=now;}row.State=expire?"Expired":"Released";row.IsActive=false;row.ChangedAt=now;db.Entry(row).Property(a=>a.ChangedAt).IsModified=true;Event(row,actor,reason,now);await db.SaveChangesAsync(ct);return true;
    }
    public async Task<SourcingAllocationMutation?> ReplayReleaseAsync(string actor,string requestId,string taskId,string allocationId,SourcingAllocationReleaseInput supplied,CancellationToken ct)
    {
        actor=SourcingAllocationRules.Actor(actor);requestId=SourcingAllocationRules.Id(requestId);taskId=SourcingAllocationRules.Id(taskId);allocationId=SourcingAllocationRules.Id(allocationId);var input=SourcingAllocationRules.Normalize(supplied);
        var hash=SourcingAllocationRules.Hash(new{Allocation=allocationId,Input=input});var previous=await Command(actor,"release",input.RequestId,allocationId,hash,requestId,taskId,ct);return previous is null?null:Replay(previous);
    }
    public async Task<SourcingAllocationMutation> ReleaseAsync(string actor,string allocationId,SourcingAllocationReleaseInput supplied,CancellationToken ct)
    {
        actor=SourcingAllocationRules.Actor(actor);allocationId=SourcingAllocationRules.Id(allocationId);var input=SourcingAllocationRules.Normalize(supplied);var hash=SourcingAllocationRules.Hash(new{Allocation=allocationId,Input=input});var previous=await Command(actor,"release",input.RequestId,allocationId,hash,null,null,ct);if(previous is not null)return Replay(previous);await Lock("acceptance",input.AcceptanceId,ct);await Lock("resource",allocationId,ct);var row=await Load(allocationId,ct);if(row.AcceptanceId!=input.AcceptanceId)throw Missing();SerialRules.MatchVersion(row.Version,input.Version);await ReleaseCore(row,actor,input.Reason,row.ExpiresAt<=clock.GetUtcNow(),ct);return await Remember(row,actor,"release",input.RequestId,hash,clock.GetUtcNow(),ct);
    }
    public async Task ReleaseForAcceptanceAsync(string actor,string acceptanceId,string reason,CancellationToken ct)
    {
        actor=SourcingAllocationRules.Actor(actor);acceptanceId=SourcingAllocationRules.Id(acceptanceId);reason=SourcingAllocationRules.Reason(reason);RequireTransaction();await Lock("acceptance",acceptanceId,ct);var id=await Rows(null).AsNoTracking().Where(a=>a.AcceptanceId==acceptanceId&&a.IsActive).Select(a=>a.Id).SingleOrDefaultAsync(ct);if(id is null){if(await Rows(null).AsNoTracking().AnyAsync(a=>a.AcceptanceId==acceptanceId&&a.State=="Transferred",ct))throw new BusinessException("sourcing_allocation_transferred_conflict","This accepted allocation has already transferred to a real order.");return;}await Lock("resource",id,ct);var row=await Load(id,ct);await ReleaseCore(row,actor,reason,row.ExpiresAt<=clock.GetUtcNow(),ct);
    }
    public async Task<int> ExpireBatchAsync(int maximum,CancellationToken ct)
    {
        if(maximum is <1 or >100)throw new ArgumentOutOfRangeException(nameof(maximum));if(db.Database.CurrentTransaction is not null)throw new InvalidOperationException("Allocation expiry requires its own short transactions.");var now=clock.GetUtcNow();var candidates=await Rows(null).AsNoTracking().Where(a=>a.State=="Active"&&a.ExpiresAt<=now).OrderBy(a=>a.ExpiresAt).ThenBy(a=>a.Id).Select(a=>new{a.Id,a.AcceptanceId}).Take(maximum).ToArrayAsync(ct);var count=0;
        foreach(var candidate in candidates){await using var tx=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable,ct);await Lock("acceptance",candidate.AcceptanceId,ct);await Lock("resource",candidate.Id,ct);var row=await Load(candidate.Id,ct);if(await ReleaseCore(row,"inventory-allocation-expiry","Allocation deadline reached",true,ct))count++;await tx.CommitAsync(ct);}return count;
    }
    public async Task<SourcingAllocationData> ReadAsync(string allocationId,string? ownerId,CancellationToken ct)
    {
        allocationId=SourcingAllocationRules.Id(allocationId);var owner=ownerId is null?null:SourcingAllocationRules.Actor(ownerId);var row=await Graph(Rows(owner).AsNoTracking()).SingleOrDefaultAsync(a=>a.Id==allocationId,ct)??throw Missing();Bound(row);var claims=await db.Set<SerialUnitClaim>().AsNoTracking().Where(c=>c.OriginAllocationId==allocationId).OrderBy(c=>c.Id).Take(101).ToArrayAsync(ct);if(claims.Length>100)throw Capacity();var version=await Rows(owner).AsNoTracking().Where(a=>a.Id==allocationId).Select(a=>a.Version).SingleOrDefaultAsync(ct);if(version is null)throw Missing();if(!version.SequenceEqual(row.Version))throw new BusinessException("version_conflict","Allocation changed while reading its unit history.");var result=new SourcingAllocationData(1,row.Id,row.RequestId,row.TaskId,row.OfferId,row.AcceptanceId,row.State,SourcingAllocationRules.EffectiveState(row.State,row.ExpiresAt,clock.GetUtcNow()),Version(row.Version),row.CreatedAt,row.ChangedAt,row.ExpiresAt,row.ContainsDemo,row.Lines.OrderBy(l=>l.OfferLineId,StringComparer.Ordinal).Select(l=>new SourcingAllocationLineData(l.OfferLineId,l.VariantId,l.Quantity,claims.Where(c=>c.OfferLineId==l.OfferLineId).Select(c=>c.UnitId).OrderBy(x=>x,StringComparer.Ordinal).ToArray())).ToArray());if(JsonSerializer.SerializeToUtf8Bytes(result,Json).Length>524288)throw Capacity();return result;
    }
    public async Task<SourcingAllocationData?> ReadActiveAsync(string acceptanceId,string? ownerId,CancellationToken ct)
    {
        acceptanceId=SourcingAllocationRules.Id(acceptanceId);var owner=ownerId is null?null:SourcingAllocationRules.Actor(ownerId);var id=await Rows(owner).AsNoTracking().Where(a=>a.AcceptanceId==acceptanceId&&a.IsActive).Select(a=>a.Id).SingleOrDefaultAsync(ct);return id is null?null:await ReadAsync(id,owner,ct);
    }
    public async Task<SourcingAllocationSummaryData[]> ReadSummariesAsync(string[] acceptanceIds,string? ownerId,CancellationToken ct)
    {
        if(acceptanceIds is null||acceptanceIds.Length>50)throw SourcingAllocationRules.Invalid();
        var ids=acceptanceIds.Select(SourcingAllocationRules.Id).Distinct(StringComparer.Ordinal).ToArray();
        var owner=ownerId is null?null:SourcingAllocationRules.Actor(ownerId);if(ids.Length==0)return [];
        // A page needs no physical identifiers. Read at most 50 parent/64-line
        // graphs in one batch and recheck versions after the split graph read.
        var rows=await Graph(Rows(owner).AsNoTracking().Where(a=>a.IsActive&&ids.Contains(a.AcceptanceId))).OrderBy(a=>a.Id).Take(51).AsSplitQuery().ToArrayAsync(ct);
        if(rows.Length>50||rows.Select(a=>a.AcceptanceId).Distinct(StringComparer.Ordinal).Count()!=rows.Length)throw Capacity();
        foreach(var row in rows)Bound(row);
        var found=rows.Select(a=>a.Id).ToArray();
        var versions=await Rows(owner).AsNoTracking().Where(a=>found.Contains(a.Id)).Select(a=>new{a.Id,a.Version,a.IsActive}).ToDictionaryAsync(a=>a.Id,ct);
        if(rows.Any(a=>!versions.TryGetValue(a.Id,out var current)||!current.IsActive||!current.Version.SequenceEqual(a.Version)))throw new BusinessException("version_conflict","Allocation changed while loading its page summary.");
        var now=clock.GetUtcNow();return rows.Select(a=>new SourcingAllocationSummaryData(1,a.Id,a.RequestId,a.TaskId,a.OfferId,a.AcceptanceId,a.State,SourcingAllocationRules.EffectiveState(a.State,a.ExpiresAt,now),Version(a.Version),a.ExpiresAt,a.ContainsDemo,checked(a.Lines.Sum(l=>l.Quantity)),a.Lines.OrderBy(l=>l.OfferLineId,StringComparer.Ordinal).Select(l=>new SourcingAllocationSummaryLine(l.OfferLineId,l.VariantId,l.Quantity)).ToArray())).ToArray();
    }
    public async Task<SourcingAllocationMutation> ReadCommandAsync(string actor,string allocationId,string operation,string commandId,CancellationToken ct)
    {
        actor=SourcingAllocationRules.Actor(actor);allocationId=SourcingAllocationRules.Id(allocationId);commandId=SourcingAllocationRules.Id(commandId);if(operation is not ("allocate" or "release"))throw SourcingAllocationRules.Invalid();var row=await db.Set<SourcingAllocationCommand>().AsNoTracking().SingleOrDefaultAsync(c=>c.ActorId==actor&&c.Operation==operation&&c.CommandId==commandId&&c.AllocationId==allocationId&&(allowDemo||!c.ContainsDemo),ct)??throw Missing();return Replay(row);
    }
    public async Task<SourcingAllocationEventPage> EventsAsync(string allocationId,string? ownerId,string? cursor,CancellationToken ct)
    {
        allocationId=SourcingAllocationRules.Id(allocationId);var owner=ownerId is null?null:SourcingAllocationRules.Actor(ownerId);if(!await Rows(owner).AsNoTracking().AnyAsync(a=>a.Id==allocationId,ct))throw Missing();var binding=SourcingAllocationRules.Hash(new{Allocation=allocationId,Owner=owner??"staff"});long after=0;if(cursor is not null){try{if(cursor.Length is <1 or >200||cursor.Any(c=>!char.IsAsciiLetterOrDigit(c)&&c is not ('-' or '_')))throw new FormatException();var raw=cursor.Replace('-','+').Replace('_','/');var value=JsonSerializer.Deserialize<EventCursor>(Convert.FromBase64String(raw.PadRight((raw.Length+3)/4*4,'=')),Json);if(value is null||value.Binding!=binding||!long.TryParse(value.After,NumberStyles.None,CultureInfo.InvariantCulture,out after)||after<1||value.After!=after.ToString(CultureInfo.InvariantCulture))throw new FormatException();}catch(Exception e)when(e is FormatException or JsonException){throw new BusinessException("invalid_sourcing_allocation_cursor","Use the event cursor for this owner and allocation.");}}
        var size=owner is null?50:20;var found=await db.Set<SourcingAllocationEvent>().AsNoTracking().Where(e=>e.AllocationId==allocationId&&e.Id>after).OrderBy(e=>e.Id).Take(size+1).ToArrayAsync(ct);var page=found.Take(size).ToArray();var next=found.Length>size?Convert.ToBase64String(JsonSerializer.SerializeToUtf8Bytes(new EventCursor(page[^1].Id.ToString(CultureInfo.InvariantCulture),binding),Json)).TrimEnd('=').Replace('+','-').Replace('/','_'):null;return new(1,size,page.Select(e=>new SourcingAllocationEventData(e.Id.ToString(CultureInfo.InvariantCulture),e.State,owner is null?e.Reason:"allocation_"+e.State.ToLowerInvariant(),e.At)).ToArray(),next);
    }
    private void Event(SourcingStockAllocation row,string actor,string reason,DateTimeOffset now)=>db.Set<SourcingAllocationEvent>().Add(new(){AllocationId=row.Id,State=row.State,ActorId=actor,Reason=reason,At=now});
    private async Task<SourcingAllocationMutation> Remember(SourcingStockAllocation row,string actor,string operation,string command,string hash,DateTimeOffset now,CancellationToken ct)
    {
        var result=new SourcingAllocationMutation(1,row.Id,row.RequestId,row.TaskId,row.OfferId,row.AcceptanceId,operation,row.State,Version(row.Version),command,now,row.ExpiresAt,false);var json=JsonSerializer.Serialize(result,Json);if(Encoding.Unicode.GetByteCount(json)>16384)throw Capacity();db.Set<SourcingAllocationCommand>().Add(new(){ActorId=actor,Operation=operation,CommandId=command,AllocationId=row.Id,RequestId=row.RequestId,TaskId=row.TaskId,ContainsDemo=row.ContainsDemo,PayloadHash=hash,ResultJson=json,At=now});await db.SaveChangesAsync(ct);return result;
    }
    private static void Bound(SourcingStockAllocation row){if(row.State is not ("Active" or "Released" or "Expired" or "Transferred")||row.IsActive!=(row.State=="Active")||row.ExpiresAt<=row.CreatedAt||row.ChangedAt<row.CreatedAt||row.Lines.Count is <1 or >64||row.Lines.Any(l=>l.Quantity is <1 or >1000000||l.TrackingMode is not ("none" or "serial" or "imei")))throw Capacity();}
    private static BusinessException Missing()=>new("not_found","The sourcing allocation was not found.");
    private static BusinessException Capacity()=>new("sourcing_allocation_capacity_unavailable","The allocation graph exceeds its supported bounds.");
}
