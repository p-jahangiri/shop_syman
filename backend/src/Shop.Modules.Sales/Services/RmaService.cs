using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;

namespace Shop.Modules.Sales;

// Sales-only intake/triage. No Inventory, Payments or Credit writer dependency.
// The API coordinator owns the audited root Serializable transaction.
public sealed class RmaService(SalesDbContext db,IRmaProtection protection,TimeProvider clock,bool allowDemo=false)
{
    private sealed record RequestSeal(string CaseId,string OwnerId,string OrderId,string Locale,string Kind,int OriginalSnapshotVersion,
        string SnapshotHash,string PolicyRevisionId,string Reason,DateTimeOffset CreatedAt);
    private sealed record SourceGroup(string Id,string Kind,string LineKey,int Quantity,DateTimeOffset HandedOffOrAvailableAt,DateTimeOffset? DeliveredAt);
    private sealed record LineSeal(string CaseId,string LineKey,string VariantId,string Sku,string Name,string Label,bool IsDigital,
        int OrderedQuantity,int Quantity,int HandedOffOrAvailableQuantity,SourceGroup[] Claims);
    private sealed record EventSeal(string CaseId,string ActorId,string Author,string Action,string State,string? Outcome,DateTimeOffset At,string? Message,string? StaffNote);
    private sealed record HistoricalLine(string Key,string VariantId,string Sku,string Name,string Label,bool IsDigital,int Quantity);
    private sealed record Facts(SalesOrder Order,HistoricalLine[] Lines,SourceGroup[] Groups);
    private DateTimeOffset Now()=>clock.GetUtcNow().ToUniversalTime();
    private static string V(byte[] bytes)=>RmaRules.Version(Convert.ToBase64String(bytes));
    private static string Hash<T>(T x)=>RmaRules.Hash(RmaRules.Serialize(x));
    private IQueryable<RmaPolicyRevision> Policies=>db.RmaPolicyRevisions.FromSqlRaw("SELECT * FROM [sales].[RmaPolicyRevisions] WITH (READCOMMITTEDLOCK)").AsNoTracking();
    private IQueryable<RmaCase> Cases=>db.RmaCases.FromSqlRaw("SELECT * FROM [sales].[RmaCases] WITH (READCOMMITTEDLOCK)");
    private IQueryable<RmaCaseCommand> Commands=>db.RmaCaseCommands.FromSqlRaw("SELECT * FROM [sales].[RmaCaseCommands] WITH (READCOMMITTEDLOCK)").AsNoTracking();
    private IQueryable<RmaPolicyCommand> PolicyCommands=>db.RmaPolicyCommands.FromSqlRaw("SELECT * FROM [sales].[RmaPolicyCommands] WITH (READCOMMITTEDLOCK)").AsNoTracking();
    private async Task LockAsync(string domain,string identity,bool exclusive,CancellationToken ct)
    {
        CartOfferRules.RequireParent(db);await using var c=db.Database.GetDbConnection().CreateCommand();c.Transaction=db.Database.CurrentTransaction!.GetDbTransaction();c.CommandTimeout=15;
        c.CommandText="DECLARE @r int;EXEC @r=sys.sp_getapplock @Resource=@resource,@LockMode=@mode,@LockOwner='Transaction',@LockTimeout=10000;SELECT @r;";
        foreach(var pair in new[]{("@resource","sayman:sales:rma:"+domain+":"+RmaRules.Hash(identity)),("@mode",exclusive?"Exclusive":"Shared")}){var p=c.CreateParameter();p.ParameterName=pair.Item1;p.Value=pair.Item2;c.Parameters.Add(p);}
        if(Convert.ToInt32(await c.ExecuteScalarAsync(ct),CultureInfo.InvariantCulture)<0)throw RmaRules.Conflict("busy");
    }
    private byte[] Protect<T>(string purpose,string principal,string id,T value)=>protection.Protect(purpose,RmaRules.Actor(principal),id,RmaRules.Serialize(value));
    private T Decode<T>(string purpose,string principal,string id,byte[] bytes)
    {
        try{return JsonSerializer.Deserialize<T>(protection.Unprotect(purpose,RmaRules.Actor(principal),id,bytes),RmaRules.Json)??throw RmaRules.Unavailable();}
        catch(Exception e)when(e is JsonException or NotSupportedException or ArgumentException){throw RmaRules.Unavailable();}
    }
    private static RmaPolicyData PolicyData(RmaPolicyRevision r)
    {
        try{RmaRules.Id(r.Id);_=RmaRules.Normalize(new RmaPolicyInput(V(r.Version),r.Enabled,r.PhysicalReturns,r.DigitalComplaints,r.ConditionsFa,r.ConditionsEn,r.WindowMode,r.WindowDays,r.MaxOpenPerOwner,"retained policy",true));
            if(r.Revision is<1 or>RmaRules.MaxRevisions||r.At.Offset!=TimeSpan.Zero)throw RmaRules.Unavailable();
            return new(r.Id,r.Revision,V(r.Version),r.Enabled,r.PhysicalReturns,r.DigitalComplaints,r.ConditionsFa,r.ConditionsEn,r.WindowMode,r.WindowDays,r.MaxOpenPerOwner,r.At);
        }catch(BusinessException){throw RmaRules.Unavailable();}
    }
    public async Task<RmaPolicyCurrent> CurrentPolicyAsync(CancellationToken ct)
    {
        await LockAsync("policy","singleton",false,ct);var row=await Policies.OrderByDescending(x=>x.Revision).FirstOrDefaultAsync(ct);return new(1,row is null?null:await VerifiedPolicyAsync(row,ct));
    }
    private async Task<RmaPolicyData> VerifiedPolicyAsync(RmaPolicyRevision row,CancellationToken ct)
    {
        var data=PolicyData(row);var receipt=await PolicyCommands.SingleOrDefaultAsync(x=>x.RevisionId==row.Id,ct)??throw RmaRules.Unavailable();
        if(receipt.ActorId!=row.ActorId||receipt.At!=row.At||RmaRules.Serialize(PolicyReceipt(receipt).Policy.Current)!=RmaRules.Serialize(data))throw RmaRules.Unavailable();
        _=Decode<string>("policyNote",row.ActorId,row.Id,row.ProtectedNote);return data;
    }
    private RmaPolicyResult PolicyReceipt(RmaPolicyCommand row)
    {
        var result=Decode<RmaPolicyResult>("policyReceipt",row.ActorId,row.CommandId,row.ProtectedResult);
        var current=result.Policy.Current;
        if(result.SchemaVersion!=1||result.CommandId!=row.CommandId||result.Replayed||Hash(result)!=row.ResultHash
            ||result.Policy.SchemaVersion!=1||result.Policy.CanRefund||result.Policy.RefundAvailability!="provider_unconfigured"
            ||current is null||current.Id!=row.RevisionId||current.At!=row.At)throw RmaRules.Unavailable();return result;
    }
    public async Task<RmaPolicyHistory> PolicyHistoryAsync(int? before,CancellationToken ct)
    {
        if(before is<=0 or>RmaRules.MaxRevisions)throw RmaRules.Invalid();await LockAsync("policy","singleton",false,ct);
        var rows=await Policies.Where(x=>before==null||x.Revision<before).OrderByDescending(x=>x.Revision).Take(21).ToArrayAsync(ct);
        var items=new List<RmaPolicyData>();foreach(var row in rows.Take(20))items.Add(await VerifiedPolicyAsync(row,ct));return new(1,items.ToArray(),rows.Length>20?items[^1].Revision:null);
    }
    public async Task<RmaPolicyResult> WritePolicyAsync(string actorId,string commandId,RmaPolicyInput supplied,CancellationToken ct)
    {
        var actor=RmaRules.Actor(actorId);var command=RmaRules.Id(commandId);var input=RmaRules.Normalize(supplied);await LockAsync("policy","singleton",true,ct);
        var hash=Hash(new{Contract="Sayman.Rma.Policy.v1",Input=input});var prior=await PolicyCommands.SingleOrDefaultAsync(x=>x.ActorId==actor&&x.CommandId==command,ct);
        if(prior is not null){if(prior.PayloadHash!=hash)throw RmaRules.Conflict("idempotency");return PolicyReceipt(prior)with{Replayed=true};}
        var current=(await CurrentPolicyAsync(ct)).Current;if(current?.Version!=input.Version||current?.Revision>=RmaRules.MaxRevisions)throw RmaRules.Conflict("policy_version");
        var now=Now();if(current?.At>now)throw RmaRules.Conflict("clock");var revision=new RmaPolicyRevision{Revision=(current?.Revision??0)+1,Enabled=input.Enabled,
            PhysicalReturns=input.PhysicalReturns,DigitalComplaints=input.DigitalComplaints,ConditionsFa=input.ConditionsFa,ConditionsEn=input.ConditionsEn,
            WindowMode=input.WindowMode,WindowDays=input.WindowDays,MaxOpenPerOwner=input.MaxOpenPerOwner,ActorId=actor,At=now};
        revision.ProtectedNote=Protect("policyNote",actor,revision.Id,input.Note);db.RmaPolicyRevisions.Add(revision);await db.SaveChangesAsync(ct);
        var result=new RmaPolicyResult(1,command,false,new(1,PolicyData(revision)));db.RmaPolicyCommands.Add(new(){ActorId=actor,CommandId=command,RevisionId=revision.Id,
            PayloadHash=hash,ResultHash=Hash(result),ProtectedResult=Protect("policyReceipt",actor,command,result),At=now});await db.SaveChangesAsync(ct);return result;
    }
    public async Task<RmaPolicyResult> PolicyReceiptAsync(string actorId,string commandId,CancellationToken ct)
    {
        var actor=RmaRules.Actor(actorId);var command=RmaRules.Id(commandId);var row=await PolicyCommands.SingleOrDefaultAsync(x=>x.ActorId==actor&&x.CommandId==command,ct)??throw RmaRules.Missing();return PolicyReceipt(row)with{Replayed=true};
    }
    private async Task<SalesOrder> OrderAsync(string ownerId,string orderId,CancellationToken ct)
    {
        var order=await OrderCommandQueries.FindAsync(db,ownerId,orderId,ct)??throw RmaRules.Missing();if(order.ContainsDemo&&!allowDemo)throw RmaRules.Missing();
        await OrderCommandQueries.LoadHistoryAsync(db,order,ct);return order;
    }
    private static HistoricalLine[] Source(SalesOrder order)
    {
        var rows=order.SnapshotVersion==2?order.LinesV2.Select(x=>new HistoricalLine(x.LineId,x.VariantId,x.Sku,x.Name,x.Label,x.IsDigital,x.Quantity)).ToArray()
            :order.Lines.Select(x=>new HistoricalLine(x.VariantId.ToUpperInvariant(),x.VariantId,x.Sku,x.Name,x.Label,x.IsDigital,x.Quantity)).ToArray();
        if(rows.Length is<1 or>RmaRules.MaxLines||rows.Select(x=>x.Key).Distinct(StringComparer.Ordinal).Count()!=rows.Length||rows.Any(x=>x.Quantity is<1 or>1000000))throw RmaRules.Unavailable();return rows;
    }
    private async Task<Facts> FactsAsync(SalesOrder order,CancellationToken ct)
    {
        var lines=Source(order);var id=order.Id;var groups=new List<SourceGroup>();
        var single=await db.OrderShipments.FromSqlInterpolated($"SELECT * FROM [sales].[OrderShipments] WITH (READCOMMITTEDLOCK) WHERE [OrderId]={id}").AsNoTracking().SingleOrDefaultAsync(ct);
        var parcels=await db.Parcels.FromSqlInterpolated($"SELECT * FROM [sales].[OrderParcels] WITH (READCOMMITTEDLOCK) WHERE [OrderId]={id}").AsNoTracking().Where(x=>x.State=="dispatched"||x.State=="delivered").Take(65).ToArrayAsync(ct);
        if(parcels.Length>64||single is not null&&parcels.Length>0)throw RmaRules.Unavailable();
        if(single is not null&&single.State is "dispatched"or"delivered"){
            if(single.DispatchedAt is null||single.OwnerId!=order.OwnerId||single.ReservationId!=order.ReservationId)throw RmaRules.Unavailable();
            var source=await db.OrderShipmentLines.FromSqlInterpolated($"SELECT * FROM [sales].[OrderShipmentLines] WITH (READCOMMITTEDLOCK) WHERE [ShipmentId]={single.Id} AND [PackingRevision]={single.PackingRevision}").AsNoTracking().ToArrayAsync(ct);
            foreach(var row in source){var line=lines.SingleOrDefault(x=>x.Key==row.LineKey&&x.VariantId==row.VariantId&&!x.IsDigital)??throw RmaRules.Unavailable();if(row.Quantity!=line.Quantity)throw RmaRules.Unavailable();groups.Add(new(single.Id,"shipment",row.LineKey,row.Quantity,single.DispatchedAt.Value,single.DeliveredAt));}
        }
        foreach(var parcel in parcels){
            if(parcel.DispatchedAt is null||parcel.InventoryDispatchHash is not{Length:64}||parcel.OwnerId!=order.OwnerId||parcel.ReservationId!=order.ReservationId)throw RmaRules.Unavailable();
            var source=await db.ParcelLines.FromSqlInterpolated($"SELECT * FROM [sales].[ParcelLineSnapshots] WITH (READCOMMITTEDLOCK) WHERE [ParcelId]={parcel.Id} AND [PackingRevision]={parcel.PackingRevision}").AsNoTracking().ToArrayAsync(ct);
            foreach(var row in source){if(!lines.Any(x=>x.Key==row.LineKey&&x.VariantId==row.VariantId&&!x.IsDigital))throw RmaRules.Unavailable();groups.Add(new(parcel.Id,"parcel",row.LineKey,row.Quantity,parcel.DispatchedAt.Value,parcel.DeliveredAt));}
        }
        var deliveries=await db.DigitalDeliveries.FromSqlInterpolated($"SELECT * FROM [sales].[DigitalDeliveries] WITH (READCOMMITTEDLOCK) WHERE [OrderId]={id}").AsNoTracking().Take(101).ToArrayAsync(ct);
        if(deliveries.Length>100)throw RmaRules.Unavailable();
        foreach(var delivery in deliveries){
            if(delivery.OwnerId!=order.OwnerId||delivery.ReservationId!=order.ReservationId)throw RmaRules.Unavailable();
            // Count available items only. Never read/decrypt digital credentials or infer a reveal event.
            var source=await db.DigitalItems.FromSqlInterpolated($"SELECT * FROM [sales].[DigitalDeliveryItems] WITH (READCOMMITTEDLOCK) WHERE [DeliveryId]={delivery.Id}").AsNoTracking().Select(x=>x.LineKey).ToArrayAsync(ct);
            foreach(var batch in source.GroupBy(x=>x,StringComparer.Ordinal)){if(!lines.Any(x=>x.Key==batch.Key&&x.IsDigital))throw RmaRules.Unavailable();groups.Add(new(delivery.Id,"digital",batch.Key,batch.Count(),delivery.AvailableAt,null));}
        }
        var now=Now();if(groups.Any(x=>x.Quantity<1||x.HandedOffOrAvailableAt.Offset!=TimeSpan.Zero||x.HandedOffOrAvailableAt>now||x.DeliveredAt is{}at&&(at<x.HandedOffOrAvailableAt||at>now||at.Offset!=TimeSpan.Zero))
            ||groups.Select(x=>(x.Id,x.LineKey)).Distinct().Count()!=groups.Count||lines.Any(l=>groups.Where(x=>x.LineKey==l.Key).Sum(x=>(long)x.Quantity)>l.Quantity))throw RmaRules.Unavailable();
        return new(order,lines,groups.ToArray());
    }
    private static bool Eligible(SourceGroup group,HistoricalLine line,RmaPolicyData policy,DateTimeOffset now)
        // Availability starts the digital complaint window, without recording
        // or inferring a content reveal. Physical clocks use customer delivery.
        =>line.IsDigital?group.Kind=="digital"&&RmaRules.WithinWindow(policy.WindowMode,policy.WindowDays,group.HandedOffOrAvailableAt,now)
            :group.Kind is "shipment"or"parcel"&&RmaRules.WithinWindow(policy.WindowMode,policy.WindowDays,group.DeliveredAt,now);
    public async Task<RmaOrderContext> ContextAsync(string ownerId,string orderId,CancellationToken ct)
    {
        var owner=OrderInputRules.Identifier(ownerId);var id=RmaRules.Id(orderId);await OrderV2Locks.OwnerAsync(db,owner,ct);
        var facts=await FactsAsync(await OrderAsync(owner,id,ct),ct);var policy=await CurrentPolicyAsync(ct);var blockers=new List<string>();var p=policy.Current;
        if(p is null)blockers.Add("policy_unconfigured");else if(!p.Enabled)blockers.Add("policy_disabled");
        if(facts.Order.State is not(OrderState.Paid or OrderState.CreditApproved or OrderState.Fulfilled))blockers.Add("payment_not_confirmed");
        if(await Cases.AsNoTracking().AnyAsync(x=>x.OrderId==id&&x.IsOpen,ct))blockers.Add("active_request_exists");
        if(p?.MaxOpenPerOwner is{}cap&&await Cases.AsNoTracking().CountAsync(x=>x.OwnerId==owner&&x.IsOpen,ct)>=cap)blockers.Add("owner_request_capacity");
        var lines=facts.Lines.Select(l=>new RmaOrderLineData(l.Key,l.VariantId,l.Sku,l.Name,l.Label,l.IsDigital,l.Quantity,
            facts.Groups.Where(x=>x.LineKey==l.Key).Sum(x=>x.Quantity),p is null||!p.Enabled||(l.IsDigital?!p.DigitalComplaints:!p.PhysicalReturns)?0:facts.Groups.Where(x=>x.LineKey==l.Key&&Eligible(x,l,p,Now())).Sum(x=>x.Quantity))).ToArray();
        if(!lines.Any(x=>x.RequestableQuantity>0))blockers.Add("no_requestable_fulfillment");
        return new(1,id,facts.Order.SnapshotVersion==2?2:1,V(facts.Order.Version),facts.Order.State.ToString(),RmaRules.Hash(facts.Order.QuoteSnapshotJson),policy,lines,blockers.Count==0,blockers.ToArray());
    }
    private RmaSummary Summary(RmaCase row,bool staff=false)=>new(row.Id,"RMA-"+row.Number.ToString(CultureInfo.InvariantCulture),row.OrderId,row.Locale,row.Kind,row.State,row.Outcome,row.IsOpen,V(row.Version),row.Lines.Sum(x=>x.Quantity),row.CreatedAt,row.ChangedAt,staff?row.OwnerId:null);
    private async Task<RmaCase> CaseAsync(string owner,string id,CancellationToken ct)
    {
        var row=await Cases.SingleOrDefaultAsync(x=>x.OwnerId==owner&&x.Id==id,ct)??throw RmaRules.Missing();if(row.ContainsDemo&&!allowDemo)throw RmaRules.Missing();
        // Command graph reads remain tracked and unchanged. Attaching detached
        // historical children through a tracked case could mark them Modified.
        row.Lines=await db.RmaCaseLines.FromSqlInterpolated($"SELECT * FROM [sales].[RmaCaseLines] WITH (READCOMMITTEDLOCK) WHERE [CaseId]={id}").OrderBy(x=>x.LineKey).ToListAsync(ct);
        row.Events=await db.RmaCaseEvents.FromSqlInterpolated($"SELECT * FROM [sales].[RmaCaseEvents] WITH (READCOMMITTEDLOCK) WHERE [CaseId]={id}").OrderBy(x=>x.Id).Take(RmaRules.MaxEvents+1).ToListAsync(ct);return row;
    }
    private async Task<RmaDetail> DetailAsync(RmaCase row,bool staff,CancellationToken ct)
    {
        var seal=Decode<RequestSeal>("request",row.OwnerId,row.Id,row.ProtectedRequest);
        if(seal.CaseId!=row.Id||seal.OwnerId!=row.OwnerId||seal.OrderId!=row.OrderId||seal.Locale!=row.Locale||seal.Kind!=row.Kind||seal.OriginalSnapshotVersion!=row.OriginalSnapshotVersion
            ||seal.SnapshotHash!=row.SnapshotHash||seal.PolicyRevisionId!=row.PolicyRevisionId||seal.CreatedAt!=row.CreatedAt||row.Lines.Count is<1 or>RmaRules.MaxLines||row.Events.Count is<1 or>RmaRules.MaxEvents)throw RmaRules.Unavailable();
        var policy=await Policies.SingleOrDefaultAsync(x=>x.Id==row.PolicyRevisionId,ct)??throw RmaRules.Unavailable();var p=await VerifiedPolicyAsync(policy,ct);
        var lines=new List<RmaLineData>();foreach(var line in row.Lines){var s=Decode<LineSeal>("line",row.OwnerId,row.Id+":"+RmaRules.Hash(line.LineKey),line.ProtectedFacts);
            if(s.CaseId!=row.Id||s.LineKey!=line.LineKey||s.VariantId!=line.VariantId||s.Sku!=line.Sku||s.Name!=line.Name||s.Label!=line.Label||s.IsDigital!=line.IsDigital||s.OrderedQuantity!=line.OrderedQuantity
                ||s.Quantity!=line.Quantity||s.HandedOffOrAvailableQuantity!=line.HandedOffOrAvailableQuantity||s.Claims is null||s.Claims.Sum(x=>(long)x.Quantity)!=line.Quantity
                ||s.Claims.Any(x=>x.LineKey!=line.LineKey||x.Quantity<1)||line.IsDigital!=(row.Kind=="digitalComplaint"))throw RmaRules.Unavailable();
            lines.Add(new(line.LineKey,line.VariantId,line.Sku,line.Name,line.Label,line.IsDigital,line.OrderedQuantity,line.Quantity,line.HandedOffOrAvailableQuantity));}
        var events=new List<RmaEventData>();foreach(var ev in row.Events){var s=Decode<EventSeal>("event",ev.ActorId,row.Id+":"+ev.Action,ev.ProtectedText);
            if(s.CaseId!=row.Id||s.ActorId!=ev.ActorId||s.Author!=ev.Author||s.Action!=ev.Action||s.State!=ev.State||s.Outcome!=ev.Outcome||s.At!=ev.At)throw RmaRules.Unavailable();
            events.Add(new(ev.Id.ToString(CultureInfo.InvariantCulture),ev.Action,ev.State,ev.Outcome,ev.Author,ev.At,s.Message,staff?s.StaffNote:null));}
        var last=row.Events[^1];if(last.State!=row.State||last.Outcome!=row.Outcome||last.At!=row.ChangedAt)throw RmaRules.Unavailable();
        return new(1,Summary(row,staff),row.OriginalSnapshotVersion,row.SnapshotHash,p,seal.Reason,lines.ToArray(),events.ToArray(),row.IsOpen);
    }
    public async Task<RmaDetail> DetailAsync(string ownerId,string caseId,bool staff,CancellationToken ct)
    {
        var owner=OrderInputRules.Identifier(ownerId);var id=RmaRules.Id(caseId);await OrderV2Locks.OwnerAsync(db,owner,ct);return await DetailAsync(await CaseAsync(owner,id,ct),staff,ct);
    }
    public async Task<RmaPage> PageAsync(string? ownerId,string? state,string? after,CancellationToken ct)
    {
        if(state is not(null or "submitted"or"reviewing"or"reviewed"or"withdrawn"))throw RmaRules.Invalid();var owner=ownerId is null?null:OrderInputRules.Identifier(ownerId);
        var scope="rma-page:"+(owner??"staff")+":"+(state??"all");var cursor=RmaRules.Cursor(after,scope);
        var rows=await Cases.AsNoTracking().Where(x=>(owner==null||x.OwnerId==owner)&&(state==null||x.State==state)&&x.Number<cursor&&(allowDemo||!x.ContainsDemo)).OrderByDescending(x=>x.Number).Take(21).ToArrayAsync(ct);
        var items=new List<RmaSummary>();foreach(var row in rows.Take(20)){row.Lines=await db.RmaCaseLines.AsNoTracking().Where(x=>x.CaseId==row.Id).ToListAsync(ct);items.Add(Summary(row,owner is null));}
        return new(1,items.ToArray(),rows.Length>20?RmaRules.Cursor(rows[19].Number,scope):null);
    }
    private RmaCommandResult Receipt(RmaCaseCommand row)
    {
        var result=Decode<RmaCommandResult>("receipt",row.ActorId,row.CommandId,row.ProtectedResult);
        if(result.SchemaVersion!=1||result.CommandId!=row.CommandId||result.PayloadHash!=row.PayloadHash||result.Replayed||Hash(result)!=row.ResultHash||result.Case.Case.Id!=row.CaseId
            ||result.Case.CanRefund||result.Case.CanReceive||result.Case.CanRestock||result.Case.CanReship||result.Case.RefundAvailability!="provider_unconfigured"
            ||row.Audience=="customer"&&result.Case.Events.Any(x=>x.StaffNote is not null))throw RmaRules.Unavailable();return result;
    }
    private async Task<RmaCommandResult?> PreviousAsync(string actor,string command,string owner,string audience,string hash,string? caseId,CancellationToken ct)
    {
        await LockAsync("command",actor+":"+command,true,ct);var row=await Commands.SingleOrDefaultAsync(x=>x.ActorId==actor&&x.CommandId==command,ct);
        if(row is null)return null;if(row.ContainsDemo&&!allowDemo)throw RmaRules.Missing();if(row.OwnerId!=owner||row.Audience!=audience||row.PayloadHash!=hash||caseId is not null&&row.CaseId!=caseId)throw RmaRules.Conflict("idempotency");return Receipt(row)with{Replayed=true};
    }
    private async Task<RmaCaseEvent> EventAsync(RmaCase row,string actor,string author,string action,string? message,string? note,DateTimeOffset at,CancellationToken ct)
    {
        var ev=new RmaCaseEvent{CaseId=row.Id,ActorId=actor,Author=author,Action=action,State=row.State,Outcome=row.Outcome,At=at};
        // Each transition action is unique per case (also a unique SQL index),
        // so its stable DP identity is known before any identity-column save.
        ev.ProtectedText=Protect("event",actor,row.Id+":"+action,new EventSeal(row.Id,actor,author,action,row.State,row.Outcome,at,message,note));
        db.RmaCaseEvents.Add(ev);if(!row.Events.Contains(ev))row.Events.Add(ev);
        await Task.CompletedTask;return ev;
    }
    private async Task<RmaCommandResult> SaveReceiptAsync(RmaCase row,string actor,string command,string audience,string hash,CancellationToken ct)
    {
        await db.SaveChangesAsync(ct);var result=new RmaCommandResult(1,command,hash,false,await DetailAsync(row,audience=="staff",ct));
        db.RmaCaseCommands.Add(new(){ActorId=actor,CommandId=command,CaseId=row.Id,OwnerId=row.OwnerId,Audience=audience,PayloadHash=hash,
            ResultHash=Hash(result),ProtectedResult=Protect("receipt",actor,command,result),ContainsDemo=row.ContainsDemo,At=row.ChangedAt});await db.SaveChangesAsync(ct);return result;
    }
    public async Task<RmaCommandResult> CreateAsync(string ownerId,string orderId,string commandId,CreateRmaInput supplied,CancellationToken ct)
    {
        var owner=OrderInputRules.Identifier(ownerId);var actor=RmaRules.Actor(owner);var order=RmaRules.Id(orderId);var command=RmaRules.Id(commandId);var input=RmaRules.Normalize(supplied);
        CartOfferRules.RequireParent(db);await OrderV2Locks.OwnerAsync(db,owner,ct);var hash=Hash(new{Contract="Sayman.Rma.Create.v1",OwnerId=owner,OrderId=order,Input=input});
        var prior=await PreviousAsync(actor,command,owner,"customer",hash,null,ct);if(prior is not null)return prior;
        var facts=await FactsAsync(await OrderAsync(owner,order,ct),ct);var p=(await CurrentPolicyAsync(ct)).Current??throw RmaRules.Conflict("policy_unconfigured");
        if(!p.Enabled||input.PolicyRevisionId!=p.Id||(input.Kind=="physicalReturn"?!p.PhysicalReturns:!p.DigitalComplaints))throw RmaRules.Conflict("policy");
        if(facts.Order.State is not(OrderState.Paid or OrderState.CreditApproved or OrderState.Fulfilled))throw RmaRules.Conflict("payment");
        if(input.OrderVersion!=V(facts.Order.Version))throw RmaRules.Conflict("order_version");
        if(await Cases.AsNoTracking().AnyAsync(x=>x.OrderId==order&&x.IsOpen,ct))throw RmaRules.Conflict("active_request");
        if(p.MaxOpenPerOwner is{}cap&&await Cases.AsNoTracking().CountAsync(x=>x.OwnerId==owner&&x.IsOpen,ct)>=cap)throw RmaRules.Conflict("capacity");
        var now=Now();if(now<p.At)throw RmaRules.Conflict("clock");var row=new RmaCase{OwnerId=facts.Order.OwnerId,OrderId=order,Locale=facts.Order.Locale,Kind=input.Kind,OriginalSnapshotVersion=facts.Order.SnapshotVersion==2?2:1,
            SnapshotHash=RmaRules.Hash(facts.Order.QuoteSnapshotJson),PolicyRevisionId=p.Id,ContainsDemo=facts.Order.ContainsDemo,CreatedAt=now,ChangedAt=now};
        row.ProtectedRequest=Protect("request",row.OwnerId,row.Id,new RequestSeal(row.Id,row.OwnerId,order,row.Locale,row.Kind,row.OriginalSnapshotVersion,row.SnapshotHash,p.Id,input.Reason,now));
        foreach(var selected in input.Lines){var line=facts.Lines.SingleOrDefault(x=>x.Key==selected.LineKey)??throw RmaRules.Invalid();if(line.IsDigital!=(input.Kind=="digitalComplaint"))throw RmaRules.Invalid();
            var available=facts.Groups.Where(x=>x.LineKey==line.Key).Sum(x=>x.Quantity);var eligible=facts.Groups.Where(x=>x.LineKey==line.Key&&Eligible(x,line,p,now)).OrderBy(x=>x.DeliveredAt??x.HandedOffOrAvailableAt).ThenBy(x=>x.Id,StringComparer.Ordinal).ToArray();
            var remaining=selected.Quantity;var claims=new List<SourceGroup>();foreach(var group in eligible){var take=Math.Min(remaining,group.Quantity);if(take>0)claims.Add(group with{Quantity=take});remaining-=take;if(remaining==0)break;}
            if(remaining!=0)throw RmaRules.Conflict("fulfillment_or_window");
            var r=new RmaCaseLine{CaseId=row.Id,LineKey=line.Key,VariantId=line.VariantId,Sku=line.Sku,Name=line.Name,Label=line.Label,IsDigital=line.IsDigital,OrderedQuantity=line.Quantity,Quantity=selected.Quantity,HandedOffOrAvailableQuantity=available};
            r.ProtectedFacts=Protect("line",row.OwnerId,row.Id+":"+RmaRules.Hash(r.LineKey),new LineSeal(row.Id,r.LineKey,r.VariantId,r.Sku,r.Name,r.Label,r.IsDigital,r.OrderedQuantity,r.Quantity,r.HandedOffOrAvailableQuantity,claims.ToArray()));row.Lines.Add(r);
        }
        db.RmaCases.Add(row);await EventAsync(row,actor,"customer","submitted",null,null,now,ct);return await SaveReceiptAsync(row,actor,command,"customer",hash,ct);
    }
    public async Task<RmaCommandResult> WithdrawAsync(string ownerId,string caseId,string commandId,WithdrawRmaInput supplied,CancellationToken ct)
    {
        if(supplied is null||!supplied.Confirmed)throw RmaRules.Invalid();var input=supplied with{Version=RmaRules.Version(supplied.Version),Reason=RmaRules.Text(supplied.Reason,4000)};
        var owner=OrderInputRules.Identifier(ownerId);var actor=RmaRules.Actor(owner);var id=RmaRules.Id(caseId);var command=RmaRules.Id(commandId);await OrderV2Locks.OwnerAsync(db,owner,ct);
        var hash=Hash(new{Contract="Sayman.Rma.Withdraw.v1",CaseId=id,Input=input});var previous=await PreviousAsync(actor,command,owner,"customer",hash,id,ct);if(previous is not null)return previous;
        var row=await CaseAsync(owner,id,ct);if(V(row.Version)!=input.Version)throw RmaRules.Conflict("version");if(!row.IsOpen)throw RmaRules.Conflict("state");var now=Now();if(now<row.ChangedAt)throw RmaRules.Conflict("clock");
        row.State="withdrawn";row.Outcome=null;row.IsOpen=false;row.ChangedAt=now;await EventAsync(row,actor,"customer","withdrawn",input.Reason,null,now,ct);return await SaveReceiptAsync(row,actor,command,"customer",hash,ct);
    }
    public async Task<RmaCommandResult> ReviewAsync(string actorId,string caseId,string commandId,ReviewRmaInput supplied,CancellationToken ct)
    {
        var actor=RmaRules.Actor(actorId);var id=RmaRules.Id(caseId);var command=RmaRules.Id(commandId);var input=RmaRules.Normalize(supplied);await OrderV2Locks.OwnerAsync(db,input.OwnerId,ct);
        var hash=Hash(new{Contract="Sayman.Rma.Review.v1",CaseId=id,Input=input});var previous=await PreviousAsync(actor,command,input.OwnerId,"staff",hash,id,ct);if(previous is not null)return previous;
        var row=await CaseAsync(input.OwnerId,id,ct);if(V(row.Version)!=input.Version)throw RmaRules.Conflict("version");
        if(input.Action=="startReview"?row.State!="submitted":row.State!="reviewing")throw RmaRules.Conflict("state");var now=Now();if(now<row.ChangedAt)throw RmaRules.Conflict("clock");
        row.State=input.Action=="startReview"?"reviewing":"reviewed";row.Outcome=input.Outcome;row.IsOpen=input.Outcome!="declined";row.ChangedAt=now;
        await EventAsync(row,actor,"staff",input.Action,input.CustomerMessage,input.Note,now,ct);return await SaveReceiptAsync(row,actor,command,"staff",hash,ct);
    }
    public async Task<RmaCommandResult> ReceiptAsync(string actorId,string commandId,bool staff,CancellationToken ct)
    {
        var actor=RmaRules.Actor(actorId);var command=RmaRules.Id(commandId);var row=await Commands.SingleOrDefaultAsync(x=>x.ActorId==actor&&x.CommandId==command&&x.Audience==(staff?"staff":"customer"),ct)??throw RmaRules.Missing();
        if(row.ContainsDemo&&!allowDemo)throw RmaRules.Missing();return Receipt(row)with{Replayed=true};
    }
}
