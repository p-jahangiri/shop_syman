using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;

namespace Shop.Modules.Inventory;

public sealed class StockItem
{
    public string VariantId { get; set; } = "";
    public bool IsSingleUnit { get; set; }
    public int OnHand { get; set; }
    public int Reserved { get; set; }
    public int SourcingReserved { get; set; }
    public byte[] Version { get; set; } = [];
    public string TrackingMode { get; set; } = "none";
}
public sealed class StockMovement
{
    public long Id { get; set; }
    public string VariantId { get; set; } = "";
    public int Delta { get; set; }
    public int Balance { get; set; }
    public string Reason { get; set; } = "";
    public string ActorId { get; set; } = "";
    public string RequestId { get; set; } = "";
    public DateTimeOffset At { get; set; } = DateTimeOffset.UtcNow;
}
public static class StockAvailability
{
    public static int Available(int onHand,int reserved,int sourcingReserved)
    {
        var available=checked((long)onHand-reserved-sourcingReserved);
        if(onHand<0||reserved<0||sourcingReserved<0||available<0||available>int.MaxValue)throw new InvalidOperationException("Stock balance invariant failed.");
        return (int)available;
    }
}
public sealed class InventoryDbContext(DbContextOptions<InventoryDbContext> options) : DbContext(options)
{
    public DbSet<StockItem> Stock => Set<StockItem>();
    public DbSet<StockMovement> Movements => Set<StockMovement>();
    public DbSet<StockReservation> Reservations => Set<StockReservation>();
    public DbSet<PartialInventoryDispatch> PartialDispatches=>Set<PartialInventoryDispatch>();
    public DbSet<PartialInventoryDispatchLine> PartialDispatchLines=>Set<PartialInventoryDispatchLine>();
    public DbSet<PartialInventoryDispatchUnit> PartialDispatchUnits=>Set<PartialInventoryDispatchUnit>();
    public DbSet<StockReservationItem> ReservationItems => Set<StockReservationItem>();
    public DbSet<StockReservationEvent> ReservationEvents => Set<StockReservationEvent>();
    public DbSet<SerialUnit> SerialUnits=>Set<SerialUnit>();
    public DbSet<SerialIdentifier> SerialIdentifiers=>Set<SerialIdentifier>();
    public DbSet<SerialUnitEvent> SerialEvents=>Set<SerialUnitEvent>();
    public DbSet<SerialCommand> SerialCommands=>Set<SerialCommand>();
    public DbSet<ReceivingUnitMapping> ReceivingUnitMappings=>Set<ReceivingUnitMapping>();
    public DbSet<SourcingStockReceipt> SourcingReceipts=>Set<SourcingStockReceipt>();
    public DbSet<SourcingStockReceiptLine> SourcingReceiptLines=>Set<SourcingStockReceiptLine>();
    public DbSet<SourcingStockReceiptUnit> SourcingReceiptUnits=>Set<SourcingStockReceiptUnit>();
    public DbSet<ReceivingCommand> ReceivingCommands=>Set<ReceivingCommand>();
    public DbSet<SourcingStockAllocation> SourcingAllocations=>Set<SourcingStockAllocation>();
    public DbSet<SourcingStockAllocationLine> SourcingAllocationLines=>Set<SourcingStockAllocationLine>();
    public DbSet<SourcingAllocationCommand> SourcingAllocationCommands=>Set<SourcingAllocationCommand>();
    public DbSet<SourcingAllocationEvent> SourcingAllocationEvents=>Set<SourcingAllocationEvent>();
    public DbSet<SerialUnitClaim> SerialUnitClaims=>Set<SerialUnitClaim>();
    public DbSet<ReservationLineEntitlement> ReservationLineEntitlements=>Set<ReservationLineEntitlement>();
    public DbSet<SourcingAllocationTransfer> SourcingAllocationTransfers=>Set<SourcingAllocationTransfer>();
    public DbSet<AccountingWarehouseLink> AccountingWarehouses=>Set<AccountingWarehouseLink>();
    public DbSet<AccountingWarehouseCommand> AccountingWarehouseCommands=>Set<AccountingWarehouseCommand>();
    public DbSet<AccountingStockApplication> AccountingStockApplications=>Set<AccountingStockApplication>();
    public DbSet<AccountingStockApplicationLine> AccountingStockApplicationLines=>Set<AccountingStockApplicationLine>();
    private void ProtectAccountingHistory()
    {
        if(ChangeTracker.Entries().Any(e=>(e.Entity is AccountingStockApplication or AccountingStockApplicationLine or AccountingWarehouseCommand or PartialInventoryDispatch or PartialInventoryDispatchLine or PartialInventoryDispatchUnit)&&(e.State is EntityState.Modified or EntityState.Deleted)))throw new InvalidOperationException("Stock applications, dispatch history and command receipts are immutable historical facts.");
    }
    public override int SaveChanges(){ProtectAccountingHistory();return base.SaveChanges();}
    public override int SaveChanges(bool acceptAllChangesOnSuccess){ProtectAccountingHistory();return base.SaveChanges(acceptAllChangesOnSuccess);}
    public override Task<int> SaveChangesAsync(CancellationToken ct=default){ProtectAccountingHistory();return base.SaveChangesAsync(ct);}
    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess,CancellationToken ct=default){ProtectAccountingHistory();return base.SaveChangesAsync(acceptAllChangesOnSuccess,ct);}
    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasDefaultSchema("inventory");
        b.Entity<StockItem>(e => { e.Property(x=>x.IsSingleUnit).HasDefaultValue(false);e.ToTable(t=>t.HasCheckConstraint("CK_Stock_SingleUnit","[IsSingleUnit]=0 OR [OnHand]<=1")); e.HasKey(x => x.VariantId); e.Property(x => x.VariantId).HasMaxLength(64); e.Property(x => x.Version).IsRowVersion(); e.Property(x=>x.SourcingReserved).HasDefaultValue(0); e.ToTable(t => t.HasCheckConstraint("CK_Stock_Balance", "[OnHand] >= 0 AND [Reserved] >= 0 AND [SourcingReserved] >= 0 AND [Reserved] <= [OnHand] AND CAST([Reserved] AS bigint) + CAST([SourcingReserved] AS bigint) <= [OnHand]")); });
        b.Entity<StockMovement>(e => { e.HasKey(x => x.Id); e.Property(x => x.VariantId).HasMaxLength(64); e.Property(x => x.Reason).HasMaxLength(500); e.Property(x => x.ActorId).HasMaxLength(64); e.Property(x => x.RequestId).HasMaxLength(64); e.HasIndex(x => x.RequestId).IsUnique(); e.HasIndex(x => new { x.VariantId, x.At }); });
        StockReservationModel.Configure(b);
        SerialInventoryModel.Configure(b);
        SourcingReceivingModel.Configure(b);
        SourcingAllocationModel.Configure(b);
        StockOrderReservationV2Model.Configure(b);
        PartialInventoryDispatchModel.Configure(b);
        AccountingInventoryModel.Configure(b);
        AccountingStockApplicationModel.Configure(b);
    }
}
public record StockAdjustment(int Delta, string Reason, string RequestId, string? Version);
public sealed class InventoryService(InventoryDbContext db) : IInventoryReader
{
    public async Task<IReadOnlyDictionary<string, int>> AvailableAsync(IEnumerable<string> variantIds, CancellationToken ct)
    {
        var ids = variantIds.Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        var rows=await db.Stock.AsNoTracking().Where(s=>ids.Contains(s.VariantId)).Select(s=>new{s.VariantId,s.OnHand,s.Reserved,s.SourcingReserved}).ToArrayAsync(ct);
        // Cart normalizes SKU identifiers; retain the same identity semantics
        // when the stored canonical spelling contains uppercase characters.
        return rows.ToDictionary(s=>s.VariantId,s=>StockAvailability.Available(s.OnHand,s.Reserved,s.SourcingReserved),StringComparer.OrdinalIgnoreCase);
    }
    public async Task<object> ReadAsync(CancellationToken ct, bool includeMovements = true) => new { Stock = await db.Stock.AsNoTracking().ToListAsync(ct), Movements = includeMovements ? await db.Movements.AsNoTracking().OrderByDescending(x => x.Id).Take(100).ToListAsync(ct) : [] };
    public async Task<object> AdjustAsync(string variantId, StockAdjustment input, string actorId, CancellationToken ct)
    {
        if (input.Delta == 0 || input.Delta is < -1000000 or > 1000000 || string.IsNullOrWhiteSpace(input.Reason) || input.Reason.Length > 500 || !Guid.TryParse(input.RequestId, out _)) throw new BusinessException("invalid_adjustment", "Provide a bounded nonzero delta, reason and UUID request id.");
        if(db.Database.CurrentTransaction is {} existing&&existing.GetDbTransaction().IsolationLevel!=IsolationLevel.Serializable)throw new InvalidOperationException("This operation requires a Serializable transaction.");
        await using var transaction = db.Database.CurrentTransaction is null?await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct):null;
        // Take the write-intent lock before the idempotency lookup to avoid S-to-X conversion races.
        // Reservations use this same row-lock order, so a physical correction cannot bypass held units.
        var item = await db.Stock.FromSqlInterpolated($"SELECT * FROM [inventory].[Stock] WITH (UPDLOCK, HOLDLOCK) WHERE [VariantId] = {variantId}").SingleOrDefaultAsync(ct);
        if (item is not null) await db.Entry(item).ReloadAsync(ct);
        var previous = await db.Movements.SingleOrDefaultAsync(x => x.RequestId == input.RequestId, ct);
        if (previous is not null) {
            if (previous.VariantId != variantId || previous.Delta != input.Delta || previous.Reason != input.Reason.Trim() || previous.ActorId != actorId) throw new BusinessException("idempotency_conflict", "This request id belongs to another adjustment.");
            if(transaction is not null)await transaction.CommitAsync(ct); return previous;
        }
        if (item is null) { if (input.Version is not null) throw new BusinessException("version_conflict", "Stock changed. Reload first."); item = new() { VariantId = variantId }; db.Stock.Add(item); }
        else if (input.Version != Convert.ToBase64String(item.Version)) throw new BusinessException("version_conflict", "Stock changed. Reload first.");
        if(item.TrackingMode!="none")throw new BusinessException("serial_tracking_required","Use serial receipt or retirement for tracked inventory.");
        _=StockAvailability.Available(item.OnHand,item.Reserved,item.SourcingReserved);
        var balance=checked((long)item.OnHand+input.Delta);
        if(balance<checked((long)item.Reserved+item.SourcingReserved))throw new BusinessException("insufficient_stock","Stock cannot fall below order and sourcing reservations.");
        if(balance>int.MaxValue)throw new BusinessException("invalid_adjustment","The adjusted inventory count exceeds the supported Stock balance.");
        item.OnHand=(int)balance;
        var movement = new StockMovement { VariantId = variantId, Delta = input.Delta, Balance = item.OnHand, Reason = input.Reason.Trim(), ActorId = actorId, RequestId = input.RequestId };
        db.Movements.Add(movement); await db.SaveChangesAsync(ct); if(transaction is not null)await transaction.CommitAsync(ct); return movement;
    }
    public async Task SeedAsync(IReadOnlyDictionary<string, int> values, CancellationToken ct)
    {
        if (await db.Stock.AnyAsync(ct)) return;
        foreach (var (id, quantity) in values) { db.Stock.Add(new() { VariantId = id, OnHand = quantity }); db.Movements.Add(new() { VariantId = id, Delta = quantity, Balance = quantity, Reason = "Development seed", ActorId = "seed", RequestId = Guid.NewGuid().ToString() }); }
        await db.SaveChangesAsync(ct);
    }
}
