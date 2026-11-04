using System.Data;
using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;
namespace Shop.Modules.Credit;

public sealed class ChequeLedgerService(CreditDbContext db,CreditScheduleService schedules,ICreditOrderScheduleSource sourceReader,IChequeLedgerProtection protection,TimeProvider clock)
{
    private sealed record Registration(string Id,string OwnerId,string OrderId,string ScheduleId,int Sequence,string DueDate,string AmountRial,string ActorId,DateTimeOffset RecordedAt,string InstrumentReference,string Note);
    private sealed record EventSeal(string Id,string ChequeId,int Sequence,string Action,string State,string ActorId,DateTimeOffset OccurredAt,DateTimeOffset RecordedAt,string Note,[property:System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.Never)]string? PreviousVersion);
    private static string Json<T>(T value)=>JsonSerializer.Serialize(value,CreditScheduleFacts.Json);
    private static string Version(ChequeLedgerEvent e)=>Convert.ToBase64String(e.Version);
    private static string Date(DateOnly d)=>d.ToString("yyyy-MM-dd",CultureInfo.InvariantCulture);
    private static string Internal(string id)=>"CH-"+id.ToUpperInvariant();
    private static string Digest(string text)=>CreditApplicationRules.Hash(text);
    private T Decode<T>(string purpose,string principal,string order,string id,byte[] bytes)
    {
        try{return JsonSerializer.Deserialize<T>(protection.Unprotect(purpose,principal,order,id,bytes),CreditScheduleFacts.Json)??throw ChequeLedgerRules.Unavailable();}
        catch(Exception e)when(e is JsonException or NullReferenceException){throw ChequeLedgerRules.Unavailable();}
    }
    private Registration OpenRegistration(ReceivedCheque c)
    {
        var r=Decode<Registration>("registration",c.OwnerId,c.OrderId,c.Id,c.ProtectedRegistration);
        if(r.Id!=c.Id||r.OwnerId!=c.OwnerId||r.OrderId!=c.OrderId||r.ScheduleId!=c.ScheduleId||r.Sequence!=c.Sequence||r.DueDate!=Date(c.DueDate)||r.AmountRial!=ChequeLedgerRules.Rial(c.AmountRial)||r.ActorId!=c.ActorId||r.RecordedAt!=c.RecordedAt)throw ChequeLedgerRules.Unavailable();
        ChequeLedgerRules.Text(r.InstrumentReference,128,true);ChequeLedgerRules.Text(r.Note,500);return r;
    }
    private ChequeSummary Summary(ReceivedCheque c,ChequeLedgerEvent e)=>new(c.Id,Internal(c.Id),c.OrderId,c.ScheduleId,c.Sequence,Date(c.DueDate),ChequeLedgerRules.Rial(c.AmountRial),e.State,Version(e),e.OccurredAt,e.RecordedAt);
    private ChequeEventData Data(ReceivedCheque c,ChequeLedgerEvent e)
    {
        var s=Decode<EventSeal>("event",c.OwnerId,c.OrderId,e.Id,e.ProtectedEvent);
        if(s.Id!=e.Id||s.ChequeId!=c.Id||e.ChequeId!=c.Id||s.Sequence!=e.Sequence||s.Action!=e.Action||s.State!=e.State||s.ActorId!=e.ActorId||s.OccurredAt!=e.OccurredAt||s.RecordedAt!=e.RecordedAt||e.RecordedAt<c.RecordedAt||e.Sequence==1&&(s.PreviousVersion is not null||e.Action!="Receive"||e.State!="Received")||e.Sequence>1&&s.PreviousVersion is null)throw ChequeLedgerRules.Unavailable();
        ChequeLedgerRules.Text(s.Note,500,e.Sequence>1);if(s.PreviousVersion is{}v)CreditApplicationRules.Version(v);
        return new(e.Id,c.Id,e.Sequence,e.Action,e.State,Version(e),e.OccurredAt,e.RecordedAt,s.Note);
    }
    private ChequeCommandResult Receipt(ChequeLedgerCommand c)
    {
        var raw=protection.Unprotect("receipt",c.ActorId,c.OrderId,c.CommandId,c.ProtectedResult);
        try{
            if(Digest(raw)!=c.ResultHash)throw ChequeLedgerRules.Unavailable();var result=JsonSerializer.Deserialize<ChequeCommandResult>(raw,CreditScheduleFacts.Json)??throw ChequeLedgerRules.Unavailable();
            if(result.SchemaVersion!=1||result.Replayed||result.CommandId!=c.CommandId||result.Cheque.Id!=c.ChequeId||result.Cheque.OrderId!=c.OrderId||result.Event.Id!=c.EventId||result.Event.ChequeId!=c.ChequeId||result.Event.RecordedAt!=c.At||result.Cheque.Version!=result.Event.Version||result.Cheque.State!=result.Event.State||result.Cheque.RecordedAt!=c.At||result.Cheque.BankVerified||result.Event.BankVerified||result.CanPay||result.CanFulfill)throw ChequeLedgerRules.Unavailable();return result;
        }catch(Exception e)when(e is JsonException or NullReferenceException){throw ChequeLedgerRules.Unavailable();}
    }
    private ChequeEventData VerifyEvent(ReceivedCheque c,ChequeLedgerEvent e,ChequeLedgerCommand command)
    {
        var data=Data(c,e);var receipt=Receipt(command);
        if(command.OwnerId!=c.OwnerId||command.OrderId!=c.OrderId||command.ChequeId!=c.Id||command.ActorId!=e.ActorId||command.At!=e.RecordedAt||Json(receipt.Event)!=Json(data)||Json(receipt.Cheque)!=Json(Summary(c,e)))throw ChequeLedgerRules.Unavailable();return data;
    }
    private async Task<ChequeEventData> VerifiedEvent(ReceivedCheque c,ChequeLedgerEvent e,CancellationToken ct)=>VerifyEvent(c,e,await db.ChequeLedgerCommands.AsNoTracking().SingleOrDefaultAsync(x=>x.EventId==e.Id,ct)??throw ChequeLedgerRules.Unavailable());
    private async Task<CreditOrderScheduleSource> Source(string owner,string order,CancellationToken ct)
    {
        Root();owner=CreditApplicationRules.Actor(owner);CreditApplicationRules.Id(order);
        // Schedule reads verify the original scope-use and financial seal under the Sales owner gate.
        await schedules.PageAsync(owner,order,false,ct);var s=await sourceReader.LockAndReadAsync(owner,order,ct);
        if(s.OwnerId!=owner||s.OrderId!=order)throw ChequeLedgerRules.Unavailable();return s;
    }
    private IQueryable<ReceivedCheque> Cheques(string order)=>db.ReceivedCheques.FromSqlInterpolated($"SELECT * FROM [credit].[ReceivedCheques] WITH (READCOMMITTEDLOCK) WHERE [OrderId]={order}").AsNoTracking();
    private IQueryable<ChequeLedgerEvent> Events(string cheque)=>db.ChequeLedgerEvents.FromSqlInterpolated($"SELECT * FROM [credit].[ChequeLedgerEvents] WITH (READCOMMITTEDLOCK) WHERE [ChequeId]={cheque}").AsNoTracking();
    private async Task<ChequeLedgerEvent> Head(string cheque,CancellationToken ct)=>await Events(cheque).OrderByDescending(x=>x.Sequence).FirstOrDefaultAsync(ct)??throw ChequeLedgerRules.Unavailable();
    private static bool Open(CreditOrderScheduleSource s,DateTimeOffset now)=>s.State=="AwaitingPayment"&&s.ExpiresAt>now;
    private static void RequireOpen(CreditOrderScheduleSource s,string version,DateTimeOffset now){if(!Open(s,now)||s.OrderVersion!=version)throw ChequeLedgerRules.Conflict();}
    public async Task<ChequeLedgerPage> PageAsync(string owner,string order,bool writable,CancellationToken ct)
    {
        var s=await Source(owner,order,ct);var schedule=await schedules.PageAsync(owner,order,false,ct);var rows=await Cheques(order).OrderBy(x=>x.Sequence).Take(61).ToArrayAsync(ct);if(rows.Length>60)throw ChequeLedgerRules.Unavailable();var items=new List<ChequeSummary>();
        if(rows.Length>0){
            var ids=rows.Select(x=>x.Id).ToArray();var heads=await db.ChequeLedgerEvents.AsNoTracking().Where(x=>ids.Contains(x.ChequeId)).GroupBy(x=>x.ChequeId).Select(g=>g.OrderByDescending(x=>x.Sequence).First()).ToArrayAsync(ct);var eventIds=heads.Select(x=>x.Id).ToArray();var commands=await db.ChequeLedgerCommands.AsNoTracking().Where(x=>eventIds.Contains(x.EventId)).ToArrayAsync(ct);
            foreach(var c in rows){OpenRegistration(c);var head=heads.SingleOrDefault(x=>x.ChequeId==c.Id)??throw ChequeLedgerRules.Unavailable();var command=commands.SingleOrDefault(x=>x.EventId==head.Id)??throw ChequeLedgerRules.Unavailable();VerifyEvent(c,head,command);items.Add(Summary(c,head));}
        }
        return new(1,order,s.OrderVersion,s.State,schedule.Current?.Version,writable&&Open(s,clock.GetUtcNow())&&schedule.Current is not null&&items.Count<schedule.Current.Calculation.Lines.Length,items.Count>0,items.ToArray());
    }
    public async Task<ChequeDetail> DetailAsync(string owner,string order,string chequeId,bool writable,CancellationToken ct)
    {
        var s=await Source(owner,order,ct);var c=await Find(owner,order,chequeId,ct);var registration=OpenRegistration(c);var head=await Head(c.Id,ct);var data=await VerifiedEvent(c,head,ct);
        return new(1,Summary(c,head),registration.InstrumentReference,registration.Note,data,writable&&head.Sequence<ChequeLedgerRules.MaxEvents?ChequeLedgerRules.Actions(head.State):[],!Open(s,clock.GetUtcNow()));
    }
    public async Task<ChequeHistoryPage> HistoryAsync(string owner,string order,string chequeId,int? before,CancellationToken ct)
    {
        if(before is <=0 or >200)throw ChequeLedgerRules.Invalid();await Source(owner,order,ct);var c=await Find(owner,order,chequeId,ct);OpenRegistration(c);
        var rows=await Events(c.Id).Where(x=>before==null||x.Sequence<before).OrderByDescending(x=>x.Sequence).Take(21).ToArrayAsync(ct);var items=new List<ChequeEventData>();foreach(var e in rows.Take(20))items.Add(await VerifiedEvent(c,e,ct));return new(1,c.Id,items.ToArray(),rows.Length>20?items[^1].Sequence:null);
    }
    public async Task<ChequeCommandResult> ReceiveAsync(string actor,string owner,string order,string commandId,ReceiveChequeInput input,CancellationToken ct)
    {
        actor=CreditApplicationRules.Actor(actor);owner=CreditApplicationRules.Actor(owner);ChequeLedgerRules.Receive(input);var prior=await Begin(actor,owner,order,commandId,"receive",input,ct);if(prior.Result is{}old)return old;
        var s=await Source(owner,order,ct);RequireOpen(s,input.OrderVersion,clock.GetUtcNow());var schedule=await schedules.PageAsync(owner,order,false,ct);var current=schedule.Current;
        if(current is null||current.Version!=input.ScheduleVersion)throw ChequeLedgerRules.Conflict();var line=current.Calculation.Lines.SingleOrDefault(x=>x.Sequence==input.Sequence)??throw ChequeLedgerRules.Conflict();if(await Cheques(order).AnyAsync(x=>x.Sequence==input.Sequence,ct))throw ChequeLedgerRules.Conflict();var at=clock.GetUtcNow().ToUniversalTime();ChequeLedgerRules.Time(input.OccurredAt,current.CreatedAt,at);
        var c=new ReceivedCheque{OwnerId=owner,OrderId=order,ScheduleId=current.Id,Sequence=line.Sequence,DueDate=CreditScheduleRules.Date(line.DueDate),AmountRial=long.Parse(line.AmountRial,CultureInfo.InvariantCulture),ActorId=actor,RecordedAt=at};var registration=new Registration(c.Id,owner,order,c.ScheduleId,c.Sequence,Date(c.DueDate),ChequeLedgerRules.Rial(c.AmountRial),actor,at,input.InstrumentReference,input.Note);c.ProtectedRegistration=protection.Protect("registration",owner,order,c.Id,Json(registration));db.ReceivedCheques.Add(c);
        var e=NewEvent(c,actor,1,"Receive","Received",input.OccurredAt,at,input.Note,null);db.ChequeLedgerEvents.Add(e);await db.SaveChangesAsync(ct);RequireOpen(s,input.OrderVersion,clock.GetUtcNow());return await Complete(actor,owner,order,commandId,prior.Hash,c,e,ct);
    }
    public async Task<ChequeCommandResult> MoveAsync(string actor,string owner,string order,string chequeId,string commandId,MoveChequeInput input,CancellationToken ct)
    {
        actor=CreditApplicationRules.Actor(actor);owner=CreditApplicationRules.Actor(owner);ChequeLedgerRules.Move(input);CreditApplicationRules.Id(chequeId);var prior=await Begin(actor,owner,order,commandId,"move:"+chequeId,input,ct);if(prior.Result is{}old)return old;
        var s=await Source(owner,order,ct);if(!Open(s,clock.GetUtcNow())&&!input.AcknowledgedClosedOrder)throw ChequeLedgerRules.Conflict();var c=await Find(owner,order,chequeId,ct);OpenRegistration(c);var head=await Head(chequeId,ct);await VerifiedEvent(c,head,ct);
        if(Version(head)!=input.Version||head.Sequence>=ChequeLedgerRules.MaxEvents)throw ChequeLedgerRules.Conflict();var next=ChequeLedgerRules.Next(head.State,input.Action);var at=clock.GetUtcNow().ToUniversalTime();if(at<head.RecordedAt)throw ChequeLedgerRules.Conflict();ChequeLedgerRules.Time(input.OccurredAt,head.OccurredAt,at);
        var e=NewEvent(c,actor,head.Sequence+1,input.Action,next,input.OccurredAt,at,input.Note,Version(head));db.ChequeLedgerEvents.Add(e);await db.SaveChangesAsync(ct);return await Complete(actor,owner,order,commandId,prior.Hash,c,e,ct);
    }
    public async Task EnsureReceiveCommit(string owner,string order,string version,CancellationToken ct)=>RequireOpen(await Source(owner,order,ct),version,clock.GetUtcNow());
    public async Task EnsureMoveCommit(string owner,string order,bool acknowledged,CancellationToken ct){var s=await Source(owner,order,ct);if(!Open(s,clock.GetUtcNow())&&!acknowledged)throw ChequeLedgerRules.Conflict();}
    public async Task<ChequeCommandResult> ReceiptAsync(string actor,string owner,string order,string cmd,CancellationToken ct)
    {
        actor=CreditApplicationRules.Actor(actor);owner=CreditApplicationRules.Actor(owner);CreditApplicationRules.Id(order);CreditApplicationRules.Id(cmd);
        var c=await db.ChequeLedgerCommands.AsNoTracking().SingleOrDefaultAsync(x=>x.ActorId==actor&&x.CommandId==cmd&&x.OwnerId==owner&&x.OrderId==order,ct)??throw CreditApplicationRules.Missing();return Receipt(c)with{Replayed=true};
    }
    private async Task<ReceivedCheque> Find(string owner,string order,string chequeId,CancellationToken ct)
    {
        owner=CreditApplicationRules.Actor(owner);CreditApplicationRules.Id(chequeId);var c=await Cheques(order).SingleOrDefaultAsync(x=>x.Id==chequeId&&x.OwnerId==owner,ct)??throw CreditApplicationRules.Missing();return c;
    }
    private ChequeLedgerEvent NewEvent(ReceivedCheque c,string actor,int seq,string action,string state,DateTimeOffset occurred,DateTimeOffset at,string note,string? previous)
    {
        var e=new ChequeLedgerEvent{ChequeId=c.Id,Sequence=seq,Action=action,State=state,ActorId=actor,OccurredAt=occurred,RecordedAt=at};e.ProtectedEvent=protection.Protect("event",c.OwnerId,c.OrderId,e.Id,Json(new EventSeal(e.Id,c.Id,seq,action,state,actor,occurred,at,note,previous)));return e;
    }
    private async Task<(string Hash,ChequeCommandResult? Result)> Begin<T>(string actor,string owner,string order,string cmd,string kind,T input,CancellationToken ct)
    {
        Root();if(actor!=CreditApplicationRules.Actor(actor)||owner!=CreditApplicationRules.Actor(owner))throw ChequeLedgerRules.Invalid();CreditApplicationRules.Id(order);CreditApplicationRules.Id(cmd);
        await using var command=db.Database.GetDbConnection().CreateCommand();command.Transaction=db.Database.CurrentTransaction!.GetDbTransaction();command.CommandTimeout=15;command.CommandText="DECLARE @r int; EXEC @r=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @r;";var p=command.CreateParameter();p.ParameterName="@resource";p.Value="sayman:credit:cheque-command:v1:"+Digest(actor+":"+cmd);command.Parameters.Add(p);if(Convert.ToInt32(await command.ExecuteScalarAsync(ct),CultureInfo.InvariantCulture)<0)throw new BusinessException("cheque_ledger_busy","Retry this same cheque command.");
        var hash=Digest(Json(new{Contract="Sayman.Credit.ChequeCommand.v1",Owner=owner,OrderId=order,Kind=kind,Input=input}));var prior=await db.ChequeLedgerCommands.FromSqlInterpolated($"SELECT * FROM [credit].[ChequeLedgerCommands] WITH (READCOMMITTEDLOCK) WHERE [ActorId]={actor} AND [CommandId]={cmd}").AsNoTracking().SingleOrDefaultAsync(ct);
        if(prior is null)return(hash,null);if(prior.OwnerId!=owner||prior.OrderId!=order||prior.PayloadHash!=hash)throw new BusinessException("cheque_ledger_idempotency_conflict","This cheque command has different input.");return(hash,Receipt(prior)with{Replayed=true});
    }
    private async Task<ChequeCommandResult> Complete(string actor,string owner,string order,string cmd,string hash,ReceivedCheque c,ChequeLedgerEvent e,CancellationToken ct)
    {
        var result=new ChequeCommandResult(1,false,cmd,Summary(c,e),Data(c,e));var raw=Json(result);
        db.ChequeLedgerCommands.Add(new(){ActorId=actor,CommandId=cmd,OwnerId=owner,OrderId=order,ChequeId=c.Id,EventId=e.Id,PayloadHash=hash,ResultHash=Digest(raw),ProtectedResult=protection.Protect("receipt",actor,order,cmd,raw),At=e.RecordedAt});await db.SaveChangesAsync(ct);return result;
    }
    private void Root(){if(db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel!=IsolationLevel.Serializable)throw new InvalidOperationException("Cheque custody requires the audited root Sales/Credit Serializable transaction.");}
}
