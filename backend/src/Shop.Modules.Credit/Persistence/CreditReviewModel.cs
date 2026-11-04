using Microsoft.EntityFrameworkCore;
namespace Shop.Modules.Credit;
public sealed class CreditApplicationReview
{
    public string Id{get;set;}=Guid.NewGuid().ToString("N");public long Sequence{get;set;}public string ApplicationId{get;set;}="";public string SubmissionId{get;set;}="";public string Outcome{get;set;}="";public string Locale{get;set;}="";public long? ApprovedAmountRial{get;set;}public DateTimeOffset? ExpiresAt{get;set;}public string ActorId{get;set;}="";public byte[] ProtectedNote{get;set;}=[];public string NoteHash{get;set;}="";public DateTimeOffset At{get;set;}
}
public sealed class CreditReviewCommand
{
    public string ActorId{get;set;}="";public string CommandId{get;set;}="";public string ApplicationId{get;set;}="";public string ReviewId{get;set;}="";public string PayloadHash{get;set;}="";public string ResultHash{get;set;}="";public byte[] ProtectedResult{get;set;}=[];public DateTimeOffset At{get;set;}
}
internal static class CreditReviewModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<CreditApplicationReview>(e=>{
            e.ToTable("ApplicationReviews",t=>{t.HasCheckConstraint("CK_CreditReview_Outcome","[Outcome] IN ('Returned','Declined','Approved')");t.HasCheckConstraint("CK_CreditReview_Approval","([Outcome]='Approved' AND [ApprovedAmountRial] IS NOT NULL AND [ExpiresAt] IS NOT NULL AND [ApprovedAmountRial]>0 AND [ExpiresAt]>[At] AND DATEPART(TZOFFSET,[ExpiresAt])=0) OR ([Outcome]<>'Approved' AND [ApprovedAmountRial] IS NULL AND [ExpiresAt] IS NULL)");t.HasCheckConstraint("CK_CreditReview_Note","DATALENGTH([ProtectedNote]) BETWEEN 1 AND 16384");t.HasCheckConstraint("CK_CreditReview_Time","DATEPART(TZOFFSET,[At])=0");t.HasCheckConstraint("CK_CreditReview_Locale","[Locale] IN ('fa','en')");});e.HasKey(x=>x.Id);e.Property(x=>x.Id).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.Sequence).UseIdentityColumn();e.HasIndex(x=>x.Sequence).IsUnique();e.Property(x=>x.ApplicationId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.SubmissionId).HasMaxLength(32).IsUnicode(false);e.HasIndex(x=>x.SubmissionId).IsUnique();e.HasIndex(x=>new{x.ApplicationId,x.Sequence});e.Property(x=>x.Outcome).HasMaxLength(16).IsUnicode(false);e.Property(x=>x.Locale).HasMaxLength(2).IsUnicode(false);e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.NoteHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ProtectedNote).HasMaxLength(16384);e.HasAlternateKey(x=>new{x.Id,x.ApplicationId,x.SubmissionId});e.HasAlternateKey(x=>new{x.Id,x.ApplicationId});e.HasOne<CreditSubmission>().WithMany().HasForeignKey(x=>new{x.SubmissionId,x.ApplicationId}).HasPrincipalKey(x=>new{x.Id,x.ApplicationId}).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<CreditApplication>(e=>{e.ToTable("Applications",t=>t.HasCheckConstraint("CK_CreditApplication_Review","([CurrentReviewId] IS NULL OR [CurrentSubmissionId] IS NOT NULL) AND ([State] NOT IN ('Approved','Declined') OR [CurrentReviewId] IS NOT NULL)"));e.Property(x=>x.CurrentReviewId).HasMaxLength(32).IsUnicode(false);e.HasOne<CreditApplicationReview>().WithMany().HasForeignKey(x=>new{x.CurrentReviewId,x.Id,x.CurrentSubmissionId}).HasPrincipalKey(x=>new{x.Id,x.ApplicationId,x.SubmissionId}).OnDelete(DeleteBehavior.Restrict);});
        b.Entity<CreditReviewCommand>(e=>{e.ToTable("ReviewCommands",t=>{t.HasCheckConstraint("CK_CreditReviewCommand_Time","DATEPART(TZOFFSET,[At])=0");t.HasCheckConstraint("CK_CreditReviewCommand_Result","DATALENGTH([ProtectedResult]) BETWEEN 1 AND 65536");});e.HasKey(x=>new{x.ActorId,x.CommandId});e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.CommandId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.ApplicationId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.ReviewId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.PayloadHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ResultHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ProtectedResult).HasMaxLength(65536);e.HasOne<CreditApplicationReview>().WithMany().HasForeignKey(x=>new{x.ReviewId,x.ApplicationId}).HasPrincipalKey(x=>new{x.Id,x.ApplicationId}).OnDelete(DeleteBehavior.Restrict);});
    }
}
public sealed partial class CreditDbContext
{
    public DbSet<CreditApplicationReview> ApplicationReviews=>Set<CreditApplicationReview>();public DbSet<CreditReviewCommand> ReviewCommands=>Set<CreditReviewCommand>();
    private void GuardReviews()
    {
        ChangeTracker.DetectChanges();if(ChangeTracker.Entries().Any(e=>(e.Entity is CreditApplicationReview or CreditReviewCommand)&&(e.State is EntityState.Modified or EntityState.Deleted)))throw CreditApplicationRules.Immutable();
        foreach(var e in ChangeTracker.Entries<CreditApplicationReview>().Where(x=>x.State==EntityState.Added)){var x=e.Entity;CreditApplicationRules.Id(x.Id);CreditApplicationRules.Id(x.ApplicationId);CreditApplicationRules.Id(x.SubmissionId);CreditReviewRules.Outcome(x.Outcome);CreditApplicationRules.Locale(x.Locale);CreditApplicationRules.Digest(x.NoteHash);if(x.ActorId!=CreditApplicationRules.Actor(x.ActorId)||x.At.Offset!=TimeSpan.Zero||x.ProtectedNote.Length is <1 or >16384||!CreditReviewRules.ValidApproval(x.Outcome,x.ApprovedAmountRial,x.ExpiresAt,x.At))throw CreditReviewRules.Invalid();}
        foreach(var e in ChangeTracker.Entries<CreditReviewCommand>().Where(x=>x.State==EntityState.Added)){var x=e.Entity;CreditApplicationRules.Id(x.CommandId);CreditApplicationRules.Id(x.ApplicationId);CreditApplicationRules.Id(x.ReviewId);CreditApplicationRules.Digest(x.PayloadHash);CreditApplicationRules.Digest(x.ResultHash);if(x.ActorId!=CreditApplicationRules.Actor(x.ActorId)||x.At.Offset!=TimeSpan.Zero||x.ProtectedResult.Length is <1 or >65536)throw CreditReviewRules.Invalid();}
    }
}
