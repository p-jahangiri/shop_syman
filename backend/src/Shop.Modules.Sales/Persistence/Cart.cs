using Microsoft.EntityFrameworkCore;

namespace Shop.Modules.Sales;

public sealed class ShoppingCart
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string? OwnerId { get; set; }
    public string? GuestTokenHash { get; set; }
    public DateTimeOffset? GuestExpiresAt { get; set; }
    public string? MergedIntoCartId { get; set; }
    public long Revision { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public byte[] Version { get; set; } = [];
    public List<ShoppingCartLine> Lines { get; set; } = [];
    public List<CartSourcingLine> SourcingLines { get; set; } = [];
    public List<CartOfferLine> OfferLines { get; set; } = [];
}
public sealed class ShoppingCartLine
{
    public string CartId { get; set; } = "";
    public string VariantId { get; set; } = "";
    public int Quantity { get; set; }
}
public sealed class CartSourcingLine
{
    public string CartId { get; set; } = "";
    public string ListingId { get; set; } = "";
    public int Quantity { get; set; }
    public string? ConfigurationId { get; set; }
}
public sealed partial class SalesDbContext(DbContextOptions<SalesDbContext> options) : DbContext(options)
{
    public DbSet<SourcingPriceAgreement> SourcingPriceAgreements => Set<SourcingPriceAgreement>();
    public DbSet<SourcingPriceAgreementLine> SourcingPriceAgreementLines => Set<SourcingPriceAgreementLine>();
    public DbSet<ShoppingCart> Carts => Set<ShoppingCart>();
    public DbSet<ShoppingCartLine> CartLines => Set<ShoppingCartLine>();
    public DbSet<CartSourcingLine> CartSourcingLines => Set<CartSourcingLine>();
    public DbSet<CartOfferLine> CartOfferLines => Set<CartOfferLine>();
    public DbSet<SourcingConversion> SourcingConversions => Set<SourcingConversion>();
    public DbSet<CartOfferCommandReceipt> CartOfferCommandReceipts => Set<CartOfferCommandReceipt>();
    public DbSet<CreditOrderLink> CreditOrderLinks=>Set<CreditOrderLink>();
    public DbSet<CreditCheckoutQuote> CreditCheckoutQuotes => Set<CreditCheckoutQuote>();
    public DbSet<CheckoutQuote> Quotes => Set<CheckoutQuote>();
    public DbSet<CheckoutQuoteLineV4> QuoteLinesV4 => Set<CheckoutQuoteLineV4>();
    public DbSet<CheckoutChargePolicy> ChargePolicies => Set<CheckoutChargePolicy>();
    public DbSet<CheckoutOrderSettings> OrderSettings => Set<CheckoutOrderSettings>();
    public DbSet<SalesOrder> Orders => Set<SalesOrder>();
    public DbSet<SalesOrderLineV2> OrderLinesV2 => Set<SalesOrderLineV2>();
    public DbSet<SalesOrderOutboxEvent> OrderOutbox => Set<SalesOrderOutboxEvent>();
    public DbSet<OrderCashPayment> OrderCashPayments => Set<OrderCashPayment>();
    public DbSet<OrderShipment> OrderShipments => Set<OrderShipment>();
    public DbSet<OrderShipmentLine> OrderShipmentLines => Set<OrderShipmentLine>();
    public DbSet<OrderShipmentUnit> OrderShipmentUnits => Set<OrderShipmentUnit>();
    public DbSet<OrderShipmentCommand> OrderShipmentCommands => Set<OrderShipmentCommand>();
    public DbSet<CustomerAddressBook> AddressBooks => Set<CustomerAddressBook>();
    public DbSet<CustomerAddress> Addresses => Set<CustomerAddress>();
    private void ProtectShipmentHistory()
    {
        RmaModel.Guard(this);
        OrderParcelModel.Guard(this);
        DigitalDeliveryModel.Guard(this);
        foreach (var entry in ChangeTracker.Entries()) {
            if ((entry.Entity is CreditOrderLink or CreditCheckoutQuote or OrderShipmentLine or OrderShipmentUnit or OrderShipmentCommand or OrderCashPayment) && (entry.State is EntityState.Modified or EntityState.Deleted))
                throw new InvalidOperationException("Packing snapshots and shipment command receipts are immutable.");
            if (entry.Entity is OrderShipment && (entry.State == EntityState.Deleted || entry.State == EntityState.Modified && new[] { "Id", "OrderId", "OwnerId", "ReservationId", "ContainsDemo" }.Any(n => entry.Property(n).IsModified)))
                throw new InvalidOperationException("A shipment's original packing identity must be retained.");
            if (entry.Entity is OrderShipment current && entry.State == EntityState.Modified && new[] { "PackingRevision", "PackedAt", "InventoryFingerprint" }.Any(n => entry.Property(n).IsModified)) {
                var priorRevision = (int)entry.Property("PackingRevision").OriginalValue!;
                if (entry.Property("State").OriginalValue?.ToString() != "packed" || current.State != "packed" || current.PackingRevision != priorRevision + 1)
                    throw new InvalidOperationException("A packing revision can only advance explicitly before warehouse hand-off.");
            }
        }
    }
    public override int SaveChanges() { GuardChequeReviewHold();ProtectShipmentHistory();CaptureSmsSignals(); return base.SaveChanges(); }
    public override int SaveChanges(bool acceptAllChangesOnSuccess) { GuardChequeReviewHold();ProtectShipmentHistory();CaptureSmsSignals(); return base.SaveChanges(acceptAllChangesOnSuccess); }
    public override Task<int> SaveChangesAsync(CancellationToken ct = default) { GuardChequeReviewHold();ProtectShipmentHistory();CaptureSmsSignals(); return base.SaveChangesAsync(ct); }
    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken ct = default) { GuardChequeReviewHold();ProtectShipmentHistory();CaptureSmsSignals(); return base.SaveChangesAsync(acceptAllChangesOnSuccess, ct); }
    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasDefaultSchema("sales");
        RmaModel.Configure(b);
        SourcingPriceAgreementModel.Configure(b);
        CartOfferModel.Configure(b);
        CheckoutQuoteModel.Configure(b);
        CreditCheckoutQuoteModel.Configure(b);
        CreditOrderModel.Configure(b);
        ChequeReviewHoldModel.Configure(b);
        WishlistModel.Configure(b);
        CheckoutChargePolicyModel.Configure(b);
        CheckoutOrderSettingsModel.Configure(b);
        SalesOrderModel.Configure(b);
        SalesSmsSignalModel.Configure(b);
        SalesOrderV2Model.Configure(b);
        OrderShipmentModel.Configure(b);
        OrderParcelModel.Configure(b);
        DigitalDeliveryModel.Configure(b);
        OrderCashPaymentModel.Configure(b);
        b.Entity<CustomerAddressBook>(e => { e.ToTable("AddressBooks", t => t.HasCheckConstraint("CK_AddressBook_Revision", "[Revision]>=0")); e.HasKey(x => x.OwnerId); e.Property(x => x.OwnerId).HasMaxLength(64); });
        b.Entity<CustomerAddress>(e => {
            e.ToTable("Addresses", t => t.HasCheckConstraint("CK_Address_ProtectedLength", "LEN([ProtectedData]) BETWEEN 1 AND 32768"));
            e.HasKey(x => x.Id); e.Property(x => x.Id).HasMaxLength(32); e.Property(x => x.OwnerId).HasMaxLength(64); e.Property(x => x.ProtectedData).IsUnicode(false).HasMaxLength(32768); e.Property(x => x.Version).IsRowVersion();
            e.HasOne<CustomerAddressBook>().WithMany().HasForeignKey(x => x.OwnerId).OnDelete(DeleteBehavior.Cascade); e.HasIndex(x => new { x.OwnerId, x.Id }).HasDatabaseName("IX_Addresses_Owner"); e.HasIndex(x => x.OwnerId).IsUnique().HasFilter("[IsDefault]=1").HasDatabaseName("UX_Addresses_DefaultOwner");
        });
        b.Entity<ShoppingCart>(e => {
            e.ToTable("Carts", t => {
                t.HasCheckConstraint("CK_Cart_Identity", "([OwnerId] IS NOT NULL AND [GuestTokenHash] IS NULL AND [GuestExpiresAt] IS NULL AND [MergedIntoCartId] IS NULL) OR ([OwnerId] IS NULL AND [GuestTokenHash] IS NOT NULL AND [GuestExpiresAt] IS NOT NULL)");
                t.HasCheckConstraint("CK_Cart_Revision", "[Revision] >= 0");
                t.HasCheckConstraint("CK_Cart_Merge", "[MergedIntoCartId] IS NULL OR [MergedIntoCartId] <> [Id]");
            });
            e.HasKey(x => x.Id); e.Property(x => x.Id).HasMaxLength(32); e.Property(x => x.OwnerId).HasMaxLength(64);
            e.Property(x => x.GuestTokenHash).HasMaxLength(64).IsUnicode(false); e.Property(x => x.MergedIntoCartId).HasMaxLength(32);
            e.Property(x => x.Version).IsRowVersion(); e.HasIndex(x => x.OwnerId).IsUnique().HasFilter("[OwnerId] IS NOT NULL");
            e.HasIndex(x => x.GuestTokenHash).IsUnique().HasFilter("[GuestTokenHash] IS NOT NULL"); e.HasIndex(x => x.GuestExpiresAt);
            e.HasOne<ShoppingCart>().WithMany().HasForeignKey(x => x.MergedIntoCartId).OnDelete(DeleteBehavior.Restrict);
            e.HasMany(x => x.Lines).WithOne().HasForeignKey(x => x.CartId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(x => x.SourcingLines).WithOne().HasForeignKey(x => x.CartId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(x => x.OfferLines).WithOne().HasForeignKey(x => x.CartId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<ShoppingCartLine>(e => {
            e.ToTable("CartLines", t => t.HasCheckConstraint("CK_CartLine_Quantity", "[Quantity] > 0 AND [Quantity] <= 1000000"));
            e.HasKey(x => new { x.CartId, x.VariantId }); e.Property(x => x.CartId).HasMaxLength(32); e.Property(x => x.VariantId).HasMaxLength(64);
            // IDs are a contract with Catalog; there is deliberately no cross-module FK.
        });
        b.Entity<CartSourcingLine>(e => {
            e.ToTable("CartSourcingLines", t => t.HasCheckConstraint("CK_CartSourcingLine_Quantity", "[Quantity] > 0 AND [Quantity] <= 1000000"));
            e.HasKey(x => new { x.CartId, x.ListingId }); e.Property(x => x.CartId).HasMaxLength(32); e.Property(x => x.ListingId).HasMaxLength(32);
            e.Property(x=>x.ConfigurationId).HasMaxLength(32);
            // The listing is a Market contract, deliberately without a cross-module FK.
        });
    }
}
public sealed record CartLineInput(string VariantId, int Quantity);
public sealed record CartInput(CartLineInput[] Lines, string? Version);
public sealed record CartLineData(string VariantId, int Quantity, string? ProductId, string? Slug, string? Name, string? Label, string? UnitPriceRial, int Available, string? LineTotalRial, string? Issue);
public sealed record CartSnapshot(int SchemaVersion, string Locale, string? Version, CartLineData[] Lines, string? SubtotalRial, bool HasIssues);
public sealed record CartIdentity(string? OwnerId, string? GuestToken);
