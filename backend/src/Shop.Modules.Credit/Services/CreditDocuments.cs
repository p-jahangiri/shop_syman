using System.Data;
using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;

namespace Shop.Modules.Credit;

public sealed record CreditDocumentInput(string Version,string ConsentId,string RequirementsRevisionId,string DocumentKey,string? ReplacesFileId,string Filename,string ContentType,int Bytes,string FileSha256);
public sealed record CreditDocumentInspection(PrivateFileScope Scope,CreditDocumentResult? Replay);
public sealed record CreditDocumentData(string Id,string ConsentId,string RequirementsRevisionId,string DocumentKey,[property:System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.Never)]string? ReplacesFileId,DateTimeOffset At,PrivateFileDescriptor File);
public sealed record CreditDocumentItem(CreditDocumentData Attachment,bool IsCurrent);
public sealed record CreditDocumentPage(int SchemaVersion,CreditApplicationSummary Application,[property:System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.Never)]string? CurrentConsentId,bool Configured,bool CanUpload,int MaxAttachments,string[] Blockers,CreditDocumentItem[] Items);
public sealed record CreditDocumentResult(int SchemaVersion,bool Replayed,string CommandId,CreditApplicationSummary Application,CreditDocumentData Attachment);

public sealed class CreditDocumentService(CreditDbContext db,CreditRequirementsService requirements,ICreditApplicationProtection protection,TimeProvider clock)
{
    public const int MaxAttachments=48;
    private static readonly JsonSerializerOptions Json=CreditRequirementsRules.Json;
    public static CreditDocumentInput Normalize(CreditDocumentInput input)
    {
        if(input is null)throw CreditApplicationRules.Invalid();CreditApplicationRules.Version(input.Version);CreditApplicationRules.Id(input.ConsentId);CreditApplicationRules.Id(input.RequirementsRevisionId);CreditApplicationRules.Key(input.DocumentKey);if(input.ReplacesFileId is{}id)CreditApplicationRules.Id(id);CreditApplicationRules.Digest(input.FileSha256);
        if(input.Filename is null||input.Filename.Length is <1 or >160||input.Filename!=input.Filename.Trim()||input.Bytes is <16 or >8388608||input.ContentType is not("image/jpeg"or"image/png"or"image/webp"or"application/pdf"))throw CreditApplicationRules.Invalid();return input;
    }
    public static string Intent(string applicationId,CreditDocumentInput input){CreditApplicationRules.Id(applicationId);return CreditApplicationRules.Hash(JsonSerializer.Serialize(new{Operation="credit_document",ApplicationId=applicationId,Input=Normalize(input)},Json));}
    public async Task<CreditDocumentInspection> InspectAsync(string actor,string applicationId,string commandId,CreditDocumentInput input,CancellationToken ct)
    {
        actor=CreditApplicationRules.Actor(actor);CreditApplicationRules.Id(commandId);input=Normalize(input);var app=await Visible(actor,false,applicationId,false,ct);var scope=new PrivateFileScope("credit",app.Id,app.OwnerId);var hash=Intent(applicationId,input);var replay=await Previous(actor,applicationId,commandId,hash,ct);if(replay is not null)return new(scope,replay);
        await ValidateCurrent(app,input,ct);return new(scope,null);
    }
    public async Task<CreditDocumentResult> AttachAsync(string actor,string applicationId,string commandId,CreditDocumentInput input,string fileId,IPrivateFileVault vault,CancellationToken ct)
    {
        actor=CreditApplicationRules.Actor(actor);CreditApplicationRules.Id(commandId);CreditApplicationRules.Id(fileId);input=Normalize(input);var hash=Intent(applicationId,input);
        await Gate("sayman:credit:requirements:v1",ct);await Gate("sayman:credit:application-commands:v1",ct);
        var app=await Visible(actor,false,applicationId,true,ct);var replay=await Previous(actor,applicationId,commandId,hash,ct);if(replay is not null)return replay;
        await ValidateCurrent(app,input,ct);var now=clock.GetUtcNow().ToUniversalTime();if(now<app.ChangedAt)now=app.ChangedAt;
        var row=new CreditDocumentAttachment{Id=fileId,ApplicationId=app.Id,ConsentId=input.ConsentId,RequirementsRevisionId=input.RequirementsRevisionId,DocumentKey=input.DocumentKey,ReplacesFileId=input.ReplacesFileId,ActorId=actor,At=now};db.DocumentAttachments.Add(row);
        app.ChangedAt=now;db.Entry(app).Property(x=>x.ChangedAt).IsModified=true;db.ApplicationEvents.Add(new(){ApplicationId=app.Id,ActorId=actor,Action="DocumentAttached",At=now});await db.SaveChangesAsync(ct);
        await vault.AttachAsync(new("credit",app.Id,app.OwnerId),fileId,actor,commandId,hash,ct);
        var result=new CreditDocumentResult(1,false,commandId,CreditApplicationService.Summary(app),new(row.Id,row.ConsentId,row.RequirementsRevisionId,row.DocumentKey,row.ReplacesFileId,row.At,new(input.Filename,input.ContentType,input.Bytes)));var raw=JsonSerializer.Serialize(result,Json);
        db.DocumentCommands.Add(new(){ActorId=actor,CommandId=commandId,ApplicationId=app.Id,FileId=fileId,PayloadHash=hash,ResultHash=CreditApplicationRules.Hash(raw),ProtectedResult=protection.Protect(app.Id,"document-receipt",CreditApplicationRules.Hash(actor+":"+commandId),raw),At=now});await db.SaveChangesAsync(ct);return result;
    }
    public async Task<CreditDocumentResult> ReceiptAsync(string actor,string applicationId,string commandId,CancellationToken ct)
    {
        actor=CreditApplicationRules.Actor(actor);CreditApplicationRules.Id(commandId);await Visible(actor,false,applicationId,false,ct);var row=await db.DocumentCommands.AsNoTracking().SingleOrDefaultAsync(x=>x.ActorId==actor&&x.ApplicationId==applicationId&&x.CommandId==commandId,ct)??throw CreditApplicationRules.Missing();return Receipt(row)with{Replayed=true};
    }
    public async Task<CreditDocumentPage> PageAsync(string actor,bool staff,string applicationId,IPrivateFileVault vault,CancellationToken ct)
    {
        var app=await Visible(actor,staff,applicationId,false,ct);var current=await requirements.CaseAsync(actor,staff,applicationId,ct);var blockers=new List<string>();
        if(app.State=="Cancelled")blockers.Add("application_cancelled");if(app.State=="Submitted")blockers.Add("application_submitted");if(app.State=="Approved")blockers.Add("application_approved");if(app.State=="Declined")blockers.Add("application_declined");if(current.Current.Published is not{Content.Enabled:true})blockers.Add("credit_requirements_unavailable");if(app.CurrentConsentId is null||current.Consent?.Requirements.Id!=current.Current.Published?.Id)blockers.Add("credit_current_consent_required");if(!vault.Configured)blockers.Add("private_file_unavailable");
        var rows=await db.DocumentAttachments.AsNoTracking().Where(x=>x.ApplicationId==applicationId).OrderByDescending(x=>x.Sequence).Take(MaxAttachments+1).ToArrayAsync(ct);if(rows.Length>MaxAttachments)throw CreditApplicationRules.Unavailable();if(rows.Length==MaxAttachments)blockers.Add("credit_document_capacity");
        var seen=new HashSet<string>(StringComparer.Ordinal);var items=new List<CreditDocumentItem>();foreach(var row in rows){var latest=seen.Add(row.ConsentId+":"+row.DocumentKey);var file=await vault.DescribeAsync(new("credit",app.Id,app.OwnerId),row.Id,ct);items.Add(new(new(row.Id,row.ConsentId,row.RequirementsRevisionId,row.DocumentKey,row.ReplacesFileId,row.At,file),latest&&row.ConsentId==app.CurrentConsentId));}
        // Staff can inspect historical documents but never upload on behalf of
        // the customer or manufacture the customer's consent.
        return new(1,CreditApplicationService.Summary(app),app.CurrentConsentId,vault.Configured,!staff&&blockers.Count==0,MaxAttachments,blockers.ToArray(),items.ToArray());
    }
    public async Task<PrivateFileScope> ScopeAsync(string actor,bool staff,string applicationId,string fileId,CancellationToken ct)
    {
        CreditApplicationRules.Id(fileId);var app=await Visible(actor,staff,applicationId,false,ct);if(!await db.DocumentAttachments.AsNoTracking().AnyAsync(x=>x.Id==fileId&&x.ApplicationId==applicationId,ct))throw CreditApplicationRules.Missing();return new("credit",app.Id,app.OwnerId);
    }
    private async Task ValidateCurrent(CreditApplication app,CreditDocumentInput input,CancellationToken ct)
    {
        if(app.State!="Draft"||Convert.ToBase64String(app.Version)!=input.Version||app.CurrentConsentId!=input.ConsentId)throw Conflict();
        var current=await requirements.CaseAsync(app.OwnerId,false,app.Id,ct);
        if(current.Current.Published is not{Content.Enabled:true}||current.Consent is null||current.Consent.Id!=input.ConsentId||current.Consent.Requirements.Id!=input.RequirementsRevisionId||current.Current.Published.Id!=input.RequirementsRevisionId)throw Conflict();
        var definition=current.Consent.Requirements.Content.Documents.SingleOrDefault(x=>x.Key==input.DocumentKey);if(definition is null||input.Bytes>definition.MaxBytes||!definition.ContentTypes.Contains(input.ContentType,StringComparer.Ordinal))throw new BusinessException("invalid_credit_document","The document does not match the consented document definition.");
        var previous=await db.DocumentAttachments.AsNoTracking().Where(x=>x.ApplicationId==app.Id&&x.ConsentId==input.ConsentId&&x.DocumentKey==input.DocumentKey).OrderByDescending(x=>x.Sequence).Select(x=>x.Id).FirstOrDefaultAsync(ct);if(previous!=input.ReplacesFileId)throw Conflict();
        if(await db.DocumentAttachments.CountAsync(x=>x.ApplicationId==app.Id,ct)>=MaxAttachments)throw new BusinessException("credit_document_capacity","This application reached its historical document limit.");
    }
    private async Task<CreditDocumentResult?> Previous(string actor,string applicationId,string commandId,string hash,CancellationToken ct)
    {
        var previous=await db.DocumentCommands.AsNoTracking().SingleOrDefaultAsync(x=>x.ActorId==actor&&x.CommandId==commandId,ct);if(previous is null)return null;if(previous.ApplicationId!=applicationId||previous.PayloadHash!=hash)throw new BusinessException("credit_application_idempotency_conflict","This command ID has different input.");return Receipt(previous)with{Replayed=true};
    }
    private CreditDocumentResult Receipt(CreditDocumentCommand row)
    {
        try{var raw=protection.Unprotect(row.ApplicationId,"document-receipt",CreditApplicationRules.Hash(row.ActorId+":"+row.CommandId),row.ProtectedResult);if(CreditApplicationRules.Hash(raw)!=row.ResultHash)throw CreditApplicationRules.Unavailable();var result=JsonSerializer.Deserialize<CreditDocumentResult>(raw,Json)??throw CreditApplicationRules.Unavailable();if(result.SchemaVersion!=1||result.Replayed||result.CommandId!=row.CommandId||result.Application.Id!=row.ApplicationId||result.Application.State!="Draft"||result.Attachment.Id!=row.FileId)throw CreditApplicationRules.Unavailable();CreditApplicationRules.Id(result.Attachment.ConsentId);CreditApplicationRules.Id(result.Attachment.RequirementsRevisionId);CreditApplicationRules.Key(result.Attachment.DocumentKey);return result;}catch(JsonException){throw CreditApplicationRules.Unavailable();}
    }
    private async Task<CreditApplication> Visible(string actor,bool staff,string id,bool tracking,CancellationToken ct)
    {
        actor=CreditApplicationRules.Actor(actor);CreditApplicationRules.Id(id);var q=tracking?db.Applications.AsQueryable():db.Applications.AsNoTracking();return await q.SingleOrDefaultAsync(x=>x.Id==id&&(staff||x.OwnerId==actor),ct)??throw CreditApplicationRules.Missing();
    }
    private async Task Gate(string resource,CancellationToken ct)
    {
        var tx=db.Database.CurrentTransaction??throw new InvalidOperationException("Credit document attachment requires the root audited Serializable transaction.");if(tx.GetDbTransaction().IsolationLevel!=IsolationLevel.Serializable)throw new InvalidOperationException("Serializable isolation is required.");await using var command=db.Database.GetDbConnection().CreateCommand();command.Transaction=tx.GetDbTransaction();command.CommandTimeout=15;command.CommandText="DECLARE @r int; EXEC @r=sys.sp_getapplock @Resource=@name,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @r;";var parameter=command.CreateParameter();parameter.ParameterName="@name";parameter.Value=resource;command.Parameters.Add(parameter);if(Convert.ToInt32(await command.ExecuteScalarAsync(ct),CultureInfo.InvariantCulture)<0)throw new BusinessException("credit_application_busy","Credit commands are busy. Retry the original command.");
    }
    private static BusinessException Conflict()=>new("credit_document_conflict","Review the current application, consent and selected document before uploading.");
}
