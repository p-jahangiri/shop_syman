using Microsoft.EntityFrameworkCore;

namespace Shop.Modules.Credit;

public sealed class CreditDocumentAttachment
{
    public string Id{get;set;}="";
    public long Sequence{get;set;}
    public string ApplicationId{get;set;}="";
    public string ConsentId{get;set;}="";
    public string RequirementsRevisionId{get;set;}="";
    public string DocumentKey{get;set;}="";
    public string? ReplacesFileId{get;set;}
    public string ActorId{get;set;}="";
    public DateTimeOffset At{get;set;}
}
public sealed class CreditDocumentCommand
{
    public string ActorId{get;set;}="";
    public string CommandId{get;set;}="";
    public string ApplicationId{get;set;}="";
    public string FileId{get;set;}="";
    public string PayloadHash{get;set;}="";
    public string ResultHash{get;set;}="";
    public byte[] ProtectedResult{get;set;}=[];
    public DateTimeOffset At{get;set;}
}
internal static class CreditDocumentModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<CreditRequirementsConsent>().HasAlternateKey(x=>new{x.Id,x.ApplicationId,x.RevisionId});
        b.Entity<CreditDocumentAttachment>(e=>{
            e.ToTable("DocumentAttachments",t=>t.HasCheckConstraint("CK_CreditDocument_Time","DATEPART(TZOFFSET,[At])=0"));
            e.HasKey(x=>x.Id);e.Property(x=>x.Id).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.Sequence).UseIdentityColumn();e.HasIndex(x=>x.Sequence).IsUnique();
            e.Property(x=>x.ApplicationId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.ConsentId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.RequirementsRevisionId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.DocumentKey).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ReplacesFileId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.ActorId).HasMaxLength(64);
            e.HasOne<CreditRequirementsConsent>().WithMany().HasForeignKey(x=>new{x.ConsentId,x.ApplicationId,x.RequirementsRevisionId}).HasPrincipalKey(x=>new{x.Id,x.ApplicationId,x.RevisionId}).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<CreditRequirementDocument>().WithMany().HasForeignKey(x=>new{x.RequirementsRevisionId,x.DocumentKey}).OnDelete(DeleteBehavior.Restrict);
            e.HasAlternateKey(x=>new{x.Id,x.ApplicationId,x.ConsentId,x.DocumentKey});
            e.HasAlternateKey(x=>new{x.Id,x.ApplicationId});
            e.HasOne<CreditDocumentAttachment>().WithMany().HasForeignKey(x=>new{x.ReplacesFileId,x.ApplicationId,x.ConsentId,x.DocumentKey}).HasPrincipalKey(x=>new{x.Id,x.ApplicationId,x.ConsentId,x.DocumentKey}).OnDelete(DeleteBehavior.Restrict);
            e.HasIndex(x=>new{x.ApplicationId,x.ConsentId,x.DocumentKey,x.Sequence});
        });
        b.Entity<CreditDocumentCommand>(e=>{
            e.ToTable("DocumentCommands",t=>{t.HasCheckConstraint("CK_CreditDocumentCommand_Result","DATALENGTH([ProtectedResult]) BETWEEN 1 AND 65536");t.HasCheckConstraint("CK_CreditDocumentCommand_Time","DATEPART(TZOFFSET,[At])=0");});
            e.HasKey(x=>new{x.ActorId,x.CommandId});e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.CommandId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.ApplicationId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.FileId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.PayloadHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ResultHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ProtectedResult).HasMaxLength(65536);
            e.HasOne<CreditApplication>().WithMany().HasForeignKey(x=>x.ApplicationId).OnDelete(DeleteBehavior.Restrict);e.HasOne<CreditDocumentAttachment>().WithMany().HasForeignKey(x=>new{x.FileId,x.ApplicationId}).HasPrincipalKey(x=>new{x.Id,x.ApplicationId}).OnDelete(DeleteBehavior.Restrict);
        });
    }
}
public sealed partial class CreditDbContext
{
    public DbSet<CreditDocumentAttachment> DocumentAttachments=>Set<CreditDocumentAttachment>();
    public DbSet<CreditDocumentCommand> DocumentCommands=>Set<CreditDocumentCommand>();
    private void GuardDocuments()
    {
        ChangeTracker.DetectChanges();
        if(ChangeTracker.Entries().Any(e=>(e.Entity is CreditDocumentAttachment or CreditDocumentCommand)&&(e.State is EntityState.Modified or EntityState.Deleted)))throw CreditApplicationRules.Immutable();
        foreach(var e in ChangeTracker.Entries<CreditDocumentAttachment>().Where(x=>x.State==EntityState.Added)){
            var x=e.Entity;CreditApplicationRules.Id(x.Id);CreditApplicationRules.Id(x.ApplicationId);CreditApplicationRules.Id(x.ConsentId);CreditApplicationRules.Id(x.RequirementsRevisionId);CreditApplicationRules.Key(x.DocumentKey);if(x.ReplacesFileId is{}previous){CreditApplicationRules.Id(previous);if(previous==x.Id)throw CreditApplicationRules.Invalid();}
            if(x.ActorId!=CreditApplicationRules.Actor(x.ActorId)||x.At.Offset!=TimeSpan.Zero)throw CreditApplicationRules.Invalid();
        }
        foreach(var e in ChangeTracker.Entries<CreditDocumentCommand>().Where(x=>x.State==EntityState.Added)){
            var x=e.Entity;CreditApplicationRules.Id(x.CommandId);CreditApplicationRules.Id(x.ApplicationId);CreditApplicationRules.Id(x.FileId);CreditApplicationRules.Digest(x.PayloadHash);CreditApplicationRules.Digest(x.ResultHash);if(x.ActorId!=CreditApplicationRules.Actor(x.ActorId)||x.At.Offset!=TimeSpan.Zero||x.ProtectedResult.Length is <1 or >65536)throw CreditApplicationRules.Invalid();
        }
    }
}
