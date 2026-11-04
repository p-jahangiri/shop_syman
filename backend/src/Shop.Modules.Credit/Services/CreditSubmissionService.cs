using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Credit;

public sealed class CreditSubmissionService(CreditDbContext db,CreditRequirementsService requirements,CreditApplicationService applications,IPrivateFileVault vault,ICreditApplicationProtection protection,TimeProvider clock)
{
    private static readonly JsonSerializerOptions Json=CreditRequirementsRules.Json;
    private sealed record Selected(CreditDocumentAttachment Attachment,PrivateFileDescriptor File);
    private sealed record Inspection(CreditCaseRequirements Requirements,Selected[] Documents,string[] Missing,int Required,string[] Blockers);
    public async Task<CreditSubmissionCapabilities> CapabilitiesAsync(string actor,bool staff,string applicationId,CancellationToken ct)
    {
        var app=await Visible(actor,staff,applicationId,false,ct);var inspected=await Inspect(app,ct);var latest=app.CurrentSubmissionId is{}id?Summary(await Submission(app.Id,id,ct)):null;
        return new(1,CreditApplicationService.Summary(app),app.CurrentConsentId,inspected.Requirements.Current.Published?.Id,inspected.Requirements.Current.Version,!staff&&inspected.Blockers.Length==0,!staff&&app.State=="Submitted",inspected.Required,inspected.Documents.Length,inspected.Missing,inspected.Blockers,latest);
    }
    public async Task<CreditSubmissionResult> SubmitAsync(string actor,string applicationId,string commandId,SubmitCreditApplicationInput input,CancellationToken ct)
    {
        actor=CreditApplicationRules.Actor(actor);CreditApplicationRules.Id(applicationId);CreditApplicationRules.Id(commandId);input=CreditSubmissionRules.Validate(input);var hash=CreditApplicationRules.Hash(JsonSerializer.Serialize(new{ApplicationId=applicationId,Input=input},Json));
        await requirements.LockAsync("sayman:credit:requirements:v1",ct);await requirements.LockAsync("sayman:credit:application-commands:v1",ct);
        var app=await Visible(actor,false,applicationId,true,ct);var previous=await db.SubmissionCommands.AsNoTracking().SingleOrDefaultAsync(x=>x.ActorId==actor&&x.CommandId==commandId,ct);
        if(previous is not null){if(previous.ApplicationId!=applicationId||previous.PayloadHash!=hash)throw new BusinessException("credit_application_idempotency_conflict","This command ID has different input.");return Receipt(previous)with{Replayed=true};}
        if(app.State!="Draft"||Convert.ToBase64String(app.Version)!=input.ApplicationVersion||app.CurrentConsentId!=input.ConsentId)throw CreditSubmissionRules.Conflict();
        var inspected=await Inspect(app,ct);if(inspected.Blockers.Length!=0||inspected.Requirements.Current.Version!=input.RequirementsVersion||inspected.Requirements.Current.Published?.Id!=input.RequirementsRevisionId||inspected.Requirements.Consent?.Id!=input.ConsentId)throw CreditSubmissionRules.Conflict();
        var now=clock.GetUtcNow().ToUniversalTime();if(now<app.ChangedAt)now=app.ChangedAt;
        var row=new CreditSubmission{ApplicationId=app.Id,ConsentId=input.ConsentId,RequirementsRevisionId=input.RequirementsRevisionId,ApplicationVersion=input.ApplicationVersion,RequirementsVersion=input.RequirementsVersion,ActorId=actor,Locale=input.Locale,DocumentCount=inspected.Documents.Length,SubmittedAt=now};var note=JsonSerializer.Serialize(input.Note,Json);row.NoteHash=CreditApplicationRules.Hash(note);row.ProtectedNote=protection.Protect(app.Id,"submission-note",row.Id,note);db.Submissions.Add(row);
        for(var i=0;i<inspected.Documents.Length;i++){var d=inspected.Documents[i];db.SubmissionDocuments.Add(new(){SubmissionId=row.Id,ApplicationId=app.Id,ConsentId=row.ConsentId,RequirementsRevisionId=row.RequirementsRevisionId,DocumentKey=d.Attachment.DocumentKey,Position=i,AttachmentId=d.Attachment.Id,MetadataHash=MetadataHash(d.File)});}
        app.State="Submitted";app.CurrentReviewId=null;app.CurrentSubmissionId=row.Id;app.ChangedAt=now;db.ApplicationEvents.Add(new(){ApplicationId=app.Id,ActorId=actor,Action="Submitted",At=now});await db.SaveChangesAsync(ct);
        var result=new CreditSubmissionResult(1,false,commandId,CreditApplicationService.Summary(app),Summary(row),input.Note);var raw=JsonSerializer.Serialize(result,Json);db.SubmissionCommands.Add(new(){ActorId=actor,CommandId=commandId,ApplicationId=app.Id,SubmissionId=row.Id,PayloadHash=hash,ResultHash=CreditApplicationRules.Hash(raw),ProtectedResult=protection.Protect(app.Id,"submission-receipt",CreditApplicationRules.Hash(actor+":"+commandId),raw),At=now});await db.SaveChangesAsync(ct);return result;
    }
    public async Task<CreditSubmissionResult> ReceiptAsync(string actor,string applicationId,string commandId,CancellationToken ct)
    {
        actor=CreditApplicationRules.Actor(actor);CreditApplicationRules.Id(commandId);await Visible(actor,false,applicationId,false,ct);var row=await db.SubmissionCommands.AsNoTracking().SingleOrDefaultAsync(x=>x.ActorId==actor&&x.ApplicationId==applicationId&&x.CommandId==commandId,ct)??throw CreditApplicationRules.Missing();return Receipt(row)with{Replayed=true};
    }
    public async Task<CreditSubmissionPage> PageAsync(string actor,bool staff,string applicationId,string? cursor,CancellationToken ct)
    {
        await Visible(actor,staff,applicationId,false,ct);var before=CreditApplicationRules.Cursor(cursor,"credit-submissions-v1|"+applicationId);var rows=await db.Submissions.AsNoTracking().Where(x=>x.ApplicationId==applicationId&&x.Sequence<before).OrderByDescending(x=>x.Sequence).Take(21).ToArrayAsync(ct);if(rows.Length>20)throw CreditApplicationRules.Unavailable();return new(1,applicationId,rows.Select(Summary).ToArray(),null);
    }
    public async Task<CreditSubmissionDetail> DetailAsync(string actor,bool staff,string applicationId,string submissionId,CancellationToken ct)
    {
        var app=await Visible(actor,staff,applicationId,false,ct);var row=await Submission(applicationId,submissionId,ct);var summary=Summary(row);var consent=await requirements.ConsentAsync(app,row.ConsentId,ct);if(consent.Requirements.Id!=row.RequirementsRevisionId||row.ActorId!=app.OwnerId||row.SubmittedAt<consent.AcceptedAt)throw CreditApplicationRules.Unavailable();
        var links=await db.SubmissionDocuments.AsNoTracking().Where(x=>x.SubmissionId==row.Id).OrderBy(x=>x.Position).Take(13).ToArrayAsync(ct);if(links.Length!=row.DocumentCount||links.Length>12||links.Where((x,i)=>x.Position!=i).Any())throw CreditApplicationRules.Unavailable();var documents=new List<CreditSubmissionFileData>();
        foreach(var link in links){if(link.ApplicationId!=app.Id||link.ConsentId!=row.ConsentId||link.RequirementsRevisionId!=row.RequirementsRevisionId)throw CreditApplicationRules.Unavailable();var definition=consent.Requirements.Content.Documents.SingleOrDefault(x=>x.Key==link.DocumentKey)??throw CreditApplicationRules.Unavailable();var file=await vault.DescribeAsync(new("credit",app.Id,app.OwnerId),link.AttachmentId,ct);if(MetadataHash(file)!=link.MetadataHash||file.Bytes>definition.MaxBytes||!definition.ContentTypes.Contains(file.ContentType,StringComparer.Ordinal))throw CreditApplicationRules.Unavailable();documents.Add(new(link.DocumentKey,link.AttachmentId,definition.Required,file));}
        if(consent.Requirements.Content.Documents.Any(x=>x.Required&&!links.Any(y=>y.DocumentKey==x.Key)))throw CreditApplicationRules.Unavailable();var plan=(await applications.DetailAsync(actor,staff,applicationId,ct)).Plan;return new(1,CreditApplicationService.Summary(app),summary,plan,consent,ReadNote(row),documents.ToArray());
    }
    private async Task<Inspection> Inspect(CreditApplication app,CancellationToken ct)
    {
        var current=await requirements.CaseAsync(app.OwnerId,false,app.Id,ct);if(current.Application.Version!=Convert.ToBase64String(app.Version))throw CreditApplicationRules.Unavailable();var blockers=new List<string>();if(app.State=="Cancelled")blockers.Add("application_cancelled");if(app.State=="Submitted")blockers.Add("application_submitted");if(app.State=="Approved")blockers.Add("application_approved");if(app.State=="Declined")blockers.Add("application_declined");
        var head=current.Current.Published;if(head is not{Content.Enabled:true})blockers.Add("credit_requirements_unavailable");var consentCurrent=current.Consent is not null&&current.Consent.Id==app.CurrentConsentId&&current.Consent.Requirements.Id==head?.Id;if(!consentCurrent)blockers.Add("credit_current_consent_required");
        var plan=await db.Plans.AsNoTracking().SingleOrDefaultAsync(x=>x.Id==app.PlanId,ct);if(plan is null||!plan.Enabled||Convert.ToBase64String(plan.Version)!=app.PlanVersion||app.RequestedAmountRial<plan.MinAmountRial||app.RequestedAmountRial>plan.MaxAmountRial)blockers.Add("credit_plan_changed");
        var definitions=head?.Content.Documents??[];var selected=new List<Selected>();if(consentCurrent){var rows=await db.DocumentAttachments.AsNoTracking().Where(x=>x.ApplicationId==app.Id&&x.ConsentId==app.CurrentConsentId).OrderByDescending(x=>x.Sequence).Take(CreditDocumentService.MaxAttachments+1).ToArrayAsync(ct);if(rows.Length>CreditDocumentService.MaxAttachments||rows.Any(x=>x.RequirementsRevisionId!=head!.Id||!definitions.Any(d=>d.Key==x.DocumentKey)))throw CreditApplicationRules.Unavailable();foreach(var d in definitions){var row=rows.FirstOrDefault(x=>x.DocumentKey==d.Key);if(row is null)continue;var file=await vault.DescribeAsync(new("credit",app.Id,app.OwnerId),row.Id,ct);if(file.Bytes>d.MaxBytes||!d.ContentTypes.Contains(file.ContentType,StringComparer.Ordinal))throw CreditApplicationRules.Unavailable();selected.Add(new(row,file));}}
        var missing=definitions.Where(d=>d.Required&&!selected.Any(x=>x.Attachment.DocumentKey==d.Key)).Select(x=>x.Key).ToArray();if(missing.Length>0)blockers.Add("credit_required_documents_missing");if((selected.Count>0||definitions.Any(x=>x.Required))&&!vault.Configured)blockers.Add("private_file_unavailable");if(await db.Submissions.CountAsync(x=>x.ApplicationId==app.Id,ct)>=20)blockers.Add("credit_submission_capacity");
        return new(current,selected.ToArray(),missing,definitions.Count(x=>x.Required),blockers.ToArray());
    }
    private async Task<CreditApplication> Visible(string actor,bool staff,string id,bool tracking,CancellationToken ct)
    {
        actor=CreditApplicationRules.Actor(actor);CreditApplicationRules.Id(id);var query=tracking?db.Applications.AsQueryable():db.Applications.AsNoTracking();return await query.SingleOrDefaultAsync(x=>x.Id==id&&(staff||x.OwnerId==actor),ct)??throw CreditApplicationRules.Missing();
    }
    private async Task<CreditSubmission> Submission(string applicationId,string id,CancellationToken ct){CreditApplicationRules.Id(id);return await db.Submissions.AsNoTracking().SingleOrDefaultAsync(x=>x.Id==id&&x.ApplicationId==applicationId,ct)??throw CreditApplicationRules.Missing();}
    private static CreditSubmissionSummary Summary(CreditSubmission row)
    {
        CreditApplicationRules.Id(row.Id);CreditApplicationRules.Id(row.ConsentId);CreditApplicationRules.Id(row.RequirementsRevisionId);CreditApplicationRules.Locale(row.Locale);if(row.DocumentCount is <0 or >12||row.SubmittedAt.Offset!=TimeSpan.Zero)throw CreditApplicationRules.Unavailable();return new(row.Id,row.ConsentId,row.RequirementsRevisionId,row.Locale,row.DocumentCount,row.SubmittedAt);
    }
    private string ReadNote(CreditSubmission row)
    {
        try{var raw=protection.Unprotect(row.ApplicationId,"submission-note",row.Id,row.ProtectedNote);if(CreditApplicationRules.Hash(raw)!=row.NoteHash)throw CreditApplicationRules.Unavailable();var note=JsonSerializer.Deserialize<string>(raw,Json)??throw CreditApplicationRules.Unavailable();return CreditRequirementsRules.Text(note,2000,true);}catch(Exception e)when(e is JsonException or BusinessException){throw CreditApplicationRules.Unavailable();}
    }
    private CreditSubmissionResult Receipt(CreditSubmissionCommand row)
    {
        try{var raw=protection.Unprotect(row.ApplicationId,"submission-receipt",CreditApplicationRules.Hash(row.ActorId+":"+row.CommandId),row.ProtectedResult);if(CreditApplicationRules.Hash(raw)!=row.ResultHash)throw CreditApplicationRules.Unavailable();var value=JsonSerializer.Deserialize<CreditSubmissionResult>(raw,Json)??throw CreditApplicationRules.Unavailable();if(value.SchemaVersion!=1||value.Replayed||value.CommandId!=row.CommandId||value.Application.Id!=row.ApplicationId||value.Application.State!="Submitted"||value.Submission.Id!=row.SubmissionId||value.Application.ChangedAt!=value.Submission.SubmittedAt)throw CreditApplicationRules.Unavailable();CreditRequirementsRules.Text(value.Note,2000,true);return value;}catch(JsonException){throw CreditApplicationRules.Unavailable();}
    }
    private static string MetadataHash(PrivateFileDescriptor file)=>CreditApplicationRules.Hash(JsonSerializer.Serialize(file,Json));
}
