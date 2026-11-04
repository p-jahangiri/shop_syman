using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Notifications;

public sealed class PhoneInboxNotification
{
    public string Id{get;set;}="";
    public long Sequence{get;set;}
    public string OwnerId{get;set;}="";
    public string Kind{get;set;}="";
    public string ListingId{get;set;}="";
    public string ConfigurationId{get;set;}="";
    public DateTimeOffset At{get;set;}
    public DateTimeOffset? ReadAt{get;set;}
    public string PayloadHash{get;set;}="";
    public byte[] ProtectedPayload{get;set;}=[];
}

internal static class PhoneInboxModel
{
    public static void Configure(ModelBuilder builder)
    {
        builder.Entity<PhoneInboxNotification>(entity=>{
            entity.ToTable("PhoneInbox",table=>{
                table.HasCheckConstraint("CK_PhoneInbox_Kind","[Kind] IN ('phone_available','sourcing_offer_published')");
                table.HasCheckConstraint("CK_PhoneInbox_Sealed","DATALENGTH([ProtectedPayload]) BETWEEN 1 AND 8192");
                table.HasCheckConstraint("CK_PhoneInbox_Time","DATEPART(TZOFFSET,[At])=0 AND ([ReadAt] IS NULL OR (DATEPART(TZOFFSET,[ReadAt])=0 AND [ReadAt]>=[At]))");
            });
            entity.HasKey(row=>row.Id);
            foreach(var name in new[]{"Id","ListingId","ConfigurationId"})entity.Property<string>(name).HasMaxLength(32).IsUnicode(false);
            entity.Property(row=>row.Sequence).UseIdentityColumn();
            entity.Property(row=>row.OwnerId).HasMaxLength(64);
            entity.Property(row=>row.Kind).HasMaxLength(32).IsUnicode(false);
            entity.Property(row=>row.PayloadHash).HasMaxLength(64).IsUnicode(false);
            entity.Property(row=>row.ProtectedPayload).HasMaxLength(8192);
            entity.HasIndex(row=>row.Sequence).IsUnique();
            entity.HasIndex(row=>new{row.OwnerId,row.Sequence});
            entity.HasIndex(row=>new{row.OwnerId,row.ReadAt,row.Sequence});
        });
    }
}

public sealed partial class NotificationsDbContext
{
    public DbSet<PhoneInboxNotification> PhoneInbox=>Set<PhoneInboxNotification>();
    private void GuardPhoneInbox()
    {
        ChangeTracker.DetectChanges();
        foreach(var entry in ChangeTracker.Entries<PhoneInboxNotification>()){
            if(entry.State==EntityState.Deleted||entry.State==EntityState.Modified&&(
                entry.Properties.Any(property=>property.IsModified&&property.Metadata.Name!=nameof(PhoneInboxNotification.ReadAt))||
                entry.OriginalValues.GetValue<DateTimeOffset?>(nameof(PhoneInboxNotification.ReadAt))is not null||entry.Entity.ReadAt is null))
                throw new BusinessException("notification_history_immutable","Only the initial read acknowledgement may change.");
            if(entry.State is not(EntityState.Added or EntityState.Modified))continue;
            var row=entry.Entity;
            foreach(var id in new[]{row.Id,row.ListingId,row.ConfigurationId})NotificationRules.Id(id);
            if(row.OwnerId!=NotificationRules.Owner(row.OwnerId)||!PhoneInboxRules.Kinds.Contains(row.Kind,StringComparer.Ordinal)||
                row.At.Offset!=TimeSpan.Zero||row.ProtectedPayload.Length is<1 or>8192||
                row.PayloadHash.Length!=64||row.PayloadHash.Any(character=>!char.IsAsciiHexDigitUpper(character))||
                row.ReadAt is{}read&&(read.Offset!=TimeSpan.Zero||read<row.At)||entry.State==EntityState.Added&&row.ReadAt is not null)
                throw NotificationRules.Invalid();
        }
    }
}
