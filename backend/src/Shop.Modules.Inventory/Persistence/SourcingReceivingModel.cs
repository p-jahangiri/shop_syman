using Microsoft.EntityFrameworkCore;

namespace Shop.Modules.Inventory;

public sealed class ReceivingUnitMapping
{
    public string Id{get;set;}="";
    public string IdentityHash{get;set;}="";
    public string OriginSystem{get;set;}="";
    public string CompanyKey{get;set;}="";
    public string WarehouseKey{get;set;}="";
    public string SourceUnitKey{get;set;}="";
    public string VariantId{get;set;}="";
    public int Numerator{get;set;}
    public int Denominator{get;set;}
    public string NameFa{get;set;}="";
    public string NameEn{get;set;}="";
    public bool IsActive{get;set;}
    public DateTimeOffset CreatedAt{get;set;}
    public DateTimeOffset ChangedAt{get;set;}
    public byte[] Version{get;set;}=[];
}
public sealed class SourcingStockReceipt
{
    public string Id{get;set;}="";
    public string RequestId{get;set;}="";
    public string TaskId{get;set;}="";
    public string OfferId{get;set;}="";
    public string AcceptanceId{get;set;}="";
    public bool ContainsDemo{get;set;}
    public bool RequiresNewOffer{get;set;}
    public string Channel{get;set;}="";
    public string OriginSystem{get;set;}="";
    public string CompanyKey{get;set;}="";
    public string WarehouseKey{get;set;}="";
    public string SourceReceiptKey{get;set;}="";
    public DateTimeOffset ReceivedAt{get;set;}
    public DateTimeOffset RecordedAt{get;set;}
    public string ActorId{get;set;}="";
    public string Reason{get;set;}="";
    public bool AcknowledgeHistorical{get;set;}
    public List<SourcingStockReceiptLine> Lines{get;set;}=[];
}
public sealed class SourcingStockReceiptLine
{
    public string Id{get;set;}="";
    public string ReceiptId{get;set;}="";
    public string ExternalIdentityHash{get;set;}="";
    public string OfferLineId{get;set;}="";
    public string VariantId{get;set;}="";
    public string SourceReceiptLineKey{get;set;}="";
    public string MappingId{get;set;}="";
    public string MappingVersion{get;set;}="";
    public string SourceUnitKey{get;set;}="";
    public string UnitNameFa{get;set;}="";
    public string UnitNameEn{get;set;}="";
    public int Numerator{get;set;}
    public int Denominator{get;set;}
    public string SourceQuantity{get;set;}="";
    public int Quantity{get;set;}
    public string TrackingMode{get;set;}="";
    public long MovementId{get;set;}
    public StockMovement Movement{get;set;}=null!;
    public List<SourcingStockReceiptUnit> Units{get;set;}=[];
}
public sealed class SourcingStockReceiptUnit
{
    public string ReceiptLineId{get;set;}="";
    public string UnitId{get;set;}="";
}
public sealed class ReceivingCommand
{
    public string ActorId{get;set;}="";
    public string Operation{get;set;}="";
    public string CommandId{get;set;}="";
    public string TargetId{get;set;}="";
    public string? RequestId{get;set;}
    public string? TaskId{get;set;}
    public bool ContainsDemo{get;set;}
    public string PayloadHash{get;set;}="";
    public string ResultJson{get;set;}="";
    public DateTimeOffset At{get;set;}
}
internal static class SourcingReceivingModel
{
    private const string Binary="Latin1_General_100_BIN2";
    public static void Configure(ModelBuilder b)
    {
        b.Entity<ReceivingUnitMapping>(e=>{
            e.ToTable("ReceivingUnitMappings",t=>t.HasCheckConstraint("CK_ReceivingMapping_Ratio","[Numerator] BETWEEN 1 AND 1000000 AND [Denominator] BETWEEN 1 AND 1000000"));e.HasKey(x=>x.Id);e.Property(x=>x.Id).HasMaxLength(32);e.Property(x=>x.IdentityHash).HasMaxLength(64).IsUnicode(false);e.HasIndex(x=>x.IdentityHash).IsUnique();
            e.Property(x=>x.OriginSystem).HasMaxLength(64).UseCollation(Binary);e.Property(x=>x.CompanyKey).HasMaxLength(64).UseCollation(Binary);e.Property(x=>x.WarehouseKey).HasMaxLength(64).UseCollation(Binary);e.Property(x=>x.SourceUnitKey).HasMaxLength(120).UseCollation(Binary);e.Property(x=>x.VariantId).HasMaxLength(64);e.Property(x=>x.NameFa).HasMaxLength(200);e.Property(x=>x.NameEn).HasMaxLength(200);e.Property(x=>x.Version).IsRowVersion();e.HasIndex(x=>new{x.VariantId,x.Id});
        });
        b.Entity<SourcingStockReceipt>(e=>{
            e.ToTable("SourcingReceipts",t=>t.HasCheckConstraint("CK_SourcingReceipt_Channel","[Channel] IN ('manual','csv')"));e.HasKey(x=>x.Id);e.Property(x=>x.Id).HasMaxLength(32);e.Property(x=>x.RequestId).HasMaxLength(32);e.Property(x=>x.TaskId).HasMaxLength(32);e.Property(x=>x.OfferId).HasMaxLength(32);e.Property(x=>x.AcceptanceId).HasMaxLength(32);e.Property(x=>x.Channel).HasMaxLength(8);e.Property(x=>x.OriginSystem).HasMaxLength(64).UseCollation(Binary);e.Property(x=>x.CompanyKey).HasMaxLength(64).UseCollation(Binary);e.Property(x=>x.WarehouseKey).HasMaxLength(64).UseCollation(Binary);e.Property(x=>x.SourceReceiptKey).HasMaxLength(120).UseCollation(Binary);e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.Reason).HasMaxLength(500);e.HasIndex(x=>new{x.TaskId,x.RecordedAt,x.Id});e.HasMany(x=>x.Lines).WithOne().HasForeignKey(x=>x.ReceiptId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<SourcingStockReceiptLine>(e=>{
            e.ToTable("SourcingReceiptLines",t=>{t.HasCheckConstraint("CK_SourcingReceiptLine_Quantity","[Quantity] BETWEEN 1 AND 1000000 AND [Numerator] BETWEEN 1 AND 1000000 AND [Denominator] BETWEEN 1 AND 1000000");t.HasCheckConstraint("CK_SourcingReceiptLine_Mode","[TrackingMode] IN ('none','serial','imei')");});e.HasKey(x=>x.Id);e.Property(x=>x.Id).HasMaxLength(32);e.Property(x=>x.ReceiptId).HasMaxLength(32);e.Property(x=>x.ExternalIdentityHash).HasMaxLength(64).IsUnicode(false);e.HasIndex(x=>x.ExternalIdentityHash).IsUnique();e.Property(x=>x.OfferLineId).HasMaxLength(32);e.Property(x=>x.VariantId).HasMaxLength(64);e.Property(x=>x.SourceReceiptLineKey).HasMaxLength(120).UseCollation(Binary);e.Property(x=>x.MappingId).HasMaxLength(32);e.Property(x=>x.MappingVersion).HasMaxLength(12).IsUnicode(false);e.Property(x=>x.SourceUnitKey).HasMaxLength(120).UseCollation(Binary);e.Property(x=>x.UnitNameFa).HasMaxLength(200);e.Property(x=>x.UnitNameEn).HasMaxLength(200);e.Property(x=>x.SourceQuantity).HasMaxLength(29).IsUnicode(false);e.Property(x=>x.TrackingMode).HasMaxLength(8);e.HasOne<ReceivingUnitMapping>().WithMany().HasForeignKey(x=>x.MappingId).OnDelete(DeleteBehavior.Restrict);e.HasOne<StockItem>().WithMany().HasForeignKey(x=>x.VariantId).OnDelete(DeleteBehavior.Restrict);e.HasOne(x=>x.Movement).WithMany().HasForeignKey(x=>x.MovementId).OnDelete(DeleteBehavior.Restrict);e.HasIndex(x=>new{x.ReceiptId,x.SourceReceiptLineKey}).IsUnique();e.HasMany(x=>x.Units).WithOne().HasForeignKey(x=>x.ReceiptLineId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<SourcingStockReceiptUnit>(e=>{e.ToTable("SourcingReceiptUnits");e.HasKey(x=>new{x.ReceiptLineId,x.UnitId});e.Property(x=>x.ReceiptLineId).HasMaxLength(32);e.Property(x=>x.UnitId).HasMaxLength(32);e.HasIndex(x=>x.UnitId).IsUnique();e.HasOne<SerialUnit>().WithMany().HasForeignKey(x=>x.UnitId).OnDelete(DeleteBehavior.Restrict);});
        b.Entity<ReceivingCommand>(e=>{e.ToTable("ReceivingCommands",t=>{t.HasCheckConstraint("CK_ReceivingCommand_Operation","[Operation] IN ('receive','mapping')");t.HasCheckConstraint("CK_ReceivingCommand_Result","ISJSON([ResultJson])=1 AND DATALENGTH([ResultJson])<=262144");});e.HasKey(x=>new{x.ActorId,x.Operation,x.CommandId});e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.Operation).HasMaxLength(8);e.Property(x=>x.CommandId).HasMaxLength(32);e.Property(x=>x.TargetId).HasMaxLength(32);e.Property(x=>x.RequestId).HasMaxLength(32);e.Property(x=>x.TaskId).HasMaxLength(32);e.Property(x=>x.PayloadHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ResultJson).HasColumnType("nvarchar(max)");});
    }
}
