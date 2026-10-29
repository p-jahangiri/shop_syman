using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Payments;

public sealed class PurchaseMethod
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Kind { get; set; } = "online";
    public string NameFa { get; set; } = "";
    public string NameEn { get; set; } = "";
    public string DescriptionFa { get; set; } = "";
    public string DescriptionEn { get; set; } = "";
    public bool Enabled { get; set; }
    public bool RequiresApproval { get; set; }
    public long? MinAmountRial { get; set; }
    public long? MaxAmountRial { get; set; }
    public byte[] Version { get; set; } = [];
    public List<MethodCategory> Categories { get; set; } = [];
}
public sealed class MethodCategory { public string MethodId { get; set; } = ""; public string CategoryId { get; set; } = ""; }
public sealed class PaymentsDbContext(DbContextOptions<PaymentsDbContext> options) : DbContext(options)
{
    public DbSet<CashPaymentAttempt> CashAttempts => Set<CashPaymentAttempt>();
    public DbSet<CashPaymentEvent> CashEvents => Set<CashPaymentEvent>();
    public DbSet<CashPaymentVerification> CashVerifications => Set<CashPaymentVerification>();
    private void ProtectPaymentHistory()
    {
        foreach(var entry in ChangeTracker.Entries()){
            if(entry.Entity is CashPaymentEvent or CashPaymentVerification && entry.State is EntityState.Modified or EntityState.Deleted)
                throw new InvalidOperationException("Payment evidence, events and receipts are immutable.");
            if(entry.Entity is CashPaymentAttempt && (entry.State==EntityState.Deleted || entry.State==EntityState.Modified && new[]{"Id","OwnerId","RequestId","PayloadHash","OrderId","MethodId","ProviderKey","AccountKey","AmountRial","Currency","SnapshotFingerprint","OriginalOrderVersion","OrderExpiresAt","ContainsDemo","CreatedAt"}.Any(p=>entry.Property(p).IsModified)))
                throw new InvalidOperationException("The original payment attempt and its financial snapshot must be retained.");
            if(entry.Entity is CashPaymentAttempt && entry.State==EntityState.Modified && entry.Property("AuthorityHash").OriginalValue is not null && new[]{"AuthorityHash","ProtectedAuthority","RedirectUri"}.Any(p=>entry.Property(p).IsModified))
                throw new InvalidOperationException("A payment attempt's established gateway authority cannot be replaced.");
        }
    }
    public override int SaveChanges(){ProtectPaymentHistory();return base.SaveChanges();}
    public override int SaveChanges(bool acceptAllChangesOnSuccess){ProtectPaymentHistory();return base.SaveChanges(acceptAllChangesOnSuccess);}
    public override Task<int> SaveChangesAsync(CancellationToken ct=default){ProtectPaymentHistory();return base.SaveChangesAsync(ct);}
    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess,CancellationToken ct=default){ProtectPaymentHistory();return base.SaveChangesAsync(acceptAllChangesOnSuccess,ct);}
    public DbSet<PurchaseMethod> Methods => Set<PurchaseMethod>();
    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasDefaultSchema("payments");
        CashPaymentModel.Configure(b);
        b.Entity<PurchaseMethod>(e => { e.HasKey(x => x.Id); e.Property(x => x.Id).HasMaxLength(64); e.Property(x => x.Version).IsRowVersion(); e.Property(x => x.Kind).HasMaxLength(20); e.Property(x => x.NameFa).HasMaxLength(200); e.Property(x => x.NameEn).HasMaxLength(200); e.Property(x => x.DescriptionFa).HasMaxLength(2000); e.Property(x => x.DescriptionEn).HasMaxLength(2000); e.HasMany(x => x.Categories).WithOne().HasForeignKey(x => x.MethodId).OnDelete(DeleteBehavior.Cascade); e.ToTable(t => { t.HasCheckConstraint("CK_Method_Kind", "[Kind] IN ('online','cheque','installment')"); t.HasCheckConstraint("CK_Method_Amount", "([MinAmountRial] IS NULL OR [MinAmountRial] >= 0) AND ([MaxAmountRial] IS NULL OR [MaxAmountRial] >= COALESCE([MinAmountRial],0))"); }); });
        b.Entity<MethodCategory>(e => { e.HasKey(x => new { x.MethodId, x.CategoryId }); e.Property(x => x.CategoryId).HasMaxLength(64); });
    }
}
public record PurchaseMethodInput(string Kind, string NameFa, string NameEn, string DescriptionFa, string DescriptionEn, bool Enabled, bool RequiresApproval, string? MinAmountRial, string? MaxAmountRial, string[] CategoryIds, string? Version);
public sealed class PurchaseMethodService(PaymentsDbContext db)
{
    public async Task<IReadOnlyList<PurchaseMethodData>> PublicAsync(string locale, CancellationToken ct) => (await db.Methods.AsNoTracking().Include(x => x.Categories).ToListAsync(ct)).Select(m => new PurchaseMethodData(m.Id, m.Kind, locale == "en" ? m.NameEn : m.NameFa, locale == "en" ? m.DescriptionEn : m.DescriptionFa, m.Enabled, m.RequiresApproval, m.Categories.Select(c => c.CategoryId).ToArray(), m.MinAmountRial, m.MaxAmountRial)).ToArray();
    public async Task<List<PurchaseMethod>> AdminAsync(CancellationToken ct) => await db.Methods.AsNoTracking().Include(x => x.Categories).ToListAsync(ct);
    public async Task<string> SaveAsync(string? id, PurchaseMethodInput input, CancellationToken ct)
    {
        if (input.Kind is not ("online" or "cheque" or "installment") || string.IsNullOrWhiteSpace(input.NameFa) || string.IsNullOrWhiteSpace(input.NameEn) || input.NameFa.Length > 200 || input.NameEn.Length > 200 || input.DescriptionFa.Length > 2000 || input.DescriptionEn.Length > 2000 || input.CategoryIds.Distinct().Count() != input.CategoryIds.Length) throw new BusinessException("invalid_method", "Provide valid bilingual names, kind and category rules.");
        var min = PurchaseLimits.Parse(input.MinAmountRial); var max = PurchaseLimits.Parse(input.MaxAmountRial); PurchaseLimits.Validate(min, max);
        var entity = id is null ? new PurchaseMethod() : await db.Methods.Include(x => x.Categories).SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw new BusinessException("not_found", "Purchase method was not found.");
        if (id is not null && input.Version != Convert.ToBase64String(entity.Version)) throw new BusinessException("version_conflict", "Purchase method changed. Reload first.");
        entity.Kind = input.Kind; entity.NameFa = input.NameFa.Trim(); entity.NameEn = input.NameEn.Trim(); entity.DescriptionFa = input.DescriptionFa; entity.DescriptionEn = input.DescriptionEn; entity.Enabled = input.Enabled; entity.RequiresApproval = input.RequiresApproval || input.Kind == "cheque"; entity.MinAmountRial = min; entity.MaxAmountRial = max;
        foreach (var old in entity.Categories.Where(x => !input.CategoryIds.Contains(x.CategoryId)).ToList()) { db.Remove(old); entity.Categories.Remove(old); }
        foreach (var key in input.CategoryIds) if (!entity.Categories.Any(x => x.CategoryId == key)) entity.Categories.Add(new() { CategoryId = key });
        // A category-only edit must also rotate the parent rowversion.
        if (id is not null) db.Entry(entity).Property(x => x.NameFa).IsModified = true;
        if (id is null) db.Methods.Add(entity); await db.SaveChangesAsync(ct); return entity.Id;
    }
    public async Task SeedAsync(IEnumerable<PurchaseMethod> methods, CancellationToken ct) { if (await db.Methods.AnyAsync(ct)) return; db.Methods.AddRange(methods); await db.SaveChangesAsync(ct); }
}
