using System.Data;
using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;
namespace Shop.Modules.Credit;
public sealed class CreditScheduleService(CreditDbContext db,ICreditOrderScheduleSource sourceReader,ICreditScheduleProtection protection,TimeProvider clock)
{
    public async Task<CreditSchedulePreview> PreviewAsync(string owner,string orderId,CreditSchedulePreviewInput input,CancellationToken ct)
    {
        CreditScheduleRules.Validate(input);var source=await Source(owner,orderId,ct);await RequireNoCheques(orderId,ct);var latest=await Latest(orderId,ct);await VerifyCurrent(latest,source,ct);RequireEditable(source,input.OrderVersion);var previous=latest is null?null:Convert.ToBase64String(latest.Version);if(input.ScheduleVersion!=previous)throw CreditScheduleRules.Conflict();var calculation=CreditScheduleCalculator.Calculate(source,input.CalendarKind,input.AnchorDate);return new(1,source.OrderId,source.OrderVersion,previous,CreditScheduleFacts.Fingerprint(source,input,calculation),source.CreditQuoteId,source.QuoteFingerprint,source.PlanName,source.Locale,calculation);
    }
    public async Task<CreditScheduleResult> SaveAsync(string actor,string owner,string orderId,string commandId,SaveCreditScheduleInput input,CancellationToken ct)
    {
        actor=CreditApplicationRules.Actor(actor);owner=CreditApplicationRules.Actor(owner);CreditApplicationRules.Id(orderId);CreditApplicationRules.Id(commandId);var previewInput=CreditScheduleRules.Validate(input);RequireRoot();await CommandGate(actor,commandId,ct);
        var hash=CreditApplicationRules.Hash(JsonSerializer.Serialize(new{Contract="Sayman.Credit.ScheduleCommand.v1",Owner=owner,OrderId=orderId,Input=input},CreditScheduleFacts.Json));var previous=await db.ScheduleCommands.FromSqlInterpolated($"SELECT * FROM [credit].[ChequeScheduleCommands] WITH (READCOMMITTEDLOCK) WHERE [ActorId]={actor} AND [CommandId]={commandId}").AsNoTracking().SingleOrDefaultAsync(ct);
        if(previous is not null){if(previous.OwnerId!=owner||previous.OrderId!=orderId||previous.PayloadHash!=hash)throw new BusinessException("credit_schedule_idempotency_conflict","This schedule command has different input.");return ReadReceipt(previous)with{Replayed=true};}
        var source=await Source(owner,orderId,ct);await RequireNoCheques(orderId,ct);var latest=await Latest(orderId,ct);await VerifyCurrent(latest,source,ct);RequireEditable(source,input.OrderVersion);var oldVersion=latest is null?null:Convert.ToBase64String(latest.Version);if(input.ScheduleVersion!=oldVersion)throw CreditScheduleRules.Conflict();var calculation=CreditScheduleCalculator.Calculate(source,input.CalendarKind,input.AnchorDate);var fingerprint=CreditScheduleFacts.Fingerprint(source,previewInput,calculation);if(fingerprint!=input.PreviewFingerprint)throw CreditScheduleRules.Conflict();
        var at=clock.GetUtcNow().ToUniversalTime();if(latest is not null&&at<latest.CreatedAt)at=latest.CreatedAt;RequireEditable(source,input.OrderVersion);if(at>=source.ExpiresAt)throw CreditScheduleRules.Conflict();
        var row=new CreditScheduleRevision{OwnerId=owner,OrderId=orderId,ApplicationId=source.ApplicationId,ScopeId=source.ScopeId,CreditQuoteId=source.CreditQuoteId,QuoteFingerprint=source.QuoteFingerprint,SourceOrderVersion=source.OrderVersion,PreviousScheduleVersion=oldVersion,SourceOrderCreatedAt=source.CreatedAt,SourceOrderExpiresAt=source.ExpiresAt,Revision=checked((latest?.Revision??0)+1),Locale=source.Locale,PlanName=source.PlanName,CalendarKind=input.CalendarKind,AnchorDate=CreditScheduleRules.Date(input.AnchorDate),PayableTotalRial=source.PayableTotalRial,PlanDownPaymentRial=source.PlanDownPaymentRial,ChargesOutsideChequesRial=Parse(calculation.ChargesOutsideChequesRial),UpfrontTotalRial=Parse(calculation.UpfrontTotalRial),InstallmentsTotalRial=Parse(calculation.InstallmentsTotalRial),FinancialHash=CreditScheduleFacts.FinancialHash(source),PreviewFingerprint=fingerprint,ActorId=actor,CreatedAt=at};row.Lines=calculation.Lines.Select(x=>new CreditScheduleLine{RevisionId=row.Id,Sequence=x.Sequence,MonthOffset=x.MonthOffset,DueDate=CreditScheduleRules.Date(x.DueDate),AmountRial=Parse(x.AmountRial)}).ToList();db.ScheduleRevisions.Add(row);await db.SaveChangesAsync(ct);RequireEditable(source,input.OrderVersion);
        var result=new CreditScheduleResult(1,false,commandId,CreditScheduleFacts.Data(row));var raw=JsonSerializer.Serialize(result,CreditScheduleFacts.Json);db.ScheduleCommands.Add(new(){ActorId=actor,CommandId=commandId,OwnerId=owner,OrderId=orderId,RevisionId=row.Id,PayloadHash=hash,ResultHash=CreditApplicationRules.Hash(raw),ProtectedResult=protection.Protect(actor,orderId,commandId,raw),At=at});await db.SaveChangesAsync(ct);RequireEditable(source,input.OrderVersion);return result;
    }
    public async Task EnsureCommitAsync(string owner,string orderId,string version,CancellationToken ct){var source=await Source(owner,orderId,ct);RequireEditable(source,version);await RequireNoCheques(orderId,ct);}
    public async Task<CreditScheduleResult> ReceiptAsync(string actor,string owner,string orderId,string commandId,CancellationToken ct)
    {
        actor=CreditApplicationRules.Actor(actor);owner=CreditApplicationRules.Actor(owner);CreditApplicationRules.Id(orderId);CreditApplicationRules.Id(commandId);var row=await db.ScheduleCommands.AsNoTracking().SingleOrDefaultAsync(x=>x.ActorId==actor&&x.CommandId==commandId&&x.OwnerId==owner&&x.OrderId==orderId,ct)??throw CreditApplicationRules.Missing();return ReadReceipt(row)with{Replayed=true};
    }
    public async Task<CreditSchedulePage> PageAsync(string owner,string orderId,bool writable,CancellationToken ct)
    {
        var source=await Source(owner,orderId,ct);var latest=await Latest(orderId,ct);await VerifyCurrent(latest,source,ct);var blockers=new List<string>();if(source.State!="AwaitingPayment"||source.ExpiresAt<=clock.GetUtcNow())blockers.Add("credit_schedule_order_closed");if(await db.ReceivedCheques.AsNoTracking().AnyAsync(x=>x.OrderId==orderId,ct))blockers.Add("credit_schedule_instruments_recorded");return new(1,orderId,source.OrderVersion,source.State,latest is null?null:CreditScheduleFacts.Data(latest),writable&&blockers.Count==0,blockers.ToArray());
    }
    public async Task<CreditScheduleHistoryPage> HistoryAsync(string owner,string orderId,int? beforeRevision,CancellationToken ct)
    {
        if(beforeRevision is <=0)throw CreditScheduleRules.Invalid();var source=await Source(owner,orderId,ct);var rows=await Rows(orderId).Where(x=>beforeRevision==null||x.Revision<beforeRevision).Include(x=>x.Lines).OrderByDescending(x=>x.Revision).Take(21).ToArrayAsync(ct);var page=rows.Take(20).ToArray();foreach(var row in page)await VerifyCurrent(row,source,ct);return new(1,orderId,page.Select(CreditScheduleFacts.Data).ToArray(),rows.Length>20?page[^1].Revision:null);
    }
    private async Task<CreditOrderScheduleSource> Source(string owner,string orderId,CancellationToken ct)
    {
        RequireRoot();owner=CreditApplicationRules.Actor(owner);CreditApplicationRules.Id(orderId);var source=await sourceReader.LockAndReadAsync(owner,orderId,ct);if(source.OwnerId!=owner||source.OrderId!=orderId)throw CreditScheduleRules.Unavailable();var used=await db.PurchaseScopeUses.AsNoTracking().SingleOrDefaultAsync(x=>x.ScopeId==source.ScopeId&&x.ApplicationId==source.ApplicationId&&x.OrderId==orderId&&x.CreditQuoteId==source.CreditQuoteId&&x.QuoteFingerprint==source.QuoteFingerprint,ct)??throw CreditApplicationRules.Missing();if(used.ActorId!=owner||source.PurchaseUse is null||source.PurchaseUse!=new CreditPurchaseUse(used.ScopeId,used.ApplicationId,used.OrderId,used.CreditQuoteId,used.QuoteFingerprint,used.AssessedAmountRial,used.At))throw CreditScheduleRules.Unavailable();return source;
    }
    private IQueryable<CreditScheduleRevision> Rows(string orderId)=>db.ScheduleRevisions.FromSqlInterpolated($"SELECT * FROM [credit].[ChequeScheduleRevisions] WITH (READCOMMITTEDLOCK) WHERE [OrderId]={orderId}").AsNoTracking();
    private Task<CreditScheduleRevision?> Latest(string orderId,CancellationToken ct)=>Rows(orderId).Include(x=>x.Lines).OrderByDescending(x=>x.Revision).FirstOrDefaultAsync(ct);
    private async Task VerifyCurrent(CreditScheduleRevision? row,CreditOrderScheduleSource source,CancellationToken ct)
    {
        if(row is null)return;if(row.OwnerId!=source.OwnerId||row.OrderId!=source.OrderId||row.FinancialHash!=CreditScheduleFacts.FinancialHash(source))throw CreditScheduleRules.Unavailable();var command=await db.ScheduleCommands.AsNoTracking().SingleOrDefaultAsync(x=>x.RevisionId==row.Id,ct)??throw CreditScheduleRules.Unavailable();var receipt=ReadReceipt(command);if(command.ActorId!=row.ActorId||command.OwnerId!=row.OwnerId||command.OrderId!=row.OrderId||command.At!=row.CreatedAt||JsonSerializer.Serialize(receipt.Revision,CreditScheduleFacts.Json)!=JsonSerializer.Serialize(CreditScheduleFacts.Data(row),CreditScheduleFacts.Json))throw CreditScheduleRules.Unavailable();
    }
    private CreditScheduleResult ReadReceipt(CreditScheduleCommand row)
    {
        try{var raw=protection.Unprotect(row.ActorId,row.OrderId,row.CommandId,row.ProtectedResult);if(CreditApplicationRules.Hash(raw)!=row.ResultHash)throw CreditScheduleRules.Unavailable();var value=JsonSerializer.Deserialize<CreditScheduleResult>(raw,CreditScheduleFacts.Json)??throw CreditScheduleRules.Unavailable();if(value.SchemaVersion!=1||value.Replayed||value.CommandId!=row.CommandId||value.Revision.Id!=row.RevisionId||value.Revision.OrderId!=row.OrderId||value.Revision.CreatedAt!=row.At||value.Revision.State!="Planned"||value.Revision.CanPay||value.Revision.CanFulfill)throw CreditScheduleRules.Unavailable();return value;}catch(Exception e)when(e is JsonException or NullReferenceException){throw CreditScheduleRules.Unavailable();}
    }
    private void RequireEditable(CreditOrderScheduleSource source,string version){if(source.State!="AwaitingPayment"||source.OrderVersion!=version||source.ExpiresAt<=clock.GetUtcNow())throw CreditScheduleRules.Conflict();}
    private async Task RequireNoCheques(string order,CancellationToken ct){if(await db.ReceivedCheques.AsNoTracking().AnyAsync(x=>x.OrderId==order,ct))throw new BusinessException("credit_schedule_instruments_recorded_conflict","A received cheque fixes this dated schedule; use its financial history.");}
    private void RequireRoot(){if(db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel!=IsolationLevel.Serializable)throw new InvalidOperationException("Schedules require the root audited Serializable Sales/Credit transaction.");}
    private async Task CommandGate(string actor,string commandId,CancellationToken ct)
    {
        var tx=db.Database.CurrentTransaction!;await using var command=db.Database.GetDbConnection().CreateCommand();command.Transaction=tx.GetDbTransaction();command.CommandTimeout=15;command.CommandText="DECLARE @r int; EXEC @r=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @r;";var parameter=command.CreateParameter();parameter.ParameterName="@resource";parameter.Value="sayman:credit:schedule-command:v1:"+CreditApplicationRules.Hash(actor+":"+commandId);command.Parameters.Add(parameter);if(Convert.ToInt32(await command.ExecuteScalarAsync(ct),CultureInfo.InvariantCulture)<0)throw new BusinessException("credit_schedule_busy","Retry the same schedule command.");
    }
    private static long Parse(string x)=>long.Parse(x,NumberStyles.None,CultureInfo.InvariantCulture);
}
