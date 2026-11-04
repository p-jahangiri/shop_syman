using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;
namespace Shop.Modules.Sales;
public sealed class ChequeReviewHoldService(SalesDbContext db,TimeProvider clock)
{
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web){UnmappedMemberHandling=System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow,RespectNullableAnnotations=true,RespectRequiredConstructorParameters=true};
    private static string Serialize<T>(T x)=>JsonSerializer.Serialize(x,Json);private static string Hash(string text)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)));
    private void Root(){if(db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel!=IsolationLevel.Serializable)throw new InvalidOperationException("Cheque review policy requires the audited root Sales Serializable transaction.");}
    private async Task Gate(string name,bool shared,CancellationToken ct)
    {
        Root();await using var c=db.Database.GetDbConnection().CreateCommand();c.Transaction=db.Database.CurrentTransaction!.GetDbTransaction();c.CommandTimeout=15;c.CommandText="DECLARE @r int; EXEC @r=sys.sp_getapplock @Resource=@resource,@LockMode=@mode,@LockOwner='Transaction',@LockTimeout=10000; SELECT @r;";var p=c.CreateParameter();p.ParameterName="@resource";p.Value="sayman:sales:cheque-review-hold:v1:"+name;c.Parameters.Add(p);var m=c.CreateParameter();m.ParameterName="@mode";m.Value=shared?"Shared":"Exclusive";c.Parameters.Add(m);if(Convert.ToInt32(await c.ExecuteScalarAsync(ct),CultureInfo.InvariantCulture)<0)throw new BusinessException("cheque_review_hold_busy","Retry this same review-hold operation.");
    }
    private IQueryable<ChequeReviewHoldPolicy> Heads=>db.ChequeReviewHoldPolicies.FromSqlRaw("SELECT * FROM [sales].[ChequeReviewHoldPolicies] WITH (READCOMMITTEDLOCK)");
    private IQueryable<ChequeReviewHoldCommand> Commands=>db.ChequeReviewHoldCommands.FromSqlRaw("SELECT * FROM [sales].[ChequeReviewHoldCommands] WITH (READCOMMITTEDLOCK)").AsNoTracking();
    private static ChequeReviewHoldRevisionData Data(ChequeReviewHoldRevision r)
    {
        try{ChequeReviewHoldRules.Id(r.Id);CreditCheckoutQuoteRules.Owner(r.ActorId);if(r.PolicyId!=1||r.Revision is<1 or>10000||r.CreatedAt.Offset!=TimeSpan.Zero||(r.Enabled?r.Minutes is not(>=1 and<=60):r.Minutes is not null))throw ChequeReviewHoldRules.Unavailable();return new(r.Id,r.Revision,r.Enabled,r.Minutes,r.CreatedAt);}catch(BusinessException){throw ChequeReviewHoldRules.Unavailable();}
    }
    private ChequeReviewHoldResult Receipt(ChequeReviewHoldCommand c)
    {
        try{var r=JsonSerializer.Deserialize<ChequeReviewHoldResult>(c.ResultJson,Json)??throw ChequeReviewHoldRules.Unavailable();if(Hash(c.ResultJson)!=c.ResultHash||r.SchemaVersion!=1||r.Replayed||r.CommandId!=c.CommandId||r.Policy.SchemaVersion!=1||r.Policy.MaximumMinutes!=60||r.Policy.Current is null||r.Policy.Current.Id!=c.RevisionId||r.Policy.Current.CreatedAt!=c.At||c.PolicyId!=1||r.Policy.Version is null)throw ChequeReviewHoldRules.Unavailable();ChequeReviewHoldRules.Version(r.Policy.Version);return r;}catch(Exception e)when(e is JsonException or NullReferenceException or BusinessException){throw ChequeReviewHoldRules.Unavailable();}
    }
    private async Task VerifyRevision(ChequeReviewHoldRevision r,CancellationToken ct)
    {
        var command=await Commands.SingleOrDefaultAsync(c=>c.RevisionId==r.Id,ct)??throw ChequeReviewHoldRules.Unavailable();if(command.ActorId!=r.ActorId||Receipt(command).Policy.Current!=Data(r))throw ChequeReviewHoldRules.Unavailable();
    }
    public async Task<ChequeReviewHoldCurrent> CurrentAsync(CancellationToken ct)
    {
        await Gate("policy",true,ct);var head=await Heads.AsNoTracking().SingleOrDefaultAsync(ct);if(head is null)return new(1,null,null);if(head.Id!=1||head.PublishedRevisionId is null)throw ChequeReviewHoldRules.Unavailable();var revision=await db.ChequeReviewHoldRevisions.AsNoTracking().SingleOrDefaultAsync(x=>x.Id==head.PublishedRevisionId&&x.PolicyId==1,ct)??throw ChequeReviewHoldRules.Unavailable();await VerifyRevision(revision,ct);var command=await Commands.SingleAsync(c=>c.RevisionId==revision.Id,ct);if(Receipt(command).Policy.Version!=Convert.ToBase64String(head.Version))throw ChequeReviewHoldRules.Unavailable();return new(1,Convert.ToBase64String(head.Version),Data(revision));
    }
    public async Task<ChequeReviewHoldHistory> HistoryAsync(int? before,CancellationToken ct)
    {
        if(before is<=0 or>10000)throw ChequeReviewHoldRules.Invalid();await Gate("policy",true,ct);var rows=await db.ChequeReviewHoldRevisions.AsNoTracking().Where(r=>before==null||r.Revision<before).OrderByDescending(x=>x.Revision).Take(21).ToArrayAsync(ct);foreach(var r in rows.Take(20))await VerifyRevision(r,ct);return new(1,rows.Take(20).Select(Data).ToArray(),rows.Length>20?rows[19].Revision:null);
    }
    public async Task<ChequeReviewHoldResult> WriteAsync(string actor,string commandId,ChequeReviewHoldInput input,CancellationToken ct)
    {
        actor=CreditCheckoutQuoteRules.Owner(actor);ChequeReviewHoldRules.Id(commandId);ChequeReviewHoldRules.Validate(input);await Gate("command:"+Hash(actor+":"+commandId),false,ct);await Gate("policy",false,ct);var hash=Hash(Serialize(new{Contract="Sayman.ChequeReviewHold.v1",Input=input}));var old=await Commands.SingleOrDefaultAsync(c=>c.ActorId==actor&&c.CommandId==commandId,ct);if(old is not null){if(old.PayloadHash!=hash)throw new BusinessException("cheque_review_hold_idempotency_conflict","This review-hold command has different input.");return Receipt(old)with{Replayed=true};}
        var current=await CurrentAsync(ct);if(current.Version!=input.Version||current.Current?.Revision>=10000)throw ChequeReviewHoldRules.Conflict();var head=await Heads.SingleOrDefaultAsync(ct);if(head is null){head=new();db.ChequeReviewHoldPolicies.Add(head);await db.SaveChangesAsync(ct);}var at=clock.GetUtcNow().ToUniversalTime();if(current.Current?.CreatedAt>at)throw ChequeReviewHoldRules.Conflict();var revision=new ChequeReviewHoldRevision{Revision=(current.Current?.Revision??0)+1,Enabled=input.Action=="Enable",Minutes=input.Minutes,ActorId=actor,CreatedAt=at};db.ChequeReviewHoldRevisions.Add(revision);head.PublishedRevisionId=revision.Id;await db.SaveChangesAsync(ct);
        var result=new ChequeReviewHoldResult(1,commandId,new(1,Convert.ToBase64String(head.Version),Data(revision)),false);var raw=Serialize(result);db.ChequeReviewHoldCommands.Add(new(){ActorId=actor,CommandId=commandId,RevisionId=revision.Id,PayloadHash=hash,ResultHash=Hash(raw),ResultJson=raw,At=at});await db.SaveChangesAsync(ct);return result;
    }
    public async Task<ChequeReviewHoldResult> ReceiptAsync(string actor,string command,CancellationToken ct)
    {
        actor=CreditCheckoutQuoteRules.Owner(actor);ChequeReviewHoldRules.Id(command);return Receipt(await Commands.SingleOrDefaultAsync(c=>c.ActorId==actor&&c.CommandId==command,ct)??throw new BusinessException("not_found","Review-hold receipt not found."))with{Replayed=true};
    }
    public async Task<CreditReviewHoldOption?> ForNewOrderAsync(string? expectedVersion,CancellationToken ct)
    {
        var p=await CurrentAsync(ct);var active=p.Current is{Enabled:true};if(active?(p.Version!=expectedVersion):(expectedVersion is not null))throw ChequeReviewHoldRules.Conflict();return active?new(p.Current!.Id,p.Version!,p.Current.Minutes!.Value):null;
    }
    public static CreditReviewHoldOption? Option(ChequeReviewHoldCurrent p)=>p.Current is{Enabled:true}?new(p.Current.Id,p.Version!,p.Current.Minutes!.Value):null;
    public static DateTimeOffset Deadline(CreditReviewHoldOption? option,DateTimeOffset now,int ordinaryMinutes,ValidatedCreditOrderQuote quote)
    {
        var until=now.AddMinutes(option?.MaximumMinutes??ordinaryMinutes);var boundaries=new List<DateTimeOffset>{quote.Authority.ExpiresAt};if(option is null)boundaries.Add(quote.Stored.ExpiresAt);if(quote.Accepted is{}accepted)foreach(var x in accepted.Lines)if(x.Accepted is{}a){boundaries.Add(a.PurchaseUntil);boundaries.Add(a.AllocationExpiresAt);}foreach(var boundary in boundaries)if(boundary<until)until=boundary;return until;
    }
}
