using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;
namespace Shop.Modules.Credit;

public sealed class CreditApplication
{
    public string Id{get;set;}=Guid.NewGuid().ToString("N");
    public long Sequence{get;set;}
    public string OwnerId{get;set;}="";
    public string PlanId{get;set;}="";
    public string PlanVersion{get;set;}="";
    public long RequestedAmountRial{get;set;}
    public string Locale{get;set;}="fa";
    public string State{get;set;}="Draft";
    public string? CurrentConsentId{get;set;}
    public string? CurrentSubmissionId{get;set;}
    public string? CurrentReviewId{get;set;}
    public string? CurrentPurchaseScopeId{get;set;}
    public byte[] ProtectedPlan{get;set;}=[];
    public string PlanHash{get;set;}="";
    public DateTimeOffset CreatedAt{get;set;}
    public DateTimeOffset ChangedAt{get;set;}
    public byte[] Version{get;set;}=[];
}
public sealed class CreditApplicationEvent
{
    public long Sequence{get;set;}
    public string ApplicationId{get;set;}="";
    public string ActorId{get;set;}="";
    public string Action{get;set;}="";
    public DateTimeOffset At{get;set;}
}
public sealed class CreditApplicationCommand
{
    public string ActorId{get;set;}="";
    public string CommandId{get;set;}="";
    public string ApplicationId{get;set;}="";
    public string PayloadHash{get;set;}="";
    public byte[] ProtectedResult{get;set;}=[];
    public string ResultHash{get;set;}="";
    public DateTimeOffset At{get;set;}
}
internal static class CreditApplicationModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<CreditApplication>(e=>{
            e.ToTable("Applications",t=>{t.HasCheckConstraint("CK_CreditApplication_State","[State] IN ('Draft','Submitted','Cancelled','Approved','Declined')");t.HasCheckConstraint("CK_CreditApplication_Locale","[Locale] IN ('fa','en')");t.HasCheckConstraint("CK_CreditApplication_Amount","[RequestedAmountRial]>0");t.HasCheckConstraint("CK_CreditApplication_Plan","DATALENGTH([ProtectedPlan]) BETWEEN 1 AND 65536");t.HasCheckConstraint("CK_CreditApplication_Time","[ChangedAt]>=[CreatedAt] AND DATEPART(TZOFFSET,[CreatedAt])=0 AND DATEPART(TZOFFSET,[ChangedAt])=0");});
            e.HasKey(x=>x.Id);e.Property(x=>x.Id).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.Sequence).UseIdentityColumn();e.HasIndex(x=>x.Sequence).IsUnique();e.Property(x=>x.OwnerId).HasMaxLength(64);e.Property(x=>x.PlanId).HasMaxLength(64);e.Property(x=>x.PlanVersion).HasMaxLength(12).IsUnicode(false);e.Property(x=>x.Locale).HasMaxLength(2).IsUnicode(false);e.Property(x=>x.State).HasMaxLength(16).IsUnicode(false);e.Property(x=>x.ProtectedPlan).HasMaxLength(65536);e.Property(x=>x.PlanHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.Version).IsRowVersion();e.HasIndex(x=>new{x.OwnerId,x.State,x.Sequence});e.HasIndex(x=>new{x.State,x.Sequence});
            e.HasOne<ChequePlan>().WithMany().HasForeignKey(x=>x.PlanId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<CreditApplicationEvent>(e=>{
            e.ToTable("ApplicationEvents",t=>{t.HasCheckConstraint("CK_CreditApplicationEvent_Action","[Action] IN ('Created','Cancelled','Consented','DocumentAttached','Submitted','Withdrawn','Returned','Approved','Declined','ScopeGranted','ScopeRevoked','ScopeUsed')");t.HasCheckConstraint("CK_CreditApplicationEvent_Time","DATEPART(TZOFFSET,[At])=0");});e.HasKey(x=>x.Sequence);e.Property(x=>x.Sequence).UseIdentityColumn();e.Property(x=>x.ApplicationId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.Action).HasMaxLength(16).IsUnicode(false);e.HasOne<CreditApplication>().WithMany().HasForeignKey(x=>x.ApplicationId).OnDelete(DeleteBehavior.Restrict);e.HasIndex(x=>new{x.ApplicationId,x.Sequence});
        });
        b.Entity<CreditApplicationCommand>(e=>{
            e.ToTable("ApplicationCommands",t=>t.HasCheckConstraint("CK_CreditApplicationCommand_Result","DATALENGTH([ProtectedResult]) BETWEEN 1 AND 65536"));e.HasKey(x=>new{x.ActorId,x.CommandId});e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.CommandId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.ApplicationId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.PayloadHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ResultHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ProtectedResult).HasMaxLength(65536);e.HasOne<CreditApplication>().WithMany().HasForeignKey(x=>x.ApplicationId).OnDelete(DeleteBehavior.Restrict);
        });
    }
}
public sealed partial class CreditDbContext
{
    public DbSet<CreditApplication> Applications=>Set<CreditApplication>();
    public DbSet<CreditApplicationEvent> ApplicationEvents=>Set<CreditApplicationEvent>();
    public DbSet<CreditApplicationCommand> ApplicationCommands=>Set<CreditApplicationCommand>();
    private void GuardApplications()
    {
        ChangeTracker.DetectChanges();
        foreach(var e in ChangeTracker.Entries<CreditApplication>()){
            if(e.State==EntityState.Deleted)throw CreditApplicationRules.Immutable();
            if(e.State==EntityState.Added){var row=e.Entity;CreditApplicationRules.Id(row.Id);if(CreditApplicationRules.Actor(row.OwnerId)!=row.OwnerId)throw CreditApplicationRules.Invalid();CreditApplicationRules.Key(row.PlanId);CreditApplicationRules.Version(row.PlanVersion);CreditApplicationRules.Locale(row.Locale);CreditApplicationRules.Digest(row.PlanHash);if(row.State!="Draft"||row.CurrentConsentId is not null||row.CurrentSubmissionId is not null||row.CurrentReviewId is not null||row.CurrentPurchaseScopeId is not null||row.RequestedAmountRial<=0||row.CreatedAt!=row.ChangedAt||row.CreatedAt.Offset!=TimeSpan.Zero||row.ProtectedPlan.Length is <1 or >65536)throw CreditApplicationRules.Invalid();}
            if(e.State==EntityState.Modified){
                if(e.Properties.Any(p=>p.IsModified&&p.Metadata.Name is not(nameof(CreditApplication.State)or nameof(CreditApplication.ChangedAt)or nameof(CreditApplication.CurrentConsentId)or nameof(CreditApplication.CurrentSubmissionId)or nameof(CreditApplication.CurrentReviewId)or nameof(CreditApplication.CurrentPurchaseScopeId))))throw CreditApplicationRules.Immutable();
                var original=e.Property(x=>x.State).OriginalValue;var reviewChanged=e.Property(x=>x.CurrentReviewId).IsModified;var scopeChanged=e.Property(x=>x.CurrentPurchaseScopeId).IsModified;
                var cancelled=!scopeChanged&&!reviewChanged&&(original is "Draft"or"Submitted")&&e.Entity.State=="Cancelled"&&!e.Property(x=>x.CurrentConsentId).IsModified&&!e.Property(x=>x.CurrentSubmissionId).IsModified;
                var consented=!scopeChanged&&!reviewChanged&&original=="Draft"&&e.Entity.State=="Draft"&&e.Property(x=>x.CurrentConsentId).IsModified&&!e.Property(x=>x.CurrentSubmissionId).IsModified&&e.Entity.CurrentConsentId is not null&&e.Entity.CurrentConsentId!=e.Property(x=>x.CurrentConsentId).OriginalValue;
                var documented=!scopeChanged&&!reviewChanged&&original=="Draft"&&e.Entity.State=="Draft"&&!e.Property(x=>x.CurrentConsentId).IsModified&&!e.Property(x=>x.CurrentSubmissionId).IsModified&&!e.Property(x=>x.State).IsModified&&ChangeTracker.Entries<CreditDocumentAttachment>().Any(d=>d.State==EntityState.Added&&d.Entity.ApplicationId==e.Entity.Id)&&ChangeTracker.Entries<CreditApplicationEvent>().Any(d=>d.State==EntityState.Added&&d.Entity.ApplicationId==e.Entity.Id&&d.Entity.Action=="DocumentAttached");
                var submitted=!scopeChanged&&(!reviewChanged||e.Entity.CurrentReviewId is null)&&original=="Draft"&&e.Entity.State=="Submitted"&&!e.Property(x=>x.CurrentConsentId).IsModified&&e.Property(x=>x.CurrentSubmissionId).IsModified&&e.Entity.CurrentSubmissionId is not null&&e.Entity.CurrentSubmissionId!=e.Property(x=>x.CurrentSubmissionId).OriginalValue&&ChangeTracker.Entries<CreditSubmission>().Any(d=>d.State==EntityState.Added&&d.Entity.ApplicationId==e.Entity.Id&&d.Entity.Id==e.Entity.CurrentSubmissionId)&&ChangeTracker.Entries<CreditApplicationEvent>().Any(d=>d.State==EntityState.Added&&d.Entity.ApplicationId==e.Entity.Id&&d.Entity.Action=="Submitted");
                var reviewed=!scopeChanged&&original=="Submitted"&&!e.Property(x=>x.CurrentConsentId).IsModified&&!e.Property(x=>x.CurrentSubmissionId).IsModified&&reviewChanged&&e.Entity.CurrentReviewId is not null&&ChangeTracker.Entries<CreditApplicationReview>().Any(d=>d.State==EntityState.Added&&d.Entity.ApplicationId==e.Entity.Id&&d.Entity.SubmissionId==e.Entity.CurrentSubmissionId&&d.Entity.Id==e.Entity.CurrentReviewId&&e.Entity.State==(d.Entity.Outcome=="Returned"?"Draft":d.Entity.Outcome)&&ChangeTracker.Entries<CreditApplicationEvent>().Any(v=>v.State==EntityState.Added&&v.Entity.ApplicationId==e.Entity.Id&&v.Entity.Action==d.Entity.Outcome));
                var scoped=original=="Approved"&&e.Entity.State=="Approved"&&!e.Property(x=>x.State).IsModified&&!reviewChanged&&!e.Property(x=>x.CurrentConsentId).IsModified&&!e.Property(x=>x.CurrentSubmissionId).IsModified&&scopeChanged&&e.Property(x=>x.CurrentPurchaseScopeId).OriginalValue is null&&e.Entity.CurrentPurchaseScopeId is not null&&ChangeTracker.Entries<CreditPurchaseScope>().Any(d=>d.State==EntityState.Added&&d.Entity.Id==e.Entity.CurrentPurchaseScopeId&&d.Entity.ApplicationId==e.Entity.Id&&d.Entity.ReviewId==e.Entity.CurrentReviewId)&&ChangeTracker.Entries<CreditApplicationEvent>().Any(d=>d.State==EntityState.Added&&d.Entity.ApplicationId==e.Entity.Id&&d.Entity.Action=="ScopeGranted");
                var revoked=original=="Approved"&&e.Entity.State=="Approved"&&!e.Property(x=>x.State).IsModified&&!reviewChanged&&!scopeChanged&&!e.Property(x=>x.CurrentConsentId).IsModified&&!e.Property(x=>x.CurrentSubmissionId).IsModified&&e.Entity.CurrentPurchaseScopeId is not null&&ChangeTracker.Entries<CreditScopeRevocation>().Any(d=>d.State==EntityState.Added&&d.Entity.ScopeId==e.Entity.CurrentPurchaseScopeId&&d.Entity.ApplicationId==e.Entity.Id)&&ChangeTracker.Entries<CreditApplicationEvent>().Any(d=>d.State==EntityState.Added&&d.Entity.ApplicationId==e.Entity.Id&&d.Entity.Action=="ScopeRevoked");
                var used=original=="Approved"&&e.Entity.State=="Approved"&&!e.Property(x=>x.State).IsModified&&!reviewChanged&&!scopeChanged&&!e.Property(x=>x.CurrentConsentId).IsModified&&!e.Property(x=>x.CurrentSubmissionId).IsModified&&e.Entity.CurrentPurchaseScopeId is not null&&ChangeTracker.Entries<CreditPurchaseScopeUse>().Any(d=>d.State==EntityState.Added&&d.Entity.ScopeId==e.Entity.CurrentPurchaseScopeId&&d.Entity.ApplicationId==e.Entity.Id&&d.Entity.ActorId==e.Entity.OwnerId)&&ChangeTracker.Entries<CreditApplicationEvent>().Any(d=>d.State==EntityState.Added&&d.Entity.ApplicationId==e.Entity.Id&&d.Entity.Action=="ScopeUsed");
                if((!cancelled&&!consented&&!documented&&!submitted&&!reviewed&&!scoped&&!revoked&&!used)||e.Entity.ChangedAt<e.Property(x=>x.ChangedAt).OriginalValue||e.Entity.ChangedAt.Offset!=TimeSpan.Zero)throw CreditApplicationRules.Immutable();
                if(consented)CreditApplicationRules.Id(e.Entity.CurrentConsentId!);if(submitted)CreditApplicationRules.Id(e.Entity.CurrentSubmissionId!);if(reviewed)CreditApplicationRules.Id(e.Entity.CurrentReviewId!);if(scoped)CreditApplicationRules.Id(e.Entity.CurrentPurchaseScopeId!);
            }
        }
        if(ChangeTracker.Entries().Any(e=>(e.Entity is CreditApplicationEvent or CreditApplicationCommand)&&(e.State is EntityState.Modified or EntityState.Deleted)))throw CreditApplicationRules.Immutable();
        foreach(var e in ChangeTracker.Entries<CreditApplicationEvent>().Where(e=>e.State==EntityState.Added)){var row=e.Entity;CreditApplicationRules.Id(row.ApplicationId);if(CreditApplicationRules.Actor(row.ActorId)!=row.ActorId||row.Action is not("Created"or"Cancelled"or"Consented"or"DocumentAttached"or"Submitted"or"Withdrawn"or"Returned"or"Approved"or"Declined"or"ScopeGranted"or"ScopeRevoked"or"ScopeUsed")||row.At.Offset!=TimeSpan.Zero)throw CreditApplicationRules.Invalid();}
        foreach(var e in ChangeTracker.Entries<CreditApplicationCommand>().Where(e=>e.State==EntityState.Added)){var row=e.Entity;CreditApplicationRules.Id(row.ApplicationId);CreditApplicationRules.Id(row.CommandId);CreditApplicationRules.Digest(row.PayloadHash);CreditApplicationRules.Digest(row.ResultHash);if(CreditApplicationRules.Actor(row.ActorId)!=row.ActorId||row.ProtectedResult.Length is <1 or >65536||row.At.Offset!=TimeSpan.Zero)throw CreditApplicationRules.Invalid();}
    }
    public override int SaveChanges(){GuardCreditReminders(); GuardCreditReminderPolicies();GuardClearances();GuardChequeApprovals();GuardUpfront();GuardChequeLedger();GuardSchedules();GuardPurchaseUses();GuardPurchaseScopes();GuardReviews();GuardSubmissions();GuardDocuments();GuardRequirements();GuardApplications();return base.SaveChanges();}
    public override int SaveChanges(bool accept){GuardCreditReminders(); GuardCreditReminderPolicies();GuardClearances();GuardChequeApprovals();GuardUpfront();GuardChequeLedger();GuardSchedules();GuardPurchaseUses();GuardPurchaseScopes();GuardReviews();GuardSubmissions();GuardDocuments();GuardRequirements();GuardApplications();return base.SaveChanges(accept);}
    public override Task<int> SaveChangesAsync(CancellationToken ct=default){GuardCreditReminders(); GuardCreditReminderPolicies();GuardClearances();GuardChequeApprovals();GuardUpfront();GuardChequeLedger();GuardSchedules();GuardPurchaseUses();GuardPurchaseScopes();GuardReviews();GuardSubmissions();GuardDocuments();GuardRequirements();GuardApplications();return base.SaveChangesAsync(ct);}
    public override Task<int> SaveChangesAsync(bool accept,CancellationToken ct=default){GuardCreditReminders(); GuardCreditReminderPolicies();GuardClearances();GuardChequeApprovals();GuardUpfront();GuardChequeLedger();GuardSchedules();GuardPurchaseUses();GuardPurchaseScopes();GuardReviews();GuardSubmissions();GuardDocuments();GuardRequirements();GuardApplications();return base.SaveChangesAsync(accept,ct);}
}
