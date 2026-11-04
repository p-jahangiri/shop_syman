using Microsoft.EntityFrameworkCore;

namespace Shop.Modules.Notifications;

public sealed class SmsWorkspaceState
{
    public string Id { get; set; } = "messaging";
    public string OtpGeneration { get; set; } = Guid.NewGuid().ToString("N");
    public int LifetimeSeconds { get; set; } = 300;
    public int ResendSeconds { get; set; } = 60;
    public int MaxAttempts { get; set; } = 5;
    public int PhoneHourlyLimit { get; set; } = 5;
    public int PhoneDailyLimit { get; set; } = 20;
    public int GlobalHourlyLimit { get; set; } = 100;
    public int GlobalDailyLimit { get; set; } = 1000;
    public int NotificationHourlyLimit { get; set; } = 100;
    public int NotificationDailyLimit { get; set; } = 1000;
    public string GenericName { get; set; } = "کاربر سایمان";
    public DateTimeOffset ChangedAt { get; set; }
    public byte[] Version { get; set; } = [];
}
public sealed class SmsConnection
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Provider { get; set; } = "smsIr";
    public string Mode { get; set; } = "live";
    public bool Enabled { get; set; }
    public string KeyRevision { get; set; } = Guid.NewGuid().ToString("N");
    public byte[]? ProtectedApiKey { get; set; }
    public bool LegacyKeyProtection { get; set; }
}
public sealed class SmsTemplate
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Kind { get; set; } = "otp";
    public string ConnectionId { get; set; } = "";
    public string ProviderTemplate { get; set; } = "";
    public bool Approved { get; set; }
    public string PreviewText { get; set; } = "";
    public List<SmsTemplateParameter> Parameters { get; set; } = [];
}
public sealed class SmsTemplateParameter
{
    public string TemplateId { get; set; } = "";
    public string Name { get; set; } = "";
    public string Source { get; set; } = "";
    public string? Constant { get; set; }
}
public sealed class SmsEventRoute
{
    public string Event { get; set; } = "";
    public bool Enabled { get; set; }
    public string? TemplateId { get; set; }
    public DateTimeOffset? EnabledSince { get; set; }
}
public sealed class SmsWorkspaceCommand
{
    public string ActorId { get; set; } = "";
    public string RequestId { get; set; } = "";
    public byte[] ProtectedFingerprint { get; set; } = [];
    public byte[] ProtectedReceipt { get; set; } = [];
    public DateTimeOffset At { get; set; }
}
public sealed class SmsMessage
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public long Sequence { get; set; }
    public string Source { get; set; } = "";
    public string SourceId { get; set; } = "";
    public string Kind { get; set; } = "";
    public string OwnerId { get; set; } = "";
    public string State { get; set; } = "queued";
    public byte[] ProtectedPayload { get; set; } = [];
    public string? ConnectionName { get; set; }
    public string? Provider { get; set; }
    public string? TemplateName { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? AttemptedAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
    public string? Reason { get; set; }
    public string? ProviderMessageId { get; set; }
    public byte[] Version { get; set; } = [];
}
internal static class SmsWorkspaceModel
{
    internal static void Configure(ModelBuilder b)
    {
        b.Entity<SmsWorkspaceState>(e => {
            e.ToTable("SmsWorkspace", t => {
                t.HasCheckConstraint("CK_SmsWorkspace_Singleton", "[Id]='messaging'");
                t.HasCheckConstraint("CK_SmsWorkspace_Policy", "[LifetimeSeconds] BETWEEN 60 AND 600 AND [ResendSeconds] BETWEEN 30 AND 300 AND [ResendSeconds]<[LifetimeSeconds] AND [MaxAttempts] BETWEEN 1 AND 10 AND [PhoneHourlyLimit] BETWEEN 1 AND 20 AND [PhoneDailyLimit] BETWEEN [PhoneHourlyLimit] AND 100 AND [GlobalHourlyLimit] BETWEEN [PhoneHourlyLimit] AND 10000 AND [GlobalDailyLimit] BETWEEN [GlobalHourlyLimit] AND 100000 AND [GlobalDailyLimit]>=[PhoneDailyLimit] AND [NotificationHourlyLimit] BETWEEN 1 AND 10000 AND [NotificationDailyLimit] BETWEEN [NotificationHourlyLimit] AND 100000");
            });
            e.HasKey(x => x.Id); e.Property(x => x.Id).HasMaxLength(32).IsUnicode(false);
            e.Property(x => x.OtpGeneration).HasMaxLength(32).IsUnicode(false); e.Property(x => x.GenericName).HasMaxLength(25); e.Property(x => x.Version).IsRowVersion();
        });
        b.Entity<SmsConnection>(e => {
            e.ToTable("SmsConnections", t => {
                t.HasCheckConstraint("CK_SmsConnection_Provider", "([Provider]='smsIr' AND [Mode] IN ('live','sandbox')) OR ([Provider]='kavenegar' AND [Mode]='live')");
                t.HasCheckConstraint("CK_SmsConnection_Key", "[ProtectedApiKey] IS NULL OR DATALENGTH([ProtectedApiKey]) BETWEEN 1 AND 32768");
            });
            e.HasKey(x => x.Id); e.Property(x => x.Id).HasMaxLength(32).IsUnicode(false); e.Property(x => x.Name).HasMaxLength(100);
            e.Property(x => x.Provider).HasMaxLength(16).IsUnicode(false); e.Property(x => x.Mode).HasMaxLength(10).IsUnicode(false);
            e.Property(x => x.KeyRevision).HasMaxLength(32).IsUnicode(false); e.Property(x => x.ProtectedApiKey).HasMaxLength(32768);
        });
        b.Entity<SmsTemplate>(e => {
            e.ToTable("SmsTemplates"); e.HasKey(x => x.Id); e.Property(x => x.Id).HasMaxLength(32).IsUnicode(false);
            e.Property(x => x.Name).HasMaxLength(100); e.Property(x => x.Kind).HasMaxLength(24).IsUnicode(false);
            e.Property(x => x.ConnectionId).HasMaxLength(32).IsUnicode(false); e.Property(x => x.ProviderTemplate).HasMaxLength(100).IsUnicode(false);
            e.Property(x => x.PreviewText).HasMaxLength(2000);
            e.HasOne<SmsConnection>().WithMany().HasForeignKey(x => x.ConnectionId).OnDelete(DeleteBehavior.Restrict);
            e.HasMany(x => x.Parameters).WithOne().HasForeignKey(x => x.TemplateId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<SmsTemplateParameter>(e => {
            e.ToTable("SmsTemplateParameters"); e.HasKey(x => new { x.TemplateId, x.Name });
            e.Property(x => x.TemplateId).HasMaxLength(32).IsUnicode(false); e.Property(x => x.Name).HasMaxLength(50).IsUnicode(false).UseCollation("Latin1_General_100_BIN2");
            e.Property(x => x.Source).HasMaxLength(24).IsUnicode(false); e.Property(x => x.Constant).HasMaxLength(100);
        });
        b.Entity<SmsEventRoute>(e => {
            e.ToTable("SmsEventRoutes", t => t.HasCheckConstraint("CK_SmsRoute_Enabled", "([Enabled]=0) OR ([TemplateId] IS NOT NULL AND [EnabledSince] IS NOT NULL)"));
            e.HasKey(x => x.Event); e.Property(x => x.Event).HasMaxLength(24).IsUnicode(false); e.Property(x => x.TemplateId).HasMaxLength(32).IsUnicode(false);
            e.HasOne<SmsTemplate>().WithMany().HasForeignKey(x => x.TemplateId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<SmsWorkspaceCommand>(e => {
            e.ToTable("SmsWorkspaceCommands"); e.HasKey(x => new { x.ActorId, x.RequestId }).IsClustered(false);
            e.Property(x => x.ActorId).HasMaxLength(450); e.Property(x => x.RequestId).HasMaxLength(32).IsUnicode(false);
            e.Property(x => x.ProtectedFingerprint).HasMaxLength(32768); e.Property(x => x.ProtectedReceipt).HasMaxLength(524288);
        });
        b.Entity<SmsMessage>(e => {
            e.ToTable("SmsMessages", t => {
                t.HasCheckConstraint("CK_SmsMessage_State", "[State] IN ('queued','dispatching','accepted','rejected','unknown','skipped')");
                t.HasCheckConstraint("CK_SmsMessage_Payload", "DATALENGTH([ProtectedPayload]) BETWEEN 1 AND 32768");
            });
            e.HasKey(x => x.Id); e.Property(x => x.Id).HasMaxLength(32).IsUnicode(false); e.Property(x => x.Sequence).UseIdentityColumn(); e.HasIndex(x => x.Sequence).IsUnique();
            e.Property(x => x.Source).HasMaxLength(32).IsUnicode(false); e.Property(x => x.SourceId).HasMaxLength(64).IsUnicode(false); e.HasIndex(x => new { x.Source, x.SourceId }).IsUnique();
            e.Property(x => x.Kind).HasMaxLength(24).IsUnicode(false); e.Property(x => x.OwnerId).HasMaxLength(64); e.Property(x => x.State).HasMaxLength(16).IsUnicode(false);
            e.Property(x => x.ProtectedPayload).HasMaxLength(32768); e.Property(x => x.ConnectionName).HasMaxLength(100); e.Property(x => x.Provider).HasMaxLength(16).IsUnicode(false);
            e.Property(x => x.TemplateName).HasMaxLength(100); e.Property(x => x.Reason).HasMaxLength(40).IsUnicode(false); e.Property(x => x.ProviderMessageId).HasMaxLength(20).IsUnicode(false);
            e.Property(x => x.Version).IsRowVersion(); e.HasIndex(x => new { x.State, x.Sequence }); e.HasIndex(x => x.AttemptedAt);
        });
    }
}
public sealed partial class NotificationsDbContext
{
    public DbSet<SmsWorkspaceState> SmsWorkspace => Set<SmsWorkspaceState>();
    public DbSet<SmsConnection> SmsConnections => Set<SmsConnection>();
    public DbSet<SmsTemplate> SmsTemplates => Set<SmsTemplate>();
    public DbSet<SmsTemplateParameter> SmsTemplateParameters => Set<SmsTemplateParameter>();
    public DbSet<SmsEventRoute> SmsEventRoutes => Set<SmsEventRoute>();
    public DbSet<SmsWorkspaceCommand> SmsWorkspaceCommands => Set<SmsWorkspaceCommand>();
    public DbSet<SmsMessage> SmsMessages => Set<SmsMessage>();
}
