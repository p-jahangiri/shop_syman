using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Credit;
public sealed class ChequePlan
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string NameFa { get; set; } = "";
    public string NameEn { get; set; } = "";
    public int Months { get; set; }
    public int MarkupBasisPoints { get; set; }
    public int DownPaymentBasisPoints { get; set; }
    public int IntervalMonths { get; set; } = 1;
    public int RoundingUnitRial { get; set; } = 10;
    public bool Enabled { get; set; }
    public long? MinAmountRial { get; set; }
    public long? MaxAmountRial { get; set; }
    public byte[] Version { get; set; } = [];
    public List<PlanCategory> Categories { get; set; } = [];
}
public sealed class PlanCategory { public string PlanId { get; set; } = ""; public string CategoryId { get; set; } = ""; }
public sealed partial class CreditDbContext(DbContextOptions<CreditDbContext> options) : DbContext(options)
{
    public DbSet<ChequePlan> Plans => Set<ChequePlan>();
    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasDefaultSchema("credit");
        b.Entity<ChequePlan>().Property(p => p.RoundingUnitRial).HasDefaultValue(10);
        b.Entity<ChequePlan>().ToTable(t => t.HasCheckConstraint("CK_Plan_Rounding", "[RoundingUnitRial] IN (1,10)"));
        b.Entity<ChequePlan>(e => { e.HasKey(x => x.Id); e.Property(x => x.Id).HasMaxLength(64); e.Property(x => x.NameFa).HasMaxLength(200); e.Property(x => x.NameEn).HasMaxLength(200); e.Property(x => x.Version).IsRowVersion(); e.HasMany(x => x.Categories).WithOne().HasForeignKey(x => x.PlanId).OnDelete(DeleteBehavior.Cascade); e.ToTable(t => { t.HasCheckConstraint("CK_Plan_Terms", "[Months] BETWEEN 1 AND 60 AND [IntervalMonths] BETWEEN 1 AND [Months] AND [Months] % [IntervalMonths] = 0 AND [MarkupBasisPoints] BETWEEN 0 AND 100000 AND [DownPaymentBasisPoints] BETWEEN 0 AND 10000"); t.HasCheckConstraint("CK_Plan_Amount", "([MinAmountRial] IS NULL OR [MinAmountRial] >= 0) AND ([MaxAmountRial] IS NULL OR [MaxAmountRial] >= COALESCE([MinAmountRial],0))"); }); });
        b.Entity<PlanCategory>(e => { e.HasKey(x => new { x.PlanId, x.CategoryId }); e.Property(x => x.CategoryId).HasMaxLength(64); });
        CreditApplicationModel.Configure(b);
        CreditRequirementsModel.Configure(b);
        CreditDocumentModel.Configure(b);
        CreditSubmissionModel.Configure(b);
        CreditReviewModel.Configure(b);
        CreditPurchaseScopeModel.Configure(b);
        CreditPurchaseUseModel.Configure(b);
        CreditScheduleModel.Configure(b);
        ChequeLedgerModel.Configure(b);
        CreditUpfrontModel.Configure(b);
        ChequeApprovalModel.Configure(b);
        CreditClearanceModel.Configure(b);
        CreditReminderModel.Configure(b);
        CreditReminderPolicyModel.Configure(b);
    }
}
public record ChequePlanInput(string NameFa, string NameEn, int Months, int MarkupBasisPoints, int DownPaymentBasisPoints, int IntervalMonths, bool Enabled, string? MinAmountRial, string? MaxAmountRial, string[] CategoryIds, string? Version, int RoundingUnitRial = 10);
public sealed class CreditPlanService(CreditDbContext db)
{
    public static void Validate(ChequePlanInput input)
    {
        if (input.RoundingUnitRial is not (1 or 10)) throw new BusinessException("invalid_cheque_rounding", "Choose integer rial or whole toman rounding.");
        if (string.IsNullOrWhiteSpace(input.NameFa) || string.IsNullOrWhiteSpace(input.NameEn) || input.NameFa.Length > 200 || input.NameEn.Length > 200 || input.Months is < 1 or > 60 || input.IntervalMonths < 1 || input.IntervalMonths > input.Months || input.Months % input.IntervalMonths != 0 || input.MarkupBasisPoints is < 0 or > 100000 || input.DownPaymentBasisPoints is < 0 or > 10000 || input.CategoryIds.Distinct().Count() != input.CategoryIds.Length) throw new BusinessException("invalid_cheque_plan", "Bilingual names, valid months, rates and intervals are required.");
        PurchaseLimits.Validate(PurchaseLimits.Parse(input.MinAmountRial), PurchaseLimits.Parse(input.MaxAmountRial));
    }
    public async Task<IReadOnlyList<CreditPlanData>> PublicAsync(string locale, CancellationToken ct) => (await db.Plans.AsNoTracking().Include(x => x.Categories).ToListAsync(ct)).Select(p => new CreditPlanData(p.Id, locale == "en" ? p.NameEn : p.NameFa, p.Months, p.MarkupBasisPoints, p.DownPaymentBasisPoints, p.IntervalMonths, p.Enabled, p.Categories.Select(c => c.CategoryId).ToArray(), p.MinAmountRial, p.MaxAmountRial, p.RoundingUnitRial)).ToArray();
    public async Task<List<ChequePlan>> AdminAsync(CancellationToken ct) => await db.Plans.AsNoTracking().Include(x => x.Categories).ToListAsync(ct);
    public async Task<string> SaveAsync(string? id, ChequePlanInput input, CancellationToken ct)
    {
        Validate(input);
        var entity = id is null ? new ChequePlan() : await db.Plans.Include(x => x.Categories).SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw new BusinessException("not_found", "Cheque plan was not found.");
        if (id is not null && input.Version != Convert.ToBase64String(entity.Version)) throw new BusinessException("version_conflict", "Cheque plan changed. Reload first.");
        entity.NameFa = input.NameFa.Trim(); entity.NameEn = input.NameEn.Trim(); entity.Months = input.Months; entity.MarkupBasisPoints = input.MarkupBasisPoints; entity.DownPaymentBasisPoints = input.DownPaymentBasisPoints; entity.IntervalMonths = input.IntervalMonths; entity.Enabled = input.Enabled; entity.MinAmountRial = PurchaseLimits.Parse(input.MinAmountRial); entity.MaxAmountRial = PurchaseLimits.Parse(input.MaxAmountRial);
        entity.RoundingUnitRial = input.RoundingUnitRial;
        foreach (var old in entity.Categories.Where(x => !input.CategoryIds.Contains(x.CategoryId)).ToList()) { db.Remove(old); entity.Categories.Remove(old); }
        foreach (var key in input.CategoryIds) if (!entity.Categories.Any(x => x.CategoryId == key)) entity.Categories.Add(new() { CategoryId = key });
        // A category-only edit must also rotate the parent rowversion.
        if (id is not null) db.Entry(entity).Property(x => x.NameFa).IsModified = true;
        if (id is null) db.Plans.Add(entity); await db.SaveChangesAsync(ct); return entity.Id;
    }
    public async Task SeedAsync(IEnumerable<ChequePlan> plans, CancellationToken ct) { if (await db.Plans.AnyAsync(ct)) return; db.Plans.AddRange(plans); await db.SaveChangesAsync(ct); }
}
