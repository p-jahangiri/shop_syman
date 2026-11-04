using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;
namespace Shop.Modules.Notifications;

public sealed class CreditInboxNotification
{
    public string Id{get;set;}="";public long Sequence{get;set;}public string OwnerId{get;set;}="";public string OrderId{get;set;}="";public string ChequeId{get;set;}="";public DateTimeOffset At{get;set;}public DateTimeOffset? ReadAt{get;set;}public string PayloadHash{get;set;}="";public byte[] ProtectedPayload{get;set;}=[];
}
internal static class CreditInboxModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<CreditInboxNotification>(e=>{
            e.ToTable("CreditInbox",t=>{t.HasCheckConstraint("CK_CreditInbox_Sealed","DATALENGTH([ProtectedPayload]) BETWEEN 1 AND 8192");t.HasCheckConstraint("CK_CreditInbox_Time","DATEPART(TZOFFSET,[At])=0 AND ([ReadAt] IS NULL OR (DATEPART(TZOFFSET,[ReadAt])=0 AND [ReadAt]>=[At]))");});e.HasKey(x=>x.Id);foreach(var n in new[]{"Id","OrderId","ChequeId"})e.Property<string>(n).HasMaxLength(32).IsUnicode(false);e.Property(x=>x.OwnerId).HasMaxLength(64);e.Property(x=>x.Sequence).UseIdentityColumn();e.Property(x=>x.PayloadHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ProtectedPayload).HasMaxLength(8192);e.HasIndex(x=>x.Sequence).IsUnique();e.HasIndex(x=>new{x.OwnerId,x.Sequence});e.HasIndex(x=>new{x.OwnerId,x.ReadAt,x.Sequence});
        });
    }
}
public sealed partial class NotificationsDbContext
{
    public DbSet<CreditInboxNotification> CreditInbox=>Set<CreditInboxNotification>();
    private void GuardCreditInbox()
    {
        ChangeTracker.DetectChanges();foreach(var entry in ChangeTracker.Entries<CreditInboxNotification>()){
            if(entry.State==EntityState.Deleted||entry.State==EntityState.Modified&&(entry.Properties.Any(p=>p.IsModified&&p.Metadata.Name!=nameof(CreditInboxNotification.ReadAt))||entry.OriginalValues.GetValue<DateTimeOffset?>(nameof(CreditInboxNotification.ReadAt))is not null||entry.Entity.ReadAt is null))throw new BusinessException("notification_history_immutable","Only the initial read acknowledgement may change.");
            if(entry.State is EntityState.Added or EntityState.Modified){var x=entry.Entity;foreach(var id in new[]{x.Id,x.OrderId,x.ChequeId})NotificationRules.Id(id);if(x.OwnerId!=NotificationRules.Owner(x.OwnerId)||x.At.Offset!=TimeSpan.Zero||x.ProtectedPayload.Length is<1 or>8192||x.PayloadHash.Length!=64||x.PayloadHash.Any(c=>!char.IsAsciiHexDigitUpper(c))||x.ReadAt is{}read&&(read.Offset!=TimeSpan.Zero||read<x.At)||entry.State==EntityState.Added&&x.ReadAt is not null)throw NotificationRules.Invalid();}
        }
    }
}
