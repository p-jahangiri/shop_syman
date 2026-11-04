using System.Globalization;
using Microsoft.EntityFrameworkCore;
namespace Shop.Modules.Credit;
public sealed class CreditAutomaticReminderCandidate
{
    public string Id{get;set;}="";public string OwnerId{get;set;}="";public string OrderId{get;set;}="";
}
public sealed record CreditAutomaticReminderSent(CreditReminderInput Input,CreditReminderResult Result,string PolicyRevisionId,string PolicyVersion);
public sealed class CreditAutomaticReminderService(CreditDbContext db,CreditReminderPolicyService policies,CreditReminderService reminders,TimeProvider clock)
{
    public const string Actor="SYSTEM_CREDIT_REMINDER_V1";
    public static string CommandId(string cheque,string civilDay)=>CreditApplicationRules.Hash("Sayman.Credit.AutomaticReminder.v1:"+cheque+":"+civilDay)[..32].ToLowerInvariant();
    public async Task<CreditAutomaticReminderCandidate[]> CandidatesAsync(string policyRevision,string today,string? after,CancellationToken ct)
    {
        CreditApplicationRules.Id(policyRevision);var day=ChequeReportRules.Date(today);if(after is not null)CreditApplicationRules.Id(after);var last=after??"";
        // This detached candidate scan owns no Sales range locks. Every send re-enters the policy gate,
        // then the Sales owner gate and verifies the actual current ledger and immutable receipts.
        return await db.Database.SqlQuery<CreditAutomaticReminderCandidate>($"""
            SELECT TOP(20) c.[Id],c.[OwnerId],c.[OrderId]
            FROM [credit].[ReceivedCheques] c WITH (READCOMMITTEDLOCK)
            WHERE c.[Id]>{last}
              AND EXISTS(SELECT 1 FROM [credit].[ReminderPolicyOffsets] o WITH (READCOMMITTEDLOCK)
                WHERE o.[RevisionId]={policyRevision} AND o.[Days]=DATEDIFF(day,c.[DueDate],{day}))
              AND NOT EXISTS(SELECT 1 FROM [credit].[ReminderEvents] e WITH (READCOMMITTEDLOCK)
                WHERE e.[ChequeId]=c.[Id] AND e.[CivilDay]={day})
            ORDER BY c.[Id]
            """).ToArrayAsync(ct);
    }
    public async Task<CreditAutomaticReminderSent?> SendAsync(CreditAutomaticReminderCandidate candidate,string expectedRevision,string expectedDay,CancellationToken ct)
    {
        var p=(await policies.CurrentAsync(ct)).Current;var now=clock.GetUtcNow();if(p is null||!p.Enabled||p.Id!=expectedRevision||ChequeReportRules.Today(now)!=expectedDay)return null;
        var page=await reminders.PageAsync(candidate.OwnerId,candidate.OrderId,candidate.Id,true,ct);if(!page.CanSend||!CreditReminderPolicyRules.Due(p,page.Cheque.DueDate,now))return null;
        var note="AUTOMATIC_PRIVATE_REMINDER policy="+p.Id+" version="+p.Version+" civilDay="+expectedDay+"; internal schedule, no bank verification.";
        var input=new CreditReminderInput(page.OrderVersion,page.Cheque.Version,page.PreviewFingerprint,note,true);var result=await reminders.SendAsync(Actor,candidate.OwnerId,candidate.OrderId,candidate.Id,CommandId(candidate.Id,expectedDay),input,ct);return new(input,result,p.Id,p.Version);
    }
    public async Task EnsureCommitAsync(CreditAutomaticReminderCandidate c,CreditAutomaticReminderSent sent,string expectedDay,CancellationToken ct)
    {
        var p=(await policies.CurrentAsync(ct)).Current;var now=clock.GetUtcNow();if(p is null||p.Id!=sent.PolicyRevisionId||p.Version!=sent.PolicyVersion||ChequeReportRules.Today(now)!=expectedDay||!CreditReminderPolicyRules.Due(p,sent.Result.Event.Summary.DueDate,now))throw CreditReminderPolicyRules.Conflict();await reminders.EnsureCommitAsync(c.OwnerId,c.OrderId,c.Id,sent.Input,sent.Result,ct);
    }
}
