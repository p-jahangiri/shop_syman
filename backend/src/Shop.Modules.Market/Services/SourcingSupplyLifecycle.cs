using System.Data;
using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;

namespace Shop.Modules.Market;

internal static class SourcingSupplyLocks
{
    internal static void RequireTransaction(MarketDbContext db){if(db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel!=IsolationLevel.Serializable)throw new InvalidOperationException("Supply commands require the root Serializable transaction shared with Inventory and audit.");}
    internal static Task CommandAsync(MarketDbContext db,string actor,string operation,string command,CancellationToken ct)=>Lock(db,"supply-command:"+actor.ToUpperInvariant()+":"+operation+":"+command,ct);
    internal static Task RequestAsync(MarketDbContext db,string request,CancellationToken ct)=>Lock(db,"request:"+request,ct);
    internal static Task TaskAsync(MarketDbContext db,string task,CancellationToken ct)=>Lock(db,"supply-task:"+task,ct);
    private static async Task Lock(MarketDbContext db,string key,CancellationToken ct)
    {
        RequireTransaction(db);var transaction=db.Database.CurrentTransaction!;await using var command=db.Database.GetDbConnection().CreateCommand();command.Transaction=transaction.GetDbTransaction();command.CommandTimeout=15;command.CommandText="DECLARE @result int; EXEC @result=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @result;";var parameter=command.CreateParameter();parameter.ParameterName="@resource";parameter.Value="sayman:market:sourcing:"+SourcingRules.Hash(key);command.Parameters.Add(parameter);if(Convert.ToInt32(await command.ExecuteScalarAsync(ct),CultureInfo.InvariantCulture)<0)throw new BusinessException("sourcing_busy_conflict","Another sourcing command is in progress. Retry the same command id.");
    }
}
internal static class SourcingSupplyLifecycle
{
    internal static void ReleaseAcceptedOffer(MarketDbContext db,SourcingSupplyTask task,SourcingOffer offer,DateTimeOffset now)
    {
        if(offer.Id!=task.OfferId||offer.RequestId!=task.RequestId||offer.State!="Accepted"||offer.AcceptanceId!=task.AcceptanceId)throw new InvalidOperationException("A supply task must retain its exact historical accepted offer.");
        if(!offer.IsActive)return;offer.IsActive=false;offer.ChangedAt=now;db.Entry(offer).Property(o=>o.ChangedAt).IsModified=true;
    }
    // Caller owns the SAME request lock. Closing the request never pretends to
    // undo an external supplier order or a physical Inventory receipt.
    internal static async Task BeforeParentCloseAsync(MarketDbContext db,string requestId,string actor,string kind,string reason,DateTimeOffset now,CancellationToken ct,ISourcingPurchaseLifecycle? purchaseLifecycle=null)
    {
        var task=await db.SourcingSupplyTasks.Include(t=>t.Lines.OrderBy(l=>l.OfferLineId).Take(65)).SingleOrDefaultAsync(t=>t.RequestId==requestId&&t.IsOpen,ct);if(task is null)return;await SourcingSupplyLocks.TaskAsync(db,task.Id,ct);if(task.Lines.Count is <1 or >64)throw new BusinessException("sourcing_supply_capacity_unavailable","The supply graph exceeds its supported bounds.");
        if(purchaseLifecycle is not null)await purchaseLifecycle.BeforeCloseAsync(actor,requestId,task.Id,task.AcceptanceId,reason,ct);
        var before=task.State;task.State="Cancelled";task.IsOpen=false;task.ChangedAt=now;db.Entry(task).Property(t=>t.ChangedAt).IsModified=true;task.PublicMessageFa="درخواست بسته شد؛ پیگیری تأمین پایان یافت. دریافت‌های واقعی انبار محفوظ‌اند.";task.PublicMessageEn="The request closed and supply follow-up ended. Actual inventory receipts are retained.";
        var offer=await db.SourcingOffers.SingleAsync(o=>o.Id==task.OfferId&&o.RequestId==requestId,ct);ReleaseAcceptedOffer(db,task,offer,now);db.SourcingSupplyEvents.Add(new(){TaskId=task.Id,ActorId=actor,ActorKind=kind,StateBefore=before,StateAfter=task.State,ReceiptProgress=SourcingSupplyRules.ReceiptProgress(task.Lines.Select(l=>(l.RequiredQuantity,l.ReceivedQuantity))),ReasonCode=reason,PublicMessageFa=task.PublicMessageFa,PublicMessageEn=task.PublicMessageEn,SourceKind=task.SourceKind,SourceKey=task.SourceKey,SourceNameFa=task.SourceNameFa,SourceNameEn=task.SourceNameEn,Reference=task.Reference,ProtectedNote=task.ProtectedNote,ActionAt=task.ActionAt,ExpectedAt=task.ExpectedAt,At=now});
    }
}
