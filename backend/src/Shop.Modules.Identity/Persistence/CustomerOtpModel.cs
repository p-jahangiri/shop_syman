using Microsoft.EntityFrameworkCore;

namespace Shop.Modules.Identity;

public sealed class CustomerSmsSettings
{
    public string Id { get; set; } = "customer-sms";
    public bool Enabled { get; set; }
    public string Mode { get; set; } = "live";
    public int TemplateId { get; set; } = 170274;
    public string CodeParameterName { get; set; } = "CODE";
    public string? NameParameterName { get; set; } = "NAME";
    public string GenericName { get; set; } = "کاربر سایمان";
    public string KeyRevision { get; set; } = Guid.NewGuid().ToString("N");
    public byte[]? ProtectedApiKey { get; set; }
    public byte[] Version { get; set; } = [];
}

public sealed class CustomerSmsSettingsCommand
{
    public string ActorId { get; set; } = "";
    public string RequestId { get; set; } = "";
    public byte[] ProtectedFingerprint { get; set; } = [];
    public byte[] ProtectedReceipt { get; set; } = [];
    public DateTimeOffset CreatedAt { get; set; }
}

public sealed class CustomerOtpChallenge
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string RequestId { get; set; } = "";
    public string CanonicalPhone { get; set; } = "";
    public byte[] ProtectedCode { get; set; } = [];
    public string SettingsKeyRevision { get; set; } = "";
    public string State { get; set; } = "Prepared";
    public string? ProviderMessageId { get; set; }
    public int FailedAttempts { get; set; }
    public int LifetimeSeconds { get; set; } = 300;
    public int ResendSeconds { get; set; } = 60;
    public int MaxAttempts { get; set; } = 5;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset ResendAt { get; set; }
    public DateTimeOffset? ConsumedAt { get; set; }
    public DateTimeOffset? SupersededAt { get; set; }
    public byte[] Version { get; set; } = [];
}

internal static class CustomerOtpModel
{
    internal static void Configure(ModelBuilder model)
    {
        model.Entity<ShopUser>(e =>
        {
            e.Property(u => u.CanonicalPhone).HasMaxLength(13).IsUnicode(false)
                .UseCollation("Latin1_General_100_BIN2");
            e.HasIndex(u => u.CanonicalPhone).IsUnique().HasFilter("[CanonicalPhone] IS NOT NULL");
        });
        model.Entity<CustomerSmsSettings>(e =>
        {
            e.ToTable("CustomerSmsSettings", "identity", t =>
            {
                t.HasCheckConstraint("CK_CustomerSms_Singleton", "[Id]='customer-sms'");
                t.HasCheckConstraint("CK_CustomerSms_Mode", "([Mode]='live' AND [TemplateId]>0 AND [TemplateId]<>123456) OR ([Mode]='sandbox' AND [TemplateId]=123456 AND [CodeParameterName]='Code' AND [NameParameterName] IS NULL)");
                t.HasCheckConstraint("CK_CustomerSms_Key", "[ProtectedApiKey] IS NULL OR DATALENGTH([ProtectedApiKey]) BETWEEN 1 AND 32768");
            });
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasMaxLength(32).IsUnicode(false);
            e.Property(x => x.Mode).HasMaxLength(10).IsUnicode(false);
            e.Property(x => x.CodeParameterName).HasMaxLength(50).IsUnicode(false);
            e.Property(x => x.NameParameterName).HasMaxLength(50).IsUnicode(false);
            e.Property(x => x.GenericName).HasMaxLength(25);
            e.Property(x => x.KeyRevision).HasMaxLength(32).IsUnicode(false);
            e.Property(x => x.ProtectedApiKey).HasMaxLength(32768);
            e.Property(x => x.Version).IsRowVersion();
        });
        model.Entity<CustomerSmsSettingsCommand>(e =>
        {
            e.ToTable("CustomerSmsSettingsCommands", "identity");
            e.HasKey(x => new { x.ActorId, x.RequestId }).IsClustered(false);
            e.Property(x => x.ActorId).HasMaxLength(450);
            e.Property(x => x.RequestId).HasMaxLength(32).IsUnicode(false);
            e.Property(x => x.ProtectedFingerprint).HasMaxLength(32768);
            e.Property(x => x.ProtectedReceipt).HasMaxLength(32768);
        });
        model.Entity<CustomerOtpChallenge>(e =>
        {
            e.ToTable("CustomerOtpChallenges", "identity", t =>
            {
                t.HasCheckConstraint("CK_CustomerOtp_Attempts", "[MaxAttempts] BETWEEN 1 AND 10 AND [FailedAttempts] BETWEEN 0 AND [MaxAttempts]");
                t.HasCheckConstraint("CK_CustomerOtp_Timing", "[LifetimeSeconds] BETWEEN 60 AND 600 AND [ResendSeconds] BETWEEN 30 AND 300 AND [ResendSeconds]<[LifetimeSeconds] AND [ExpiresAt]=DATEADD(second,[LifetimeSeconds],[CreatedAt]) AND [ResendAt]=DATEADD(second,[ResendSeconds],[CreatedAt])");
                t.HasCheckConstraint("CK_CustomerOtp_State", "[State] IN ('Prepared','Dispatching','Accepted','Rejected','Unknown')");
                t.HasCheckConstraint("CK_CustomerOtp_Code", "DATALENGTH([ProtectedCode]) BETWEEN 1 AND 32768");
            });
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasMaxLength(32).IsUnicode(false).UseCollation("Latin1_General_100_BIN2");
            e.Property(x => x.RequestId).HasMaxLength(32).IsUnicode(false);
            e.HasIndex(x => x.RequestId).IsUnique();
            e.Property(x => x.CanonicalPhone).HasMaxLength(13).IsUnicode(false);
            e.Property(x => x.ProtectedCode).HasMaxLength(32768);
            e.Property(x => x.LifetimeSeconds).HasDefaultValue(300);
            e.Property(x => x.ResendSeconds).HasDefaultValue(60);
            e.Property(x => x.MaxAttempts).HasDefaultValue(5);
            e.Property(x => x.SettingsKeyRevision).HasMaxLength(32).IsUnicode(false);
            e.Property(x => x.State).HasMaxLength(16).IsUnicode(false);
            e.Property(x => x.ProviderMessageId).HasMaxLength(20).IsUnicode(false);
            e.Property(x => x.Version).IsRowVersion();
            e.HasIndex(x => new { x.CanonicalPhone, x.CreatedAt });
            e.HasIndex(x => x.CreatedAt);
        });
    }
}

public sealed partial class IdentityDbContext
{
    public DbSet<CustomerSmsSettings> CustomerSmsSettings => Set<CustomerSmsSettings>();
    public DbSet<CustomerSmsSettingsCommand> CustomerSmsSettingsCommands => Set<CustomerSmsSettingsCommand>();
    public DbSet<CustomerOtpChallenge> CustomerOtpChallenges => Set<CustomerOtpChallenge>();
}
