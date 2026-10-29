using System.Data;
using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;
namespace Shop.Modules.Credit;

public sealed class CreditReminderService(CreditDbContext db,ChequeLedgerService ledger,ICreditOrderScheduleSource orders,ICreditReminderProtection protection,ICreditReminderNotificationWriter notifications,TimeProvider clock)
{
    private sealed record Seal(string OwnerId,string ActorId,CreditReminderEventData Event);
    private static string Json<T>(T value)=>JsonSerializer.Serialize(value,CreditScheduleFacts.Json);
    private static string Hash(string text)=>CreditApplicationRules.Hash(text);
    private static string Day(DateOnly day)=>day.ToString("yyyy-MM-dd",CultureInfo.InvariantCulture);
    private void Root(){if(db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel!=IsolationLevel.Serializable)throw new InvalidOperationException("Credit reminders require the audited shared Sales/Credit/Notifications Serializable transaction.");}
    private IQueryable<CreditReminderEvent> Events(string cheque)=>db.ReminderEvents.FromSqlInterpolated($"SELECT * FROM [credit].[ReminderEvents] WITH (READCOMMITTEDLOCK) WHERE [ChequeId]={cheque}").AsNoTracking();
    private T Decode<T>(string purpose,string principal,string order,string id,byte[] data)
    {
        try{return JsonSerializer.Deserialize<T>(protection.Unprotect(purpose,principal,order,id,data),CreditScheduleFacts.Json)??throw CreditReminderRules.Unavailable();}catch(Exception e)when(e is JsonException or NullReferenceException){throw CreditReminderRules.Unavailable();}
    }
    private CreditReminderEventData Data(CreditReminderEvent e)
    {
        var seal=Decode<Seal>("event",e.OwnerId,e.OrderId,e.Id,e.ProtectedEvent);var data=seal.Event;var s=data.Summary;
        if(seal.OwnerId!=e.OwnerId||seal.ActorId!=e.ActorId||s.Id!=e.Id||s.OrderId!=e.OrderId||s.ChequeId!=e.ChequeId||s.Sequence!=e.Sequence||s.CivilDay!=Day(e.CivilDay)||s.At!=e.At||s.CivilDay!=ChequeReportRules.Today(s.At)||s.Sequence is<1 or>CreditReminderRules.MaxEvents||!ChequeReportRules.Held(s.LedgerState))throw CreditReminderRules.Unavailable();CreditApplicationRules.Version(s.LedgerVersion);CreditApplicationRules.Version(s.OrderVersion);CreditApplicationRules.Digest(s.PreviewFingerprint);CreditReminderRules.Day(s.DueDate);ChequeLedgerRules.Text(data.Note,500,true);if(!long.TryParse(s.AmountRial,NumberStyles.None,CultureInfo.InvariantCulture,out var amount)||amount<=0||amount.ToString(CultureInfo.InvariantCulture)!=s.AmountRial)throw CreditReminderRules.Unavailable();return data;
    }
    private CreditReminderResult Receipt(CreditReminderCommand command)
    {
        var raw=protection.Unprotect("receipt",command.ActorId,command.OrderId,command.CommandId,command.ProtectedResult);
        try{if(Hash(raw)!=command.ResultHash)throw CreditReminderRules.Unavailable();var r=JsonSerializer.Deserialize<CreditReminderResult>(raw,CreditScheduleFacts.Json)??throw CreditReminderRules.Unavailable();if(r.SchemaVersion!=1||r.Replayed||r.CommandId!=command.CommandId||r.Event.Summary.Id!=command.EventId||r.Event.Summary.OrderId!=command.OrderId||r.Event.Summary.ChequeId!=command.ChequeId||r.Event.Summary.At!=command.At||r.BankVerified||r.CanPay||r.CanFulfill)throw CreditReminderRules.Unavailable();CreditApplicationRules.Version(r.Event.Summary.OrderVersion);CreditApplicationRules.Digest(r.Event.Summary.PreviewFingerprint);return r;}catch(Exception e)when(e is JsonException or NullReferenceException){throw CreditReminderRules.Unavailable();}
    }
    private async Task<CreditReminderEventData> Verified(CreditReminderEvent e,CancellationToken ct)
    {
        var data=Data(e);var c=await db.ReminderCommands.AsNoTracking().SingleOrDefaultAsync(x=>x.EventId==e.Id,ct)??throw CreditReminderRules.Unavailable();var r=Receipt(c);if(c.OwnerId!=e.OwnerId||c.OrderId!=e.OrderId||c.ChequeId!=e.ChequeId||c.ActorId!=e.ActorId||c.At!=e.At||Json(r.Event)!=Json(data))throw CreditReminderRules.Unavailable();return data;
    }
    private async Task<CreditOrderScheduleSource> Source(string owner,string order,CancellationToken ct)
    {
        Root();owner=CreditApplicationRules.Actor(owner);CreditApplicationRules.Id(order);var s=await orders.LockAndReadAsync(owner,order,ct);if(s.OwnerId!=owner||s.OrderId!=order)throw CreditReminderRules.Unavailable();return s;
    }
    private static string Fingerprint(CreditOrderScheduleSource s,ChequeSummary c,string today,int? sequence)=>Hash(Json(new{Contract="Sayman.Credit.PrivateChequeReminder.v1",s.OwnerId,s.OrderId,s.OrderVersion,s.State,s.CreditQuoteId,s.QuoteFingerprint,Cheque=c,Today=today,NextSequence=sequence}));
    public async Task<CreditReminderPage> PageAsync(string owner,string order,string cheque,bool writable,CancellationToken ct)
    {
        owner=CreditApplicationRules.Actor(owner);CreditApplicationRules.Id(cheque);var s=await Source(owner,order,ct);var detail=await ledger.DetailAsync(owner,order,cheque,false,ct);var now=clock.GetUtcNow();var day=ChequeReportRules.Today(now);var date=ChequeReportRules.Date(day);var sent=await Events(cheque).SingleOrDefaultAsync(x=>x.CivilDay==date,ct);var head=await Events(cheque).OrderByDescending(x=>x.Sequence).FirstOrDefaultAsync(ct);if(head is not null)await Verified(head,ct);var current=sent is null?null:(await Verified(sent,ct)).Summary;
        int? sequence=(head?.Sequence??0)<CreditReminderRules.MaxEvents?(head?.Sequence??0)+1:null;return new(1,order,s.OrderVersion,s.State,detail.Cheque,day,Fingerprint(s,detail.Cheque,day,sequence),sequence,writable&&current is null&&(head is null||now>=head.At)&&(head?.Sequence??0)<CreditReminderRules.MaxEvents&&CreditReminderRules.Eligible(s.State,detail.Cheque.State),current);
    }
    public async Task<CreditReminderHistory> HistoryAsync(string owner,string order,string cheque,int? before,CancellationToken ct)
    {
        if(before is<=0 or>CreditReminderRules.MaxEvents)throw CreditReminderRules.Invalid();await Source(owner,order,ct);await ledger.DetailAsync(owner,order,cheque,false,ct);var rows=await Events(cheque).Where(x=>before==null||x.Sequence<before).OrderByDescending(x=>x.Sequence).Take(21).ToArrayAsync(ct);var result=new List<CreditReminderEventData>();foreach(var row in rows.Take(20))result.Add(await Verified(row,ct));return new(1,order,cheque,result.ToArray(),rows.Length>20?result[^1].Summary.Sequence:null);
    }
    private async Task CommandGate(string actor,string command,CancellationToken ct)
    {
        await using var c=db.Database.GetDbConnection().CreateCommand();c.Transaction=db.Database.CurrentTransaction!.GetDbTransaction();c.CommandTimeout=15;c.CommandText="DECLARE @r int;EXEC @r=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;SELECT @r;";var p=c.CreateParameter();p.ParameterName="@resource";p.Value="sayman:credit:reminder-command:v1:"+Hash(actor+":"+command);c.Parameters.Add(p);if(Convert.ToInt32(await c.ExecuteScalarAsync(ct),CultureInfo.InvariantCulture)<0)throw new BusinessException("credit_reminder_busy","Retry the same reminder command.");
    }
    public async Task<CreditReminderResult> SendAsync(string actor,string owner,string order,string cheque,string command,CreditReminderInput input,CancellationToken ct)
    {
        Root();actor=CreditApplicationRules.Actor(actor);owner=CreditApplicationRules.Actor(owner);foreach(var id in new[]{order,cheque,command})CreditApplicationRules.Id(id);CreditReminderRules.Validate(input);var s=await Source(owner,order,ct);await CommandGate(actor,command,ct);var hash=Hash(Json(new{Contract="Sayman.Credit.ChequeReminderCommand.v1",OwnerId=owner,OrderId=order,ChequeId=cheque,Input=input}));var prior=await db.ReminderCommands.FromSqlInterpolated($"SELECT * FROM [credit].[ReminderCommands] WITH (READCOMMITTEDLOCK) WHERE [ActorId]={actor} AND [CommandId]={command}").AsNoTracking().SingleOrDefaultAsync(ct);
        if(prior is not null){if(prior.OwnerId!=owner||prior.OrderId!=order||prior.ChequeId!=cheque||prior.PayloadHash!=hash)throw new BusinessException("credit_reminder_idempotency_conflict","This reminder command has different input.");return Receipt(prior)with{Replayed=true};}
        var c=(await ledger.DetailAsync(owner,order,cheque,false,ct)).Cheque;var now=clock.GetUtcNow().ToUniversalTime();var today=ChequeReportRules.Today(now);var date=ChequeReportRules.Date(today);if(!CreditReminderRules.Eligible(s.State,c.State)||s.OrderVersion!=input.OrderVersion||c.Version!=input.LedgerVersion)throw CreditReminderRules.Conflict();if(await Events(cheque).AnyAsync(x=>x.CivilDay==date,ct))throw new BusinessException("credit_reminder_daily_conflict","This cheque already has an internal reminder on this Tehran civil day.");var head=await Events(cheque).OrderByDescending(x=>x.Sequence).FirstOrDefaultAsync(ct);if(head is not null){await Verified(head,ct);if(now<head.At)throw CreditReminderRules.Conflict();}var seq=(head?.Sequence??0)+1;if(seq>CreditReminderRules.MaxEvents||Fingerprint(s,c,today,seq)!=input.PreviewFingerprint)throw CreditReminderRules.Conflict();
        var e=new CreditReminderEvent{OwnerId=owner,OrderId=order,ChequeId=cheque,Sequence=seq,CivilDay=date,ActorId=actor,At=now};var summary=new CreditReminderSummary(e.Id,order,cheque,seq,today,c.DueDate,c.AmountRial,c.State,c.Version,s.OrderVersion,input.PreviewFingerprint,now);var data=new CreditReminderEventData(summary,input.Note);e.ProtectedEvent=protection.Protect("event",owner,order,e.Id,Json(new Seal(owner,actor,data)));db.ReminderEvents.Add(e);await db.SaveChangesAsync(ct);await notifications.RecordAsync(new(e.Id,owner,order,cheque,c.DueDate,c.AmountRial,today,now),ct);
        var result=new CreditReminderResult(1,false,command,data);var raw=Json(result);db.ReminderCommands.Add(new(){ActorId=actor,CommandId=command,OwnerId=owner,OrderId=order,ChequeId=cheque,EventId=e.Id,PayloadHash=hash,ResultHash=Hash(raw),At=now,ProtectedResult=protection.Protect("receipt",actor,order,command,raw)});await db.SaveChangesAsync(ct);return result;
    }
    public async Task EnsureCommitAsync(string owner,string order,string cheque,CreditReminderInput input,CreditReminderResult result,CancellationToken ct)
    {
        if(result.Replayed)return;var s=await Source(owner,order,ct);var c=(await ledger.DetailAsync(owner,order,cheque,false,ct)).Cheque;var now=clock.GetUtcNow();var today=ChequeReportRules.Today(now);if(now<result.Event.Summary.At||result.Event.Summary.CivilDay!=today||!CreditReminderRules.Eligible(s.State,c.State)||s.OrderVersion!=input.OrderVersion||c.Version!=input.LedgerVersion||Fingerprint(s,c,today,result.Event.Summary.Sequence)!=input.PreviewFingerprint)throw CreditReminderRules.Conflict();
    }
    public async Task<CreditReminderResult> ReceiptAsync(string actor,string owner,string order,string cheque,string command,CancellationToken ct)
    {
        actor=CreditApplicationRules.Actor(actor);owner=CreditApplicationRules.Actor(owner);foreach(var id in new[]{order,cheque,command})CreditApplicationRules.Id(id);var c=await db.ReminderCommands.AsNoTracking().SingleOrDefaultAsync(x=>x.ActorId==actor&&x.CommandId==command&&x.OwnerId==owner&&x.OrderId==order&&x.ChequeId==cheque,ct)??throw CreditApplicationRules.Missing();return Receipt(c)with{Replayed=true};
    }
}
