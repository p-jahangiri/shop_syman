using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Market;
public sealed class MarketListing
{
    public string Id {get;set;}=Guid.NewGuid().ToString("N");
    public string ModelId {get;set;}="";
    public string Status {get;set;}="Draft";
    public string SourceKey {get;set;}="";
    public string SourceItemKey {get;set;}="";
    public string SourceNameFa {get;set;}="";
    public string SourceNameEn {get;set;}="";
    public string? SourceUrl {get;set;}
    public string Availability {get;set;}="unknown";
    public DateTimeOffset? ObservedAt {get;set;}
    public DateTimeOffset? ValidUntil {get;set;}
    public long? ReferencePriceRial {get;set;}
    public bool IsDemo {get;set;}
    public DateTimeOffset CreatedAt {get;set;}=DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt {get;set;}=DateTimeOffset.UtcNow;
    public byte[] Version {get;set;}=[];
}
public sealed class MarketDbContext(DbContextOptions<MarketDbContext> options):DbContext(options)
{
    public DbSet<MarketListing> Listings=>Set<MarketListing>();
    public DbSet<PhoneConfiguration> PhoneConfigurations=>Set<PhoneConfiguration>();
    public DbSet<PhoneInterest> PhoneInterests=>Set<PhoneInterest>();
    public DbSet<PhoneDiscoveryCommand> PhoneDiscoveryCommands=>Set<PhoneDiscoveryCommand>();
    public DbSet<MarketSource> Sources=>Set<MarketSource>();
    public DbSet<MarketSourceObservation> SourceObservations=>Set<MarketSourceObservation>();
    public DbSet<MarketSourceCommand> SourceCommands=>Set<MarketSourceCommand>();
    public DbSet<MarketSourceImportReceipt> SourceImportReceipts=>Set<MarketSourceImportReceipt>();
    public DbSet<MarketImportReceipt> ImportReceipts=>Set<MarketImportReceipt>();
    public DbSet<SourcingRequest> SourcingRequests=>Set<SourcingRequest>();
    public DbSet<SourcingRequestLine> SourcingRequestLines=>Set<SourcingRequestLine>();
    public DbSet<SourcingRequestEvent> SourcingRequestEvents=>Set<SourcingRequestEvent>();
    public DbSet<SourcingCommandReceipt> SourcingCommandReceipts=>Set<SourcingCommandReceipt>();
    public DbSet<SourcingOffer> SourcingOffers=>Set<SourcingOffer>();
    public DbSet<SourcingOfferEvent> SourcingOfferEvents=>Set<SourcingOfferEvent>();
    public DbSet<SourcingOfferAcceptance> SourcingOfferAcceptances=>Set<SourcingOfferAcceptance>();
    public DbSet<SourcingOfferCommandReceipt> SourcingOfferCommandReceipts=>Set<SourcingOfferCommandReceipt>();
    public DbSet<SourcingSupplyTask> SourcingSupplyTasks=>Set<SourcingSupplyTask>();
    public DbSet<SourcingSupplyEvent> SourcingSupplyEvents=>Set<SourcingSupplyEvent>();
    public DbSet<SourcingSupplyCommandReceipt> SourcingSupplyCommandReceipts=>Set<SourcingSupplyCommandReceipt>();
    public DbSet<SourcingSupplyReceiptApplication> SourcingSupplyReceiptApplications=>Set<SourcingSupplyReceiptApplication>();
    public DbSet<SourcingOrderLink> SourcingOrderLinks=>Set<SourcingOrderLink>();
    public DbSet<CatalogMarketModelV1> CatalogModels=>Set<CatalogMarketModelV1>();
    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasDefaultSchema("market");
        PhoneDiscoveryModel.Configure(b);
        MarketSourceModel.Configure(b);
        MarketSourceCsvModel.Configure(b);
        SourcingModel.Configure(b);
        SourcingOfferModel.Configure(b);
        SourcingSupplyModel.Configure(b);
        SourcingOrderProjectionModel.Configure(b);
        b.Entity<MarketImportReceipt>(e=>{e.HasKey(x=>new{x.ActorId,x.RequestId});e.Property(x=>x.ActorId).HasMaxLength(64);e.Property(x=>x.RequestId).HasMaxLength(32);e.Property(x=>x.PayloadHash).HasMaxLength(64).IsUnicode(false);e.Property(x=>x.ResponseJson).HasColumnType("nvarchar(max)");e.ToTable(t=>{t.HasCheckConstraint("CK_MarketImport_Response","ISJSON([ResponseJson])=1 AND DATALENGTH([ResponseJson])<=262144");t.HasCheckConstraint("CK_MarketImport_Rows","[RowCount] BETWEEN 1 AND 50");});});
        b.Entity<MarketListing>(e=>{
            e.HasKey(x=>x.Id);e.Property(x=>x.Id).HasMaxLength(32);e.Property(x=>x.ModelId).HasMaxLength(64);e.HasIndex(x=>x.ModelId).IsUnique();
            e.Property(x=>x.SourceKey).HasMaxLength(64);e.Property(x=>x.SourceItemKey).HasMaxLength(120);e.HasIndex(x=>new{x.SourceKey,x.SourceItemKey}).IsUnique();
            e.Property(x=>x.SourceNameFa).HasMaxLength(200);e.Property(x=>x.SourceNameEn).HasMaxLength(200);e.Property(x=>x.SourceUrl).HasMaxLength(1500);
            e.Property(x=>x.Status).HasMaxLength(16);e.Property(x=>x.Availability).HasMaxLength(16);e.Property(x=>x.ReferencePriceRial).HasColumnType("bigint");e.Property(x=>x.Version).IsRowVersion();e.HasIndex(x=>new{x.Status,x.Id});
            e.ToTable(t=>{t.HasCheckConstraint("CK_Market_Status","[Status] IN ('Draft','Published','Hidden')");t.HasCheckConstraint("CK_Market_Availability","[Availability] IN ('unknown','available','unavailable')");t.HasCheckConstraint("CK_Market_Observation","([ObservedAt] IS NULL AND [ValidUntil] IS NULL AND [Availability]='unknown' AND [ReferencePriceRial] IS NULL) OR ([ObservedAt] IS NOT NULL AND [ValidUntil] IS NOT NULL AND [ValidUntil]>[ObservedAt])");t.HasCheckConstraint("CK_Market_Price","[ReferencePriceRial] IS NULL OR [ReferencePriceRial]>0");});
        });
        b.Entity<CatalogMarketModelV1>(e=>{e.HasNoKey();e.ToView("MarketModelsV1","catalog");foreach(var name in new[]{"ModelId","CategoryId","BrandId"})e.Property(name).HasMaxLength(64);e.Property(x=>x.Slug).HasMaxLength(150);e.Property(x=>x.Brand).HasMaxLength(120);e.Property(x=>x.NameFa).HasMaxLength(250);e.Property(x=>x.NameEn).HasMaxLength(250);e.Property(x=>x.SearchFa).HasMaxLength(500);e.Property(x=>x.SearchEn).HasMaxLength(500);e.Property(x=>x.Version).HasColumnType("varbinary(8)");});
    }
    public override Task<int> SaveChangesAsync(CancellationToken cancellationToken=default)
    {
        if(ChangeTracker.Entries<MarketSourceObservation>().Any(x=>x.State is EntityState.Modified or EntityState.Deleted))throw new InvalidOperationException("Market observations are append-only.");
        return base.SaveChangesAsync(cancellationToken);
    }
    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess,CancellationToken cancellationToken=default)
    {
        if(ChangeTracker.Entries<MarketSourceObservation>().Any(x=>x.State is EntityState.Modified or EntityState.Deleted))throw new InvalidOperationException("Market observations are append-only.");
        return base.SaveChangesAsync(acceptAllChangesOnSuccess,cancellationToken);
    }
    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        if(ChangeTracker.Entries<MarketSourceObservation>().Any(x=>x.State is EntityState.Modified or EntityState.Deleted))throw new InvalidOperationException("Market observations are append-only.");
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }
}
