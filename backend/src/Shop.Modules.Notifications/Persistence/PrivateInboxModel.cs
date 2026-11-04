using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;
namespace Shop.Modules.Notifications;
public sealed class InboxNotification
{
    public string Id { get; set; }=Guid.NewGuid().ToString("N");
    public long Sequence { get; set; }
    public string OwnerId { get; set; }="";
    public string TicketId { get; set; }="";
    public long EventSequence { get; set; }
    public string Kind { get; set; }="";
    public DateTimeOffset At { get; set; }
    public DateTimeOffset? ReadAt { get; set; }
}
public sealed partial class NotificationsDbContext(DbContextOptions<NotificationsDbContext> options):DbContext(options)
{
    public DbSet<InboxNotification> Inbox=>Set<InboxNotification>();
    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasDefaultSchema("notifications");
        CreditInboxModel.Configure(b);
        PhoneInboxModel.Configure(b);
        SmsWorkspaceModel.Configure(b);
        b.Entity<InboxNotification>(e=>{
            e.ToTable("Inbox",t=>{t.HasCheckConstraint("CK_Inbox_Kind","[Kind] IN ('support_reply','support_closed','support_reopened')");t.HasCheckConstraint("CK_Inbox_Source","[EventSequence]>0");t.HasCheckConstraint("CK_Inbox_Time","DATEPART(TZOFFSET,[At])=0 AND ([ReadAt] IS NULL OR (DATEPART(TZOFFSET,[ReadAt])=0 AND [ReadAt]>=[At]))");});
            e.HasKey(x=>x.Id);e.Property(x=>x.Id).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.Sequence).UseIdentityColumn();e.HasIndex(x=>x.Sequence).IsUnique();e.Property(x=>x.OwnerId).HasMaxLength(64);e.Property(x=>x.TicketId).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.Kind).HasMaxLength(24).IsUnicode(false);
            e.HasIndex(x=>new{x.OwnerId,x.TicketId,x.EventSequence}).IsUnique();e.HasIndex(x=>new{x.OwnerId,x.Sequence});e.HasIndex(x=>new{x.OwnerId,x.ReadAt,x.Sequence});
        });
    }
    private void Guard()
    {
        GuardCreditInbox();GuardPhoneInbox();ChangeTracker.DetectChanges();foreach(var entry in ChangeTracker.Entries<InboxNotification>()){
            if(entry.State==EntityState.Deleted||entry.State==EntityState.Modified&&(entry.Properties.Any(p=>p.IsModified&&p.Metadata.Name!=nameof(InboxNotification.ReadAt))||entry.OriginalValues.GetValue<DateTimeOffset?>(nameof(InboxNotification.ReadAt))is not null||entry.Entity.ReadAt is null))throw new BusinessException("notification_history_immutable","Only the initial read acknowledgement may change.");
            if(entry.State is EntityState.Added or EntityState.Modified){var x=entry.Entity;NotificationRules.Id(x.Id);NotificationRules.Id(x.TicketId);if(NotificationRules.Owner(x.OwnerId)!=x.OwnerId||x.EventSequence<=0||!NotificationRules.Kinds.Contains(x.Kind,StringComparer.Ordinal)||x.At.Offset!=TimeSpan.Zero||x.ReadAt is{}read&&(read.Offset!=TimeSpan.Zero||read<x.At)||entry.State==EntityState.Added&&x.ReadAt is not null)throw NotificationRules.Invalid();}
        }
    }
    public override int SaveChanges(){Guard();return base.SaveChanges();}
    public override int SaveChanges(bool acceptAllChangesOnSuccess){Guard();return base.SaveChanges(acceptAllChangesOnSuccess);}
    public override Task<int> SaveChangesAsync(CancellationToken ct=default){Guard();return base.SaveChangesAsync(ct);}
    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess,CancellationToken ct=default){Guard();return base.SaveChangesAsync(acceptAllChangesOnSuccess,ct);}
}
