using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;
namespace Shop.Modules.Cms;
public sealed class CmsBlogPost
{
    public string Id{get;set;}="";public string Slug{get;set;}="";public bool IsDemo{get;set;}
    public string DraftJson{get;set;}="";public string DraftHash{get;set;}="";public int Publication{get;set;}
    public DateTimeOffset? FirstPublishedAt{get;set;}public string? PublishedRevisionId{get;set;}public string CreatedBy{get;set;}="";public DateTimeOffset CreatedAt{get;set;}
    public string UpdatedBy{get;set;}="";public DateTimeOffset UpdatedAt{get;set;}public byte[] Version{get;set;}=[];
}
public sealed class CmsBlogPostRevision
{
    public string Id{get;set;}="";public string PostId{get;set;}="";public int Publication{get;set;}public string Action{get;set;}="";
    public List<CmsBlogRevisionTag> Tags{get;set;}=[];public string BodyJson{get;set;}="";public string BodyHash{get;set;}="";public string ActorId{get;set;}="";public DateTimeOffset At{get;set;}
}
public sealed class CmsBlogPostCommand
{
    public string ActorId{get;set;}="";public string CommandId{get;set;}="";public string PostId{get;set;}="";
    public string PayloadHash{get;set;}="";public string ResultJson{get;set;}="";public string ResultHash{get;set;}="";public DateTimeOffset At{get;set;}
}
public sealed class CmsBlogRevisionTag{public string RevisionId{get;set;}="";public string Slug{get;set;}="";public string NameFa{get;set;}="";public string NameEn{get;set;}="";}
public sealed partial class CmsDbContext
{
    public DbSet<CmsBlogPost> BlogPosts=>Set<CmsBlogPost>();public DbSet<CmsBlogPostRevision> BlogPostRevisions=>Set<CmsBlogPostRevision>();public DbSet<CmsBlogPostCommand> BlogPostCommands=>Set<CmsBlogPostCommand>();
    public DbSet<CmsBlogRevisionTag> BlogRevisionTags=>Set<CmsBlogRevisionTag>();
    private static void ConfigureBlogPosts(ModelBuilder b)
    {
        b.Entity<CmsBlogPost>(e=>{
            e.ToTable("BlogPosts",t=>t.HasCheckConstraint("CK_CmsBlogPost_Facts","[Publication] BETWEEN 0 AND 10000 AND (([Publication]=0 AND [FirstPublishedAt] IS NULL) OR ([Publication]>0 AND [FirstPublishedAt] IS NOT NULL)) AND DATEPART(TZOFFSET,[CreatedAt])=0 AND DATEPART(TZOFFSET,[UpdatedAt])=0 AND [UpdatedAt]>=[CreatedAt] AND DATALENGTH([DraftJson]) BETWEEN 2 AND 131072 AND ([FirstPublishedAt] IS NULL OR ([FirstPublishedAt]>=[CreatedAt] AND [FirstPublishedAt]<=[UpdatedAt] AND DATEPART(TZOFFSET,[FirstPublishedAt])=0))"));
            e.HasKey(x=>x.Id);e.Property(x=>x.Id).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.Slug).HasMaxLength(80).IsUnicode(false).UseCollation("Latin1_General_100_BIN2");e.HasIndex(x=>x.Slug).IsUnique();e.HasIndex(x=>new{x.FirstPublishedAt,x.Id}).IsDescending(true,true);
            e.Property(x=>x.DraftJson).HasMaxLength(65536);e.Property(x=>x.DraftHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.PublishedRevisionId).HasMaxLength(32).IsUnicode(false);
            e.Property(x=>x.CreatedBy).HasMaxLength(64);e.Property(x=>x.UpdatedBy).HasMaxLength(64);e.Property(x=>x.Version).IsRowVersion();
            e.HasOne<CmsBlogPostRevision>().WithMany().HasForeignKey(x=>new{x.Id,x.PublishedRevisionId}).HasPrincipalKey(x=>new{x.PostId,x.Id}).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<CmsBlogPostRevision>(e=>{
            e.ToTable("BlogPostRevisions",t=>t.HasCheckConstraint("CK_CmsBlogPostRevision_Facts","[Publication] BETWEEN 1 AND 10000 AND [Action] IN ('Publish','Restore','Unpublish') AND DATEPART(TZOFFSET,[At])=0 AND DATALENGTH([BodyJson]) BETWEEN 2 AND 131072"));
            e.HasKey(x=>x.Id);e.HasAlternateKey(x=>new{x.PostId,x.Id});foreach(var n in new[]{"Id","PostId"})e.Property<string>(n).HasMaxLength(32).IsUnicode(false);
            e.Property(x=>x.Action).HasMaxLength(16).IsUnicode(false);e.Property(x=>x.BodyJson).HasMaxLength(65536);e.Property(x=>x.BodyHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ActorId).HasMaxLength(64);
            e.HasMany(x=>x.Tags).WithOne().HasForeignKey(x=>x.RevisionId).OnDelete(DeleteBehavior.Restrict);e.HasIndex(x=>new{x.PostId,x.Publication}).IsUnique();e.HasOne<CmsBlogPost>().WithMany().HasForeignKey(x=>x.PostId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<CmsBlogRevisionTag>(e=>{e.ToTable("BlogRevisionTags");e.HasKey(x=>new{x.RevisionId,x.Slug});e.Property(x=>x.RevisionId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.Slug).HasMaxLength(80).IsUnicode(false).UseCollation("Latin1_General_100_BIN2");e.Property(x=>x.NameFa).HasMaxLength(60);e.Property(x=>x.NameEn).HasMaxLength(60);e.HasIndex(x=>new{x.Slug,x.RevisionId});});
        b.Entity<CmsBlogPostCommand>(e=>{
            e.ToTable("BlogPostCommands",t=>t.HasCheckConstraint("CK_CmsBlogPostCommand_Facts","DATEPART(TZOFFSET,[At])=0 AND DATALENGTH([ResultJson]) BETWEEN 2 AND 4096"));
            e.HasKey(x=>new{x.ActorId,x.CommandId});e.Property(x=>x.ActorId).HasMaxLength(64);foreach(var n in new[]{"CommandId","PostId"})e.Property<string>(n).HasMaxLength(32).IsUnicode(false);
            foreach(var n in new[]{"PayloadHash","ResultHash"})e.Property<string>(n).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ResultJson).HasMaxLength(2048);e.HasOne<CmsBlogPost>().WithMany().HasForeignKey(x=>x.PostId).OnDelete(DeleteBehavior.Restrict);
        });
    }
    private void GuardBlogPosts()
    {
        ChangeTracker.DetectChanges();foreach(var e in ChangeTracker.Entries()){
            if(e.Entity is CmsBlogPostRevision or CmsBlogPostCommand or CmsBlogRevisionTag&&e.State is EntityState.Modified or EntityState.Deleted)throw new BusinessException("cms_blog_immutable","Page history is immutable.");
            if(e.Entity is CmsBlogPost&&e.State==EntityState.Deleted)throw new BusinessException("cms_blog_immutable","Unpublish instead of deleting page history.");
        }
        foreach(var e in ChangeTracker.Entries<CmsBlogPost>().Where(x=>x.State is EntityState.Added or EntityState.Modified)){
            var p=e.Entity;CmsBlogPostRules.Id(p.Id);CmsBlogPostRules.Slug(p.Slug);CmsBlogPostRules.Actor(p.CreatedBy);CmsBlogPostRules.Actor(p.UpdatedBy);
            if((p.Publication==0)!=(p.FirstPublishedAt is null)||p.Publication is<0 or>10000||p.CreatedAt.Offset!=TimeSpan.Zero||p.UpdatedAt.Offset!=TimeSpan.Zero||p.UpdatedAt<p.CreatedAt||CmsBlogPostRules.Digest(p.DraftJson)!=p.DraftHash)throw CmsBlogPostRules.Invalid();
            CmsBlogPostRules.Content(CmsBlogPostRules.Read<CmsBlogContent>(p.DraftJson),false);
            if(p.FirstPublishedAt is{}first&&(first.Offset!=TimeSpan.Zero||first<p.CreatedAt||first>p.UpdatedAt)||e.State==EntityState.Modified&&e.Property(x=>x.FirstPublishedAt).OriginalValue is not null&&e.Property(x=>x.FirstPublishedAt).IsModified)throw new BusinessException("cms_blog_immutable","The first publication date is immutable.");
            if(e.State==EntityState.Modified&&new[]{nameof(CmsBlogPost.Id),nameof(CmsBlogPost.Slug),nameof(CmsBlogPost.IsDemo),nameof(CmsBlogPost.CreatedBy),nameof(CmsBlogPost.CreatedAt)}.Any(n=>e.Property(n).IsModified))throw new BusinessException("cms_blog_immutable","Page address and origin are immutable.");
        }
        foreach(var e in ChangeTracker.Entries<CmsBlogPostRevision>().Where(x=>x.State==EntityState.Added)){
            var p=e.Entity;CmsBlogPostRules.Id(p.Id);CmsBlogPostRules.Id(p.PostId);CmsBlogPostRules.Actor(p.ActorId);if(p.Action is not("Publish"or"Restore"or"Unpublish")||p.Publication is<1 or>10000||p.At.Offset!=TimeSpan.Zero||CmsBlogPostRules.Digest(p.BodyJson)!=p.BodyHash)throw CmsBlogPostRules.Invalid();var content=CmsBlogPostRules.Read<CmsBlogContent>(p.BodyJson);CmsBlogPostRules.Content(content,true);if(CmsBlogPostRules.Serialize(content.Tags)!=CmsBlogPostRules.Serialize(p.Tags.OrderBy(t=>t.Slug,StringComparer.Ordinal).Select(t=>new CmsBlogTag(t.Slug,t.NameFa,t.NameEn)).ToArray()))throw CmsBlogPostRules.Invalid();
        }
        foreach(var e in ChangeTracker.Entries<CmsBlogPostCommand>().Where(x=>x.State==EntityState.Added)){
            var p=e.Entity;CmsBlogPostRules.Actor(p.ActorId);CmsBlogPostRules.Id(p.CommandId);CmsBlogPostRules.Id(p.PostId);if(p.At.Offset!=TimeSpan.Zero||p.PayloadHash.Length!=64||CmsBlogPostRules.Digest(p.ResultJson)!=p.ResultHash)throw CmsBlogPostRules.Invalid();
            var r=CmsBlogPostRules.Read<CmsBlogPostResult>(p.ResultJson);if(r.PostId!=p.PostId||r.CommandId!=p.CommandId||r.Replayed)throw CmsBlogPostRules.Invalid();
        }
        foreach(var en in ChangeTracker.Entries<CmsBlogRevisionTag>().Where(x=>x.State==EntityState.Added)){
            var x=en.Entity;var revision=ChangeTracker.Entries<CmsBlogPostRevision>().SingleOrDefault(y=>y.Entity.Id==x.RevisionId&&y.State==EntityState.Added)?.Entity;var tag=revision is null?null:CmsBlogPostRules.Read<CmsBlogContent>(revision.BodyJson).Tags.SingleOrDefault(t=>t.Slug==x.Slug);if(tag is null||tag.NameFa!=x.NameFa||tag.NameEn!=x.NameEn)throw CmsBlogPostRules.Invalid();
        }
    }
}
