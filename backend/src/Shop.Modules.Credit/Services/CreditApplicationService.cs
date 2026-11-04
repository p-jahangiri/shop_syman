using System.Data;
using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;
namespace Shop.Modules.Credit;

public sealed class CreditApplicationService(CreditDbContext db,ICreditApplicationProtection protection,TimeProvider clock)
{
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web){MaxDepth=16};
    private static string Money(long value)=>value.ToString(CultureInfo.InvariantCulture);
    public async Task<CreditApplicationPlans> PlansAsync(string? after,CancellationToken ct)
    {
        if(after is not null)CreditApplicationRules.Key(after);
        var query=db.Plans.AsNoTracking().Where(x=>x.Enabled);if(after is not null)query=query.Where(x=>string.Compare(x.Id,after)>0);
        var rows=await query.OrderBy(x=>x.Id).Select(x=>new{x.Id,x.Version,x.NameFa,x.NameEn,x.Months,x.MarkupBasisPoints,x.DownPaymentBasisPoints,x.IntervalMonths,x.RoundingUnitRial,x.MinAmountRial,x.MaxAmountRial,CategoryCount=x.Categories.Count}).Take(51).ToArrayAsync(ct);
        return new(1,rows.Take(50).Select(x=>new CreditApplicationPlanOption(x.Id,Convert.ToBase64String(x.Version),x.NameFa,x.NameEn,x.Months,x.MarkupBasisPoints,x.DownPaymentBasisPoints,x.IntervalMonths,Money(x.RoundingUnitRial),x.MinAmountRial is{}min?Money(min):null,x.MaxAmountRial is{}max?Money(max):null,x.CategoryCount)).ToArray(),rows.Length>50?rows[49].Id:null);
    }
    public async Task<CreditApplicationPage> PageAsync(string actor,bool staff,string? state,string? cursor,CancellationToken ct)
    {
        actor=CreditApplicationRules.Actor(actor);state=CreditApplicationRules.State(state);var scope="credit-applications|"+(staff?"staff":actor)+"|"+state;var before=CreditApplicationRules.Cursor(cursor,scope);
        var q=db.Applications.AsNoTracking().Where(x=>x.Sequence<before);if(!staff)q=q.Where(x=>x.OwnerId==actor);if(state is not null)q=q.Where(x=>x.State==state);
        var rows=await q.OrderByDescending(x=>x.Sequence).Take(51).ToArrayAsync(ct);return new(1,state,rows.Take(50).Select(Summary).ToArray(),rows.Length>50?CreditApplicationRules.Cursor(rows[49].Sequence,scope):null);
    }
    public async Task<CreditApplicationDetail> DetailAsync(string actor,bool staff,string id,CancellationToken ct)
    {
        var row=await VisibleAsync(actor,staff,id,false,ct);var raw=protection.Unprotect(row.Id,"plan",row.Id,row.ProtectedPlan);if(CreditApplicationRules.Hash(raw)!=row.PlanHash)throw CreditApplicationRules.Unavailable();
        CreditApplicationPlan plan;try{plan=JsonSerializer.Deserialize<CreditApplicationPlan>(raw,Json)??throw CreditApplicationRules.Unavailable();ValidateSnapshot(plan,row);}catch(JsonException){throw CreditApplicationRules.Unavailable();}
        // This legacy detail does not carry workflow readiness. The independent
        // submission endpoint is authoritative; Submitted is never approval.
        return new(1,Summary(row),plan,false,row.State=="Cancelled"?["application_cancelled"]:row.State=="Submitted"?["application_submitted"]:row.State=="Approved"?["application_approved"]:row.State=="Declined"?["application_declined"]:["credit_submission_not_configured"]);
    }
    public Task<CreditApplicationResult> CreateAsync(string actor,string commandId,CreateCreditApplicationInput input,CancellationToken ct)
    {
        actor=CreditApplicationRules.Actor(actor);if(input is null)throw CreditApplicationRules.Invalid();CreditApplicationRules.Key(input.PlanId);CreditApplicationRules.Version(input.PlanVersion);var amount=CreditApplicationRules.Amount(input.RequestedAmountRial);CreditApplicationRules.Locale(input.Locale);
        return CommandAsync(actor,commandId,null,new{Operation="create",Input=input},async()=>{
            if(await db.Applications.CountAsync(x=>x.OwnerId==actor&&(x.State=="Draft"||x.State=="Submitted"),ct)>=20)throw new BusinessException("credit_application_capacity","Cancel an existing draft before creating another.");
            var plan=await db.Plans.AsNoTracking().SingleOrDefaultAsync(x=>x.Id==input.PlanId&&x.Enabled,ct)??throw new BusinessException("credit_plan_conflict","Choose an active cheque plan.");
            if(Convert.ToBase64String(plan.Version)!=input.PlanVersion||amount<plan.MinAmountRial||amount>plan.MaxAmountRial)throw new BusinessException("credit_plan_conflict","The selected plan or requested amount changed. Review current terms.");
            var categories=await db.Set<PlanCategory>().AsNoTracking().Where(x=>x.PlanId==plan.Id).OrderBy(x=>x.CategoryId).Select(x=>x.CategoryId).Take(501).ToArrayAsync(ct);if(categories.Length>500)throw CreditApplicationRules.Unavailable();
            var snapshot=new CreditApplicationPlan(plan.Id,input.PlanVersion,plan.NameFa,plan.NameEn,plan.Months,plan.MarkupBasisPoints,plan.DownPaymentBasisPoints,plan.IntervalMonths,Money(plan.RoundingUnitRial),plan.MinAmountRial is{}min?Money(min):null,plan.MaxAmountRial is{}max?Money(max):null,categories);
            var now=clock.GetUtcNow().ToUniversalTime();var row=new CreditApplication{OwnerId=actor,PlanId=plan.Id,PlanVersion=input.PlanVersion,RequestedAmountRial=amount,Locale=input.Locale,CreatedAt=now,ChangedAt=now};ValidateSnapshot(snapshot,row);var raw=JsonSerializer.Serialize(snapshot,Json);row.ProtectedPlan=protection.Protect(row.Id,"plan",row.Id,raw);row.PlanHash=CreditApplicationRules.Hash(raw);db.Applications.Add(row);Event(row,actor,"Created",now);await db.SaveChangesAsync(ct);return new(1,false,commandId,Summary(row));
        },ct);
    }
    public Task<CreditApplicationResult> CancelAsync(string actor,string id,string commandId,CancelCreditApplicationInput input,CancellationToken ct)
    {
        actor=CreditApplicationRules.Actor(actor);CreditApplicationRules.Id(id);if(input is null)throw CreditApplicationRules.Invalid();CreditApplicationRules.Version(input.Version);
        return CommandAsync(actor,commandId,id,new{Operation="cancel",ApplicationId=id,Input=input},async()=>{
            var row=await VisibleAsync(actor,false,id,true,ct);if(row.State is not("Draft"or"Submitted")||Convert.ToBase64String(row.Version)!=input.Version)throw new BusinessException("credit_application_version_conflict","The application changed or can no longer be withdrawn.");
            var now=clock.GetUtcNow().ToUniversalTime();if(now<row.ChangedAt)now=row.ChangedAt;var action=row.State=="Submitted"?"Withdrawn":"Cancelled";row.State="Cancelled";row.ChangedAt=now;Event(row,actor,action,now);await db.SaveChangesAsync(ct);return new(1,false,commandId,Summary(row));
        },ct);
    }
    public async Task<CreditApplicationResult> ReceiptAsync(string actor,string commandId,CancellationToken ct)
    {
        actor=CreditApplicationRules.Actor(actor);CreditApplicationRules.Id(commandId);var row=await db.ApplicationCommands.AsNoTracking().SingleOrDefaultAsync(x=>x.ActorId==actor&&x.CommandId==commandId,ct)??throw CreditApplicationRules.Missing();await VisibleAsync(actor,false,row.ApplicationId,false,ct);return Receipt(row)with{Replayed=true};
    }
    private async Task<CreditApplicationResult> CommandAsync(string actor,string commandId,string? id,object input,Func<Task<CreditApplicationResult>> work,CancellationToken ct)
    {
        CreditApplicationRules.Id(commandId);var tx=db.Database.CurrentTransaction??throw new InvalidOperationException("Credit commands require the root audited Serializable transaction.");if(tx.GetDbTransaction().IsolationLevel!=IsolationLevel.Serializable)throw new InvalidOperationException("Credit commands require Serializable isolation.");
        await using(var command=db.Database.GetDbConnection().CreateCommand()){
            command.Transaction=tx.GetDbTransaction();command.CommandTimeout=15;command.CommandText="DECLARE @r int; EXEC @r=sys.sp_getapplock @Resource=N'sayman:credit:application-commands:v1',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @r;";
            if(Convert.ToInt32(await command.ExecuteScalarAsync(ct),CultureInfo.InvariantCulture)<0)throw new BusinessException("credit_application_busy","Credit applications are busy. Retry the original command.");
        }
        var hash=CreditApplicationRules.Hash(JsonSerializer.Serialize(input,Json));var previous=await db.ApplicationCommands.FromSqlInterpolated($"SELECT * FROM [credit].[ApplicationCommands] WITH (READCOMMITTEDLOCK) WHERE [ActorId]={actor} AND [CommandId]={commandId}").AsNoTracking().SingleOrDefaultAsync(ct);
        if(previous is not null){if(previous.PayloadHash!=hash||id is not null&&previous.ApplicationId!=id)throw new BusinessException("credit_application_idempotency_conflict","This command ID has different input.");return Receipt(previous)with{Replayed=true};}
        var result=await work();var raw=JsonSerializer.Serialize(result,Json);db.ApplicationCommands.Add(new(){ActorId=actor,CommandId=commandId,ApplicationId=result.Application.Id,PayloadHash=hash,ResultHash=CreditApplicationRules.Hash(raw),ProtectedResult=protection.Protect(result.Application.Id,"receipt",CreditApplicationRules.Hash(actor+":"+commandId),raw),At=clock.GetUtcNow().ToUniversalTime()});await db.SaveChangesAsync(ct);return result;
    }
    private async Task<CreditApplication> VisibleAsync(string actor,bool staff,string id,bool tracking,CancellationToken ct)
    {
        actor=CreditApplicationRules.Actor(actor);CreditApplicationRules.Id(id);var q=tracking?db.Applications.AsQueryable():db.Applications.AsNoTracking();return await q.SingleOrDefaultAsync(x=>x.Id==id&&(staff||x.OwnerId==actor),ct)??throw CreditApplicationRules.Missing();
    }
    internal static CreditApplicationSummary Summary(CreditApplication row)
    {
        try{CreditApplicationRules.Id(row.Id);CreditApplicationRules.Key(row.PlanId);CreditApplicationRules.Locale(row.Locale);CreditApplicationRules.State(row.State);CreditApplicationRules.Amount(Money(row.RequestedAmountRial));if(row.Version.Length!=8||row.CreatedAt.Offset!=TimeSpan.Zero||row.ChangedAt.Offset!=TimeSpan.Zero||row.ChangedAt<row.CreatedAt)throw CreditApplicationRules.Unavailable();return new(row.Id,row.PlanId,Money(row.RequestedAmountRial),row.Locale,row.State,Convert.ToBase64String(row.Version),row.CreatedAt,row.ChangedAt);}catch(BusinessException){throw CreditApplicationRules.Unavailable();}
    }
    private static void ValidateSnapshot(CreditApplicationPlan plan,CreditApplication row)
    {
        if(plan.RoundingUnitRial is not("1"or"10")||plan.Id!=row.PlanId||plan.Version!=row.PlanVersion||plan.CategoryIds is null||plan.CategoryIds.Length>500||plan.CategoryIds.Distinct(StringComparer.Ordinal).Count()!=plan.CategoryIds.Length)throw CreditApplicationRules.Unavailable();
        try{CreditApplicationRules.Key(plan.Id);CreditApplicationRules.Version(plan.Version);foreach(var category in plan.CategoryIds)CreditApplicationRules.Key(category);CreditPlanService.Validate(new(plan.NameFa,plan.NameEn,plan.Months,plan.MarkupBasisPoints,plan.DownPaymentBasisPoints,plan.IntervalMonths,true,plan.MinAmountRial,plan.MaxAmountRial,plan.CategoryIds,plan.Version,plan.RoundingUnitRial=="1"?1:10));}catch(BusinessException){throw CreditApplicationRules.Unavailable();}
    }
    private CreditApplicationResult Receipt(CreditApplicationCommand row)
    {
        try{var raw=protection.Unprotect(row.ApplicationId,"receipt",CreditApplicationRules.Hash(row.ActorId+":"+row.CommandId),row.ProtectedResult);if(CreditApplicationRules.Hash(raw)!=row.ResultHash)throw CreditApplicationRules.Unavailable();var value=JsonSerializer.Deserialize<CreditApplicationResult>(raw,Json)??throw CreditApplicationRules.Unavailable();if(value.SchemaVersion!=1||value.Replayed||value.CommandId!=row.CommandId||value.Application.Id!=row.ApplicationId)throw CreditApplicationRules.Unavailable();return value;}catch(JsonException){throw CreditApplicationRules.Unavailable();}
    }
    private void Event(CreditApplication row,string actor,string action,DateTimeOffset at)=>db.ApplicationEvents.Add(new(){ApplicationId=row.Id,ActorId=actor,Action=action,At=at});
}
