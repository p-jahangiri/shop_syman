using Microsoft.EntityFrameworkCore;
namespace Shop.Modules.Reviews;

public sealed class ProductReview
{
    public string Id{get;set;}=Guid.NewGuid().ToString("N");
    public long Sequence{get;set;}
    public string ProductId{get;set;}="";
    public string OwnerId{get;set;}="";
    public string State{get;set;}="Pending";
    public string CurrentRevisionId{get;set;}="";
    public string? Reply{get;set;}
    public DateTimeOffset CreatedAt{get;set;}
    public DateTimeOffset ChangedAt{get;set;}
    public bool IsWithdrawn{get;set;}
    public byte[] Version{get;set;}=[];
}
public sealed class ReviewRevision
{
    public string Id{get;set;}=Guid.NewGuid().ToString("N");
    public string ReviewId{get;set;}="";
    public string Locale{get;set;}="fa";
    public int Rating{get;set;}
    public string DisplayName{get;set;}="";
    public string Title{get;set;}="";
    public string Body{get;set;}="";
    public DateTimeOffset At{get;set;}
    public string? PhotoId{get;set;}
}
public sealed class ReviewPhoto
{
    public string Id{get;set;}=Guid.NewGuid().ToString("N");
    public byte[] Webp{get;set;}=[];
}
public sealed class ReviewCommand
{
    public string ActorId{get;set;}="";
    public string CommandId{get;set;}="";
    public string PayloadHash{get;set;}="";
    public string ResultJson{get;set;}="";
    public DateTimeOffset At{get;set;}
}
public sealed class ReviewEvent
{
    public long Id{get;set;}
    public string ReviewId{get;set;}="";
    public string RevisionId{get;set;}="";
    public string ActorId{get;set;}="";
    public string Action{get;set;}="";
    public string Reason{get;set;}="";
    public DateTimeOffset At{get;set;}
}
public sealed class ReviewReport
{
    public string ReviewId{get;set;}="";
    public string RevisionId{get;set;}="";
    public string OwnerId{get;set;}="";
    public string Reason{get;set;}="";
    public DateTimeOffset At{get;set;}
}
public sealed class ReviewVote
{
    public string ReviewId { get; set; } = "";
    public string RevisionId { get; set; } = "";
    public string VoterId { get; set; } = "";
    public int Value { get; set; }
    public byte[] Version { get; set; } = [];
}
public sealed class ReviewsDbContext(DbContextOptions<ReviewsDbContext> options):DbContext(options)
{
    public DbSet<ProductReview> Reviews=>Set<ProductReview>();
    public DbSet<ReviewRevision> Revisions=>Set<ReviewRevision>();
    public DbSet<ReviewPhoto> Photos=>Set<ReviewPhoto>();
    public DbSet<ReviewCommand> Commands=>Set<ReviewCommand>();
    public DbSet<ReviewEvent> Events=>Set<ReviewEvent>();
    public DbSet<ReviewReport> Reports=>Set<ReviewReport>();
    public DbSet<ReviewVote> Votes => Set<ReviewVote>();
    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasDefaultSchema("reviews");
        b.Entity<ProductReview>(e=>{
            e.ToTable("Reviews",t=>t.HasCheckConstraint("CK_Review_State","[State] IN ('Pending','Approved','Rejected','Hidden')"));
            e.HasKey(x=>x.Id);e.Property(x=>x.Id).HasMaxLength(32);e.Property(x=>x.Sequence).UseIdentityColumn();e.HasIndex(x=>x.Sequence).IsUnique();
            e.Property(x=>x.ProductId).HasMaxLength(64);e.Property(x=>x.OwnerId).HasMaxLength(64);e.HasIndex(x=>new{x.OwnerId,x.ProductId}).IsUnique();
            e.Property(x=>x.State).HasMaxLength(16);e.Property(x=>x.CurrentRevisionId).HasMaxLength(32);e.Property(x=>x.Reply).HasMaxLength(2000);e.Property(x=>x.Version).IsRowVersion();
            e.Property(x => x.IsWithdrawn).HasDefaultValue(false);
            e.HasIndex(x=>new{x.ProductId,x.State,x.Sequence});e.HasIndex(x=>new{x.State,x.Sequence});
        });
        b.Entity<ReviewRevision>(e=>{
            e.ToTable("Revisions",t=>{t.HasCheckConstraint("CK_Review_Rating","[Rating] BETWEEN 1 AND 5");t.HasCheckConstraint("CK_Review_Locale","[Locale] IN ('fa','en')");});
            e.HasKey(x=>x.Id);e.Property(x=>x.Id).HasMaxLength(32);e.Property(x=>x.ReviewId).HasMaxLength(32);e.HasIndex(x=>new{x.ReviewId,x.Id}).IsUnique();e.Property(x=>x.Locale).HasMaxLength(2);e.Property(x=>x.DisplayName).HasMaxLength(60);e.Property(x=>x.Title).HasMaxLength(100);e.Property(x=>x.Body).HasMaxLength(2000);
            e.HasOne<ProductReview>().WithMany().HasForeignKey(x=>x.ReviewId).OnDelete(DeleteBehavior.Restrict);
            e.Property(x=>x.PhotoId).HasMaxLength(32);
            e.HasOne<ReviewPhoto>().WithMany().HasForeignKey(x=>x.PhotoId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<ReviewPhoto>(e=>{
            e.ToTable("Photos",t=>t.HasCheckConstraint("CK_Review_PhotoBytes","DATALENGTH([Webp]) BETWEEN 12 AND 2097152"));
            e.HasKey(x=>x.Id);e.Property(x=>x.Id).HasMaxLength(32);e.Property(x=>x.Webp).IsRequired();
        });
        b.Entity<ReviewCommand>(e=>{e.ToTable("Commands",t=>t.HasCheckConstraint("CK_Review_CommandJson","ISJSON([ResultJson])=1"));e.HasKey(x=>new{x.ActorId,x.CommandId});e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.CommandId).HasMaxLength(32);e.Property(x=>x.PayloadHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ResultJson).HasMaxLength(16000);});
        b.Entity<ReviewEvent>(e=>{e.ToTable("Events");e.HasKey(x=>x.Id);e.Property(x=>x.Id).UseIdentityColumn();e.Property(x=>x.ReviewId).HasMaxLength(32);e.Property(x=>x.RevisionId).HasMaxLength(32);e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.Action).HasMaxLength(16);e.Property(x=>x.Reason).HasMaxLength(400);e.HasOne<ProductReview>().WithMany().HasForeignKey(x=>x.ReviewId).OnDelete(DeleteBehavior.Restrict);e.HasIndex(x=>new{x.ReviewId,x.Id});});
        b.Entity<ReviewVote>(e =>
        {
            e.ToTable("Votes", t => t.HasCheckConstraint("CK_Review_VoteValue", "[Value] IN (-1,0,1)"));
            e.HasKey(x => new { x.ReviewId, x.RevisionId, x.VoterId });
            e.Property(x => x.ReviewId).HasMaxLength(32);
            e.Property(x => x.RevisionId).HasMaxLength(32);
            e.Property(x => x.VoterId).HasMaxLength(64);
            e.Property(x => x.Version).IsRowVersion();
            e.HasIndex(x => new { x.ReviewId, x.RevisionId, x.Value });
            e.HasOne<ReviewRevision>().WithMany().HasForeignKey(x => new { x.ReviewId, x.RevisionId })
                .HasPrincipalKey(x => new { x.ReviewId, x.Id }).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<ReviewReport>(e=>{e.ToTable("Reports",t=>t.HasCheckConstraint("CK_Review_ReportReason","[Reason] IN ('spam','abuse','personal_data','unrelated')"));e.HasKey(x=>new{x.ReviewId,x.RevisionId,x.OwnerId});e.Property(x=>x.ReviewId).HasMaxLength(32);e.Property(x=>x.RevisionId).HasMaxLength(32);e.Property(x=>x.OwnerId).HasMaxLength(64);e.Property(x=>x.Reason).HasMaxLength(16);e.HasOne<ReviewRevision>().WithMany().HasForeignKey(x=>new{x.ReviewId,x.RevisionId}).HasPrincipalKey(x=>new{x.ReviewId,x.Id}).OnDelete(DeleteBehavior.Restrict);});
    }
}
