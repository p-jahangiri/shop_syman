using Microsoft.EntityFrameworkCore;
namespace Shop.Modules.Sales;

public sealed class OrderDigitalDelivery
{
    public string Id{get;set;}="";
    public string OrderId{get;set;}="";
    public string OwnerId{get;set;}="";
    public string ReservationId{get;set;}="";
    public DateTimeOffset AvailableAt{get;set;}
    public string InventoryDispatchHash{get;set;}="";
    public bool ContainsDemo{get;set;}
    public byte[] ProtectedManifest{get;set;}=[];
}
public sealed class OrderDigitalItem
{
    public string Id{get;set;}="";
    public string DeliveryId{get;set;}="";
    public string LineKey{get;set;}="";
    public int Position{get;set;}
    public byte[] ProtectedContent{get;set;}=[];
}
public sealed class OrderDigitalCommand
{
    public string ActorId{get;set;}="";
    public string CommandId{get;set;}="";
    public string OrderId{get;set;}="";
    public string DeliveryId{get;set;}="";
    public string PayloadHash{get;set;}="";
    public DateTimeOffset RecordedAt{get;set;}
    public bool ContainsDemo{get;set;}
    public byte[] ProtectedReceipt{get;set;}=[];
}
public sealed partial class SalesDbContext
{
    public DbSet<OrderDigitalDelivery> DigitalDeliveries=>Set<OrderDigitalDelivery>();
    public DbSet<OrderDigitalItem> DigitalItems=>Set<OrderDigitalItem>();
    public DbSet<OrderDigitalCommand> DigitalCommands=>Set<OrderDigitalCommand>();
}
public static class DigitalDeliveryModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<OrderDigitalDelivery>(e=>{
            e.ToTable("DigitalDeliveries",t=>{
                t.HasCheckConstraint("CK_DigitalDelivery_Identity","LEN([Id])=32 AND LEN([OrderId])=32 AND LEN([ReservationId])=32 AND LEN([InventoryDispatchHash])=64");
                t.HasCheckConstraint("CK_DigitalDelivery_Manifest","DATALENGTH([ProtectedManifest]) BETWEEN 1 AND 131072");
            });e.HasKey(x=>x.Id);e.HasAlternateKey(x=>new{x.Id,x.OrderId});
            foreach(var n in new[]{"Id","OrderId","ReservationId"})e.Property<string>(n).HasMaxLength(32);
            e.Property(x=>x.OwnerId).HasMaxLength(64);e.Property(x=>x.InventoryDispatchHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ProtectedManifest).HasMaxLength(131072);
            e.HasIndex(x=>new{x.OrderId,x.AvailableAt,x.Id});
            e.HasOne<OrderFulfillmentHeader>().WithMany().HasForeignKey(x=>new{x.OrderId,x.OwnerId,x.ReservationId}).HasPrincipalKey(x=>new{x.OrderId,x.OwnerId,x.ReservationId}).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<OrderDigitalItem>(e=>{
            e.ToTable("DigitalDeliveryItems",t=>{
                t.HasCheckConstraint("CK_DigitalItem_Identity","LEN([Id])=32 AND LEN([DeliveryId])=32 AND [Position] BETWEEN 1 AND 100");
                t.HasCheckConstraint("CK_DigitalItem_Content","DATALENGTH([ProtectedContent]) BETWEEN 1 AND 16384");
            });e.HasKey(x=>x.Id);e.Property(x=>x.Id).HasMaxLength(32);e.Property(x=>x.DeliveryId).HasMaxLength(32);e.Property(x=>x.LineKey).HasMaxLength(64);e.Property(x=>x.ProtectedContent).HasMaxLength(16384);
            e.HasIndex(x=>new{x.DeliveryId,x.LineKey,x.Position}).IsUnique();e.HasOne<OrderDigitalDelivery>().WithMany().HasForeignKey(x=>x.DeliveryId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<OrderDigitalCommand>(e=>{
            e.ToTable("DigitalDeliveryCommands",t=>{
                t.HasCheckConstraint("CK_DigitalCommand_Identity","LEN([CommandId])=32 AND LEN([PayloadHash])=64");
                t.HasCheckConstraint("CK_DigitalCommand_Receipt","DATALENGTH([ProtectedReceipt]) BETWEEN 1 AND 131072");
            });e.HasKey(x=>new{x.ActorId,x.CommandId});e.Property(x=>x.ActorId).HasMaxLength(64);
            foreach(var n in new[]{"CommandId","OrderId","DeliveryId"})e.Property<string>(n).HasMaxLength(32);
            e.Property(x=>x.PayloadHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ProtectedReceipt).HasMaxLength(131072);
            e.HasIndex(x=>x.DeliveryId).IsUnique();e.HasOne<OrderDigitalDelivery>().WithMany().HasForeignKey(x=>new{x.DeliveryId,x.OrderId}).HasPrincipalKey(x=>new{x.Id,x.OrderId}).OnDelete(DeleteBehavior.Restrict);
        });
    }
    public static void Guard(SalesDbContext db)
    {
        if(db.ChangeTracker.Entries().Any(e=>(e.Entity is OrderDigitalDelivery or OrderDigitalItem or OrderDigitalCommand)&&(e.State is EntityState.Modified or EntityState.Deleted)))throw new InvalidOperationException("Published digital content, manifests and command receipts are immutable.");
    }
}
