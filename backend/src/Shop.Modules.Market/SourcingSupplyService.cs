using System.Data;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;

namespace Shop.Modules.Market;

public sealed class SourcingSupplyService(MarketDbContext db,ICatalogOfferReader catalog,ISourcingSupplyNoteProtection notes,TimeProvider clock,bool allowDemo,ISourcingPurchaseLifecycle? purchaseLifecycle=null)
{
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web){UnmappedMemberHandling=JsonUnmappedMemberHandling.Disallow,MaxDepth=16};
    private sealed record PageCursor(long At,string Id,string Binding);
    private sealed record EventCursor(string After,string Binding);
    private sealed record Prepared(string Actor,SourcingRequest Parent,SourcingSupplyTask Task,SourcingReceivingPlan Plan);
    private readonly Dictionary<string,Prepared> prepared=new(StringComparer.Ordinal);
    private readonly HashSet<string> receivingLocks=new(StringComparer.Ordinal);
    private IQueryable<SourcingRequest> Parents(string? owner)=>db.SourcingRequests.Where(r=>(allowDemo||!r.ContainsDemo)&&(owner==null||r.OwnerId==owner));
    private IQueryable<SourcingSupplyTask> Tasks(string? owner)=>db.SourcingSupplyTasks.Where(t=>(allowDemo||!t.ContainsDemo)&&(owner==null||t.OwnerId==owner));
    private static string Version(byte[] value)=>Convert.ToBase64String(value);
    private static string Reference(SourcingRequest parent)=>"SR-"+parent.Number.ToString(CultureInfo.InvariantCulture);
    private static bool ParentOpen(SourcingRequest parent)=>parent.State is "Submitted" or "Reviewing";
    private static IQueryable<SourcingSupplyTask> Graph(IQueryable<SourcingSupplyTask> query)=>query.Include(t=>t.Lines.OrderBy(l=>l.OfferLineId).Take(65));
    private static void Bound(SourcingSupplyTask row)
    {
        if(row.Lines.Count is <1 or >64||row.Lines.Select(l=>l.OfferLineId).Distinct(StringComparer.Ordinal).Count()!=row.Lines.Count||!SourcingSupplyRules.States.Contains(row.State,StringComparer.Ordinal)||row.IsOpen!=SourcingSupplyRules.Open(row.State)||row.ProtectedNote.Length is <1 or >65536)throw Capacity();
        SourcingSupplyRules.ReceiptProgress(row.Lines.Select(l=>(l.RequiredQuantity,l.ReceivedQuantity)));
    }
    private static string Progress(SourcingSupplyTask task)=>SourcingSupplyRules.ReceiptProgress(task.Lines.Select(l=>(l.RequiredQuantity,l.ReceivedQuantity)));
    private string Protect(string owner,string task,string text){var value=notes.Protect(owner,task,text);if(value.Length is <1 or >65536)throw Capacity();return value;}

    public async Task<SourcingSupplyMutation> StartAsync(string actorId,string requestId,string offerId,string taskId,SourcingSupplyStartInput supplied,CancellationToken ct)
    {
        var actor=SourcingRules.Actor(actorId);requestId=SourcingRules.Id(requestId);offerId=SourcingRules.Id(offerId);taskId=SourcingRules.Id(taskId);var input=SourcingSupplyRules.Normalize(supplied);
        var hash=SourcingRules.Payload(new{TargetRequest=requestId,TargetOffer=offerId,TargetTask=taskId,Input=input});
        SourcingSupplyLocks.RequireTransaction(db);await SourcingSupplyLocks.CommandAsync(db,actor,"start",input.RequestId,ct);
        if(await Replay(actor,"start",input.RequestId,requestId,taskId,hash,ct) is{} replay)return replay;
        await SourcingSupplyLocks.RequestAsync(db,requestId,ct);await SourcingSupplyLocks.TaskAsync(db,taskId,ct);
        var parent=await Parents(null).SingleOrDefaultAsync(r=>r.Id==requestId,ct)??throw Missing();CheckParent(parent,input.RequestVersion,true);
        if(await db.SourcingSupplyTasks.AnyAsync(t=>t.Id==taskId||t.RequestId==requestId&&t.IsOpen,ct))throw Conflict();
        var offer=await db.SourcingOffers.Include(o=>o.Lines.OrderBy(l=>l.LineId).Take(65)).SingleOrDefaultAsync(o=>o.RequestId==requestId&&o.Id==offerId&&(allowDemo||!o.ContainsDemo),ct)??throw Missing();
        var now=clock.GetUtcNow();if(Version(offer.Version)!=input.OfferVersion)throw Changed();
        if(offer.TermsHash!=input.TermsHash)throw new BusinessException("sourcing_offer_terms_conflict","Review the exact accepted terms before starting supply.");
        var acceptance=await db.SourcingOfferAcceptances.SingleOrDefaultAsync(a=>a.OfferId==offerId,ct)??throw Conflict();
        if(offer.State!="Accepted"||!offer.IsActive||offer.PurchaseUntil<=now||offer.AcceptanceId!=acceptance.Id||acceptance.OwnerId!=parent.OwnerId||acceptance.TermsHash!=offer.TermsHash)throw Reoffer();
        if(await db.SourcingSupplyTasks.AnyAsync(t=>t.AcceptanceId==acceptance.Id,ct))throw Conflict();
        if(offer.Lines.Count is <1 or >64)throw Capacity();
        var current=await SourcingSupplyCatalogState.ReadAsync(catalog,offer.Lines.Select(l=>l.VariantId).Distinct(StringComparer.OrdinalIgnoreCase).ToArray(),ct);
        if(current is null||offer.Lines.Any(l=>!current.TryGetValue(l.VariantId,out var sku)||sku.ProductId!=l.ProductId||sku.MaterialFingerprint!=l.MaterialFingerprint))throw Reoffer();
        now=clock.GetUtcNow();if(offer.PurchaseUntil<=now)throw Reoffer();
        var task=new SourcingSupplyTask{Id=taskId,RequestId=requestId,OfferId=offerId,AcceptanceId=acceptance.Id,OwnerId=parent.OwnerId,TermsHash=offer.TermsHash,ContainsDemo=parent.ContainsDemo||offer.ContainsDemo,CreatedAt=now,ChangedAt=now,ProtectedNote=Protect(parent.OwnerId,taskId,"")};
        task.Lines=offer.Lines.Select(l=>new SourcingSupplyTaskLine{TaskId=taskId,OfferLineId=l.LineId,VariantId=l.VariantId,ProductId=l.ProductId,Sku=l.Sku,NameFa=l.NameFa,NameEn=l.NameEn,LabelFa=l.LabelFa,LabelEn=l.LabelEn,MaterialFingerprint=l.MaterialFingerprint,RequiredQuantity=l.Quantity}).ToList();
        Bound(task);db.SourcingSupplyTasks.Add(task);TouchParent(parent,now);var ev=Event(task,actor,null,"supply_started",now);await db.SaveChangesAsync(ct);var result=await Remember(actor,"start",input.RequestId,hash,parent,task,ev,ct);if(offer.PurchaseUntil<=clock.GetUtcNow())throw Reoffer();return result;
    }

    public Task<SourcingSupplyMutation> RequestedAsync(string actor,string requestId,string taskId,SourcingSupplySourceInput input,CancellationToken ct)=>RecordSource(actor,requestId,taskId,"requested",input,ct);
    public Task<SourcingSupplyMutation> OrderedAsync(string actor,string requestId,string taskId,SourcingSupplySourceInput input,CancellationToken ct)=>RecordSource(actor,requestId,taskId,"ordered",input,ct);
    private async Task<SourcingSupplyMutation> RecordSource(string actorId,string requestId,string taskId,string operation,SourcingSupplySourceInput supplied,CancellationToken ct)
    {
        var actor=SourcingRules.Actor(actorId);requestId=SourcingRules.Id(requestId);taskId=SourcingRules.Id(taskId);var input=SourcingSupplyRules.Normalize(supplied,operation=="ordered");var hash=SourcingRules.Payload(new{TargetRequest=requestId,TargetTask=taskId,Input=input});
        var replay=await Command(actor,operation,input.RequestId,requestId,taskId,hash,ct);if(replay is not null)return replay;
        var (parent,task,offer)=await Tracked(requestId,taskId,input.RequestVersion,input.TaskVersion,ct);var now=clock.GetUtcNow();if(input.ActionAt>now)throw SourcingSupplyRules.Invalid();
        if(!task.IsOpen||await RequiresNewOffer(parent,task,offer,now,ct)||operation=="requested"&&task.State=="SupplierOrderRecorded")throw Reoffer();
        var before=task.State;task.State=operation=="ordered"?"SupplierOrderRecorded":"SupplierRequested";task.SourceKind=input.SourceKind;task.SourceKey=input.SourceKey;task.SourceNameFa=input.SourceNameFa;task.SourceNameEn=input.SourceNameEn;task.Reference=input.Reference;task.ActionAt=input.ActionAt;task.ExpectedAt=input.ExpectedAt;task.PublicMessageFa=input.PublicMessageFa;task.PublicMessageEn=input.PublicMessageEn;task.ProtectedNote=Protect(task.OwnerId,task.Id,input.InternalNote??"");Touch(task,parent,now);var ev=Event(task,actor,before,"supplier_"+operation,now);await db.SaveChangesAsync(ct);return await Remember(actor,operation,input.RequestId,hash,parent,task,ev,ct);
    }
    public async Task<SourcingSupplyMutation> ProgressAsync(string actorId,string requestId,string taskId,SourcingSupplyProgressInput supplied,CancellationToken ct)
    {
        var actor=SourcingRules.Actor(actorId);requestId=SourcingRules.Id(requestId);taskId=SourcingRules.Id(taskId);var input=SourcingSupplyRules.Normalize(supplied);var hash=SourcingRules.Payload(new{TargetRequest=requestId,TargetTask=taskId,Input=input});var replay=await Command(actor,"progress",input.RequestId,requestId,taskId,hash,ct);if(replay is not null)return replay;
        var (parent,task,_)=await Tracked(requestId,taskId,input.RequestVersion,input.TaskVersion,ct);var now=clock.GetUtcNow();if(input.ActionAt>now)throw SourcingSupplyRules.Invalid();
        task.ActionAt=input.ActionAt;task.ExpectedAt=input.ExpectedAt;task.PublicMessageFa=input.PublicMessageFa;task.PublicMessageEn=input.PublicMessageEn;task.ProtectedNote=Protect(task.OwnerId,task.Id,input.InternalNote??"");Touch(task,parent,now);var ev=Event(task,actor,task.State,"supply_progress_recorded",now);await db.SaveChangesAsync(ct);return await Remember(actor,"progress",input.RequestId,hash,parent,task,ev,ct);
    }
    public Task<SourcingSupplyMutation> CancelAsync(string actor,string requestId,string taskId,SourcingSupplyCloseInput input,CancellationToken ct)=>Close(actor,requestId,taskId,"cancel",input,ct);
    public Task<SourcingSupplyMutation> FailAsync(string actor,string requestId,string taskId,SourcingSupplyCloseInput input,CancellationToken ct)=>Close(actor,requestId,taskId,"fail",input,ct);
    private async Task<SourcingSupplyMutation> Close(string actorId,string requestId,string taskId,string operation,SourcingSupplyCloseInput supplied,CancellationToken ct)
    {
        var actor=SourcingRules.Actor(actorId);requestId=SourcingRules.Id(requestId);taskId=SourcingRules.Id(taskId);var input=SourcingSupplyRules.Normalize(supplied);var hash=SourcingRules.Payload(new{TargetRequest=requestId,TargetTask=taskId,Input=input});var replay=await Command(actor,operation,input.RequestId,requestId,taskId,hash,ct);if(replay is not null)return replay;
        var (parent,task,offer)=await Tracked(requestId,taskId,input.RequestVersion,input.TaskVersion,ct);if(!task.IsOpen)throw Conflict();
        // Request/task locks are held; Sales consumption is authoritative even
        // after consent expiry or an inactive Offer projection. Revoke/release
        // must happen before any closure writes and before Inventory Stock locks.
        if(purchaseLifecycle is not null)await purchaseLifecycle.BeforeCloseAsync(actor,requestId,taskId,task.AcceptanceId,input.ReasonCode,ct);
        var now=clock.GetUtcNow();var before=task.State;task.State=operation=="cancel"?"Cancelled":"Failed";task.IsOpen=false;task.PublicMessageFa=input.PublicMessageFa;task.PublicMessageEn=input.PublicMessageEn;task.ProtectedNote=Protect(task.OwnerId,task.Id,input.InternalNote??"");Touch(task,parent,now);SourcingSupplyLifecycle.ReleaseAcceptedOffer(db,task,offer,now);var ev=Event(task,actor,before,input.ReasonCode,now);await db.SaveChangesAsync(ct);return await Remember(actor,operation,input.RequestId,hash,parent,task,ev,ct);
    }

    // Root calls this before Inventory replay. It intentionally performs no
    // existence, state, deadline, catalog or live-version reads.
    public async Task AcquireReceivingLocksAsync(string actorId,string requestId,string taskId,string commandId,CancellationToken ct)
    {
        var actor=SourcingRules.Actor(actorId);requestId=SourcingRules.Id(requestId);taskId=SourcingRules.Id(taskId);var command=SourcingRules.CommandId(commandId);SourcingSupplyLocks.RequireTransaction(db);await SourcingSupplyLocks.CommandAsync(db,actor,"receive",command,ct);await SourcingSupplyLocks.RequestAsync(db,requestId,ct);await SourcingSupplyLocks.TaskAsync(db,taskId,ct);receivingLocks.Add(actor+":"+requestId+":"+taskId+":"+command);
    }
    public async Task<SourcingReceivingPlan> PrepareReceiveAsync(string actorId,string requestId,string taskId,SourcingReceiptInput input,CancellationToken ct)
    {
        var actor=SourcingRules.Actor(actorId);requestId=SourcingRules.Id(requestId);taskId=SourcingRules.Id(taskId);var command=SourcingRules.CommandId(input.RequestId);SourcingSupplyLocks.RequireTransaction(db);
        // Root has already acquired these BEFORE Inventory replay. Do not
        // acquire even a reentrant Market lock after entering Inventory.
        if(!receivingLocks.Contains(actor+":"+requestId+":"+taskId+":"+command))throw new InvalidOperationException("Acquire supply receiving locks before entering Inventory replay.");
        var (parent,task,offer)=await Tracked(requestId,taskId,SourcingRules.Version(input.RequestVersion),SourcingRules.Version(input.TaskVersion),ct);
        if(input.Lines is not {Length:>0 and <=64}||input.Lines.Any(l=>l is null))throw SourcingSupplyRules.Invalid();
        var ids=input.Lines.Select(l=>SourcingRules.Id(l.OfferLineId)).ToHashSet(StringComparer.Ordinal);if(ids.Any(id=>task.Lines.All(l=>l.OfferLineId!=id)))throw new BusinessException("sourcing_supply_line_conflict","Receive only exact accepted supply lines.");
        var requiresNew=await RequiresNewOffer(parent,task,offer,clock.GetUtcNow(),ct);if(requiresNew&&!input.AcknowledgeHistorical)throw new BusinessException("sourcing_supply_historical_ack_conflict","Explicitly acknowledge the historical or changed consent before recording a physical arrival.");
        var plan=new SourcingReceivingPlan(requestId,taskId,task.OfferId,task.AcceptanceId,task.OwnerId,task.TermsHash,task.ContainsDemo,requiresNew,Version(parent.Version),Version(task.Version),task.Lines.OrderBy(l=>l.OfferLineId,StringComparer.Ordinal).Select(l=>new SourcingReceivingPlanLine(l.OfferLineId,l.VariantId,l.ProductId,l.RequiredQuantity,l.ReceivedQuantity,l.MaterialFingerprint)).ToArray());prepared[taskId]=new(actor,parent,task,plan);return plan;
    }
    public async Task<SourcingSupplyMutation> CompleteReceiveAsync(string actorId,SourcingReceivingPlan plan,SourcingReceivingResult result,CancellationToken ct)
    {
        var actor=SourcingRules.Actor(actorId);SourcingSupplyLocks.RequireTransaction(db);
        if(!prepared.TryGetValue(plan.TaskId,out var context)||context.Actor!=actor||!ReferenceEquals(context.Plan,plan)||result.Replayed||result.SchemaVersion!=1||result.RequestId!=plan.RequestId||result.TaskId!=plan.TaskId||result.OfferId!=plan.OfferId||result.AcceptanceId!=plan.AcceptanceId||result.RequiresNewOffer!=plan.RequiresNewOffer||result.Lines is not {Length:>0 and <=64})throw new InvalidOperationException("Complete only the fresh Inventory result of this scoped prepared supply receipt.");
        var parent=context.Parent;var task=context.Task;if(Version(parent.Version)!=plan.RequestVersion||Version(task.Version)!=plan.TaskVersion)throw Changed();var receiptId=SourcingRules.Id(result.ReceiptId);
        if(await db.SourcingSupplyReceiptApplications.AnyAsync(a=>a.ReceiptId==receiptId,ct))throw new InvalidOperationException("The Inventory receipt was already applied to supply progress.");
        var groups=result.Lines.GroupBy(l=>l.OfferLineId,StringComparer.Ordinal).ToArray();
        foreach(var group in groups){var line=task.Lines.SingleOrDefault(l=>l.OfferLineId==group.Key)??throw new InvalidOperationException("Inventory returned a foreign supply line.");if(group.Any(l=>l.Quantity is <1 or >1000000||!string.Equals(l.VariantId,line.VariantId,StringComparison.OrdinalIgnoreCase)))throw new InvalidOperationException("Inventory returned an invalid supply quantity or SKU.");var received=group.Aggregate(0,(sum,l)=>checked(sum+l.Quantity));if(received>line.RequiredQuantity-line.ReceivedQuantity)throw new BusinessException("sourcing_supply_quantity_conflict","The receipt exceeds this accepted line's remaining quantity.");line.ReceivedQuantity=checked(line.ReceivedQuantity+received);}
        var now=clock.GetUtcNow();task.ActionAt=result.ReceivedAt;task.PublicMessageFa="دریافت واقعی ثبت شد؛ وضعیت تخصیص موجودی را در خلاصهٔ جاری بررسی کنید.";task.PublicMessageEn="Actual receipt recorded; check the current summary for stock allocation status.";Touch(task,parent,now);var ev=Event(task,actor,task.State,plan.RequiresNewOffer?"historical_goods_received":"goods_received",now);db.SourcingSupplyReceiptApplications.Add(new(){ReceiptId=receiptId,TaskId=task.Id,At=now});await db.SaveChangesAsync(ct);prepared.Remove(task.Id);return Mutation("receive",parent,task,ev,false);
    }

    public async Task<SourcingSupplyCustomerDetail> ReadAsync(string ownerId,string requestId,string taskId,CancellationToken ct)
    {
        var owner=SourcingRules.Actor(ownerId);var (parent,task,offer,requires)=await ReadGraph(owner,requestId,taskId,ct);return CheckSize(new SourcingSupplyCustomerDetail(1,parent.Id,Reference(parent),Version(parent.Version),Summary(task,offer,requires),Lines(task),task.PublicMessageFa,task.PublicMessageEn));
    }
    public async Task<SourcingSupplyAdminDetail> ReadAdminAsync(string requestId,string taskId,CancellationToken ct)
    {
        var (parent,task,offer,requires)=await ReadGraph(null,requestId,taskId,ct);return CheckSize(new SourcingSupplyAdminDetail(1,parent.Id,Reference(parent),Version(parent.Version),Summary(task,offer,requires),Lines(task),task.PublicMessageFa,task.PublicMessageEn,task.SourceKind,task.SourceKey,task.SourceNameFa,task.SourceNameEn,task.Reference,task.ActionAt,notes.Unprotect(task.OwnerId,task.Id,task.ProtectedNote),task.IsOpen&&!requires,true,task.IsOpen,task.IsOpen));
    }
    public async Task<SourcingSupplyInventoryDetail> InventoryReadAsync(string taskId,CancellationToken ct)
    {
        taskId=SourcingRules.Id(taskId);var requestId=await Tasks(null).AsNoTracking().Where(t=>t.Id==taskId).Select(t=>t.RequestId).SingleOrDefaultAsync(ct)??throw Missing();var (parent,task,offer,requires)=await ReadGraph(null,requestId,taskId,ct);
        return CheckSize(new SourcingSupplyInventoryDetail(1,parent.Id,Reference(parent),Version(parent.Version),Summary(task,offer,requires),task.Lines.OrderBy(l=>l.OfferLineId,StringComparer.Ordinal).Select(l=>new SourcingSupplyInventoryLine(l.OfferLineId,l.VariantId,l.ProductId,l.Sku,l.NameFa,l.NameEn,l.LabelFa,l.LabelEn,l.RequiredQuantity,l.ReceivedQuantity,l.RequiredQuantity-l.ReceivedQuantity)).ToArray(),task.Lines.Any(l=>l.ReceivedQuantity<l.RequiredQuantity),requires));
    }
    private async Task<(SourcingRequest Parent,SourcingSupplyTask Task,SourcingOffer Offer,bool Requires)> ReadGraph(string? owner,string requestId,string taskId,CancellationToken ct)
    {
        requestId=SourcingRules.Id(requestId);taskId=SourcingRules.Id(taskId);
        for(var attempt=0;attempt<2;attempt++){
            var parent=await Parents(owner).AsNoTracking().SingleOrDefaultAsync(r=>r.Id==requestId,ct)??throw Missing();var task=await Graph(Tasks(owner).AsNoTracking()).SingleOrDefaultAsync(t=>t.Id==taskId&&t.RequestId==requestId,ct)??throw Missing();Bound(task);var offer=await db.SourcingOffers.AsNoTracking().SingleOrDefaultAsync(o=>o.Id==task.OfferId&&o.RequestId==requestId,ct)??throw Missing();var requires=await RequiresNewOffer(parent,task,offer,clock.GetUtcNow(),ct);
            var pv=await Parents(owner).AsNoTracking().Where(r=>r.Id==requestId).Select(r=>r.Version).SingleOrDefaultAsync(ct);var tv=await Tasks(owner).AsNoTracking().Where(t=>t.Id==taskId&&t.RequestId==requestId).Select(t=>t.Version).SingleOrDefaultAsync(ct);var ov=await db.SourcingOffers.AsNoTracking().Where(o=>o.Id==offer.Id).Select(o=>o.Version).SingleOrDefaultAsync(ct);
            if(pv is null||tv is null||ov is null)throw Missing();if(!pv.SequenceEqual(parent.Version)||!tv.SequenceEqual(task.Version)||!ov.SequenceEqual(offer.Version)){if(attempt==0)continue;throw Changed();}return(parent,task,offer,requires);
        }
        throw new InvalidOperationException("Supply detail retry budget exhausted.");
    }
    public async Task<SourcingSupplyPage> PageAsync(string? ownerId,string requestId,string? cursor,CancellationToken ct)
    {
        var owner=ownerId is null?null:SourcingRules.Actor(ownerId);requestId=SourcingRules.Id(requestId);var parent=await Parents(owner).AsNoTracking().SingleOrDefaultAsync(r=>r.Id==requestId,ct)??throw Missing();var size=owner is null?50:20;var binding=SourcingRules.Hash("supply:"+(owner??"admin")+":"+requestId);var after=DecodePage(cursor,binding);var query=Tasks(owner).AsNoTracking().Where(t=>t.RequestId==requestId);query=After(query,after);var found=await Graph(query.OrderByDescending(t=>t.CreatedAt).ThenByDescending(t=>t.Id).Take(size+1)).ToArrayAsync(ct);var page=found.Take(size).ToArray();var items=new List<SourcingSupplySummary>();
        foreach(var task in page){Bound(task);var offer=await db.SourcingOffers.AsNoTracking().SingleOrDefaultAsync(o=>o.Id==task.OfferId&&o.RequestId==requestId,ct)??throw Missing();items.Add(Summary(task,offer,await RequiresNewOffer(parent,task,offer,clock.GetUtcNow(),ct)));}
        var candidate=owner is null?await StartCandidate(parent,ct):null;var version=await Parents(owner).AsNoTracking().Where(r=>r.Id==requestId).Select(r=>r.Version).SingleOrDefaultAsync(ct);if(version is null)throw Missing();if(!version.SequenceEqual(parent.Version))throw Changed();return CheckSize(new SourcingSupplyPage(1,requestId,Reference(parent),Version(parent.Version),size,items.ToArray(),found.Length>size?Encode(new PageCursor(page[^1].CreatedAt.UtcTicks,page[^1].Id,binding)):null,candidate));
    }
    public async Task<SourcingSupplyInventoryPage> InventoryPageAsync(string? state,string? query,string? cursor,CancellationToken ct)
    {
        state??="all";if(state!="all"&&!SourcingSupplyRules.States.Contains(state,StringComparer.Ordinal))throw SourcingSupplyRules.Invalid();var filter=PurchaseAdminFilter.Create(query);var binding=filter.Binding("inventory-supply:"+state);var after=DecodePage(cursor,binding);var tasks=Tasks(null).AsNoTracking();if(state!="all")tasks=tasks.Where(t=>t.State==state);foreach(var term in filter.Search.Split(' ',StringSplitOptions.RemoveEmptyEntries))tasks=tasks.Where(t=>t.Id.Contains(term)||t.RequestId.Contains(term)||t.Lines.Any(l=>l.Sku.Contains(term)||l.NameFa.Contains(term)||l.NameEn.Contains(term)));tasks=After(tasks,after);const int size=50;var found=await Graph(tasks.OrderByDescending(t=>t.CreatedAt).ThenByDescending(t=>t.Id).Take(size+1)).ToArrayAsync(ct);var page=found.Take(size).ToArray();var items=new List<SourcingSupplyInventoryItem>();
        foreach(var task in page){Bound(task);var parent=await Parents(null).AsNoTracking().SingleOrDefaultAsync(r=>r.Id==task.RequestId,ct)??throw Missing();var offer=await db.SourcingOffers.AsNoTracking().SingleOrDefaultAsync(o=>o.Id==task.OfferId&&o.RequestId==task.RequestId,ct)??throw Missing();var requires=await RequiresNewOffer(parent,task,offer,clock.GetUtcNow(),ct);var tv=await Tasks(null).AsNoTracking().Where(t=>t.Id==task.Id).Select(t=>t.Version).SingleOrDefaultAsync(ct);var pv=await Parents(null).AsNoTracking().Where(r=>r.Id==parent.Id).Select(r=>r.Version).SingleOrDefaultAsync(ct);var ov=await db.SourcingOffers.AsNoTracking().Where(o=>o.Id==offer.Id).Select(o=>o.Version).SingleOrDefaultAsync(ct);if(tv is null||pv is null||ov is null)throw Missing();if(!tv.SequenceEqual(task.Version)||!pv.SequenceEqual(parent.Version)||!ov.SequenceEqual(offer.Version))throw Changed();items.Add(new(parent.Id,Reference(parent),Version(parent.Version),Summary(task,offer,requires)));}
        return CheckSize(new SourcingSupplyInventoryPage(1,size,items.ToArray(),found.Length>size?Encode(new PageCursor(page[^1].CreatedAt.UtcTicks,page[^1].Id,binding)):null));
    }
    public async Task<SourcingSupplyEventPage> EventsAsync(string ownerId,string requestId,string taskId,string? cursor,CancellationToken ct)
    {
        var owner=SourcingRules.Actor(ownerId);var (parent,task,_,_)=await ReadGraph(owner,requestId,taskId,ct);var rows=await EventRows(owner,task,cursor,20,ct);var binding=EventBinding(owner,task);var values=rows.Select(PublicEvent).ToArray();var result=SourcingSupplyWireBudget.Page(values,20,(items,next)=>new SourcingSupplyEventPage(1,20,items,next),e=>Encode(new EventCursor(e.Id,binding)));await CheckReadVersions(owner,parent,task,ct);return result;
    }
    public async Task<SourcingSupplyAdminEventPage> AdminEventsAsync(string requestId,string taskId,string? cursor,CancellationToken ct)
    {
        var (parent,task,_,_)=await ReadGraph(null,requestId,taskId,ct);var rows=await EventRows(null,task,cursor,50,ct);var binding=EventBinding(null,task);var values=rows.Select(e=>new SourcingSupplyAdminEventData(PublicEvent(e),e.ActorId,e.SourceKind,e.SourceKey,e.SourceNameFa,e.SourceNameEn,e.Reference,notes.Unprotect(task.OwnerId,task.Id,e.ProtectedNote))).ToArray();var result=SourcingSupplyWireBudget.Page(values,50,(items,next)=>new SourcingSupplyAdminEventPage(1,50,items,next),e=>Encode(new EventCursor(e.Event.Id,binding)));await CheckReadVersions(null,parent,task,ct);return result;
    }
    private static string EventBinding(string? owner,SourcingSupplyTask task)=>SourcingRules.Hash("supply-events:"+(owner??"admin")+":"+task.RequestId+":"+task.Id);
    private async Task<SourcingSupplyEvent[]> EventRows(string? owner,SourcingSupplyTask task,string? cursor,int size,CancellationToken ct)
    {
        var binding=EventBinding(owner,task);var after=Decode<EventCursor>(cursor);long position=0;if(after is not null&&(after.Binding!=binding||after.After is not {Length:>0 and <=19}||!long.TryParse(after.After,NumberStyles.None,CultureInfo.InvariantCulture,out position)||position<=0||position.ToString(CultureInfo.InvariantCulture)!=after.After))throw InvalidCursor();return await db.SourcingSupplyEvents.AsNoTracking().Where(e=>e.TaskId==task.Id&&e.Id>position).OrderBy(e=>e.Id).Take(size+1).ToArrayAsync(ct);
    }
    private async Task CheckReadVersions(string? owner,SourcingRequest parent,SourcingSupplyTask task,CancellationToken ct)
    {
        var pv=await Parents(owner).AsNoTracking().Where(r=>r.Id==parent.Id).Select(r=>r.Version).SingleOrDefaultAsync(ct);var tv=await Tasks(owner).AsNoTracking().Where(t=>t.Id==task.Id&&t.RequestId==parent.Id).Select(t=>t.Version).SingleOrDefaultAsync(ct);if(pv is null||tv is null)throw Missing();if(!pv.SequenceEqual(parent.Version)||!tv.SequenceEqual(task.Version))throw Changed();
    }
    public async Task<SourcingSupplyMutation> ReadReceiptAsync(string actorId,string requestId,string taskId,string operation,string commandId,CancellationToken ct)
    {
        var actor=SourcingRules.Actor(actorId);requestId=SourcingRules.Id(requestId);taskId=SourcingRules.Id(taskId);var command=SourcingRules.CommandId(commandId);if(!SourcingSupplyRules.Operations.Contains(operation,StringComparer.Ordinal))throw SourcingSupplyRules.Invalid();var row=await db.SourcingSupplyCommandReceipts.AsNoTracking().SingleOrDefaultAsync(r=>r.ActorId==actor&&r.Operation==operation&&r.CommandId==command&&r.RequestId==requestId&&r.TaskId==taskId&&(allowDemo||!r.ContainsDemo),ct)??throw Missing();return Deserialize(row) with{Replayed=true};
    }

    private async Task<SourcingSupplyMutation?> Command(string actor,string operation,string command,string requestId,string taskId,string hash,CancellationToken ct)
    {
        SourcingSupplyLocks.RequireTransaction(db);await SourcingSupplyLocks.CommandAsync(db,actor,operation,command,ct);var replay=await Replay(actor,operation,command,requestId,taskId,hash,ct);if(replay is not null)return replay;await SourcingSupplyLocks.RequestAsync(db,requestId,ct);await SourcingSupplyLocks.TaskAsync(db,taskId,ct);return null;
    }
    private async Task<(SourcingRequest Parent,SourcingSupplyTask Task,SourcingOffer Offer)> Tracked(string requestId,string taskId,string parentVersion,string taskVersion,CancellationToken ct)
    {
        var parent=await Parents(null).SingleOrDefaultAsync(r=>r.Id==requestId,ct)??throw Missing();CheckParent(parent,parentVersion,false);var task=await Graph(Tasks(null)).SingleOrDefaultAsync(t=>t.Id==taskId&&t.RequestId==requestId,ct)??throw Missing();Bound(task);if(Version(task.Version)!=taskVersion)throw Changed();var offer=await db.SourcingOffers.SingleOrDefaultAsync(o=>o.Id==task.OfferId&&o.RequestId==requestId,ct)??throw Missing();return(parent,task,offer);
    }
    private async Task<bool> RequiresNewOffer(SourcingRequest parent,SourcingSupplyTask task,SourcingOffer offer,DateTimeOffset now,CancellationToken ct)
    {
        if(!ParentOpen(parent)||!task.IsOpen||offer.State!="Accepted"||!offer.IsActive||offer.AcceptanceId!=task.AcceptanceId||offer.TermsHash!=task.TermsHash||offer.PurchaseUntil<=now)return true;
        var current=await SourcingSupplyCatalogState.ReadAsync(catalog,task.Lines.Select(l=>l.VariantId).Distinct(StringComparer.OrdinalIgnoreCase).ToArray(),ct);return current is null||task.Lines.Any(l=>!current.TryGetValue(l.VariantId,out var sku)||sku.ProductId!=l.ProductId||sku.MaterialFingerprint!=l.MaterialFingerprint);
    }
    private async Task<SourcingSupplyStartCandidate?> StartCandidate(SourcingRequest parent,CancellationToken ct)
    {
        var now=clock.GetUtcNow();if(!ParentOpen(parent)||await db.SourcingSupplyTasks.AsNoTracking().AnyAsync(t=>t.RequestId==parent.Id&&t.IsOpen,ct))return null;
        var offer=await db.SourcingOffers.AsNoTracking().Include(o=>o.Lines.OrderBy(l=>l.LineId).Take(65)).SingleOrDefaultAsync(o=>o.RequestId==parent.Id&&o.State=="Accepted"&&o.IsActive&&o.PurchaseUntil>now&&(allowDemo||!o.ContainsDemo),ct);if(offer is null)return null;if(offer.Lines.Count is <1 or >64)throw Capacity();
        var acceptance=await db.SourcingOfferAcceptances.AsNoTracking().SingleOrDefaultAsync(a=>a.OfferId==offer.Id,ct);if(acceptance is null||offer.AcceptanceId!=acceptance.Id||acceptance.OwnerId!=parent.OwnerId||acceptance.TermsHash!=offer.TermsHash||await db.SourcingSupplyTasks.AsNoTracking().AnyAsync(t=>t.AcceptanceId==acceptance.Id,ct))return null;
        var current=await SourcingSupplyCatalogState.ReadAsync(catalog,offer.Lines.Select(l=>l.VariantId).Distinct(StringComparer.OrdinalIgnoreCase).ToArray(),ct);if(current is null||offer.Lines.Any(l=>!current.TryGetValue(l.VariantId,out var sku)||sku.ProductId!=l.ProductId||sku.MaterialFingerprint!=l.MaterialFingerprint))return null;
        return new(offer.Id,acceptance.Id,Version(offer.Version),offer.TermsHash,offer.PurchaseUntil);
    }
    private void Touch(SourcingSupplyTask task,SourcingRequest parent,DateTimeOffset now){task.ChangedAt=now;db.Entry(task).Property(t=>t.ChangedAt).IsModified=true;TouchParent(parent,now);}
    private void TouchParent(SourcingRequest parent,DateTimeOffset now){parent.ChangedAt=now;db.Entry(parent).Property(r=>r.ChangedAt).IsModified=true;}
    private static void CheckParent(SourcingRequest parent,string expected,bool requireOpen){if(Version(parent.Version)!=expected)throw Changed();if(requireOpen&&!ParentOpen(parent))throw Conflict();}
    private static SourcingSupplyLineData[] Lines(SourcingSupplyTask task)=>task.Lines.OrderBy(l=>l.OfferLineId,StringComparer.Ordinal).Select(l=>new SourcingSupplyLineData(l.OfferLineId,l.VariantId,l.Sku,l.NameFa,l.NameEn,l.LabelFa,l.LabelEn,l.RequiredQuantity,l.ReceivedQuantity,l.RequiredQuantity-l.ReceivedQuantity)).ToArray();
    private static SourcingSupplySummary Summary(SourcingSupplyTask task,SourcingOffer offer,bool requires){var progress=Progress(task);var required=task.Lines.Sum(l=>l.RequiredQuantity);var received=task.Lines.Sum(l=>l.ReceivedQuantity);return new(task.Id,task.OfferId,task.AcceptanceId,task.State,progress,SourcingSupplyRules.EffectiveState(task.State,progress),Version(task.Version),task.Lines.Count,required,received,required-received,task.CreatedAt,task.ChangedAt,task.ExpectedAt,offer.PurchaseUntil,task.IsOpen,requires,task.ContainsDemo);}
    private SourcingSupplyEvent Event(SourcingSupplyTask task,string actor,string? before,string reason,DateTimeOffset now)
    {
        var row=new SourcingSupplyEvent{TaskId=task.Id,ActorId=actor,StateBefore=before,StateAfter=task.State,ReceiptProgress=Progress(task),ReasonCode=reason,PublicMessageFa=task.PublicMessageFa,PublicMessageEn=task.PublicMessageEn,SourceKind=task.SourceKind,SourceKey=task.SourceKey,SourceNameFa=task.SourceNameFa,SourceNameEn=task.SourceNameEn,Reference=task.Reference,ProtectedNote=task.ProtectedNote,ActionAt=task.ActionAt,ExpectedAt=task.ExpectedAt,At=now};db.SourcingSupplyEvents.Add(row);return row;
    }
    private static SourcingSupplyEventData PublicEvent(SourcingSupplyEvent e)=>new(e.Id.ToString(CultureInfo.InvariantCulture),e.StateBefore,e.StateAfter,e.ReceiptProgress,e.ActorKind,e.ReasonCode,e.PublicMessageFa,e.PublicMessageEn,e.ActionAt,e.ExpectedAt,e.At);
    private static SourcingSupplyMutation Mutation(string operation,SourcingRequest parent,SourcingSupplyTask task,SourcingSupplyEvent ev,bool replayed)=>new(1,parent.Id,task.Id,task.OfferId,task.AcceptanceId,operation,task.State,Progress(task),Version(task.Version),Version(parent.Version),ev.Id.ToString(CultureInfo.InvariantCulture),ev.At,replayed);
    private async Task<SourcingSupplyMutation> Remember(string actor,string operation,string command,string hash,SourcingRequest parent,SourcingSupplyTask task,SourcingSupplyEvent ev,CancellationToken ct)
    {
        var result=Mutation(operation,parent,task,ev,false);var json=JsonSerializer.Serialize(result,Json);if(Encoding.Unicode.GetByteCount(json)>16384)throw Capacity();db.SourcingSupplyCommandReceipts.Add(new(){ActorId=actor,Operation=operation,CommandId=command,RequestId=parent.Id,TaskId=task.Id,PayloadHash=hash,ResultJson=json,ContainsDemo=task.ContainsDemo,CreatedAt=clock.GetUtcNow()});await db.SaveChangesAsync(ct);return result;
    }
    private async Task<SourcingSupplyMutation?> Replay(string actor,string operation,string command,string requestId,string taskId,string hash,CancellationToken ct)
    {
        var row=await db.SourcingSupplyCommandReceipts.AsNoTracking().SingleOrDefaultAsync(r=>r.ActorId==actor&&r.Operation==operation&&r.CommandId==command,ct);if(row is null)return null;if(row.ContainsDemo&&!allowDemo)throw Missing();if(row.RequestId!=requestId||row.TaskId!=taskId||row.PayloadHash!=hash)throw new BusinessException("idempotency_conflict","This supply command id belongs to another target or payload.");return Deserialize(row) with{Replayed=true};
    }
    private static SourcingSupplyMutation Deserialize(SourcingSupplyCommandReceipt row)=>JsonSerializer.Deserialize<SourcingSupplyMutation>(row.ResultJson,Json)??throw new InvalidOperationException("Invalid stored supply command result.");
    private static IQueryable<SourcingSupplyTask> After(IQueryable<SourcingSupplyTask> query,PageCursor? after){if(after is null)return query;var at=new DateTimeOffset(after.At,TimeSpan.Zero);return query.Where(t=>t.CreatedAt<at||t.CreatedAt==at&&string.Compare(t.Id,after.Id)<0);}
    private static PageCursor? DecodePage(string? cursor,string binding){var after=Decode<PageCursor>(cursor);if(after is not null&&(after.Binding!=binding||after.At<DateTimeOffset.MinValue.UtcTicks||after.At>DateTimeOffset.MaxValue.UtcTicks||SourcingRules.Id(after.Id)!=after.Id))throw InvalidCursor();return after;}
    private static string Encode<T>(T value)=>Convert.ToBase64String(JsonSerializer.SerializeToUtf8Bytes(value,Json)).TrimEnd('=').Replace('+','-').Replace('/','_');
    private static T? Decode<T>(string? cursor)where T:class{if(cursor is null)return null;try{if(cursor.Length is <1 or >200||cursor.Any(c=>!char.IsAsciiLetterOrDigit(c)&&c is not ('-' or '_')))throw InvalidCursor();var raw=cursor.Replace('-','+').Replace('_','/');return JsonSerializer.Deserialize<T>(Convert.FromBase64String(raw.PadRight((raw.Length+3)/4*4,'=')),Json)??throw InvalidCursor();}catch(Exception e)when(e is FormatException or JsonException or ArgumentException){throw InvalidCursor();}}
    private static T CheckSize<T>(T value){if(JsonSerializer.SerializeToUtf8Bytes(value,Json).Length>524288)throw Capacity();return value;}
    private static BusinessException Missing()=>new("not_found","The supply task was not found.");
    private static BusinessException Conflict()=>new("sourcing_supply_state_conflict","The supply task or request does not allow this operation.");
    private static BusinessException Changed()=>new("version_conflict","The request or supply task changed. Read its current detail.");
    private static BusinessException Reoffer()=>new("sourcing_supply_reoffer_conflict","The accepted consent no longer permits new procurement. Prepare a new offer.");
    private static BusinessException InvalidCursor()=>new("invalid_sourcing_supply_cursor","Use a cursor bound to this owner, target and filter.");
    private static BusinessException Capacity()=>new("sourcing_supply_capacity_unavailable","The supply graph exceeds its supported bounds.");
}
