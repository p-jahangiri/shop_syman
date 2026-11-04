using Microsoft.EntityFrameworkCore;

namespace Shop.Modules.Credit;

public sealed class CreditSubmission
{
    public string Id{get;set;}=Guid.NewGuid().ToString("N");
    public long Sequence{get;set;}
    public string ApplicationId{get;set;}="";
    public string ConsentId{get;set;}="";
    public string RequirementsRevisionId{get;set;}="";
    public string ApplicationVersion{get;set;}="";
    public string RequirementsVersion{get;set;}="";
    public string ActorId{get;set;}="";
    public string Locale{get;set;}="";
    public int DocumentCount{get;set;}
    public byte[] ProtectedNote{get;set;}=[];
    public string NoteHash{get;set;}="";
    public DateTimeOffset SubmittedAt{get;set;}
}
public sealed class CreditSubmissionDocument
{
    public string SubmissionId{get;set;}="";
    public string ApplicationId{get;set;}="";
    public string ConsentId{get;set;}="";
    public string RequirementsRevisionId{get;set;}="";
    public string DocumentKey{get;set;}="";
    public int Position{get;set;}
    public string AttachmentId{get;set;}="";
    public string MetadataHash{get;set;}="";
}
public sealed class CreditSubmissionCommand
{
    public string ActorId{get;set;}="";
    public string CommandId{get;set;}="";
    public string ApplicationId{get;set;}="";
    public string SubmissionId{get;set;}="";
    public string PayloadHash{get;set;}="";
    public string ResultHash{get;set;}="";
    public byte[] ProtectedResult{get;set;}=[];
    public DateTimeOffset At{get;set;}
}
internal static class CreditSubmissionModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<CreditSubmission>(e=>{
            e.ToTable("Submissions",t=>{t.HasCheckConstraint("CK_CreditSubmission_Time","DATEPART(TZOFFSET,[SubmittedAt])=0");t.HasCheckConstraint("CK_CreditSubmission_Locale","[Locale] IN ('fa','en')");t.HasCheckConstraint("CK_CreditSubmission_Documents","[DocumentCount] BETWEEN 0 AND 12");t.HasCheckConstraint("CK_CreditSubmission_Note","DATALENGTH([ProtectedNote]) BETWEEN 1 AND 16384");});
            e.HasKey(x=>x.Id);e.Property(x=>x.Id).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.Sequence).UseIdentityColumn();e.HasIndex(x=>x.Sequence).IsUnique();e.Property(x=>x.ApplicationId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.ConsentId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.RequirementsRevisionId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.ApplicationVersion).HasMaxLength(12).IsUnicode(false);e.Property(x=>x.RequirementsVersion).HasMaxLength(12).IsUnicode(false);e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.Locale).HasMaxLength(2).IsUnicode(false);e.Property(x=>x.NoteHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ProtectedNote).HasMaxLength(16384);
            e.HasAlternateKey(x=>new{x.Id,x.ApplicationId});e.HasAlternateKey(x=>new{x.Id,x.ApplicationId,x.ConsentId,x.RequirementsRevisionId});e.HasIndex(x=>new{x.ApplicationId,x.Sequence});
            e.HasOne<CreditRequirementsConsent>().WithMany().HasForeignKey(x=>new{x.ConsentId,x.ApplicationId,x.RequirementsRevisionId}).HasPrincipalKey(x=>new{x.Id,x.ApplicationId,x.RevisionId}).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<CreditApplication>(e=>{e.ToTable("Applications",t=>t.HasCheckConstraint("CK_CreditApplication_Submission","[State] <> 'Submitted' OR [CurrentSubmissionId] IS NOT NULL"));e.Property(x=>x.CurrentSubmissionId).HasMaxLength(32).IsUnicode(false);e.HasOne<CreditSubmission>().WithMany().HasForeignKey(x=>new{x.CurrentSubmissionId,x.Id}).HasPrincipalKey(x=>new{x.Id,x.ApplicationId}).OnDelete(DeleteBehavior.Restrict);});
        b.Entity<CreditSubmissionDocument>(e=>{
            e.ToTable("SubmissionDocuments",t=>t.HasCheckConstraint("CK_CreditSubmissionDocument_Position","[Position] BETWEEN 0 AND 11"));e.HasKey(x=>new{x.SubmissionId,x.DocumentKey});e.Property(x=>x.SubmissionId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.ApplicationId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.ConsentId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.RequirementsRevisionId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.DocumentKey).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.AttachmentId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.MetadataHash).HasMaxLength(64).IsUnicode(false);e.HasIndex(x=>new{x.SubmissionId,x.Position}).IsUnique();e.HasIndex(x=>new{x.SubmissionId,x.AttachmentId}).IsUnique();
            e.HasOne<CreditSubmission>().WithMany().HasForeignKey(x=>new{x.SubmissionId,x.ApplicationId,x.ConsentId,x.RequirementsRevisionId}).HasPrincipalKey(x=>new{x.Id,x.ApplicationId,x.ConsentId,x.RequirementsRevisionId}).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<CreditDocumentAttachment>().WithMany().HasForeignKey(x=>new{x.AttachmentId,x.ApplicationId,x.ConsentId,x.DocumentKey}).HasPrincipalKey(x=>new{x.Id,x.ApplicationId,x.ConsentId,x.DocumentKey}).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<CreditSubmissionCommand>(e=>{
            e.ToTable("SubmissionCommands",t=>{t.HasCheckConstraint("CK_CreditSubmissionCommand_Result","DATALENGTH([ProtectedResult]) BETWEEN 1 AND 65536");t.HasCheckConstraint("CK_CreditSubmissionCommand_Time","DATEPART(TZOFFSET,[At])=0");});e.HasKey(x=>new{x.ActorId,x.CommandId});e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.CommandId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.ApplicationId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.SubmissionId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.PayloadHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ResultHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ProtectedResult).HasMaxLength(65536);e.HasOne<CreditSubmission>().WithMany().HasForeignKey(x=>new{x.SubmissionId,x.ApplicationId}).HasPrincipalKey(x=>new{x.Id,x.ApplicationId}).OnDelete(DeleteBehavior.Restrict);
        });
    }
}
public sealed partial class CreditDbContext
{
    public DbSet<CreditSubmission> Submissions=>Set<CreditSubmission>();
    public DbSet<CreditSubmissionDocument> SubmissionDocuments=>Set<CreditSubmissionDocument>();
    public DbSet<CreditSubmissionCommand> SubmissionCommands=>Set<CreditSubmissionCommand>();
    private void GuardSubmissions()
    {
        ChangeTracker.DetectChanges();if(ChangeTracker.Entries().Any(e=>(e.Entity is CreditSubmission or CreditSubmissionDocument or CreditSubmissionCommand)&&(e.State is EntityState.Modified or EntityState.Deleted)))throw CreditApplicationRules.Immutable();
        foreach(var e in ChangeTracker.Entries<CreditSubmission>().Where(x=>x.State==EntityState.Added)){
            var x=e.Entity;CreditApplicationRules.Id(x.Id);CreditApplicationRules.Id(x.ApplicationId);CreditApplicationRules.Id(x.ConsentId);CreditApplicationRules.Id(x.RequirementsRevisionId);CreditApplicationRules.Version(x.ApplicationVersion);CreditApplicationRules.Version(x.RequirementsVersion);CreditApplicationRules.Locale(x.Locale);CreditApplicationRules.Digest(x.NoteHash);if(x.ActorId!=CreditApplicationRules.Actor(x.ActorId)||x.SubmittedAt.Offset!=TimeSpan.Zero||x.DocumentCount is <0 or >12||x.ProtectedNote.Length is <1 or >16384)throw CreditApplicationRules.Invalid();
        }
        foreach(var e in ChangeTracker.Entries<CreditSubmissionDocument>().Where(x=>x.State==EntityState.Added)){
            var x=e.Entity;CreditApplicationRules.Id(x.SubmissionId);CreditApplicationRules.Id(x.ApplicationId);CreditApplicationRules.Id(x.ConsentId);CreditApplicationRules.Id(x.RequirementsRevisionId);CreditApplicationRules.Id(x.AttachmentId);CreditApplicationRules.Key(x.DocumentKey);CreditApplicationRules.Digest(x.MetadataHash);if(x.Position is <0 or >11)throw CreditApplicationRules.Invalid();
        }
        foreach(var e in ChangeTracker.Entries<CreditSubmissionCommand>().Where(x=>x.State==EntityState.Added)){
            var x=e.Entity;CreditApplicationRules.Id(x.CommandId);CreditApplicationRules.Id(x.SubmissionId);CreditApplicationRules.Id(x.ApplicationId);CreditApplicationRules.Digest(x.PayloadHash);CreditApplicationRules.Digest(x.ResultHash);if(x.ActorId!=CreditApplicationRules.Actor(x.ActorId)||x.At.Offset!=TimeSpan.Zero||x.ProtectedResult.Length is <1 or >65536)throw CreditApplicationRules.Invalid();
        }
    }
}
