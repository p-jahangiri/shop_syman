using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;

namespace Shop.Modules.Sales;
public sealed class CheckoutOrderSettings
{
    public int Id { get; set; } = 1;
    public bool TemporaryOrdersEnabled { get; set; }
    public bool ChequeOrdersEnabled { get; set; }
    public int ReservationMinutes { get; set; } = 15;
    public int MaxOpenOrdersPerCustomer { get; set; } = 1;
    public byte[] Version { get; set; } = [];
}
public sealed record CheckoutOrderSettingsInput(bool TemporaryOrdersEnabled, int ReservationMinutes, int MaxOpenOrdersPerCustomer, string? Version, bool? ChequeOrdersEnabled=null);
public sealed record TemporaryOrderOption(bool CanCreate, int ReservationMinutes, bool RequiresSignIn, string[] Blockers, string? SettingsVersion = null);
public sealed class CheckoutOrderSettingsService(SalesDbContext db)
{
    public async Task<CheckoutOrderSettings> ReadAsync(CancellationToken ct) => await db.OrderSettings.AsNoTracking().SingleOrDefaultAsync(ct) ?? new();
    public static void Validate(CheckoutOrderSettingsInput input)
    {
        if (input.ReservationMinutes is < 1 or > 60 || input.MaxOpenOrdersPerCustomer is < 1 or > 10) throw new BusinessException("invalid_order_settings", "Choose a 1–60 minute reservation and 1–10 open orders per customer.");
    }
    public async Task<CheckoutOrderSettings> SaveAsync(CheckoutOrderSettingsInput input, CancellationToken ct)
    {
        Validate(input);
        if (db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel != IsolationLevel.Serializable) throw new InvalidOperationException("Order settings require the atomic administrative transaction.");
        var row = await db.OrderSettings.SingleOrDefaultAsync(ct);
        if (row is null) { if (input.Version is not null) throw Conflict(); row = new(); db.OrderSettings.Add(row); }
        else if (input.Version != Convert.ToBase64String(row.Version)) throw Conflict();
        row.TemporaryOrdersEnabled = input.TemporaryOrdersEnabled; if(input.ChequeOrdersEnabled is{}cheque)row.ChequeOrdersEnabled=cheque; row.ReservationMinutes = input.ReservationMinutes; row.MaxOpenOrdersPerCustomer = input.MaxOpenOrdersPerCustomer;
        await db.SaveChangesAsync(ct); return row;
    }
    public static TemporaryOrderOption Option(CheckoutOrderSettings settings, PurchaseMethodData? method, string? payable)
    {
        var blockers = new List<string>();
        if (!settings.TemporaryOrdersEnabled) blockers.Add("temporary_orders_disabled");
        if (method is null) blockers.Add("method_required");
        else if (!method.Enabled || method.Kind != "online" || method.RequiresApproval) blockers.Add("order_workflow_unavailable");
        if (payable is null) blockers.Add("charges_unconfigured");
        else if (payable == "0") blockers.Add("zero_amount_review_required");
        return new(blockers.Count == 0, settings.ReservationMinutes, true, blockers.ToArray(), settings.Version.Length == 0 ? null : Convert.ToBase64String(settings.Version));
    }
    private static BusinessException Conflict() => new("version_conflict", "Order settings changed. Reload before editing.");
}
internal static class CheckoutOrderSettingsModel
{
    public static void Configure(ModelBuilder b) => b.Entity<CheckoutOrderSettings>(e => {
        e.ToTable("CheckoutOrderSettings", t => { t.HasCheckConstraint("CK_OrderSettings_Singleton", "[Id]=1"); t.HasCheckConstraint("CK_OrderSettings_Limits", "[ReservationMinutes] BETWEEN 1 AND 60 AND [MaxOpenOrdersPerCustomer] BETWEEN 1 AND 10"); });
        e.HasKey(x => x.Id); e.Property(x => x.Id).ValueGeneratedNever(); e.Property(x=>x.ChequeOrdersEnabled).HasDefaultValue(false); e.Property(x => x.Version).IsRowVersion();
    });
}
