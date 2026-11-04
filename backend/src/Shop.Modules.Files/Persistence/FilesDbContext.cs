using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;
namespace Shop.Modules.Files;

public sealed class PrivateFileObject
{
    public string Id {get;set;}=Guid.NewGuid().ToString("N");
    public string Kind {get;set;}="";
    public string ResourceId {get;set;}="";
    public string OwnerId {get;set;}="";
    public string ActorId {get;set;}="";
    public string CommandId {get;set;}="";
    public string ResourceVersion {get;set;}="";
    public string PayloadHash {get;set;}="";
    public string IntentHash {get;set;}="";
    public string PlaintextHash {get;set;}="";
    public string CiphertextHash {get;set;}="";
    public string ContentType {get;set;}="";
    public int Bytes {get;set;}
    public byte[] Nonce {get;set;}=[];
    public byte[] ProtectedKey {get;set;}=[];
    public byte[] ProtectedFilename {get;set;}=[];
    public DateTimeOffset CreatedAt {get;set;}
    public DateTimeOffset? StoredAt {get;set;}
    public DateTimeOffset? AttachedAt {get;set;}
    public string State {get;set;}="Staged";
    public byte[] Version {get;set;}=[];
}
public sealed class FilesDbContext(DbContextOptions<FilesDbContext> options):DbContext(options)
{
    public DbSet<PrivateFileObject> Objects=>Set<PrivateFileObject>();
    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasDefaultSchema("files");b.Entity<PrivateFileObject>(e=>{
            e.ToTable("PrivateObjects",t=>{
                t.HasCheckConstraint("CK_PrivateObject_Kind","[Kind] IN ('support','credit')");
                t.HasCheckConstraint("CK_PrivateObject_Bytes","[Bytes] BETWEEN 16 AND 8388608 AND DATALENGTH([Nonce])=12 AND DATALENGTH([ProtectedKey]) BETWEEN 1 AND 4096 AND DATALENGTH([ProtectedFilename]) BETWEEN 1 AND 4096");
                t.HasCheckConstraint("CK_PrivateObject_ContentType","[ContentType] IN ('image/jpeg','image/png','image/webp','application/pdf')");
                t.HasCheckConstraint("CK_PrivateObject_State","([State]='Staged' AND [StoredAt] IS NULL AND [AttachedAt] IS NULL) OR ([State]='Stored' AND [StoredAt] IS NOT NULL AND [StoredAt]>=[CreatedAt] AND [AttachedAt] IS NULL) OR ([State]='Attached' AND [StoredAt] IS NOT NULL AND [AttachedAt] IS NOT NULL AND [StoredAt]>=[CreatedAt] AND [AttachedAt]>=[StoredAt])");
            });
            e.HasKey(x=>x.Id);e.Property(x=>x.Id).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.Kind).HasMaxLength(16).IsUnicode(false);e.Property(x=>x.ResourceId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.OwnerId).HasMaxLength(64);e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.CommandId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.ResourceVersion).HasMaxLength(12).IsUnicode(false);
            e.Property(x=>x.IntentHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.PayloadHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.PlaintextHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.CiphertextHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ContentType).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.State).HasMaxLength(16).IsUnicode(false);e.Property(x=>x.Nonce).HasMaxLength(12);e.Property(x=>x.ProtectedKey).HasMaxLength(4096);e.Property(x=>x.ProtectedFilename).HasMaxLength(4096);e.Property(x=>x.Version).IsRowVersion();
            e.HasIndex(x=>new{x.ActorId,x.CommandId}).IsUnique();e.HasIndex(x=>new{x.ActorId,x.State});e.HasIndex(x=>new{x.Kind,x.ResourceId,x.State});
        });
    }
    private void Guard()
    {
        ChangeTracker.DetectChanges();foreach(var e in ChangeTracker.Entries<PrivateFileObject>()){
            if(e.State==EntityState.Added){
                var x=e.Entity;PrivateFileRules.Id(x.Id);PrivateFileRules.Id(x.CommandId);PrivateFileRules.Version(x.ResourceVersion);var scope=PrivateFileRules.Scope(new(x.Kind,x.ResourceId,x.OwnerId));
                if(scope.OwnerId!=x.OwnerId||PrivateFileRules.Actor(x.ActorId)!=x.ActorId||x.State!="Staged"||x.StoredAt is not null||x.AttachedAt is not null||x.CreatedAt.Offset!=TimeSpan.Zero||x.Bytes is <16 or >PrivateFileRules.MaxBytes||x.Nonce.Length!=12||x.ProtectedKey.Length is <1 or >4096||x.ProtectedFilename.Length is <1 or >4096||!PrivateFileRules.ContentTypes.Contains(x.ContentType,StringComparer.Ordinal)||!PrivateFileRules.IsHash(x.IntentHash)||!PrivateFileRules.IsHash(x.PayloadHash)||!PrivateFileRules.IsHash(x.PlaintextHash)||!PrivateFileRules.IsHash(x.CiphertextHash))throw Immutable();continue;
            }
            if(e.State==EntityState.Deleted)throw Immutable();if(e.State!=EntityState.Modified)continue;
            var changed=e.Properties.Where(x=>x.IsModified).Select(x=>x.Metadata.Name).ToHashSet(StringComparer.Ordinal);
            var previous=e.Property(x=>x.State).OriginalValue;
            if(previous=="Staged"&&e.Entity.State=="Stored"&&e.Entity.StoredAt is{}stored&&stored.Offset==TimeSpan.Zero&&stored>=e.Entity.CreatedAt&&changed.SetEquals([nameof(PrivateFileObject.State),nameof(PrivateFileObject.StoredAt)]))continue;
            if(previous=="Stored"&&e.Entity.State=="Attached"&&e.Entity.AttachedAt is{}attached&&attached.Offset==TimeSpan.Zero&&attached>=e.Entity.StoredAt&&changed.SetEquals([nameof(PrivateFileObject.State),nameof(PrivateFileObject.AttachedAt)]))continue;
            throw Immutable();
        }
    }
    private static BusinessException Immutable()=>new("private_file_history_immutable","Private file facts and completed transitions cannot be rewritten.");
    public override int SaveChanges(){Guard();return base.SaveChanges();}
    public override int SaveChanges(bool acceptAllChangesOnSuccess){Guard();return base.SaveChanges(acceptAllChangesOnSuccess);}
    public override Task<int> SaveChangesAsync(CancellationToken ct=default){Guard();return base.SaveChangesAsync(ct);}
    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess,CancellationToken ct=default){Guard();return base.SaveChangesAsync(acceptAllChangesOnSuccess,ct);}
}
