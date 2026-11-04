using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;

namespace Shop.Modules.Market;

// The composition root enters Market before Sales/cart and Inventory. This
// service neither owns a cart nor treats conversion as an order or payment.
public sealed class SourcingConversionPlanService(MarketDbContext db,ICatalogOfferReader catalog,IPurchaseConfiguration purchasing,TimeProvider clock,bool allowDemo)
{
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web);
    private sealed record Held(string Owner,string Task,Guid Transaction);
    private sealed record Prepared(string Owner,string Command,Guid Transaction,SourcingConversionInput Input,SourcingRequest Parent,SourcingSupplyTask Task,SourcingOffer Offer,AcceptedSourcingPurchasePlan Plan);
    private readonly HashSet<(string Owner,Guid Transaction)> owners=[];
    private readonly Dictionary<(string Owner,string Request,string Offer),Held> candidates=new();
    private readonly Dictionary<(string Owner,string Request,string Offer,string Task,string Command),Guid> held=new();
    private readonly Dictionary<string,Prepared> prepared=new(StringComparer.Ordinal);
    private static string Version(byte[] value)=>Convert.ToBase64String(value);
    private static string OwnerKey(string value)=>SourcingRules.Actor(value).ToUpperInvariant();
    private Guid Transaction(){SourcingSupplyLocks.RequireTransaction(db);return db.Database.CurrentTransaction!.TransactionId;}

    public async Task AcquireOwnerAsync(string ownerId,CancellationToken ct)
    {
        var owner=OwnerKey(ownerId);var transaction=Transaction();
        // Exact same key as SourcingRequestService: submit/cancel/conversion
        // serialize the owner's Market entry before any cart lock or read.
        await using var command=db.Database.GetDbConnection().CreateCommand();command.Transaction=db.Database.CurrentTransaction!.GetDbTransaction();command.CommandTimeout=15;command.CommandText="DECLARE @result int; EXEC @result=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @result;";var parameter=command.CreateParameter();parameter.ParameterName="@resource";parameter.Value="sayman:market:sourcing:"+SourcingRules.Hash("owner:"+owner);command.Parameters.Add(parameter);
        if(Convert.ToInt32(await command.ExecuteScalarAsync(ct),CultureInfo.InvariantCulture)<0)throw new BusinessException("sourcing_busy_conflict","Another sourcing command is in progress. Retry the same command id.");owners.Add((owner,transaction));
    }
    public async Task AcquireCandidateLocksAsync(string ownerId,string requestId,string offerId,CancellationToken ct)
    {
        var owner=OwnerKey(ownerId);requestId=SourcingRules.Id(requestId);offerId=SourcingRules.Id(offerId);await AcquireOwnerAsync(owner,ct);var transaction=Transaction();await SourcingSupplyLocks.RequestAsync(db,requestId,ct);
        var tasks=await db.SourcingSupplyTasks.AsNoTracking().Where(t=>t.RequestId==requestId&&t.OfferId==offerId&&t.OwnerId==owner&&(allowDemo||!t.ContainsDemo)).OrderBy(t=>t.Id).Select(t=>t.Id).Take(2).ToArrayAsync(ct);
        if(tasks.Length==0)throw Missing();if(tasks.Length!=1)throw Capacity();await SourcingSupplyLocks.TaskAsync(db,tasks[0],ct);candidates[(owner,requestId,offerId)]=new(owner,tasks[0],transaction);
    }
    public async Task AcquireRequestTaskAsync(string ownerId,string requestId,string offerId,string taskId,string commandId,CancellationToken ct)
    {
        var owner=OwnerKey(ownerId);requestId=SourcingRules.Id(requestId);offerId=SourcingRules.Id(offerId);taskId=SourcingRules.Id(taskId);var command=SourcingRules.CommandId(commandId);var transaction=Transaction();
        if(!owners.Contains((owner,transaction)))throw new InvalidOperationException("Acquire the Market owner lock before Sales conversion command/replay and request/task locks.");
        await SourcingSupplyLocks.RequestAsync(db,requestId,ct);await SourcingSupplyLocks.TaskAsync(db,taskId,ct);held[(owner,requestId,offerId,taskId,command)]=transaction;
    }
    public async Task<AcceptedSourcingPurchasePlan> CandidateAsync(string ownerId,string requestId,string offerId,CancellationToken ct)
    {
        var owner=OwnerKey(ownerId);requestId=SourcingRules.Id(requestId);offerId=SourcingRules.Id(offerId);var transaction=Transaction();
        if(!candidates.TryGetValue((owner,requestId,offerId),out var gate)||gate.Transaction!=transaction)throw new InvalidOperationException("Acquire candidate owner/request/task locks before reading a purchase plan or cart.");
        var (_,_,_,plan)=await ReadPlan(owner,requestId,offerId,gate.Task,null,ct);return plan;
    }
    public async Task<AcceptedSourcingPurchasePlan> PrepareAsync(string ownerId,string requestId,string offerId,SourcingConversionInput supplied,CancellationToken ct)
    {
        var owner=OwnerKey(ownerId);requestId=SourcingRules.Id(requestId);offerId=SourcingRules.Id(offerId);var input=SourcingConversionPlanRules.Normalize(supplied);var transaction=Transaction();
        if(!held.TryGetValue((owner,requestId,offerId,input.TaskId,input.RequestId),out var acquired)||acquired!=transaction)throw new InvalidOperationException("Acquire owner, Sales conversion command/replay and Market request/task locks before preparing conversion.");
        var (parent,task,offer,plan)=await ReadPlan(owner,requestId,offerId,input.TaskId,input,ct);prepared[input.RequestId]=new(owner,input.RequestId,transaction,input,parent,task,offer,plan);return plan;
    }
    private async Task<(SourcingRequest Parent,SourcingSupplyTask Task,SourcingOffer Offer,AcceptedSourcingPurchasePlan Plan)> ReadPlan(string owner,string requestId,string offerId,string taskId,SourcingConversionInput? input,CancellationToken ct)
    {
        var parent=await db.SourcingRequests.AsNoTracking().SingleOrDefaultAsync(r=>r.Id==requestId&&r.OwnerId==owner&&(allowDemo||!r.ContainsDemo),ct)??throw Missing();
        var task=await db.SourcingSupplyTasks.AsNoTracking().Include(t=>t.Lines.OrderBy(l=>l.OfferLineId).Take(65)).SingleOrDefaultAsync(t=>t.Id==taskId&&t.RequestId==requestId&&t.OfferId==offerId&&t.OwnerId==owner&&(allowDemo||!t.ContainsDemo),ct)??throw Missing();
        var offer=await SourcingAcceptedPurchaseValidation.Graph(db.SourcingOffers.AsNoTracking()).SingleOrDefaultAsync(o=>o.Id==offerId&&o.RequestId==requestId&&(allowDemo||!o.ContainsDemo),ct)??throw Missing();
        var parentVersion=Version(parent.Version);var taskVersion=Version(task.Version);var offerVersion=Version(offer.Version);
        if(input is not null&&(parentVersion!=input.RequestVersion||taskVersion!=input.TaskVersion||offerVersion!=input.OfferVersion))throw Changed();
        if(parent.State is not ("Submitted" or "Reviewing")||!task.IsOpen||!SourcingSupplyRules.Open(task.State)||!task.OwnerId.Equals(parent.OwnerId,StringComparison.OrdinalIgnoreCase))throw Reoffer();
        var acceptance=await db.SourcingOfferAcceptances.AsNoTracking().SingleOrDefaultAsync(a=>a.OfferId==offer.Id,ct);var now=clock.GetUtcNow();
        if(offer.State!="Accepted"||!offer.IsActive||offer.PublishedAt is null||offer.AcceptedAt is null||offer.PurchaseUntil<=now||offer.AcceptanceId!=task.AcceptanceId||offer.TermsHash!=task.TermsHash||acceptance is null||acceptance.Id!=task.AcceptanceId||!acceptance.OwnerId.Equals(parent.OwnerId,StringComparison.OrdinalIgnoreCase)||acceptance.TermsHash!=task.TermsHash||acceptance.At!=offer.AcceptedAt||input is not null&&(input.AcceptanceId!=task.AcceptanceId||input.TermsHash!=task.TermsHash))throw Reoffer();
        SourcingRules.Version(acceptance.OfferVersion);
        var lines=SourcingAcceptedPurchaseValidation.Snapshot(offer);
        if(task.Lines.Count!=lines.Length||task.Lines.Count is <1 or >64||task.Lines.Select(l=>l.OfferLineId).Distinct(StringComparer.Ordinal).Count()!=task.Lines.Count||lines.Any(l=>!task.Lines.Any(t=>t.OfferLineId==l.OfferLineId&&t.VariantId==l.Sku.VariantId&&t.ProductId==l.Sku.ProductId&&t.RequiredQuantity==l.Quantity&&t.MaterialFingerprint==l.Sku.MaterialFingerprint)))throw new BusinessException("sourcing_conversion_line_conflict","Conversion requires every exact accepted line and quantity; replacement needs new consent.");
        var current=await SourcingSupplyCatalogState.ReadAsync(catalog,lines.Select(l=>l.Sku.VariantId).Distinct(StringComparer.OrdinalIgnoreCase).ToArray(),ct);
        if(current is null||lines.Any(l=>!current.TryGetValue(l.Sku.VariantId,out var sku)||sku.ProductId!=l.Sku.ProductId||sku.MaterialFingerprint!=l.Sku.MaterialFingerprint))throw new BusinessException("sourcing_offer_catalog_conflict","Current published physical SKU material must still match the accepted terms before conversion.");
        foreach(var sku in current.Values)SourcingOfferSnapshots.Validate(sku);await SourcingAcceptedPurchaseValidation.CheckPurchasingAsync(purchasing,offer.TotalRial,current.Values.ToArray(),ct);
        // All reads are bounded and hold the request/task locks before any cart
        // read. The final version fence also catches unsupported direct drift.
        var parentNow=await db.SourcingRequests.AsNoTracking().Where(r=>r.Id==requestId&&r.OwnerId==owner&&(allowDemo||!r.ContainsDemo)).Select(r=>r.Version).SingleOrDefaultAsync(ct);
        var taskNow=await db.SourcingSupplyTasks.AsNoTracking().Where(t=>t.Id==taskId&&t.OwnerId==owner&&(allowDemo||!t.ContainsDemo)).Select(t=>t.Version).SingleOrDefaultAsync(ct);
        var offerNow=await db.SourcingOffers.AsNoTracking().Where(o=>o.Id==offerId&&(allowDemo||!o.ContainsDemo)).Select(o=>o.Version).SingleOrDefaultAsync(ct);
        if(parentNow is null||taskNow is null||offerNow is null||!parentNow.SequenceEqual(parent.Version)||!taskNow.SequenceEqual(task.Version)||!offerNow.SequenceEqual(offer.Version))throw Changed();
        if(offer.PurchaseUntil<=clock.GetUtcNow())throw Expired();
        var plan=new AcceptedSourcingPurchasePlan(parent.Id,task.Id,offer.Id,offer.Revision,acceptance.Id,parent.OwnerId,offer.TermsHash!,parentVersion,taskVersion,offerVersion,offer.PurchaseUntil,offer.TermsFa,offer.TermsEn,parent.ContainsDemo||task.ContainsDemo||offer.ContainsDemo,lines);
        if(JsonSerializer.SerializeToUtf8Bytes(plan,Json).Length>524288)throw Capacity();return(parent,task,offer,plan);
    }
    public async Task CompleteAsync(string ownerId,AcceptedSourcingPurchasePlan plan,SourcingConversionMutation result,CancellationToken ct)
    {
        var owner=OwnerKey(ownerId);var transaction=Transaction();
        if(plan is null||result is null||!prepared.TryGetValue(result.CommandId,out var context)||context.Owner!=owner||context.Transaction!=transaction||!ReferenceEquals(context.Plan,plan)||result.Replayed||result.SchemaVersion!=1||result.CanPay||result.CanCheckout||result.RequestId!=plan.RequestId||result.TaskId!=plan.TaskId||result.OfferId!=plan.OfferId||result.AcceptanceId!=plan.AcceptanceId||result.AgreementId!=context.Input.AgreementId||result.AllocationId!=context.Input.AllocationId||result.CommandId!=context.Command)throw new InvalidOperationException("Complete only the fresh Sales conversion result for this scoped owned purchase plan.");
        SourcingConversionPlanRules.ValidateCompletion(plan,result);var now=clock.GetUtcNow();if(plan.PurchaseUntil<=now)throw Expired();
        var parent=db.SourcingRequests.Local.SingleOrDefault(r=>r.Id==plan.RequestId);if(parent is not null&&Version(parent.Version)!=plan.RequestVersion)throw Changed();
        if(parent is null){parent=new SourcingRequest{Id=plan.RequestId,Version=context.Parent.Version.ToArray()};db.Attach(parent);}
        var task=db.SourcingSupplyTasks.Local.SingleOrDefault(t=>t.Id==plan.TaskId);if(task is not null&&Version(task.Version)!=plan.TaskVersion)throw Changed();
        if(task is null){task=new SourcingSupplyTask{Id=plan.TaskId,Version=context.Task.Version.ToArray()};db.Attach(task);}
        const string fa="اقلام پیشنهاد پذیرفته‌شده به سبد اضافه شد؛ سفارش یا پرداختی ثبت نشده است.";
        const string en="The accepted offer items were added to the cart. No order or payment has been recorded.";
        parent.ChangedAt=now;task.ChangedAt=now;task.PublicMessageFa=fa;task.PublicMessageEn=en;db.Entry(parent).Property(r=>r.ChangedAt).IsModified=true;db.Entry(task).Property(t=>t.ChangedAt).IsModified=true;db.Entry(task).Property(t=>t.PublicMessageFa).IsModified=true;db.Entry(task).Property(t=>t.PublicMessageEn).IsModified=true;
        var source=context.Task;db.SourcingSupplyEvents.Add(new(){TaskId=source.Id,ActorId=context.Parent.OwnerId,ActorKind="customer",StateBefore=source.State,StateAfter=source.State,ReceiptProgress=SourcingSupplyRules.ReceiptProgress(source.Lines.Select(l=>(l.RequiredQuantity,l.ReceivedQuantity))),ReasonCode="cart_converted",PublicMessageFa=fa,PublicMessageEn=en,SourceKind=source.SourceKind,SourceKey=source.SourceKey,SourceNameFa=source.SourceNameFa,SourceNameEn=source.SourceNameEn,Reference=source.Reference,ProtectedNote=source.ProtectedNote,ActionAt=source.ActionAt,ExpectedAt=source.ExpectedAt,At=now});
        await db.SaveChangesAsync(ct);prepared.Remove(context.Command);
    }
    private static BusinessException Missing()=>new("not_found","The owned supply task or its exact accepted offer was not found.");
    private static BusinessException Changed()=>new("version_conflict","The request, task or accepted offer changed. Refresh before conversion.");
    private static BusinessException Reoffer()=>new("sourcing_supply_reoffer_conflict","Conversion requires current open supply follow-up and active unexpired consent.");
    private static BusinessException Expired()=>new("sourcing_conversion_expired_conflict","The accepted purchase deadline elapsed while validating conversion.");
    private static BusinessException Capacity()=>new("sourcing_offer_capacity_unavailable","The accepted conversion graph exceeds its supported bounds.");
}

