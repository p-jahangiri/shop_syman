using System.Globalization;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Inventory;

public sealed class SourcingReceivingService(InventoryDbContext db,StockReservationService reservations,SerialInventoryService serials,TimeProvider clock,bool allowDemo):IInventorySourcingReceiving
{
    private sealed record PreparedLine(SourcingReceiptLineInput Input,SourcingReceivingPlanLine Plan,ReceivingUnitMapping Mapping,int Quantity,string ExternalIdentity);
    private static string Payload(string requestId,string taskId,string receiptId,SourcingReceiptInput input)=>SourcingReceivingRules.Hash(new{Request=requestId,Task=taskId,Receipt=receiptId,Input=input});
    public async Task<SourcingReceivingResult?> ReplayAsync(string actorId,string requestId,string taskId,string receiptId,SourcingReceiptInput supplied,CancellationToken ct)
    {
        var actor=SourcingReceivingRules.Actor(actorId);requestId=SourcingReceivingRules.Id(requestId);taskId=SourcingReceivingRules.Id(taskId);receiptId=SourcingReceivingRules.Id(receiptId);var input=SourcingReceivingRules.Normalize(supplied);ReceivingPersistence.RequireTransaction(db);await reservations.LockAsync("receiving-command","receive:"+actor+":"+input.RequestId,ct);
        var previous=await ReceivingPersistence.Replay(db,actor,"receive",input.RequestId,receiptId,requestId,taskId,Payload(requestId,taskId,receiptId,input),ct);if(previous is null)return null;if(previous.ContainsDemo&&!allowDemo)throw ReceivingPersistence.Missing();return ReceivingPersistence.Read<SourcingReceivingResult>(previous) with{Replayed=true};
    }
    public async Task<SourcingReceivingResult> ReceiveAsync(string actorId,string receiptId,SourcingReceivingPlan plan,SourcingReceiptInput supplied,CancellationToken ct)
    {
        var actor=SourcingReceivingRules.Actor(actorId);receiptId=SourcingReceivingRules.Id(receiptId);var input=SourcingReceivingRules.Normalize(supplied);if(plan is null)throw new InvalidOperationException("Market must supply a trusted receiving plan.");var replay=await ReplayAsync(actor,plan.RequestId,plan.TaskId,receiptId,input,ct);if(replay is not null)return replay;ValidatePlan(plan,input);
        if(plan.ContainsDemo&&!allowDemo)throw ReceivingPersistence.Missing();var now=clock.GetUtcNow();if(input.ReceivedAt>now)throw SourcingReceivingRules.Invalid();if(plan.RequiresNewOffer&&!input.AcknowledgeHistorical)throw new BusinessException("receiving_historical_acknowledgement_conflict","Explicitly acknowledge that this historical receipt does not restore consent or authorize checkout.");
        // Physical identity deliberately excludes actor, task, channel and SKU.
        // A duplicate anywhere rejects the complete command before any Stock write.
        var identities=input.Lines.Select(l=>SourcingReceivingRules.ExternalLineIdentity(input.OriginSystem,input.CompanyKey,input.WarehouseKey,input.SourceReceiptKey,l.SourceReceiptLineKey)).ToArray();
        foreach(var identity in identities.OrderBy(x=>x,StringComparer.Ordinal))await reservations.LockAsync("receiving-external-line",identity,ct);
        await reservations.LockAsync("receiving-receipt",receiptId,ct);if(await db.SourcingReceipts.FromSqlInterpolated($"SELECT * FROM [inventory].[SourcingReceipts] WITH (UPDLOCK, HOLDLOCK) WHERE [Id]={receiptId}").AsNoTracking().AnyAsync(ct))throw new BusinessException("receiving_receipt_conflict","This receipt resource already records another receiving command.");
        foreach(var identity in identities.OrderBy(x=>x,StringComparer.Ordinal))
            if(await db.SourcingReceiptLines.FromSqlInterpolated($"SELECT * FROM [inventory].[SourcingReceiptLines] WITH (UPDLOCK, HOLDLOCK) WHERE [ExternalIdentityHash]={identity}").AsNoTracking().AnyAsync(ct))throw new BusinessException("receiving_external_identity_conflict","At least one physical source line was already received. Recover the original receipt instead of entering it again.");
        var prepared=await PrepareLines(plan,input,ct);var groups=prepared.GroupBy(l=>l.Plan.VariantId,StringComparer.OrdinalIgnoreCase).OrderBy(g=>g.Key.ToUpperInvariant(),StringComparer.Ordinal).ToArray();
        var stocks=await reservations.LockStockAsync(groups.Select(g=>g.Key),ct);
        foreach(var group in groups){var versions=group.Select(l=>l.Input.StockVersion).Distinct(StringComparer.Ordinal).ToArray();var modes=group.Select(l=>l.Input.TrackingMode).Distinct(StringComparer.Ordinal).ToArray();if(versions.Length!=1||modes.Length!=1)throw new BusinessException("receiving_stock_conflict","Every physical line for a SKU must use the same current Stock version and tracking mode.");
            if(!stocks.TryGetValue(group.Key,out var stock)){if(versions[0] is not null||modes[0]!="none")throw new BusinessException("version_conflict","Configure tracked Stock and reload its version before receiving.");stock=new(){VariantId=group.Key};db.Stock.Add(stock);stocks.Add(group.Key,stock);}else SerialRules.MatchVersion(stock.Version,versions[0]);
            if(stock.TrackingMode!=modes[0])throw new BusinessException("receiving_tracking_conflict","The SKU tracking configuration changed. Reload the physical Stock state.");
            _=StockAvailability.Available(stock.OnHand,stock.Reserved,stock.SourcingReserved);
            if((long)stock.OnHand+group.Sum(l=>(long)l.Quantity)>int.MaxValue)throw new BusinessException("receiving_stock_capacity_conflict","The received quantity exceeds the supported Stock balance.");
        }
        var header=new SourcingStockReceipt{Id=receiptId,RequestId=plan.RequestId,TaskId=plan.TaskId,OfferId=plan.OfferId,AcceptanceId=plan.AcceptanceId,ContainsDemo=plan.ContainsDemo,RequiresNewOffer=plan.RequiresNewOffer,Channel=input.Channel,OriginSystem=input.OriginSystem,CompanyKey=input.CompanyKey,WarehouseKey=input.WarehouseKey,SourceReceiptKey=input.SourceReceiptKey,ReceivedAt=input.ReceivedAt,RecordedAt=now,ActorId=actor,Reason=input.Reason,AcknowledgeHistorical=input.AcknowledgeHistorical};
        foreach(var group in groups){var stock=stocks[group.Key];var received=group.Sum(l=>l.Quantity);var movement=new StockMovement{VariantId=stock.VariantId,Delta=received,Reason=input.Reason,ActorId=actor,RequestId=SourcingReceivingRules.Hash(new{Kind="sourcing-receipt",Receipt=receiptId,Variant=stock.VariantId.ToUpperInvariant()}),At=now};
            foreach(var line in group){SerialUnit[] units=[];if(stock.TrackingMode=="none")stock.OnHand=checked(stock.OnHand+line.Quantity);else units=await serials.ReceiveCoreAsync(stock,line.Input.Units.Select(u=>new SerialUnitInput(u.Serial,u.Imei1,u.Imei2)).ToArray(),actor,input.Reason,now,ct);
                var stored=new SourcingStockReceiptLine{Id=Guid.NewGuid().ToString("N"),ReceiptId=receiptId,ExternalIdentityHash=line.ExternalIdentity,OfferLineId=line.Plan.OfferLineId,VariantId=stock.VariantId,SourceReceiptLineKey=line.Input.SourceReceiptLineKey,MappingId=line.Mapping.Id,MappingVersion=line.Input.MappingVersion,SourceUnitKey=line.Mapping.SourceUnitKey,UnitNameFa=line.Mapping.NameFa,UnitNameEn=line.Mapping.NameEn,Numerator=line.Mapping.Numerator,Denominator=line.Mapping.Denominator,SourceQuantity=line.Input.SourceQuantity,Quantity=line.Quantity,TrackingMode=stock.TrackingMode,Movement=movement};stored.Units=units.Select(u=>new SourcingStockReceiptUnit{ReceiptLineId=stored.Id,UnitId=u.Id}).ToList();header.Lines.Add(stored);
            }
            movement.Balance=stock.OnHand;db.Movements.Add(movement);
        }
        db.SourcingReceipts.Add(header);await db.SaveChangesAsync(ct);var result=Result(header,false);await ReceivingPersistence.Remember(db,actor,"receive",input.RequestId,receiptId,plan.RequestId,plan.TaskId,plan.ContainsDemo,Payload(plan.RequestId,plan.TaskId,receiptId,input),result,now,ct);return result;
    }
    private async Task<PreparedLine[]> PrepareLines(SourcingReceivingPlan plan,SourcingReceiptInput input,CancellationToken ct)
    {
        var ids=input.Lines.Select(l=>l.MappingId).Distinct(StringComparer.Ordinal).OrderBy(x=>x,StringComparer.Ordinal).ToArray();foreach(var id in ids)await reservations.LockAsync("receiving-mapping",id,ct);
        var found=await db.ReceivingUnitMappings.AsNoTracking().Where(m=>ids.Contains(m.Id)).ToDictionaryAsync(m=>m.Id,ct);var plans=plan.Lines.ToDictionary(l=>l.OfferLineId,StringComparer.Ordinal);var prepared=new List<PreparedLine>();
        foreach(var line in input.Lines){if(!plans.TryGetValue(line.OfferLineId,out var target))throw new BusinessException("receiving_line_conflict","The physical receipt line is not part of this accepted task.");if(!found.TryGetValue(line.MappingId,out var mapping))throw ReceivingPersistence.Missing();
            if(!mapping.IsActive||Convert.ToBase64String(mapping.Version)!=line.MappingVersion||mapping.OriginSystem!=input.OriginSystem||mapping.CompanyKey!=input.CompanyKey||mapping.WarehouseKey!=input.WarehouseKey||!mapping.VariantId.Equals(target.VariantId,StringComparison.OrdinalIgnoreCase))throw new BusinessException("receiving_mapping_conflict","Read the active, current mapping for this exact source, unit and accepted SKU.");
            var quantity=SourcingReceivingRules.ConvertQuantity(line.SourceQuantity,mapping.Numerator,mapping.Denominator);if(line.TrackingMode!="none"&&line.Units.Length!=quantity)throw new BusinessException("receiving_serial_quantity_conflict","Provide exactly one physical serial unit for each received sales unit.");prepared.Add(new(line,target,mapping,quantity,SourcingReceivingRules.ExternalLineIdentity(input.OriginSystem,input.CompanyKey,input.WarehouseKey,input.SourceReceiptKey,line.SourceReceiptLineKey)));
        }
        foreach(var group in prepared.GroupBy(l=>l.Plan.OfferLineId,StringComparer.Ordinal)){var target=group.First().Plan;if(group.Sum(l=>(long)l.Quantity)>(long)target.RequiredQuantity-target.ReceivedQuantity)throw new BusinessException("receiving_quantity_conflict","The received quantity exceeds the accepted task's remaining quantity.");}
        return prepared.ToArray();
    }
    private static void ValidatePlan(SourcingReceivingPlan plan,SourcingReceiptInput input)
    {
        if(plan is null||plan.Lines is null||plan.Lines.Length is <1 or >64||plan.Lines.Any(l=>l is null)||plan.Lines.Select(l=>l.OfferLineId).Distinct(StringComparer.Ordinal).Count()!=plan.Lines.Length)throw new InvalidOperationException("Market returned an invalid trusted receiving plan.");
        SourcingReceivingRules.Id(plan.RequestId);SourcingReceivingRules.Id(plan.TaskId);SourcingReceivingRules.Id(plan.OfferId);SourcingReceivingRules.Id(plan.AcceptanceId);SourcingReceivingRules.Actor(plan.OwnerId);SourcingReceivingRules.Version(plan.RequestVersion);SourcingReceivingRules.Version(plan.TaskVersion);
        if(plan.RequestVersion!=input.RequestVersion||plan.TaskVersion!=input.TaskVersion)throw new BusinessException("version_conflict","The prepared receiving task changed. Read it again.");
        foreach(var line in plan.Lines){SourcingReceivingRules.Id(line.OfferLineId);SourcingReceivingRules.Identifier(line.VariantId);SourcingReceivingRules.Identifier(line.ProductId);if(line.RequiredQuantity is <1 or >1000000||line.ReceivedQuantity<0||line.ReceivedQuantity>line.RequiredQuantity)throw new InvalidOperationException("Market returned invalid accepted quantities.");}
    }
    private static SourcingReceivingResult Result(SourcingStockReceipt r,bool replayed)=>new(1,r.Id,r.RequestId,r.TaskId,r.OfferId,r.AcceptanceId,r.RequiresNewOffer,r.ReceivedAt,r.RecordedAt,replayed,r.Lines.OrderBy(l=>l.SourceReceiptLineKey,StringComparer.Ordinal).Select(l=>new SourcingReceivedLine(l.Id,l.OfferLineId,l.VariantId,l.Quantity,l.MovementId.ToString(CultureInfo.InvariantCulture),l.Units.OrderBy(u=>u.UnitId,StringComparer.Ordinal).Select(u=>u.UnitId).ToArray())).ToArray());
    public async Task<SourcingReceivingResult> ReadCommandAsync(string actorId,string receiptId,string commandId,CancellationToken ct)
    {
        var actor=SourcingReceivingRules.Actor(actorId);receiptId=SourcingReceivingRules.Id(receiptId);commandId=SourcingReceivingRules.Id(commandId);var row=await db.ReceivingCommands.AsNoTracking().SingleOrDefaultAsync(c=>c.ActorId==actor&&c.Operation=="receive"&&c.CommandId==commandId&&c.TargetId==receiptId&&(allowDemo||!c.ContainsDemo),ct)??throw ReceivingPersistence.Missing();return ReceivingPersistence.Read<SourcingReceivingResult>(row) with{Replayed=true};
    }
    public async Task<SourcingReceiptData> ReadAsync(string receiptId,CancellationToken ct)
    {
        receiptId=SourcingReceivingRules.Id(receiptId);var row=await db.SourcingReceipts.AsNoTracking().Where(r=>r.Id==receiptId&&(allowDemo||!r.ContainsDemo)).Include(r=>r.Lines.OrderBy(l=>l.Id).Take(65)).ThenInclude(l=>l.Units.OrderBy(u=>u.UnitId).Take(101)).AsSplitQuery().SingleOrDefaultAsync(ct)??throw ReceivingPersistence.Missing();
        if(row.Lines.Count>64||row.Lines.Sum(l=>l.Units.Count)>100)throw new BusinessException("receiving_capacity_unavailable","The receipt graph exceeds its supported bounds.");
        var result=new SourcingReceiptData(1,row.Id,row.RequestId,row.TaskId,row.OfferId,row.AcceptanceId,row.Channel,row.OriginSystem,row.CompanyKey,row.WarehouseKey,row.SourceReceiptKey,row.ReceivedAt,row.RecordedAt,row.ActorId,row.Reason,row.AcknowledgeHistorical,row.RequiresNewOffer,row.Lines.OrderBy(l=>l.SourceReceiptLineKey,StringComparer.Ordinal).Select(l=>new SourcingReceiptLineData(l.Id,l.OfferLineId,l.VariantId,l.SourceReceiptLineKey,l.MappingId,l.MappingVersion,l.SourceUnitKey,l.UnitNameFa,l.UnitNameEn,l.Numerator,l.Denominator,l.SourceQuantity,l.Quantity,l.TrackingMode,l.MovementId.ToString(CultureInfo.InvariantCulture),l.Units.Select(u=>u.UnitId).OrderBy(x=>x,StringComparer.Ordinal).ToArray())).ToArray());
        if(JsonSerializer.SerializeToUtf8Bytes(result,ReceivingPersistence.Json).Length>524288)throw new BusinessException("receiving_capacity_unavailable","The receipt exceeds its supported response bound.");return result;
    }
    public async Task<ReceivingStockState[]> ReadStockAsync(string[] variantIds,CancellationToken ct)
    {
        if(variantIds is null||variantIds.Length>64||variantIds.Any(v=>v is null)||variantIds.Distinct(StringComparer.OrdinalIgnoreCase).Count()!=variantIds.Length)throw SourcingReceivingRules.Invalid();var ids=variantIds.Select(SourcingReceivingRules.Identifier).OrderBy(v=>v.ToUpperInvariant(),StringComparer.Ordinal).ToArray();var stock=await db.Stock.AsNoTracking().Where(s=>ids.Contains(s.VariantId)).ToDictionaryAsync(s=>s.VariantId,StringComparer.OrdinalIgnoreCase,ct);
        return ids.Select(id=>stock.TryGetValue(id,out var s)?new ReceivingStockState(id,s.TrackingMode,s.OnHand,s.Reserved,Convert.ToBase64String(s.Version)):new ReceivingStockState(id,"none",0,0,null)).ToArray();
    }
}
