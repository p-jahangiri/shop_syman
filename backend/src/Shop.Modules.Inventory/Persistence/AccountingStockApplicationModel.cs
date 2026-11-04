using Microsoft.EntityFrameworkCore;
namespace Shop.Modules.Inventory;

public sealed class AccountingStockApplication
{
    public string Id {get;set;}="";
    public string ActorId {get;set;}="";
    public string CommandId {get;set;}="";
    public string BatchId {get;set;}="";
    public string PayloadHash {get;set;}="";
    public string BatchPayloadHash {get;set;}="";
    public string PreviewFingerprint {get;set;}="";
    public string CompanyKey {get;set;}="";
    public string ExternalWarehouseKey {get;set;}="";
    public string WarehouseId {get;set;}="";
    public string WarehouseVersion {get;set;}="";
    public DateTimeOffset ObservedAt {get;set;}
    public DateTimeOffset AppliedAt {get;set;}
    public string Reason {get;set;}="";
    public bool IsDemo {get;set;}
    public bool AcknowledgeWholeStorePhysical {get;set;}
    public bool AcknowledgeUnpostedSalesReconciled {get;set;}
    public int RowCount {get;set;}
    public List<AccountingStockApplicationLine> Lines {get;set;}=[];
}
public sealed class AccountingStockApplicationLine
{
    public string ApplicationId {get;set;}="";
    public string BatchId {get;set;}="";
    public int RowNumber {get;set;}
    public DateTimeOffset ObservedAt {get;set;}
    public string ExternalItemId {get;set;}="";
    public string ExternalUnitKey {get;set;}="";
    public string SourceQuantity {get;set;}="";
    public int Numerator {get;set;}
    public int Denominator {get;set;}
    public string LinkId {get;set;}="";
    public string LinkVersion {get;set;}="";
    public string MappingId {get;set;}="";
    public string MappingVersion {get;set;}="";
    public string VariantId {get;set;}="";
    public string ProductId {get;set;}="";
    public string VariantVersion {get;set;}="";
    public string ProductVersion {get;set;}="";
    public string Sku {get;set;}="";
    public string NameFa {get;set;}="";
    public string NameEn {get;set;}="";
    public int BeforeOnHand {get;set;}
    public int AfterOnHand {get;set;}
    public int Reserved {get;set;}
    public int SourcingReserved {get;set;}
    public int Delta {get;set;}
    public string? BeforeStockVersion {get;set;}
    public string? AfterStockVersion {get;set;}
    public long? MovementId {get;set;}
}
internal static class AccountingStockApplicationModel
{
    internal static void Configure(ModelBuilder b)
    {
        b.Entity<AccountingStockApplication>(e=>{
            e.ToTable("AccountingStockApplications",t=>{t.HasCheckConstraint("CK_AccountingStockApplication_Count","[RowCount] BETWEEN 1 AND 200");t.HasCheckConstraint("CK_AccountingStockApplication_Consent","[AcknowledgeWholeStorePhysical]=1 AND [AcknowledgeUnpostedSalesReconciled]=1");t.HasCheckConstraint("CK_AccountingStockApplication_Time","[ObservedAt]<=[AppliedAt]");});e.HasKey(x=>x.Id);e.Property(x=>x.Id).HasMaxLength(32);e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.CommandId).HasMaxLength(32);e.Property(x=>x.BatchId).HasMaxLength(32);e.HasIndex(x=>new{x.ActorId,x.CommandId}).IsUnique();e.HasIndex(x=>new{x.BatchId,x.Id});
            foreach(var name in new[]{nameof(AccountingStockApplication.PayloadHash),nameof(AccountingStockApplication.BatchPayloadHash),nameof(AccountingStockApplication.PreviewFingerprint)})e.Property<string>(name).HasMaxLength(64).IsUnicode(false);
            e.Property(x=>x.CompanyKey).HasMaxLength(64).UseCollation("Latin1_General_100_BIN2");e.Property(x=>x.ExternalWarehouseKey).HasMaxLength(64).UseCollation("Latin1_General_100_BIN2");e.Property(x=>x.WarehouseId).HasMaxLength(32);e.Property(x=>x.WarehouseVersion).HasMaxLength(12).IsUnicode(false);e.Property(x=>x.Reason).HasMaxLength(400);e.HasOne<AccountingWarehouseLink>().WithMany().HasForeignKey(x=>x.WarehouseId).OnDelete(DeleteBehavior.Restrict);e.HasMany(x=>x.Lines).WithOne().HasForeignKey(x=>x.ApplicationId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<AccountingStockApplicationLine>(e=>{
            e.ToTable("AccountingStockApplicationLines",t=>{
                t.HasCheckConstraint("CK_AccountingStockLine_RowRatio","[RowNumber] BETWEEN 1 AND 200 AND [Numerator] BETWEEN 1 AND 1000000 AND [Denominator] BETWEEN 1 AND 1000000");
                t.HasCheckConstraint("CK_AccountingStockLine_Balance","[BeforeOnHand]>=0 AND [AfterOnHand] BETWEEN 0 AND 1000000 AND [Reserved]>=0 AND [SourcingReserved]>=0 AND CAST([Reserved] AS bigint)+CAST([SourcingReserved] AS bigint)<=[BeforeOnHand] AND CAST([Reserved] AS bigint)+CAST([SourcingReserved] AS bigint)<=[AfterOnHand] AND CAST([AfterOnHand] AS bigint)-CAST([BeforeOnHand] AS bigint)=[Delta] AND [Delta] BETWEEN -1000000 AND 1000000");
                t.HasCheckConstraint("CK_AccountingStockLine_Movement","([Delta]=0 AND [MovementId] IS NULL) OR ([Delta]<>0 AND [MovementId] IS NOT NULL)");
            });e.HasKey(x=>new{x.ApplicationId,x.RowNumber});e.Property(x=>x.ApplicationId).HasMaxLength(32);e.Property(x=>x.BatchId).HasMaxLength(32);e.HasIndex(x=>new{x.BatchId,x.RowNumber}).IsUnique();e.Property(x=>x.VariantId).HasMaxLength(64);e.HasIndex(x=>new{x.VariantId,x.ObservedAt});e.Property(x=>x.ProductId).HasMaxLength(64);e.Property(x=>x.Sku).HasMaxLength(80);e.Property(x=>x.NameFa).HasMaxLength(250);e.Property(x=>x.NameEn).HasMaxLength(250);e.Property(x=>x.ExternalItemId).HasMaxLength(120).UseCollation("Latin1_General_100_BIN2");e.Property(x=>x.ExternalUnitKey).HasMaxLength(64).UseCollation("Latin1_General_100_BIN2");e.Property(x=>x.SourceQuantity).HasMaxLength(29).IsUnicode(false);e.Property(x=>x.LinkId).HasMaxLength(32);e.Property(x=>x.MappingId).HasMaxLength(32);
            foreach(var name in new[]{nameof(AccountingStockApplicationLine.LinkVersion),nameof(AccountingStockApplicationLine.MappingVersion),nameof(AccountingStockApplicationLine.VariantVersion),nameof(AccountingStockApplicationLine.ProductVersion),nameof(AccountingStockApplicationLine.BeforeStockVersion),nameof(AccountingStockApplicationLine.AfterStockVersion)})e.Property<string>(name).HasMaxLength(12).IsUnicode(false);
            e.HasOne<ReceivingUnitMapping>().WithMany().HasForeignKey(x=>x.MappingId).OnDelete(DeleteBehavior.Restrict);e.HasOne<StockMovement>().WithMany().HasForeignKey(x=>x.MovementId).OnDelete(DeleteBehavior.Restrict);
        });
    }
}
