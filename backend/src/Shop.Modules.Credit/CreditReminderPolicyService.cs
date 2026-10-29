using System.Data;
using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;
namespace Shop.Modules.Credit;
public sealed class CreditReminderPolicyService(CreditDbContext db,ICreditReminderPolicyProtection protection,TimeProvider clock,CreditReminderDeliveryOptions delivery)
{
    private sealed record Seal(string Id,int Revision,string ActorId,bool Enabled,int[] DayOffsets,string? SendAt,string Note,DateTimeOffset At);
    private static string Json<T>(T x)=>JsonSerializer.Serialize(x,CreditScheduleFacts.Json);
    private static string Hash(string x)=>CreditApplicationRules.Hash(x);
    private void Root(){if(db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel!=IsolationLevel.Serializable)throw new InvalidOperationException("Reminder policy requires the audited root Serializable transaction.");}
    public async Task LockAsync(bool exclusive,CancellationToken ct)
    {
        Root();await using var c=db.Database.GetDbConnection().CreateCommand();c.Transaction=db.Database.CurrentTransaction!.GetDbTransaction();c.CommandTimeout=15;c.CommandText="DECLARE @r int;EXEC @r=sys.sp_getapplock @Resource='sayman:credit:reminder-policy:v1',@LockMode=@mode,@LockOwner='Transaction',@LockTimeout=10000;SELECT @r;";var p=c.CreateParameter();p.ParameterName="@mode";p.Value=exclusive?"Exclusive":"Shared";c.Parameters.Add(p);if(Convert.ToInt32(await c.ExecuteScalarAsync(ct),CultureInfo.InvariantCulture)<0)throw new BusinessException("credit_reminder_policy_busy","Retry the same reminder policy operation.");
    }
    private IQueryable<CreditReminderPolicyRevision> Rows=>db.ReminderPolicyRevisions.FromSqlRaw("SELECT * FROM [credit].[ReminderPolicyRevisions] WITH (READCOMMITTEDLOCK)").AsNoTracking();
    private IQueryable<CreditReminderPolicyCommand> Commands=>db.ReminderPolicyCommands.FromSqlRaw("SELECT * FROM [credit].[ReminderPolicyCommands] WITH (READCOMMITTEDLOCK)").AsNoTracking();
    private T Decode<T>(string purpose,string actor,string id,byte[] raw)
    {
        try{return JsonSerializer.Deserialize<T>(protection.Unprotect(purpose,actor,id,raw),CreditScheduleFacts.Json)??throw CreditReminderPolicyRules.Unavailable();}catch(Exception e)when(e is JsonException or NullReferenceException){throw CreditReminderPolicyRules.Unavailable();}
    }
    private CreditReminderPolicyResult Receipt(CreditReminderPolicyCommand c)
    {
        var r=Decode<CreditReminderPolicyResult>("receipt",c.ActorId,c.CommandId,c.ProtectedResult);var d=r.Policy.Current;
        if(Hash(Json(r))!=c.ResultHash||r.SchemaVersion!=1||r.Replayed||r.CommandId!=c.CommandId||r.Policy.SchemaVersion!=1||r.Policy.TimeZone!="Asia/Tehran"||r.Policy.Channel!="PrivateAccountInbox"||d is null||d.Id!=c.RevisionId||d.At!=c.At)throw CreditReminderPolicyRules.Unavailable();ValidateData(d);return r;
    }
    private static void ValidateData(CreditReminderPolicyRevisionData d)
    {
        try{CreditApplicationRules.Id(d.Id);CreditApplicationRules.Version(d.Version);CreditReminderPolicyRules.Validate(new(d.Version,d.Enabled,d.DayOffsets,d.SendAt,d.Note,true));if(d.Revision is<1 or>CreditReminderPolicyRules.MaxRevisions||d.At.Offset!=TimeSpan.Zero)throw CreditReminderPolicyRules.Unavailable();}catch(BusinessException){throw CreditReminderPolicyRules.Unavailable();}
    }
    private async Task<CreditReminderPolicyRevisionData> Data(CreditReminderPolicyRevision r,CancellationToken ct)
    {
        var s=Decode<Seal>("revision",r.ActorId,r.Id,r.ProtectedData);var offsets=await db.ReminderPolicyOffsets.AsNoTracking().Where(x=>x.RevisionId==r.Id).OrderBy(x=>x.Days).Select(x=>x.Days).ToArrayAsync(ct);
        if(s.Id!=r.Id||s.Revision!=r.Revision||s.ActorId!=r.ActorId||s.Enabled!=r.Enabled||s.SendAt!=r.SendAt||s.At!=r.At||s.DayOffsets is null||!s.DayOffsets.SequenceEqual(offsets)||r.ActorId!=CreditApplicationRules.Actor(r.ActorId))throw CreditReminderPolicyRules.Unavailable();
        var d=new CreditReminderPolicyRevisionData(r.Id,r.Revision,Convert.ToBase64String(r.Version),r.Enabled,offsets,r.SendAt,s.Note,r.At);ValidateData(d);
        var c=await Commands.SingleOrDefaultAsync(x=>x.RevisionId==r.Id,ct)??throw CreditReminderPolicyRules.Unavailable();if(c.ActorId!=r.ActorId||c.At!=r.At||Json(Receipt(c).Policy.Current)!=Json(d))throw CreditReminderPolicyRules.Unavailable();return d;
    }
    public async Task<CreditReminderPolicyCurrent> CurrentAsync(CancellationToken ct)
    {
        await LockAsync(false,ct);var r=await Rows.OrderByDescending(x=>x.Revision).FirstOrDefaultAsync(ct);return new(1,r is null?null:await Data(r,ct),WorkerEnabled:delivery.WorkerEnabled);
    }
    public async Task<CreditReminderPolicyHistory> HistoryAsync(int? before,CancellationToken ct)
    {
        if(before is<=0 or>CreditReminderPolicyRules.MaxRevisions)throw CreditReminderPolicyRules.Invalid();await LockAsync(false,ct);var rows=await Rows.Where(x=>before==null||x.Revision<before).OrderByDescending(x=>x.Revision).Take(21).ToArrayAsync(ct);var items=new List<CreditReminderPolicyRevisionData>();foreach(var row in rows.Take(20))items.Add(await Data(row,ct));return new(1,items.ToArray(),rows.Length>20?items[^1].Revision:null);
    }
    public async Task<CreditReminderPolicyResult> WriteAsync(string actor,string command,CreditReminderPolicyInput input,CancellationToken ct)
    {
        actor=CreditApplicationRules.Actor(actor);CreditApplicationRules.Id(command);CreditReminderPolicyRules.Validate(input);await LockAsync(true,ct);var hash=Hash(Json(new{Contract="Sayman.Credit.ReminderPolicy.v1",Input=input}));var prior=await Commands.SingleOrDefaultAsync(x=>x.ActorId==actor&&x.CommandId==command,ct);
        if(prior is not null){if(prior.PayloadHash!=hash)throw new BusinessException("credit_reminder_policy_idempotency_conflict","This reminder policy command has different input.");return Receipt(prior)with{Replayed=true};}
        var current=(await CurrentAsync(ct)).Current;if(current?.Version!=input.Version||current?.Revision>=CreditReminderPolicyRules.MaxRevisions)throw CreditReminderPolicyRules.Conflict();var now=clock.GetUtcNow().ToUniversalTime();if(current?.At>now)throw CreditReminderPolicyRules.Conflict();
        var r=new CreditReminderPolicyRevision{Revision=(current?.Revision??0)+1,Enabled=input.Enabled,SendAt=input.SendAt,ActorId=actor,At=now};r.Offsets=input.DayOffsets.Select(d=>new CreditReminderPolicyOffset{RevisionId=r.Id,Days=d}).ToList();r.ProtectedData=protection.Protect("revision",actor,r.Id,Json(new Seal(r.Id,r.Revision,actor,r.Enabled,input.DayOffsets,r.SendAt,input.Note,now)));db.ReminderPolicyRevisions.Add(r);await db.SaveChangesAsync(ct);
        var data=new CreditReminderPolicyRevisionData(r.Id,r.Revision,Convert.ToBase64String(r.Version),r.Enabled,input.DayOffsets,r.SendAt,input.Note,now);var result=new CreditReminderPolicyResult(1,command,false,new(1,data,WorkerEnabled:delivery.WorkerEnabled));var raw=Json(result);db.ReminderPolicyCommands.Add(new(){ActorId=actor,CommandId=command,RevisionId=r.Id,PayloadHash=hash,ResultHash=Hash(raw),ProtectedResult=protection.Protect("receipt",actor,command,raw),At=now});await db.SaveChangesAsync(ct);return result;
    }
    public async Task<CreditReminderPolicyResult> ReceiptAsync(string actor,string command,CancellationToken ct)
    {
        actor=CreditApplicationRules.Actor(actor);CreditApplicationRules.Id(command);return Receipt(await Commands.SingleOrDefaultAsync(x=>x.ActorId==actor&&x.CommandId==command,ct)??throw CreditApplicationRules.Missing())with{Replayed=true};
    }
}
