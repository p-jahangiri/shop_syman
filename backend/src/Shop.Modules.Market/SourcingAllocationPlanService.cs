using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Market;

// This is an internal composition contract, never a browser-supplied price.
// The root already owns the shared Serializable transaction and enters Market
// before Inventory. Completing a prepared plan takes no further Market locks.
public sealed class SourcingAllocationPlanService(MarketDbContext db,ICatalogOfferReader catalog,IPurchaseConfiguration purchasing,TimeProvider clock,bool allowDemo)
{
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web);
    private sealed record Held(string Actor,string Operation,Guid Transaction);
    private sealed record Prepared(string Actor,string Command,Guid Transaction,DateTimeOffset ExpiresAt,SourcingRequest Parent,SourcingSupplyTask Task,SourcingOffer Offer,AcceptedSourcingPurchasePlan Plan);
    private readonly Dictionary<(string Request,string Task,string Command),Held> held=new();
    private readonly Dictionary<string,Prepared> prepared=new(StringComparer.Ordinal);
    private static string Version(byte[] value)=>Convert.ToBase64String(value);

    public async Task AcquireLocksAsync(string actorId,string requestId,string taskId,string commandId,CancellationToken ct,string operation="allocate")
    {
        var actor=SourcingRules.Actor(actorId);requestId=SourcingRules.Id(requestId);taskId=SourcingRules.Id(taskId);var command=SourcingRules.CommandId(commandId);
        if(operation is not ("allocate" or "release"))throw Invalid();
        SourcingSupplyLocks.RequireTransaction(db);
        await SourcingSupplyLocks.CommandAsync(db,actor,operation,command,ct);
        await SourcingSupplyLocks.RequestAsync(db,requestId,ct);
        await SourcingSupplyLocks.TaskAsync(db,taskId,ct);
        var key=(requestId,taskId,command);
        var transaction=db.Database.CurrentTransaction!.TransactionId;
        if(held.TryGetValue(key,out var prior)&&prior.Transaction==transaction&&prior!=new Held(actor,operation,transaction))throw new InvalidOperationException("A scoped allocation command cannot change actor or operation.");
        held[key]=new(actor,operation,transaction);
    }

    public async Task<AcceptedSourcingPurchasePlan> PrepareAsync(string requestId,string taskId,SourcingAllocationInput input,CancellationToken ct)
    {
        requestId=SourcingRules.Id(requestId);taskId=SourcingRules.Id(taskId);var command=SourcingRules.CommandId(input.RequestId);
        SourcingSupplyLocks.RequireTransaction(db);
        if(!held.TryGetValue((requestId,taskId,command),out var gate)||gate.Operation!="allocate"||gate.Transaction!=db.Database.CurrentTransaction!.TransactionId)throw new InvalidOperationException("Acquire allocation Market locks before entering Inventory replay.");
        var requestVersion=SourcingRules.Version(input.RequestVersion);var taskVersion=SourcingRules.Version(input.TaskVersion);var offerVersion=SourcingRules.Version(input.OfferVersion);var acceptanceId=SourcingRules.Id(input.AcceptanceId);var termsHash=SourcingRules.Fingerprint(input.TermsHash);
        if(input.ExpiresAt.Offset!=TimeSpan.Zero||input.Lines is not {Length:>0 and <=64}||input.Lines.Any(l=>l is null))throw Invalid();
        SourcingRules.Text(input.Reason,500,true);
        var selected=input.Lines.Select(l=>SourcingRules.Id(l.OfferLineId)).ToArray();if(selected.Distinct(StringComparer.Ordinal).Count()!=selected.Length)throw Invalid();
        var parent=await db.SourcingRequests.SingleOrDefaultAsync(r=>r.Id==requestId&&(allowDemo||!r.ContainsDemo),ct)??throw Missing();
        var task=await db.SourcingSupplyTasks.Include(t=>t.Lines.OrderBy(l=>l.OfferLineId).Take(65)).SingleOrDefaultAsync(t=>t.Id==taskId&&t.RequestId==requestId&&(allowDemo||!t.ContainsDemo),ct)??throw Missing();
        if(Version(parent.Version)!=requestVersion||Version(task.Version)!=taskVersion)throw Changed();
        if(parent.State is not ("Submitted" or "Reviewing")||!task.IsOpen||!SourcingSupplyRules.Open(task.State)||task.OwnerId!=parent.OwnerId)throw Reoffer();
        var offer=await Graph(db.SourcingOffers).SingleOrDefaultAsync(o=>o.Id==task.OfferId&&o.RequestId==requestId&&(allowDemo||!o.ContainsDemo),ct)??throw Missing();
        if(Version(offer.Version)!=offerVersion)throw Changed();
        var now=clock.GetUtcNow();var acceptance=await db.SourcingOfferAcceptances.SingleOrDefaultAsync(a=>a.OfferId==offer.Id,ct);
        if(offer.State!="Accepted"||!offer.IsActive||offer.PublishedAt is null||offer.AcceptedAt is null||offer.PurchaseUntil<=now||offer.AcceptanceId!=acceptanceId||task.AcceptanceId!=acceptanceId||offer.TermsHash!=termsHash||task.TermsHash!=termsHash||acceptance is null||acceptance.Id!=acceptanceId||acceptance.OwnerId!=parent.OwnerId||acceptance.TermsHash!=termsHash||acceptance.At!=offer.AcceptedAt)throw Reoffer();
        SourcingRules.Version(acceptance.OfferVersion);
        if(input.ExpiresAt<=now||input.ExpiresAt>offer.PurchaseUntil)throw new BusinessException("sourcing_allocation_deadline_conflict","Choose an explicit future hold deadline within the accepted purchase deadline.");
        var lines=Snapshot(offer);
        if(task.Lines.Count!=lines.Length||task.Lines.Count is <1 or >64||selected.Length!=lines.Length||lines.Any(line=>!selected.Contains(line.OfferLineId,StringComparer.Ordinal)||!task.Lines.Any(l=>l.OfferLineId==line.OfferLineId&&l.VariantId==line.Sku.VariantId&&l.ProductId==line.Sku.ProductId&&l.RequiredQuantity==line.Quantity&&l.MaterialFingerprint==line.Sku.MaterialFingerprint)))throw new BusinessException("sourcing_allocation_line_conflict","Allocate every exact accepted line and quantity; replacement or partial allocation needs a new consent.");
        var current=await SourcingSupplyCatalogState.ReadAsync(catalog,lines.Select(l=>l.Sku.VariantId).Distinct(StringComparer.OrdinalIgnoreCase).ToArray(),ct);
        if(current is null||lines.Any(l=>!current.TryGetValue(l.Sku.VariantId,out var sku)||sku.ProductId!=l.Sku.ProductId||sku.MaterialFingerprint!=l.Sku.MaterialFingerprint))throw new BusinessException("sourcing_offer_catalog_conflict","Current published physical SKU material must still match the accepted terms before allocation.");
        foreach(var sku in current.Values)SourcingOfferSnapshots.Validate(sku);
        await CheckPurchasingAsync(offer.TotalRial,current.Values.ToArray(),ct);
        // Capacity/purchasing reads can consume time. Crossing the exact deadline
        // while validating never creates a fresh right to the expired consent.
        if(offer.PurchaseUntil<=clock.GetUtcNow()||input.ExpiresAt<=clock.GetUtcNow())throw new BusinessException("sourcing_allocation_deadline_conflict","The accepted purchase or requested hold deadline elapsed while validating allocation.");
        var plan=new AcceptedSourcingPurchasePlan(requestId,taskId,offer.Id,offer.Revision,acceptanceId,parent.OwnerId,termsHash,requestVersion,taskVersion,offerVersion,offer.PurchaseUntil,offer.TermsFa,offer.TermsEn,parent.ContainsDemo||task.ContainsDemo||offer.ContainsDemo,lines);
        if(JsonSerializer.SerializeToUtf8Bytes(plan,Json).Length>524288)throw Capacity();
        prepared[taskId]=new(gate.Actor,command,gate.Transaction,input.ExpiresAt,parent,task,offer,plan);return plan;
    }

    public async Task CompleteAsync(string actorId,AcceptedSourcingPurchasePlan plan,SourcingAllocationMutation result,CancellationToken ct)
    {
        var actor=SourcingRules.Actor(actorId);SourcingSupplyLocks.RequireTransaction(db);
        if(!prepared.TryGetValue(plan.TaskId,out var context)||context.Actor!=actor||context.Transaction!=db.Database.CurrentTransaction!.TransactionId||!ReferenceEquals(context.Plan,plan)||result.Replayed||result.SchemaVersion!=1||result.Operation!="allocate"||result.State!="Active"||result.CommandId!=context.Command||result.RequestId!=plan.RequestId||result.TaskId!=plan.TaskId||result.OfferId!=plan.OfferId||result.AcceptanceId!=plan.AcceptanceId||result.ExpiresAt!=context.ExpiresAt)throw new InvalidOperationException("Complete only the fresh Inventory allocation result for this scoped prepared purchase plan.");
        SourcingRules.Id(result.AllocationId);SourcingRules.Version(result.Version);
        if(Version(context.Parent.Version)!=plan.RequestVersion||Version(context.Task.Version)!=plan.TaskVersion||Version(context.Offer.Version)!=plan.OfferVersion)throw Changed();
        var now=clock.GetUtcNow();var task=context.Task;var parent=context.Parent;
        task.PublicMessageFa="سهم این درخواست تا "+result.ExpiresAt.ToString("yyyy-MM-dd HH:mm 'UTC'",CultureInfo.InvariantCulture)+" نگه‌داری شده است؛ خرید یا پرداختی ثبت نشده است.";
        task.PublicMessageEn="This request's stock share is held until "+result.ExpiresAt.ToString("yyyy-MM-dd HH:mm 'UTC'",CultureInfo.InvariantCulture)+". No purchase or payment has been recorded.";
        task.ChangedAt=now;parent.ChangedAt=now;db.Entry(task).Property(t=>t.ChangedAt).IsModified=true;db.Entry(parent).Property(r=>r.ChangedAt).IsModified=true;
        db.SourcingSupplyEvents.Add(new(){TaskId=task.Id,ActorId=actor,ActorKind="staff",StateBefore=task.State,StateAfter=task.State,ReceiptProgress=SourcingSupplyRules.ReceiptProgress(task.Lines.Select(l=>(l.RequiredQuantity,l.ReceivedQuantity))),ReasonCode="stock_allocated",PublicMessageFa=task.PublicMessageFa,PublicMessageEn=task.PublicMessageEn,SourceKind=task.SourceKind,SourceKey=task.SourceKey,SourceNameFa=task.SourceNameFa,SourceNameEn=task.SourceNameEn,Reference=task.Reference,ProtectedNote=task.ProtectedNote,ActionAt=task.ActionAt,ExpectedAt=task.ExpectedAt,At=now});
        await db.SaveChangesAsync(ct);prepared.Remove(plan.TaskId);
    }

    private static IQueryable<SourcingOffer> Graph(IQueryable<SourcingOffer> query)=>SourcingAcceptedPurchaseValidation.Graph(query);
    private static AcceptedSourcingPlanLine[] Snapshot(SourcingOffer offer)=>SourcingAcceptedPurchaseValidation.Snapshot(offer);
    private Task CheckPurchasingAsync(long total,OfferSkuSnapshot[] variants,CancellationToken ct)=>SourcingAcceptedPurchaseValidation.CheckPurchasingAsync(purchasing,total,variants,ct);
    private static BusinessException Invalid()=>new("invalid_sourcing_allocation","Use a bounded explicit allocation of every accepted line and a UTC hold deadline.");
    private static BusinessException Missing()=>new("not_found","The supply request or its exact accepted terms were not found.");
    private static BusinessException Changed()=>new("version_conflict","The request, task or accepted offer changed. Refresh before allocating stock.");
    private static BusinessException Reoffer()=>new("sourcing_supply_reoffer_conflict","A current open task and active unexpired consent are required before stock allocation.");
    private static BusinessException Capacity()=>new("sourcing_offer_capacity_unavailable","The accepted snapshot or purchase configuration exceeds supported bounds.");
}
