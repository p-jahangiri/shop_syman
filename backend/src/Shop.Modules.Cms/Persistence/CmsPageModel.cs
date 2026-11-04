using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;
namespace Shop.Modules.Cms;
public sealed class CmsPage
{
    public string Id{get;set;}="";public string Slug{get;set;}="";public bool IsDemo{get;set;}
    public string DraftJson{get;set;}="";public string DraftHash{get;set;}="";public int Publication{get;set;}
    public string? PublishedRevisionId{get;set;}public string CreatedBy{get;set;}="";public DateTimeOffset CreatedAt{get;set;}
    public string UpdatedBy{get;set;}="";public DateTimeOffset UpdatedAt{get;set;}public byte[] Version{get;set;}=[];
}
public sealed class CmsPageRevision
{
    public string Id{get;set;}="";public string PageId{get;set;}="";public int Publication{get;set;}public string Action{get;set;}="";
    public string BodyJson{get;set;}="";public string BodyHash{get;set;}="";public string ActorId{get;set;}="";public DateTimeOffset At{get;set;}
}
public sealed class CmsPageCommand
{
    public string ActorId{get;set;}="";public string CommandId{get;set;}="";public string PageId{get;set;}="";
    public string PayloadHash{get;set;}="";public string ResultJson{get;set;}="";public string ResultHash{get;set;}="";public DateTimeOffset At{get;set;}
}
public sealed partial class CmsDbContext
{
    public DbSet<CmsPage> Pages=>Set<CmsPage>();public DbSet<CmsPageRevision> PageRevisions=>Set<CmsPageRevision>();public DbSet<CmsPageCommand> PageCommands=>Set<CmsPageCommand>();
    private static void ConfigurePages(ModelBuilder b)
    {
        b.Entity<CmsPage>(e=>{
            e.ToTable("Pages",t=>t.HasCheckConstraint("CK_CmsPage_Facts","[Publication] BETWEEN 0 AND 10000 AND DATEPART(TZOFFSET,[CreatedAt])=0 AND DATEPART(TZOFFSET,[UpdatedAt])=0 AND [UpdatedAt]>=[CreatedAt] AND DATALENGTH([DraftJson]) BETWEEN 2 AND 131072"));
            e.HasKey(x=>x.Id);e.Property(x=>x.Id).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.Slug).HasMaxLength(80).IsUnicode(false);e.HasIndex(x=>x.Slug).IsUnique();
            e.Property(x=>x.DraftJson).HasMaxLength(65536);e.Property(x=>x.DraftHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.PublishedRevisionId).HasMaxLength(32).IsUnicode(false);
            e.Property(x=>x.CreatedBy).HasMaxLength(64);e.Property(x=>x.UpdatedBy).HasMaxLength(64);e.Property(x=>x.Version).IsRowVersion();
            e.HasOne<CmsPageRevision>().WithMany().HasForeignKey(x=>new{x.Id,x.PublishedRevisionId}).HasPrincipalKey(x=>new{x.PageId,x.Id}).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<CmsPageRevision>(e=>{
            e.ToTable("PageRevisions",t=>t.HasCheckConstraint("CK_CmsPageRevision_Facts","[Publication] BETWEEN 1 AND 10000 AND [Action] IN ('Publish','Restore','Unpublish') AND DATEPART(TZOFFSET,[At])=0 AND DATALENGTH([BodyJson]) BETWEEN 2 AND 131072"));
            e.HasKey(x=>x.Id);e.HasAlternateKey(x=>new{x.PageId,x.Id});foreach(var n in new[]{"Id","PageId"})e.Property<string>(n).HasMaxLength(32).IsUnicode(false);
            e.Property(x=>x.Action).HasMaxLength(16).IsUnicode(false);e.Property(x=>x.BodyJson).HasMaxLength(65536);e.Property(x=>x.BodyHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ActorId).HasMaxLength(64);
            e.HasIndex(x=>new{x.PageId,x.Publication}).IsUnique();e.HasOne<CmsPage>().WithMany().HasForeignKey(x=>x.PageId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<CmsPageCommand>(e=>{
            e.ToTable("PageCommands",t=>t.HasCheckConstraint("CK_CmsPageCommand_Facts","DATEPART(TZOFFSET,[At])=0 AND DATALENGTH([ResultJson]) BETWEEN 2 AND 4096"));
            e.HasKey(x=>new{x.ActorId,x.CommandId});e.Property(x=>x.ActorId).HasMaxLength(64);foreach(var n in new[]{"CommandId","PageId"})e.Property<string>(n).HasMaxLength(32).IsUnicode(false);
            foreach(var n in new[]{"PayloadHash","ResultHash"})e.Property<string>(n).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ResultJson).HasMaxLength(2048);e.HasOne<CmsPage>().WithMany().HasForeignKey(x=>x.PageId).OnDelete(DeleteBehavior.Restrict);
        });
    }
    private void GuardPages()
    {
        ChangeTracker.DetectChanges();foreach(var e in ChangeTracker.Entries()){
            if(e.Entity is CmsPageRevision or CmsPageCommand&&e.State is EntityState.Modified or EntityState.Deleted)throw new BusinessException("cms_page_immutable","Page history is immutable.");
            if(e.Entity is CmsPage&&e.State==EntityState.Deleted)throw new BusinessException("cms_page_immutable","Unpublish instead of deleting page history.");
        }
        foreach(var e in ChangeTracker.Entries<CmsPage>().Where(x=>x.State is EntityState.Added or EntityState.Modified)){
            var p=e.Entity;CmsPageRules.Id(p.Id);CmsPageRules.Slug(p.Slug);CmsPageRules.Actor(p.CreatedBy);CmsPageRules.Actor(p.UpdatedBy);
            if(p.Publication is<0 or>10000||p.CreatedAt.Offset!=TimeSpan.Zero||p.UpdatedAt.Offset!=TimeSpan.Zero||p.UpdatedAt<p.CreatedAt||CmsPageRules.Digest(p.DraftJson)!=p.DraftHash)throw CmsPageRules.Invalid();
            CmsPageRules.Content(CmsPageRules.Read<CmsPageContent>(p.DraftJson),false);
            if(e.State==EntityState.Modified&&new[]{nameof(CmsPage.Id),nameof(CmsPage.Slug),nameof(CmsPage.IsDemo),nameof(CmsPage.CreatedBy),nameof(CmsPage.CreatedAt)}.Any(n=>e.Property(n).IsModified))throw new BusinessException("cms_page_immutable","Page address and origin are immutable.");
        }
        foreach(var e in ChangeTracker.Entries<CmsPageRevision>().Where(x=>x.State==EntityState.Added)){
            var p=e.Entity;CmsPageRules.Id(p.Id);CmsPageRules.Id(p.PageId);CmsPageRules.Actor(p.ActorId);if(p.Action is not("Publish"or"Restore"or"Unpublish")||p.Publication is<1 or>10000||p.At.Offset!=TimeSpan.Zero||CmsPageRules.Digest(p.BodyJson)!=p.BodyHash)throw CmsPageRules.Invalid();CmsPageRules.Content(CmsPageRules.Read<CmsPageContent>(p.BodyJson),true);
        }
        foreach(var e in ChangeTracker.Entries<CmsPageCommand>().Where(x=>x.State==EntityState.Added)){
            var p=e.Entity;CmsPageRules.Actor(p.ActorId);CmsPageRules.Id(p.CommandId);CmsPageRules.Id(p.PageId);if(p.At.Offset!=TimeSpan.Zero||p.PayloadHash.Length!=64||CmsPageRules.Digest(p.ResultJson)!=p.ResultHash)throw CmsPageRules.Invalid();
            var r=CmsPageRules.Read<CmsPageResult>(p.ResultJson);if(r.PageId!=p.PageId||r.CommandId!=p.CommandId||r.Replayed)throw CmsPageRules.Invalid();
        }
    }
    public override int SaveChanges(){GuardPages();GuardRedirects();GuardBlogPosts();return base.SaveChanges();}
    public override int SaveChanges(bool acceptAllChangesOnSuccess){GuardPages();GuardRedirects();GuardBlogPosts();return base.SaveChanges(acceptAllChangesOnSuccess);}
    public override Task<int> SaveChangesAsync(CancellationToken ct=default){GuardPages();GuardRedirects();GuardBlogPosts();return base.SaveChangesAsync(ct);}
    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess,CancellationToken ct=default){GuardPages();GuardRedirects();GuardBlogPosts();return base.SaveChangesAsync(acceptAllChangesOnSuccess,ct);}
}
