using Microsoft.EntityFrameworkCore;

namespace Shop.Modules.Credit;

public sealed class CreditRequirementsHead
{
    public int Id{get;set;}=1;
    public string PublishedRevisionId{get;set;}="";
    public DateTimeOffset ChangedAt{get;set;}
    public byte[] Version{get;set;}=[];
}
public sealed class CreditRequirementsRevision
{
    public string Id{get;set;}=Guid.NewGuid().ToString("N");
    public long Sequence{get;set;}
    public string TitleFa{get;set;}="";public string TitleEn{get;set;}="";
    public string TermsFa{get;set;}="";public string TermsEn{get;set;}="";
    public string ConsentLabelFa{get;set;}="";public string ConsentLabelEn{get;set;}="";
    public bool Enabled{get;set;}
    public string CreatedBy{get;set;}="";
    public DateTimeOffset CreatedAt{get;set;}
    public string SnapshotHash{get;set;}="";
}
public sealed class CreditRequirementDocument
{
    public string RevisionId{get;set;}="";public string Key{get;set;}="";public int Position{get;set;}
    public string NameFa{get;set;}="";public string NameEn{get;set;}="";
    public string HelpFa{get;set;}="";public string HelpEn{get;set;}="";
    public bool Required{get;set;}public int MaxBytes{get;set;}public int ContentTypeMask{get;set;}
}
public sealed class CreditRequirementsPublishCommand
{
    public string ActorId{get;set;}="";public string CommandId{get;set;}="";public string RevisionId{get;set;}="";
    public string PayloadHash{get;set;}="";public string ResultHash{get;set;}="";public byte[] ProtectedResult{get;set;}=[];public DateTimeOffset At{get;set;}
}
public sealed class CreditRequirementsConsent
{
    public string Id{get;set;}=Guid.NewGuid().ToString("N");
    public string ApplicationId{get;set;}="";public string RevisionId{get;set;}="";public string ActorId{get;set;}="";
    public string Locale{get;set;}="";public string RequirementsHash{get;set;}="";public DateTimeOffset AcceptedAt{get;set;}
}
public sealed class CreditRequirementsConsentCommand
{
    public string ActorId{get;set;}="";public string CommandId{get;set;}="";public string ApplicationId{get;set;}="";public string ConsentId{get;set;}="";
    public string PayloadHash{get;set;}="";public string ResultHash{get;set;}="";public byte[] ProtectedResult{get;set;}=[];public DateTimeOffset At{get;set;}
}
internal static class CreditRequirementsModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<CreditRequirementsRevision>(e=>{
            e.ToTable("RequirementsRevisions",t=>t.HasCheckConstraint("CK_CreditRequirementsRevision_Time","DATEPART(TZOFFSET,[CreatedAt])=0"));e.HasKey(x=>x.Id);e.Property(x=>x.Id).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.Sequence).UseIdentityColumn();e.HasIndex(x=>x.Sequence).IsUnique();e.Property(x=>x.TitleFa).HasMaxLength(160);e.Property(x=>x.TitleEn).HasMaxLength(160);e.Property(x=>x.TermsFa).HasMaxLength(4000);e.Property(x=>x.TermsEn).HasMaxLength(4000);e.Property(x=>x.ConsentLabelFa).HasMaxLength(500);e.Property(x=>x.ConsentLabelEn).HasMaxLength(500);e.Property(x=>x.CreatedBy).HasMaxLength(64);e.Property(x=>x.SnapshotHash).HasMaxLength(64).IsUnicode(false);
        });
        b.Entity<CreditRequirementsHead>(e=>{
            e.ToTable("RequirementsHead",t=>{t.HasCheckConstraint("CK_CreditRequirementsHead_Only","[Id]=1");t.HasCheckConstraint("CK_CreditRequirementsHead_Time","DATEPART(TZOFFSET,[ChangedAt])=0");});e.HasKey(x=>x.Id);e.Property(x=>x.Id).ValueGeneratedNever();e.Property(x=>x.PublishedRevisionId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.Version).IsRowVersion();e.HasOne<CreditRequirementsRevision>().WithMany().HasForeignKey(x=>x.PublishedRevisionId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<CreditRequirementDocument>(e=>{
            e.ToTable("RequirementDocuments",t=>{t.HasCheckConstraint("CK_CreditRequirementDocument_Position","[Position] BETWEEN 0 AND 11");t.HasCheckConstraint("CK_CreditRequirementDocument_File","[MaxBytes] BETWEEN 1 AND 8388608 AND [ContentTypeMask] BETWEEN 1 AND 15");});e.HasKey(x=>new{x.RevisionId,x.Key});e.Property(x=>x.RevisionId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.Key).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.NameFa).HasMaxLength(120);e.Property(x=>x.NameEn).HasMaxLength(120);e.Property(x=>x.HelpFa).HasMaxLength(300);e.Property(x=>x.HelpEn).HasMaxLength(300);e.HasIndex(x=>new{x.RevisionId,x.Position}).IsUnique();e.HasOne<CreditRequirementsRevision>().WithMany().HasForeignKey(x=>x.RevisionId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<CreditRequirementsPublishCommand>(e=>{
            e.ToTable("RequirementsPublishCommands",t=>{t.HasCheckConstraint("CK_CreditRequirementsPublishCommand_Result","DATALENGTH([ProtectedResult]) BETWEEN 1 AND 65536");t.HasCheckConstraint("CK_CreditRequirementsPublishCommand_Time","DATEPART(TZOFFSET,[At])=0");});e.HasKey(x=>new{x.ActorId,x.CommandId});e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.CommandId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.RevisionId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.PayloadHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ResultHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ProtectedResult).HasMaxLength(65536);e.HasOne<CreditRequirementsRevision>().WithMany().HasForeignKey(x=>x.RevisionId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<CreditRequirementsConsent>(e=>{
            e.ToTable("RequirementsConsents",t=>{t.HasCheckConstraint("CK_CreditRequirementsConsent_Locale","[Locale] IN ('fa','en')");t.HasCheckConstraint("CK_CreditRequirementsConsent_Time","DATEPART(TZOFFSET,[AcceptedAt])=0");});e.HasKey(x=>x.Id);e.HasAlternateKey(x=>new{x.Id,x.ApplicationId});e.Property(x=>x.Id).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.ApplicationId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.RevisionId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.Locale).HasMaxLength(2).IsUnicode(false);e.Property(x=>x.RequirementsHash).HasMaxLength(64).IsUnicode(false);e.HasOne<CreditApplication>().WithMany().HasForeignKey(x=>x.ApplicationId).OnDelete(DeleteBehavior.Restrict);e.HasOne<CreditRequirementsRevision>().WithMany().HasForeignKey(x=>x.RevisionId).OnDelete(DeleteBehavior.Restrict);e.HasIndex(x=>new{x.ApplicationId,x.AcceptedAt});
        });
        b.Entity<CreditRequirementsConsentCommand>(e=>{
            e.ToTable("RequirementsConsentCommands",t=>{t.HasCheckConstraint("CK_CreditRequirementsConsentCommand_Result","DATALENGTH([ProtectedResult]) BETWEEN 1 AND 65536");t.HasCheckConstraint("CK_CreditRequirementsConsentCommand_Time","DATEPART(TZOFFSET,[At])=0");});e.HasKey(x=>new{x.ActorId,x.CommandId});e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.CommandId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.ApplicationId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.ConsentId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.PayloadHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ResultHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ProtectedResult).HasMaxLength(65536);e.HasOne<CreditRequirementsConsent>().WithMany().HasForeignKey(x=>new{x.ConsentId,x.ApplicationId}).HasPrincipalKey(x=>new{x.Id,x.ApplicationId}).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<CreditApplication>(e=>{
            e.Property(x=>x.CurrentConsentId).HasMaxLength(32).IsUnicode(false);
            e.HasOne<CreditRequirementsConsent>().WithMany().HasForeignKey(x=>new{x.CurrentConsentId,x.Id}).HasPrincipalKey(x=>new{x.Id,x.ApplicationId}).OnDelete(DeleteBehavior.Restrict);
        });
    }
}
public sealed partial class CreditDbContext
{
    public DbSet<CreditRequirementsHead> RequirementsHead=>Set<CreditRequirementsHead>();
    public DbSet<CreditRequirementsRevision> RequirementsRevisions=>Set<CreditRequirementsRevision>();
    public DbSet<CreditRequirementDocument> RequirementDocuments=>Set<CreditRequirementDocument>();
    public DbSet<CreditRequirementsPublishCommand> RequirementsPublishCommands=>Set<CreditRequirementsPublishCommand>();
    public DbSet<CreditRequirementsConsent> RequirementsConsents=>Set<CreditRequirementsConsent>();
    public DbSet<CreditRequirementsConsentCommand> RequirementsConsentCommands=>Set<CreditRequirementsConsentCommand>();
    private void GuardRequirements()
    {
        ChangeTracker.DetectChanges();
        foreach(var e in ChangeTracker.Entries()){
            if(e.Entity is CreditRequirementsRevision or CreditRequirementDocument or CreditRequirementsPublishCommand or CreditRequirementsConsent or CreditRequirementsConsentCommand){if(e.State is EntityState.Modified or EntityState.Deleted)throw CreditRequirementsRules.Immutable();}
        }
        foreach(var e in ChangeTracker.Entries<CreditRequirementsHead>().Where(e=>e.State!=EntityState.Unchanged)){
            if(e.State==EntityState.Deleted)throw CreditRequirementsRules.Immutable();var row=e.Entity;CreditApplicationRules.Id(row.PublishedRevisionId);if(row.Id!=1||row.ChangedAt.Offset!=TimeSpan.Zero)throw CreditRequirementsRules.Invalid();
            if(e.State==EntityState.Modified&&(e.Properties.Any(p=>p.IsModified&&p.Metadata.Name is not(nameof(CreditRequirementsHead.PublishedRevisionId)or nameof(CreditRequirementsHead.ChangedAt)))||row.PublishedRevisionId==e.Property(x=>x.PublishedRevisionId).OriginalValue||row.ChangedAt<e.Property(x=>x.ChangedAt).OriginalValue))throw CreditRequirementsRules.Immutable();
        }
        foreach(var e in ChangeTracker.Entries<CreditRequirementsRevision>().Where(e=>e.State==EntityState.Added)){
            var x=e.Entity;CreditApplicationRules.Id(x.Id);CreditApplicationRules.Digest(x.SnapshotHash);if(CreditApplicationRules.Actor(x.CreatedBy)!=x.CreatedBy||x.CreatedAt.Offset!=TimeSpan.Zero)throw CreditRequirementsRules.Invalid();CreditRequirementsRules.Validate(new(x.TitleFa,x.TitleEn,x.TermsFa,x.TermsEn,x.ConsentLabelFa,x.ConsentLabelEn,x.Enabled,[]));
        }
        foreach(var e in ChangeTracker.Entries<CreditRequirementDocument>().Where(e=>e.State==EntityState.Added)){
            var x=e.Entity;CreditApplicationRules.Id(x.RevisionId);CreditApplicationRules.Key(x.Key);if(x.Position is <0 or >11||x.MaxBytes is <1 or >8388608)throw CreditRequirementsRules.Invalid();CreditRequirementsRules.ContentTypes(x.ContentTypeMask);CreditRequirementsRules.Text(x.NameFa,120);CreditRequirementsRules.Text(x.NameEn,120);CreditRequirementsRules.Text(x.HelpFa,300,true);CreditRequirementsRules.Text(x.HelpEn,300,true);
        }
        foreach(var e in ChangeTracker.Entries<CreditRequirementsConsent>().Where(e=>e.State==EntityState.Added)){
            var x=e.Entity;CreditApplicationRules.Id(x.Id);CreditApplicationRules.Id(x.ApplicationId);CreditApplicationRules.Id(x.RevisionId);CreditApplicationRules.Locale(x.Locale);CreditApplicationRules.Digest(x.RequirementsHash);if(CreditApplicationRules.Actor(x.ActorId)!=x.ActorId||x.AcceptedAt.Offset!=TimeSpan.Zero)throw CreditRequirementsRules.Invalid();
        }
        foreach(var e in ChangeTracker.Entries<CreditRequirementsPublishCommand>().Where(e=>e.State==EntityState.Added)){var x=e.Entity;CreditApplicationRules.Id(x.RevisionId);GuardRequirementCommand(x.ActorId,x.CommandId,x.PayloadHash,x.ResultHash,x.ProtectedResult,x.At);}
        foreach(var e in ChangeTracker.Entries<CreditRequirementsConsentCommand>().Where(e=>e.State==EntityState.Added)){var x=e.Entity;CreditApplicationRules.Id(x.ApplicationId);CreditApplicationRules.Id(x.ConsentId);GuardRequirementCommand(x.ActorId,x.CommandId,x.PayloadHash,x.ResultHash,x.ProtectedResult,x.At);}
    }
    private static void GuardRequirementCommand(string actor,string id,string hash,string result,byte[] bytes,DateTimeOffset at){CreditApplicationRules.Id(id);CreditApplicationRules.Digest(hash);CreditApplicationRules.Digest(result);if(CreditApplicationRules.Actor(actor)!=actor||bytes.Length is <1 or >65536||at.Offset!=TimeSpan.Zero)throw CreditRequirementsRules.Invalid();}
}
