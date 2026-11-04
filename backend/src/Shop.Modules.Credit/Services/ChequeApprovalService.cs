using System.Data;
using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;
namespace Shop.Modules.Credit;
public sealed class ChequeApprovalService(CreditDbContext db,CreditScheduleService schedules,ChequeLedgerService ledger,ICreditOrderScheduleSource sourceReader,IChequeApprovalProtection protection,TimeProvider clock)
{
    private sealed record Origin(string Id,string OwnerId,string OrderId,string ChequeId,string ScheduleId,string ActorId,DateTimeOffset RecordedAt);
    private sealed record EventSeal(string Id,string ApprovalId,string OrderId,string ChequeId,string LedgerEventId,int Sequence,string Action,string State,string ActorId,string OrderVersion,string ScheduleVersion,string LedgerVersion,string Note,string? PreviousVersion,bool AcknowledgedClosedOrder,DateTimeOffset OccurredAt,DateTimeOffset RecordedAt);
    private static string Json<T>(T x)=>JsonSerializer.Serialize(x,CreditScheduleFacts.Json);
    private static string Version(ChequeApprovalEvent x)=>Convert.ToBase64String(x.Version);
    private static string Hash(string x)=>CreditApplicationRules.Hash(x);
    private T Decode<T>(string kind,string principal,string order,string id,byte[] value){try{return JsonSerializer.Deserialize<T>(protection.Unprotect(kind,principal,order,id,value),CreditScheduleFacts.Json)??throw ChequeApprovalRules.Unavailable();}catch(Exception e)when(e is JsonException or NullReferenceException){throw ChequeApprovalRules.Unavailable();}}
    private void Root(){if(db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel!=IsolationLevel.Serializable)throw new InvalidOperationException("Cheque approval requires the audited root Sales/Credit Serializable transaction.");}
    private async Task<CreditOrderScheduleSource> Source(string owner,string order,CancellationToken ct){Root();owner=CreditApplicationRules.Actor(owner);CreditApplicationRules.Id(order);await schedules.PageAsync(owner,order,false,ct);var s=await sourceReader.LockAndReadAsync(owner,order,ct);if(s.OwnerId!=owner||s.OrderId!=order)throw ChequeApprovalRules.Unavailable();return s;}
    private static bool Open(CreditOrderScheduleSource s,DateTimeOffset now)=>s.State=="CreditApproved"||s.State=="AwaitingPayment"&&s.ExpiresAt>now;
    private IQueryable<ChequeApproval> Heads(string owner,string order)=>db.ChequeApprovals.FromSqlInterpolated($"SELECT * FROM [credit].[ChequeApprovals] WITH (READCOMMITTEDLOCK) WHERE [OwnerId]={owner} AND [OrderId]={order}").AsNoTracking();
    private async Task<(ChequeApproval? Head,ChequeApprovalEventData[] Events)> Verified(string owner,string order,string cheque,CancellationToken ct)
    {
        owner=CreditApplicationRules.Actor(owner);
        var h=await Heads(owner,order).SingleOrDefaultAsync(x=>x.ChequeId==cheque,ct);if(h is null)return(null,[]);
        var o=Decode<Origin>("origin",owner,order,h.Id,h.ProtectedOrigin);if(Json(o)!=Json(new Origin(h.Id,h.OwnerId,h.OrderId,h.ChequeId,h.ScheduleId,h.ActorId,h.RecordedAt)))throw ChequeApprovalRules.Unavailable();
        var registration=await db.ReceivedCheques.AsNoTracking().SingleOrDefaultAsync(x=>x.Id==cheque,ct)??throw ChequeApprovalRules.Unavailable();if(registration.OwnerId!=owner||registration.OrderId!=order||registration.ScheduleId!=h.ScheduleId||registration.RecordedAt>h.RecordedAt)throw ChequeApprovalRules.Unavailable();
        var rows=await db.ChequeApprovalEvents.FromSqlInterpolated($"SELECT * FROM [credit].[ChequeApprovalEvents] WITH (READCOMMITTEDLOCK) WHERE [ApprovalId]={h.Id}").AsNoTracking().OrderBy(x=>x.Sequence).Take(201).ToArrayAsync(ct);if(rows.Length is<1 or>200)throw ChequeApprovalRules.Unavailable();
        var commands=await db.ChequeApprovalCommands.AsNoTracking().Where(x=>x.ApprovalId==h.Id).Take(201).ToArrayAsync(ct);if(commands.Length!=rows.Length)throw ChequeApprovalRules.Unavailable();
        var ledgerIds=rows.Select(x=>x.LedgerEventId).Distinct().ToArray();var ledgerRows=await db.ChequeLedgerEvents.AsNoTracking().Where(x=>ledgerIds.Contains(x.Id)).ToArrayAsync(ct);var result=new List<ChequeApprovalEventData>();
        foreach(var e in rows){
            var seal=Decode<EventSeal>("event",owner,order,e.Id,e.ProtectedEvent);var past=result.LastOrDefault();var record=ledgerRows.SingleOrDefault(x=>x.Id==e.LedgerEventId)??throw ChequeApprovalRules.Unavailable();
            if(e.Sequence!=result.Count+1||e.OrderId!=order||e.ChequeId!=cheque||seal.Id!=e.Id||seal.ApprovalId!=h.Id||seal.OrderId!=order||seal.ChequeId!=cheque||seal.LedgerEventId!=record.Id||seal.Sequence!=e.Sequence||seal.Action!=e.Action||seal.State!=e.State||seal.ActorId!=e.ActorId||seal.OccurredAt!=e.OccurredAt||seal.RecordedAt!=e.RecordedAt||seal.PreviousVersion!=past?.Summary.Version||e.RecordedAt<h.RecordedAt||e.OccurredAt<(past?.Summary.OccurredAt??registration.RecordedAt)||e.OccurredAt>e.RecordedAt||past is not null&&e.RecordedAt<past.Summary.RecordedAt||record.ChequeId!=cheque||seal.LedgerVersion!=Convert.ToBase64String(record.Version)||record.RecordedAt>e.RecordedAt)throw ChequeApprovalRules.Unavailable();
            CreditApplicationRules.Version(seal.OrderVersion);CreditApplicationRules.Version(seal.ScheduleVersion);CreditUpfrontRules.Text(seal.Note,500,true);
            if(e.Action=="Approve"?(e.State!="Approved"||seal.AcknowledgedClosedOrder||!ChequeApprovalRules.Eligible(record.State)||past is{Summary.State:"Approved"}&&past.Summary.LedgerVersion==seal.LedgerVersion):(e.Action!="Revoke"||e.State!="Revoked"||past?.Summary.State!="Approved"))throw ChequeApprovalRules.Unavailable();
            var data=new ChequeApprovalEventData(new(e.Id,h.Id,order,cheque,e.Sequence,e.Action,e.State,Version(e),seal.OrderVersion,seal.ScheduleVersion,seal.LedgerVersion,e.OccurredAt,e.RecordedAt),seal.Note,seal.PreviousVersion,seal.AcknowledgedClosedOrder);
            var cmd=commands.SingleOrDefault(x=>x.EventId==e.Id)??throw ChequeApprovalRules.Unavailable();var receipt=Receipt(cmd);if(cmd.OwnerId!=owner||cmd.OrderId!=order||cmd.ChequeId!=cheque||cmd.ApprovalId!=h.Id||cmd.ActorId!=e.ActorId||cmd.At!=e.RecordedAt||Json(receipt.Event)!=Json(data))throw ChequeApprovalRules.Unavailable();result.Add(data);
        }
        return(h,result.ToArray());
    }
    private ChequeApprovalResult Receipt(ChequeApprovalCommand c)
    {
        var raw=protection.Unprotect("receipt",c.ActorId,c.OrderId,c.CommandId,c.ProtectedResult);try{var r=JsonSerializer.Deserialize<ChequeApprovalResult>(raw,CreditScheduleFacts.Json)??throw ChequeApprovalRules.Unavailable();if(Hash(raw)!=c.ResultHash||r.SchemaVersion!=1||r.Replayed||r.CommandId!=c.CommandId||r.OrderId!=c.OrderId||r.ChequeId!=c.ChequeId||r.Event.Summary.Id!=c.EventId||r.Event.Summary.ApprovalId!=c.ApprovalId||r.Event.Summary.ChequeId!=c.ChequeId||r.Event.Summary.OrderId!=c.OrderId||r.Event.Summary.RecordedAt!=c.At||r.Event.Summary.BankVerified||r.BankVerified||r.CanPay||r.CanFulfill)throw ChequeApprovalRules.Unavailable();return r;}catch(Exception e)when(e is JsonException or NullReferenceException){throw ChequeApprovalRules.Unavailable();}
    }
    public async Task<ChequeApprovalPage> PageAsync(string owner,string order,CancellationToken ct)
    {
        var s=await Source(owner,order,ct);var plan=await schedules.PageAsync(owner,order,false,ct);var cheques=await ledger.PageAsync(owner,order,false,ct);var items=new List<ChequeApprovalItem>();
        foreach(var line in plan.Current?.Calculation.Lines??[]){var cheque=cheques.Items.SingleOrDefault(x=>x.Sequence==line.Sequence);if(cheque is not null&&(cheque.ScheduleId!=plan.Current!.Id||cheque.AmountRial!=line.AmountRial||cheque.DueDate!=line.DueDate))throw ChequeApprovalRules.Unavailable();var approved=cheque is null?null:(await Verified(owner,order,cheque.Id,ct)).Events.LastOrDefault()?.Summary;items.Add(new(line.Sequence,line.DueDate,line.AmountRial,cheque,approved,cheque is not null&&ChequeApprovalRules.Effective(approved,cheque,plan.Current!.Version)));}
        if(cheques.Items.Length>items.Count||cheques.Items.Any(x=>!items.Any(i=>i.Cheque?.Id==x.Id)))throw ChequeApprovalRules.Unavailable();return new(1,order,s.OrderVersion,s.State,plan.Current?.Version,items.ToArray(),items.Count>0&&items.All(x=>x.ApprovedForCurrentCheque));
    }
    public async Task<ChequeApprovalDetail> DetailAsync(string owner,string order,string cheque,CancellationToken ct,bool writable)
    {
        CreditApplicationRules.Id(cheque);var s=await Source(owner,order,ct);var page=await PageAsync(owner,order,ct);var item=page.Items.SingleOrDefault(x=>x.Cheque?.Id==cheque)??throw CreditApplicationRules.Missing();var detail=await ledger.DetailAsync(owner,order,cheque,false,ct);var h=await Verified(owner,order,cheque,ct);var current=h.Events.LastOrDefault();bool open=Open(s,clock.GetUtcNow()),capacity=h.Events.Length<200;return new(1,item,detail.InstrumentReference,current,writable&&open&&capacity&&ChequeApprovalRules.Eligible(detail.Cheque.State)&&!item.ApprovedForCurrentCheque,writable&&capacity&&current?.Summary.State=="Approved"&&s.State is "AwaitingPayment"or"CreditApproved"or"Expired"or"Cancelled",!open);
    }
    public async Task<ChequeApprovalHistory> HistoryAsync(string owner,string order,string cheque,int? before,CancellationToken ct)
    {
        if(before is<=0 or>200)throw ChequeApprovalRules.Invalid();await Source(owner,order,ct);await ledger.DetailAsync(owner,order,cheque,false,ct);var h=await Verified(owner,order,cheque,ct);var events=h.Events.Reverse().Where(x=>before is null||x.Summary.Sequence<before).Take(21).ToArray();return new(1,order,cheque,events.Take(20).ToArray(),events.Length>20?events[19].Summary.Sequence:null);
    }
    public async Task<ChequeApprovalResult> WriteAsync(string actor,string owner,string order,string cheque,string command,ChequeApprovalInput input,CancellationToken ct)
    {
        actor=CreditApplicationRules.Actor(actor);owner=CreditApplicationRules.Actor(owner);CreditApplicationRules.Id(cheque);CreditApplicationRules.Id(command);ChequeApprovalRules.Validate(input);var s=await Source(owner,order,ct);await Gate(actor,command,ct);var hash=Hash(Json(new{Contract="Sayman.Credit.ChequeApproval.v1",Owner=owner,OrderId=order,ChequeId=cheque,Input=input}));var prior=await db.ChequeApprovalCommands.FromSqlInterpolated($"SELECT * FROM [credit].[ChequeApprovalCommands] WITH (READCOMMITTEDLOCK) WHERE [ActorId]={actor} AND [CommandId]={command}").AsNoTracking().SingleOrDefaultAsync(ct);
        if(prior is not null){if(prior.OwnerId!=owner||prior.OrderId!=order||prior.ChequeId!=cheque||prior.PayloadHash!=hash)throw new BusinessException("cheque_approval_idempotency_conflict","This approval command has different input.");return Receipt(prior)with{Replayed=true};}
        var detail=await DetailAsync(owner,order,cheque,ct,true);var plan=await schedules.PageAsync(owner,order,false,ct);var h=await Verified(owner,order,cheque,ct);var old=h.Events.LastOrDefault();var chequeDetail=await ledger.DetailAsync(owner,order,cheque,false,ct);
        if(s.OrderVersion!=input.OrderVersion||plan.Current?.Version!=input.ScheduleVersion||detail.Item.Cheque!.Version!=input.LedgerVersion||old?.Summary.Version!=input.Version||h.Events.Length>=200||input.Action=="Approve"&&!detail.CanApprove||input.Action=="Revoke"&&(!detail.CanRevoke||detail.ClosedOrderAcknowledgementRequired&&!input.AcknowledgedClosedOrder))throw ChequeApprovalRules.Conflict();
        var at=clock.GetUtcNow().ToUniversalTime();ChequeLedgerRules.Time(input.OccurredAt,old?.Summary.OccurredAt??chequeDetail.Cheque.RecordedAt,at);if(old is not null&&at<old.Summary.RecordedAt)throw ChequeApprovalRules.Conflict();
        var origin=h.Head;if(origin is null){origin=new(){OwnerId=owner,OrderId=order,ChequeId=cheque,ScheduleId=plan.Current!.Id,ActorId=actor,RecordedAt=at};origin.ProtectedOrigin=protection.Protect("origin",owner,order,origin.Id,Json(new Origin(origin.Id,owner,order,cheque,origin.ScheduleId,actor,at)));db.ChequeApprovals.Add(origin);}
        var e=new ChequeApprovalEvent{ApprovalId=origin.Id,OrderId=order,ChequeId=cheque,LedgerEventId=chequeDetail.Current.Id,Sequence=h.Events.Length+1,Action=input.Action,State=input.Action=="Approve"?"Approved":"Revoked",ActorId=actor,OccurredAt=input.OccurredAt,RecordedAt=at};e.ProtectedEvent=protection.Protect("event",owner,order,e.Id,Json(new EventSeal(e.Id,origin.Id,order,cheque,e.LedgerEventId,e.Sequence,e.Action,e.State,actor,input.OrderVersion,input.ScheduleVersion,input.LedgerVersion,input.Note,input.Version,input.AcknowledgedClosedOrder,input.OccurredAt,at)));db.ChequeApprovalEvents.Add(e);await db.SaveChangesAsync(ct);
        var data=new ChequeApprovalEventData(new(e.Id,origin.Id,order,cheque,e.Sequence,e.Action,e.State,Version(e),input.OrderVersion,input.ScheduleVersion,input.LedgerVersion,input.OccurredAt,at),input.Note,input.Version,input.AcknowledgedClosedOrder);var result=new ChequeApprovalResult(1,command,order,cheque,data,false);var raw=Json(result);db.ChequeApprovalCommands.Add(new(){ActorId=actor,CommandId=command,OwnerId=owner,OrderId=order,ChequeId=cheque,ApprovalId=origin.Id,EventId=e.Id,PayloadHash=hash,ResultHash=Hash(raw),ProtectedResult=protection.Protect("receipt",actor,order,command,raw),At=at});await db.SaveChangesAsync(ct);await EnsureCommitAsync(owner,order,cheque,input,ct);return result;
    }
    public async Task EnsureCommitAsync(string owner,string order,string cheque,ChequeApprovalInput input,CancellationToken ct)
    {
        var s=await Source(owner,order,ct);var plan=await schedules.PageAsync(owner,order,false,ct);var detail=await ledger.DetailAsync(owner,order,cheque,false,ct);if(s.OrderVersion!=input.OrderVersion||plan.Current?.Version!=input.ScheduleVersion||detail.Cheque.Version!=input.LedgerVersion||input.Action=="Approve"&&(!Open(s,clock.GetUtcNow())||!ChequeApprovalRules.Eligible(detail.Cheque.State))||input.Action=="Revoke"&&(s.State is not("AwaitingPayment"or"CreditApproved"or"Cancelled"or"Expired")||!Open(s,clock.GetUtcNow())&&!input.AcknowledgedClosedOrder))throw ChequeApprovalRules.Conflict();
    }
    public async Task<ChequeApprovalResult> ReceiptAsync(string actor,string owner,string order,string cheque,string cmd,CancellationToken ct)
    {
        actor=CreditApplicationRules.Actor(actor);owner=CreditApplicationRules.Actor(owner);foreach(var id in new[]{order,cheque,cmd})CreditApplicationRules.Id(id);var c=await db.ChequeApprovalCommands.AsNoTracking().SingleOrDefaultAsync(x=>x.ActorId==actor&&x.CommandId==cmd&&x.OwnerId==owner&&x.OrderId==order&&x.ChequeId==cheque,ct)??throw CreditApplicationRules.Missing();return Receipt(c)with{Replayed=true};
    }
    private async Task Gate(string actor,string cmd,CancellationToken ct)
    {
        Root();await using var c=db.Database.GetDbConnection().CreateCommand();c.Transaction=db.Database.CurrentTransaction!.GetDbTransaction();c.CommandTimeout=15;c.CommandText="DECLARE @r int; EXEC @r=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @r;";var p=c.CreateParameter();p.ParameterName="@resource";p.Value="sayman:credit:cheque-approval:v1:"+Hash(actor+":"+cmd);c.Parameters.Add(p);if(Convert.ToInt32(await c.ExecuteScalarAsync(ct),CultureInfo.InvariantCulture)<0)throw new BusinessException("cheque_approval_busy","Retry this same manual cheque approval command.");
    }
}
