using Microsoft.EntityFrameworkCore;

namespace Shop.Modules.Identity;

public sealed class StaffCreationCommand
{
    public string ActorId { get; set; } = "";
    public Guid RequestId { get; set; }
    public string UserId { get; set; } = "";
    public byte[] ProtectedFingerprint { get; set; } = [];
    public byte[] ProtectedReceipt { get; set; } = [];
    public DateTimeOffset CreatedAt { get; set; }
}

internal static class StaffProvisioningModel
{
    internal static void Configure(ModelBuilder model)
    {
        model.Entity<ShopUser>().ToTable("AspNetUsers", "identity", table => {
            table.HasCheckConstraint("CK_User_InitialPasswordProvisioning", "[MustChangePassword]=0 OR [ProvisionedByAdministrator]=1");
            table.HasCheckConstraint("CK_User_ManagedStaffMfa", "[ProvisionedByAdministrator]=0 OR [RequireMfa]=1");
        });
        model.Entity<StaffCreationCommand>(entity => {
            entity.ToTable("StaffCreationCommands", "identity", table => {
                table.HasCheckConstraint("CK_StaffCreation_Command", "[RequestId]<>'00000000-0000-0000-0000-000000000000'");
                table.HasCheckConstraint("CK_StaffCreation_Protected", "DATALENGTH([ProtectedFingerprint]) BETWEEN 1 AND 512 AND DATALENGTH([ProtectedReceipt]) BETWEEN 1 AND 16384");
            });
            entity.HasKey(x => new { x.ActorId, x.RequestId }).IsClustered(false);
            entity.Property(x => x.ActorId).HasMaxLength(450);
            entity.Property(x => x.UserId).HasMaxLength(450);
            entity.Property(x => x.ProtectedFingerprint).HasMaxLength(512);
            entity.Property(x => x.ProtectedReceipt).HasMaxLength(16384);
            entity.HasIndex(x => x.UserId).IsUnique();
            entity.HasOne<ShopUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
        });
    }

    internal static void Guard(IdentityDbContext db)
    {
        if (db.ChangeTracker.Entries<StaffCreationCommand>().Any(x => x.State is EntityState.Modified or EntityState.Deleted))
            throw new InvalidOperationException("Staff creation receipts are immutable.");
    }
}

public sealed partial class IdentityDbContext
{
    public DbSet<StaffCreationCommand> StaffCreationCommands => Set<StaffCreationCommand>();
    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        StaffProvisioningModel.Guard(this);
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }
    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        StaffProvisioningModel.Guard(this);
        return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }
}
