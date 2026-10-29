using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;
namespace Shop.Modules.Cms;
public sealed class CmsRedirect
{
    public string Id{get;set;}="";public string SourcePath{get;set;}="";public bool IsDemo{get;set;}
    public string? DraftTargetPath{get;set;}public int? DraftStatus{get;set;}public string? PublishedRevisionId{get;set;}public int Publication{get;set;}
    public string CreatedBy{get;set;}="";public DateTimeOffset CreatedAt{get;set;}public string UpdatedBy{get;set;}="";public DateTimeOffset UpdatedAt{get;set;}public byte[] Version{get;set;}=[];
}
public sealed class CmsRedirectRevision
{
    public string Id{get;set;}="";public string RedirectId{get;set;}="";public string SourcePath{get;set;}="";public int Publication{get;set;}public string Action{get;set;}="";public string TargetPath{get;set;}="";public int Status{get;set;}public string FactsHash{get;set;}="";public string ActorId{get;set;}="";public DateTimeOffset At{get;set;}
}
public sealed class CmsRedirectCommand
{
    public string ActorId{get;set;}="";public string CommandId{get;set;}="";public string RedirectId{get;set;}="";public string SourcePath{get;set;}="";public string PayloadHash{get;set;}="";public string ResultJson{get;set;}="";public string ResultHash{get;set;}="";public DateTimeOffset At{get;set;}
}
internal static class CmsRedirectModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<CmsRedirect>(e=>{
            e.ToTable("Redirects",t=>t.HasCheckConstraint("CK_CmsRedirect_Facts","[Publication] BETWEEN 0 AND 10000 AND ([DraftStatus] IS NULL OR [DraftStatus] IN (301,302)) AND DATEPART(TZOFFSET,[CreatedAt])=0 AND DATEPART(TZOFFSET,[UpdatedAt])=0 AND [UpdatedAt]>=[CreatedAt]"));
            e.HasKey(x=>x.Id);e.HasAlternateKey(x=>new{x.Id,x.SourcePath});e.Property(x=>x.Id).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.SourcePath).HasMaxLength(192).IsUnicode(false);e.HasIndex(x=>x.SourcePath).IsUnique();e.Property(x=>x.DraftTargetPath).HasMaxLength(192).IsUnicode(false);e.Property(x=>x.PublishedRevisionId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.CreatedBy).HasMaxLength(64);e.Property(x=>x.UpdatedBy).HasMaxLength(64);e.Property(x=>x.Version).IsRowVersion();
            e.HasOne<CmsRedirectRevision>().WithMany().HasForeignKey(x=>new{x.Id,x.PublishedRevisionId}).HasPrincipalKey(x=>new{x.RedirectId,x.Id}).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<CmsRedirectRevision>(e=>{
            e.ToTable("RedirectRevisions",t=>t.HasCheckConstraint("CK_CmsRedirectRevision_Facts","[Publication] BETWEEN 1 AND 10000 AND [Action] IN ('Publish','Restore','Unpublish') AND [Status] IN (301,302) AND DATEPART(TZOFFSET,[At])=0"));
            e.HasKey(x=>x.Id);e.HasAlternateKey(x=>new{x.RedirectId,x.Id});foreach(var n in new[]{"Id","RedirectId"})e.Property<string>(n).HasMaxLength(32).IsUnicode(false);foreach(var n in new[]{"SourcePath","TargetPath"})e.Property<string>(n).HasMaxLength(192).IsUnicode(false);e.Property(x=>x.Action).HasMaxLength(16).IsUnicode(false);e.Property(x=>x.FactsHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ActorId).HasMaxLength(64);e.HasIndex(x=>new{x.RedirectId,x.Publication}).IsUnique();e.HasOne<CmsRedirect>().WithMany().HasForeignKey(x=>new{x.RedirectId,x.SourcePath}).HasPrincipalKey(x=>new{x.Id,x.SourcePath}).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<CmsRedirectCommand>(e=>{
            e.ToTable("RedirectCommands",t=>t.HasCheckConstraint("CK_CmsRedirectCommand_Facts","DATEPART(TZOFFSET,[At])=0 AND DATALENGTH([ResultJson]) BETWEEN 2 AND 8192"));
            e.HasKey(x=>new{x.ActorId,x.CommandId});e.Property(x=>x.ActorId).HasMaxLength(64);foreach(var n in new[]{"CommandId","RedirectId"})e.Property<string>(n).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.SourcePath).HasMaxLength(192).IsUnicode(false);foreach(var n in new[]{"PayloadHash","ResultHash"})e.Property<string>(n).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ResultJson).HasMaxLength(4096);e.HasOne<CmsRedirect>().WithMany().HasForeignKey(x=>new{x.RedirectId,x.SourcePath}).HasPrincipalKey(x=>new{x.Id,x.SourcePath}).OnDelete(DeleteBehavior.Restrict);
        });
    }
}
public sealed partial class CmsDbContext
{
    public DbSet<CmsRedirect> Redirects=>Set<CmsRedirect>();public DbSet<CmsRedirectRevision> RedirectRevisions=>Set<CmsRedirectRevision>();public DbSet<CmsRedirectCommand> RedirectCommands=>Set<CmsRedirectCommand>();
    private void GuardRedirects()
    {
        var entries=ChangeTracker.Entries().Where(x=>x.Entity is CmsRedirect or CmsRedirectRevision or CmsRedirectCommand).ToArray();if(entries.Length==0)return;
        foreach(var e in entries){
            if(e.Entity is CmsRedirectRevision or CmsRedirectCommand&&e.State is EntityState.Modified or EntityState.Deleted)throw new BusinessException("cms_redirect_immutable","Redirect history is immutable.");
            if(e.Entity is CmsRedirect&&e.State==EntityState.Deleted)throw new BusinessException("cms_redirect_immutable","Unpublish instead of deleting history.");
            if(e.State is not(EntityState.Added or EntityState.Modified))continue;
            if(e.Entity is CmsRedirect p){CmsRedirectRules.Id(p.Id);CmsRedirectRules.Draft(p.SourcePath,p.DraftTargetPath,p.DraftStatus);CmsRedirectRules.Actor(p.CreatedBy);CmsRedirectRules.Actor(p.UpdatedBy);if(p.Publication is<0 or>10000||p.CreatedAt.Offset!=TimeSpan.Zero||p.UpdatedAt.Offset!=TimeSpan.Zero||p.UpdatedAt<p.CreatedAt)throw CmsRedirectRules.Invalid();if(e.State==EntityState.Modified&&new[]{nameof(CmsRedirect.Id),nameof(CmsRedirect.SourcePath),nameof(CmsRedirect.IsDemo),nameof(CmsRedirect.CreatedBy),nameof(CmsRedirect.CreatedAt)}.Any(n=>e.Property(n).IsModified))throw new BusinessException("cms_redirect_immutable","Source path and origin are immutable.");}
            else if(e.Entity is CmsRedirectRevision revision){CmsRedirectRules.Id(revision.Id);CmsRedirectRules.Id(revision.RedirectId);CmsRedirectRules.Actor(revision.ActorId);if(revision.Action is not("Publish"or"Restore"or"Unpublish")||revision.Publication is<1 or>10000||revision.At.Offset!=TimeSpan.Zero||revision.FactsHash!=CmsRedirectRules.FactsHash(revision.SourcePath,revision.TargetPath,revision.Status))throw CmsRedirectRules.Invalid();}
            else if(e.Entity is CmsRedirectCommand c){CmsRedirectRules.Id(c.CommandId);CmsRedirectRules.Id(c.RedirectId);CmsRedirectRules.Actor(c.ActorId);CmsRedirectRules.Source(c.SourcePath);if(c.PayloadHash.Length!=64||c.At.Offset!=TimeSpan.Zero||c.ResultHash!=CmsPageRules.Digest(c.ResultJson))throw CmsRedirectRules.Invalid();var result=CmsRedirectRules.Read<CmsRedirectResult>(c.ResultJson);if(result.RedirectId!=c.RedirectId||result.CommandId!=c.CommandId||result.SourcePath!=c.SourcePath||result.Replayed)throw CmsRedirectRules.Invalid();}
        }
    }
}