public static class SourcingConversionPlanRules
{
    public static SourcingConversionInput Normalize(SourcingConversionInput input)
    {
        if(input is null)throw new BusinessException("invalid_sourcing_conversion","Use the exact current accepted terms, allocation and cart versions.");
        return input with{RequestId=SourcingRules.CommandId(input.RequestId),TaskId=SourcingRules.Id(input.TaskId),RequestVersion=SourcingRules.Version(input.RequestVersion),TaskVersion=SourcingRules.Version(input.TaskVersion),OfferVersion=SourcingRules.Version(input.OfferVersion),AcceptanceId=SourcingRules.Id(input.AcceptanceId),AgreementId=SourcingRules.Id(input.AgreementId),AgreementVersion=SourcingRules.Version(input.AgreementVersion),AllocationId=SourcingRules.Id(input.AllocationId),AllocationVersion=SourcingRules.Version(input.AllocationVersion),TermsHash=SourcingRules.Fingerprint(input.TermsHash),CartVersion=input.CartVersion is null?null:SourcingRules.Version(input.CartVersion)};
    }
    public static void ValidateCompletion(AcceptedSourcingPurchasePlan plan,SourcingConversionMutation result)
    {
        SourcingRules.Id(result.ConversionId);SourcingRules.Id(result.CartId);SourcingRules.Version(result.CartVersion);
        if(result.At.Offset!=TimeSpan.Zero||result.Lines is not {Length:>0 and <=64}||result.Lines.Any(l=>l is null)||plan.Lines is not {Length:>0 and <=64}||result.Lines.Length!=plan.Lines.Length||result.Lines.Select(l=>l.LineId).Distinct(StringComparer.Ordinal).Count()!=result.Lines.Length||result.Lines.Select(l=>l.AgreementLineId).Distinct(StringComparer.Ordinal).Count()!=result.Lines.Length||result.Lines.Select(l=>l.OfferLineId).Distinct(StringComparer.Ordinal).Count()!=result.Lines.Length)throw new InvalidOperationException("A conversion result must link every exact accepted line once.");
        foreach(var link in result.Lines){SourcingRules.Id(link.LineId);SourcingRules.Id(link.AgreementLineId);SourcingRules.Id(link.OfferLineId);if(!plan.Lines.Any(l=>l.OfferLineId==link.OfferLineId))throw new InvalidOperationException("A conversion result cannot substitute an accepted offer line.");}
    }
}
