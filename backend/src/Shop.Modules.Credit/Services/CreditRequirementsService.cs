using System.Data;
using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;

namespace Shop.Modules.Credit;

public sealed class CreditRequirementsService(CreditDbContext db,ICreditApplicationProtection protection,TimeProvider clock)
{
    private static readonly JsonSerializerOptions Json=CreditRequirementsRules.Json;
    public async Task<CreditRequirementsCurrent> CurrentAsync(CancellationToken ct)
    {
        var head=await db.RequirementsHead.AsNoTracking().SingleOrDefaultAsync(ct);
        return head is null?new(1,null,null):new(1,Convert.ToBase64String(head.Version),await RevisionAsync(head.PublishedRevisionId,ct));
    }
    public async Task<CreditRequirementsHistory> HistoryAsync(string? cursor,CancellationToken ct)
    {
        var before=CreditApplicationRules.Cursor(cursor,"credit-requirements-history-v1");
        var rows=await db.RequirementsRevisions.AsNoTracking().Where(x=>x.Sequence<before).OrderByDescending(x=>x.Sequence).Select(x=>new{x.Id,x.Sequence,x.CreatedAt,x.TitleFa,x.TitleEn,x.Enabled,DocumentCount=db.RequirementDocuments.Count(d=>d.RevisionId==x.Id)}).Take(51).ToArrayAsync(ct);
        // Only summaries in history; loading 50 complete legal texts would
        // exceed the private response budget. One revision has its own read.
        return new(1,rows.Take(50).Select(x=>new CreditRequirementsRevisionSummary(x.Id,x.CreatedAt,x.TitleFa,x.TitleEn,x.Enabled,x.DocumentCount)).ToArray(),rows.Length>50?CreditApplicationRules.Cursor(rows[49].Sequence,"credit-requirements-history-v1"):null);
    }
    public async Task<CreditRequirementsRevisionData> RevisionAsync(string id,CancellationToken ct)
    {
        CreditApplicationRules.Id(id);var row=await db.RequirementsRevisions.AsNoTracking().SingleOrDefaultAsync(x=>x.Id==id,ct)??throw CreditApplicationRules.Missing();
        var docs=await db.RequirementDocuments.AsNoTracking().Where(x=>x.RevisionId==id).OrderBy(x=>x.Position).Take(13).ToArrayAsync(ct);
        if(docs.Length>12||docs.Where((x,i)=>x.Position!=i).Any())throw CreditApplicationRules.Unavailable();
        try{
            var content=new CreditRequirementsContent(row.TitleFa,row.TitleEn,row.TermsFa,row.TermsEn,row.ConsentLabelFa,row.ConsentLabelEn,row.Enabled,docs.Select(x=>new CreditDocumentRequirementInput(x.Key,x.NameFa,x.NameEn,x.HelpFa,x.HelpEn,x.Required,x.MaxBytes,CreditRequirementsRules.ContentTypes(x.ContentTypeMask))).ToArray());
            var value=new CreditRequirementsRevisionData(row.Id,row.CreatedAt,content);
            if(CreditApplicationRules.Hash(CreditRequirementsRules.Snapshot(value))!=row.SnapshotHash)throw CreditApplicationRules.Unavailable();return value;
        }catch(BusinessException){throw CreditApplicationRules.Unavailable();}
    }
    public async Task<PublishCreditRequirementsResult> PublishAsync(string actor,string commandId,PublishCreditRequirementsInput input,CancellationToken ct)
    {
        actor=CreditApplicationRules.Actor(actor);CreditApplicationRules.Id(commandId);if(input is null)throw CreditRequirementsRules.Invalid();if(input.Version is not null)CreditApplicationRules.Version(input.Version);CreditRequirementsRules.Validate(input.Content);
        await LockAsync("sayman:credit:requirements:v1",ct);var hash=CreditApplicationRules.Hash(JsonSerializer.Serialize(input,Json));
        var previous=await db.RequirementsPublishCommands.AsNoTracking().SingleOrDefaultAsync(x=>x.ActorId==actor&&x.CommandId==commandId,ct);
        if(previous is not null){if(previous.PayloadHash!=hash)throw IdempotencyConflict();return ReadPublishReceipt(previous)with{Replayed=true};}
        var head=await db.RequirementsHead.SingleOrDefaultAsync(ct);
        if((head is null?null:Convert.ToBase64String(head.Version))!=input.Version)throw CreditRequirementsRules.Conflict();
        var content=input.Content with{Documents=input.Content.Documents.Select(x=>x with{ContentTypes=CreditRequirementsRules.ContentTypes(CreditRequirementsRules.TypeMask(x.ContentTypes))}).ToArray()};
        var now=clock.GetUtcNow().ToUniversalTime();if(head is not null&&now<head.ChangedAt)now=head.ChangedAt;
        var row=new CreditRequirementsRevision{TitleFa=content.TitleFa,TitleEn=content.TitleEn,TermsFa=content.TermsFa,TermsEn=content.TermsEn,ConsentLabelFa=content.ConsentLabelFa,ConsentLabelEn=content.ConsentLabelEn,Enabled=content.Enabled,CreatedBy=actor,CreatedAt=now};
        var snapshot=new CreditRequirementsRevisionData(row.Id,now,content);row.SnapshotHash=CreditApplicationRules.Hash(CreditRequirementsRules.Snapshot(snapshot));db.RequirementsRevisions.Add(row);
        for(var i=0;i<content.Documents.Length;i++){var d=content.Documents[i];db.RequirementDocuments.Add(new(){RevisionId=row.Id,Key=d.Key,Position=i,NameFa=d.NameFa,NameEn=d.NameEn,HelpFa=d.HelpFa,HelpEn=d.HelpEn,Required=d.Required,MaxBytes=d.MaxBytes,ContentTypeMask=CreditRequirementsRules.TypeMask(d.ContentTypes)});}
        if(head is null){head=new(){PublishedRevisionId=row.Id,ChangedAt=now};db.RequirementsHead.Add(head);}else{head.PublishedRevisionId=row.Id;head.ChangedAt=now;}
        await db.SaveChangesAsync(ct);var result=new PublishCreditRequirementsResult(1,false,commandId,new(1,Convert.ToBase64String(head.Version),snapshot));var raw=JsonSerializer.Serialize(result,Json);
        db.RequirementsPublishCommands.Add(new(){ActorId=actor,CommandId=commandId,RevisionId=row.Id,PayloadHash=hash,ResultHash=CreditApplicationRules.Hash(raw),ProtectedResult=protection.Protect(row.Id,"requirements-receipt",CreditApplicationRules.Hash(actor+":"+commandId),raw),At=now});await db.SaveChangesAsync(ct);return result;
    }
    public async Task<PublishCreditRequirementsResult> PublishReceiptAsync(string actor,string commandId,CancellationToken ct)
    {
        actor=CreditApplicationRules.Actor(actor);CreditApplicationRules.Id(commandId);var row=await db.RequirementsPublishCommands.AsNoTracking().SingleOrDefaultAsync(x=>x.ActorId==actor&&x.CommandId==commandId,ct)??throw CreditApplicationRules.Missing();return ReadPublishReceipt(row)with{Replayed=true};
    }
    public async Task<CreditCaseRequirements> CaseAsync(string actor,bool staff,string applicationId,CancellationToken ct)
    {
        var app=await VisibleAsync(actor,staff,applicationId,false,ct);var current=await CurrentAsync(ct);var consent=app.CurrentConsentId is{}id?await ConsentAsync(app,id,ct):null;
        return new(1,CreditApplicationService.Summary(app),current,consent,app.State=="Draft"&&current.Published is{Content.Enabled:true}&&consent?.Requirements.Id!=current.Published.Id);
    }
    public async Task<AcceptCreditRequirementsResult> AcceptAsync(string actor,string applicationId,string commandId,AcceptCreditRequirementsInput input,CancellationToken ct)
    {
        actor=CreditApplicationRules.Actor(actor);CreditApplicationRules.Id(applicationId);CreditApplicationRules.Id(commandId);if(input is null||!input.Accepted)throw CreditRequirementsRules.Invalid();CreditApplicationRules.Version(input.ApplicationVersion);CreditApplicationRules.Version(input.RequirementsVersion);CreditApplicationRules.Id(input.RequirementsRevisionId);CreditApplicationRules.Locale(input.Locale);
        // Stable lock order with publishing. The second gate is shared with
        // existing create/cancel commands; consent cannot race cancellation.
        await LockAsync("sayman:credit:requirements:v1",ct);await LockAsync("sayman:credit:application-commands:v1",ct);
        var hash=CreditApplicationRules.Hash(JsonSerializer.Serialize(new{ApplicationId=applicationId,Input=input},Json));
        var previous=await db.RequirementsConsentCommands.AsNoTracking().SingleOrDefaultAsync(x=>x.ActorId==actor&&x.CommandId==commandId,ct);
        if(previous is not null){if(previous.PayloadHash!=hash||previous.ApplicationId!=applicationId)throw IdempotencyConflict();await VisibleAsync(actor,false,applicationId,false,ct);return ReadConsentReceipt(previous)with{Replayed=true};}
        var app=await VisibleAsync(actor,false,applicationId,true,ct);var head=await db.RequirementsHead.AsNoTracking().SingleOrDefaultAsync(ct);
        if(app.State!="Draft"||Convert.ToBase64String(app.Version)!=input.ApplicationVersion||head is null||Convert.ToBase64String(head.Version)!=input.RequirementsVersion||head.PublishedRevisionId!=input.RequirementsRevisionId)throw CreditRequirementsRules.Conflict();
        var revision=await RevisionAsync(head.PublishedRevisionId,ct);if(!revision.Content.Enabled)throw CreditRequirementsRules.Conflict();
        if(app.CurrentConsentId is{}currentConsent&&(await ConsentAsync(app,currentConsent,ct)).Requirements.Id==revision.Id)throw CreditRequirementsRules.Conflict();
        var now=clock.GetUtcNow().ToUniversalTime();if(now<app.ChangedAt)now=app.ChangedAt;if(now<revision.CreatedAt)now=revision.CreatedAt;
        var consent=new CreditRequirementsConsent{ApplicationId=app.Id,RevisionId=revision.Id,ActorId=actor,Locale=input.Locale,RequirementsHash=CreditApplicationRules.Hash(CreditRequirementsRules.Snapshot(revision)),AcceptedAt=now};
        db.RequirementsConsents.Add(consent);app.CurrentConsentId=consent.Id;app.ChangedAt=now;db.ApplicationEvents.Add(new(){ApplicationId=app.Id,ActorId=actor,Action="Consented",At=now});await db.SaveChangesAsync(ct);
        var result=new AcceptCreditRequirementsResult(1,false,commandId,CreditApplicationService.Summary(app),new(consent.Id,consent.Locale,consent.AcceptedAt,revision));var raw=JsonSerializer.Serialize(result,Json);
        db.RequirementsConsentCommands.Add(new(){ActorId=actor,CommandId=commandId,ApplicationId=app.Id,ConsentId=consent.Id,PayloadHash=hash,ResultHash=CreditApplicationRules.Hash(raw),ProtectedResult=protection.Protect(app.Id,"consent-receipt",CreditApplicationRules.Hash(actor+":"+commandId),raw),At=now});await db.SaveChangesAsync(ct);return result;
    }
    public async Task<AcceptCreditRequirementsResult> ConsentReceiptAsync(string actor,string applicationId,string commandId,CancellationToken ct)
    {
        actor=CreditApplicationRules.Actor(actor);CreditApplicationRules.Id(applicationId);CreditApplicationRules.Id(commandId);await VisibleAsync(actor,false,applicationId,false,ct);
        var row=await db.RequirementsConsentCommands.AsNoTracking().SingleOrDefaultAsync(x=>x.ActorId==actor&&x.CommandId==commandId&&x.ApplicationId==applicationId,ct)??throw CreditApplicationRules.Missing();return ReadConsentReceipt(row)with{Replayed=true};
    }
    internal async Task<CreditRequirementsConsentData> ConsentAsync(CreditApplication app,string id,CancellationToken ct)
    {
        var row=await db.RequirementsConsents.AsNoTracking().SingleOrDefaultAsync(x=>x.Id==id&&x.ApplicationId==app.Id,ct)??throw CreditApplicationRules.Unavailable();var revision=await RevisionAsync(row.RevisionId,ct);
        if(row.ActorId!=app.OwnerId||row.RequirementsHash!=CreditApplicationRules.Hash(CreditRequirementsRules.Snapshot(revision))||row.AcceptedAt<app.CreatedAt||row.AcceptedAt<revision.CreatedAt||row.AcceptedAt.Offset!=TimeSpan.Zero||row.Locale is not("fa"or"en"))throw CreditApplicationRules.Unavailable();return new(row.Id,row.Locale,row.AcceptedAt,revision);
    }
    private async Task<CreditApplication> VisibleAsync(string actor,bool staff,string id,bool tracking,CancellationToken ct)
    {
        actor=CreditApplicationRules.Actor(actor);CreditApplicationRules.Id(id);var q=tracking?db.Applications.AsQueryable():db.Applications.AsNoTracking();return await q.SingleOrDefaultAsync(x=>x.Id==id&&(staff||x.OwnerId==actor),ct)??throw CreditApplicationRules.Missing();
    }
    private PublishCreditRequirementsResult ReadPublishReceipt(CreditRequirementsPublishCommand row)
    {
        var value=ReadReceipt<PublishCreditRequirementsResult>(row.RevisionId,"requirements-receipt",row.ActorId,row.CommandId,row.ProtectedResult,row.ResultHash);
        if(value.SchemaVersion!=1||value.Replayed||value.CommandId!=row.CommandId||value.Current.Published?.Id!=row.RevisionId||value.Current.Version is null)throw CreditApplicationRules.Unavailable();CreditApplicationRules.Version(value.Current.Version);CreditRequirementsRules.Snapshot(value.Current.Published);return value;
    }
    private AcceptCreditRequirementsResult ReadConsentReceipt(CreditRequirementsConsentCommand row)
    {
        var value=ReadReceipt<AcceptCreditRequirementsResult>(row.ApplicationId,"consent-receipt",row.ActorId,row.CommandId,row.ProtectedResult,row.ResultHash);
        if(value.SchemaVersion!=1||value.Replayed||value.CommandId!=row.CommandId||value.Application.Id!=row.ApplicationId||value.Consent.Id!=row.ConsentId||value.Application.State!="Draft")throw CreditApplicationRules.Unavailable();CreditRequirementsRules.Snapshot(value.Consent.Requirements);return value;
    }
    private T ReadReceipt<T>(string scope,string kind,string actor,string command,byte[] bytes,string hash)
    {
        try{var raw=protection.Unprotect(scope,kind,CreditApplicationRules.Hash(actor+":"+command),bytes);if(CreditApplicationRules.Hash(raw)!=hash)throw CreditApplicationRules.Unavailable();return JsonSerializer.Deserialize<T>(raw,Json)??throw CreditApplicationRules.Unavailable();}catch(JsonException){throw CreditApplicationRules.Unavailable();}
    }
    internal async Task LockAsync(string resource,CancellationToken ct)
    {
        var tx=db.Database.CurrentTransaction??throw new InvalidOperationException("Credit requirements commands require the root audited Serializable transaction.");if(tx.GetDbTransaction().IsolationLevel!=IsolationLevel.Serializable)throw new InvalidOperationException("Serializable isolation is required.");
        await using var command=db.Database.GetDbConnection().CreateCommand();command.Transaction=tx.GetDbTransaction();command.CommandTimeout=15;command.CommandText="DECLARE @r int; EXEC @r=sys.sp_getapplock @Resource=@name,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @r;";var parameter=command.CreateParameter();parameter.ParameterName="@name";parameter.Value=resource;command.Parameters.Add(parameter);if(Convert.ToInt32(await command.ExecuteScalarAsync(ct),CultureInfo.InvariantCulture)<0)throw new BusinessException("credit_application_busy","Credit commands are busy. Retry the original command.");
    }
    private static BusinessException IdempotencyConflict()=>new("credit_application_idempotency_conflict","This command ID has different input.");
}
