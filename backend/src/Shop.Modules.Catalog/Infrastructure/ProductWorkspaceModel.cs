using Microsoft.EntityFrameworkCore;

namespace Shop.Modules.Catalog.Infrastructure;

public sealed class ProductWorkspaceCommand
{
    public string ActorId { get; set; } = "";
    public string RequestId { get; set; } = "";
    public string Fingerprint { get; set; } = "";
    public string Kind { get; set; } = "";
    public string ReceiptJson { get; set; } = "";
    public DateTimeOffset CreatedAt
    {
        get; set;
    }
}
public sealed class ProductFormConfiguration
{
    public string Id { get; set; } = "default";
    public DateTimeOffset UpdatedAt
    {
        get; set;
    }
    public byte[] Version { get; set; } = [];
    public List<ProductFormField> Fields { get; set; } = [];
}
public sealed class ProductFormField
{
    public string ConfigurationId { get; set; } = "default";
    public string Key { get; set; } = "";
    public string Label { get; set; } = "";
    public string Help { get; set; } = "";
    public bool Visible { get; set; } = true;
    public int SortOrder
    {
        get; set;
    }
}
public static class ProductWorkspaceModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<ProductWorkspaceCommand>(e => { e.ToTable("ProductWorkspaceCommands", t => t.HasCheckConstraint("CK_ProductWorkspaceCommand_Kind", "[Kind] IN ('save','prices','archive','restore','fields')")); e.HasKey(x => new { x.ActorId, x.RequestId }); e.Property(x => x.ActorId).HasMaxLength(64); e.Property(x => x.RequestId).HasMaxLength(32); e.Property(x => x.Fingerprint).HasMaxLength(64); e.Property(x => x.Kind).HasMaxLength(16); e.Property(x => x.ReceiptJson).HasMaxLength(16384); e.HasIndex(x => x.CreatedAt); });
        b.Entity<ProductFormConfiguration>(e => { e.ToTable("ProductFormConfigurations"); e.HasKey(x => x.Id); e.Property(x => x.Id).HasMaxLength(16); e.Property(x => x.Version).IsRowVersion(); e.HasMany(x => x.Fields).WithOne().HasForeignKey(x => x.ConfigurationId).OnDelete(DeleteBehavior.Cascade); });
        b.Entity<ProductFormField>(e => { e.ToTable("ProductFormFields", t => t.HasCheckConstraint("CK_ProductFormField_Order", "[SortOrder] >= 0 AND [SortOrder] <= 1000")); e.HasKey(x => new { x.ConfigurationId, x.Key }); e.Property(x => x.ConfigurationId).HasMaxLength(16); e.Property(x => x.Key).HasMaxLength(40); e.Property(x => x.Label).HasMaxLength(150); e.Property(x => x.Help).HasMaxLength(1000); });
    }
}
