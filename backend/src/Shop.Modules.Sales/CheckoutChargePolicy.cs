using System.Data;
using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;

namespace Shop.Modules.Sales;
public sealed class CheckoutChargePolicy
{
    public int Id { get; set; } = 1;
    public string ShippingMode { get; set; } = "unconfigured";
    public string ShippingNameFa { get; set; } = "";
    public string ShippingNameEn { get; set; } = "";
    public string ShippingDescriptionFa { get; set; } = "";
    public string ShippingDescriptionEn { get; set; } = "";
    public long? ShippingFeeRial { get; set; }
    public long? ShippingFreeFromRial { get; set; }
    public string TaxMode { get; set; } = "unconfigured";
    public int? TaxRateBasisPoints { get; set; }
    public string TaxBase { get; set; } = "goods";
    public string TaxRounding { get; set; } = "half_up";
    public byte[] Version { get; set; } = [];
}
public sealed record CheckoutChargePolicyInput(string ShippingMode, string ShippingNameFa, string ShippingNameEn, string ShippingDescriptionFa, string ShippingDescriptionEn, string? ShippingFeeRial, string? ShippingFreeFromRial, string TaxMode, int? TaxRateBasisPoints, string TaxBase, string TaxRounding, string? Version);
public sealed class CheckoutChargePolicyService(SalesDbContext db)
{
    public async Task<CheckoutChargePolicy> ReadAsync(CancellationToken ct) => await db.ChargePolicies.AsNoTracking().SingleOrDefaultAsync(ct) ?? new();
    public static (long? Fee, long? FreeFrom) Validate(CheckoutChargePolicyInput input)
    {
        var fee = PurchaseLimits.Parse(input.ShippingFeeRial); var freeFrom = PurchaseLimits.Parse(input.ShippingFreeFromRial);
        if (input.ShippingMode is not ("unconfigured" or "free" or "flat") || input.TaxMode is not ("unconfigured" or "exempt" or "exclusive" or "inclusive") || input.TaxBase is not ("items" or "goods" or "goods_shipping") || input.TaxRounding is not ("down" or "up" or "half_up")) throw Invalid();
        if (input.ShippingMode == "flat" ? fee is null or <= 0 || freeFrom is <= 0 : fee is not null || freeFrom is not null) throw Invalid();
        if (input.ShippingNameFa.Length > 200 || input.ShippingNameEn.Length > 200 || input.ShippingDescriptionFa.Length > 2000 || input.ShippingDescriptionEn.Length > 2000 || input.ShippingMode != "unconfigured" && (string.IsNullOrWhiteSpace(input.ShippingNameFa) || string.IsNullOrWhiteSpace(input.ShippingNameEn))) throw Invalid();
        if (input.TaxMode is "exclusive" or "inclusive" ? input.TaxRateBasisPoints is null or < 1 or > 10000 : input.TaxRateBasisPoints is not null) throw Invalid();
        return (fee, freeFrom);
    }
    public async Task<CheckoutChargePolicy> SaveAsync(CheckoutChargePolicyInput input, CancellationToken ct)
    {
        var amounts = Validate(input);
        if (db.Database.CurrentTransaction is not { } transaction || transaction.GetDbTransaction().IsolationLevel != IsolationLevel.Serializable) throw new InvalidOperationException("Charge policies require the atomic administrative transaction.");
        var row = await db.ChargePolicies.SingleOrDefaultAsync(ct);
        if (row is null) { if (input.Version is not null) throw Conflict(); row = new(); db.ChargePolicies.Add(row); }
        else if (input.Version != Convert.ToBase64String(row.Version)) throw Conflict();
        row.ShippingMode = input.ShippingMode; row.ShippingNameFa = input.ShippingNameFa.Trim(); row.ShippingNameEn = input.ShippingNameEn.Trim(); row.ShippingDescriptionFa = input.ShippingDescriptionFa; row.ShippingDescriptionEn = input.ShippingDescriptionEn; row.ShippingFeeRial = amounts.Fee; row.ShippingFreeFromRial = amounts.FreeFrom;
        row.TaxMode = input.TaxMode; row.TaxRateBasisPoints = input.TaxRateBasisPoints; row.TaxBase = input.TaxBase; row.TaxRounding = input.TaxRounding;
        await db.SaveChangesAsync(ct); return row;
    }
    private static BusinessException Invalid() => new("invalid_charge_policy", "Choose explicit shipping/tax modes, bounded bilingual content, positive flat amounts and a valid tax rate/base/rounding.");
    private static BusinessException Conflict() => new("version_conflict", "Checkout charges changed. Reload before editing.");
}
internal static class CheckoutChargePolicyModel
{
    public static void Configure(ModelBuilder b) => b.Entity<CheckoutChargePolicy>(e => {
        e.ToTable("CheckoutChargePolicies", t => {
            t.HasCheckConstraint("CK_ChargePolicy_Singleton", "[Id]=1");
            t.HasCheckConstraint("CK_ChargePolicy_Shipping", "([ShippingMode] IN ('unconfigured','free') AND [ShippingFeeRial] IS NULL AND [ShippingFreeFromRial] IS NULL) OR ([ShippingMode]='flat' AND [ShippingFeeRial] IS NOT NULL AND [ShippingFeeRial]>0 AND ([ShippingFreeFromRial] IS NULL OR [ShippingFreeFromRial]>0))");
            t.HasCheckConstraint("CK_ChargePolicy_Tax", "([TaxMode] IN ('unconfigured','exempt') AND [TaxRateBasisPoints] IS NULL) OR ([TaxMode] IN ('exclusive','inclusive') AND [TaxRateBasisPoints] IS NOT NULL AND [TaxRateBasisPoints] BETWEEN 1 AND 10000)");
            t.HasCheckConstraint("CK_ChargePolicy_TaxRule", "[TaxBase] IN ('items','goods','goods_shipping') AND [TaxRounding] IN ('down','up','half_up')");
        });
        e.HasKey(x => x.Id); e.Property(x => x.Id).ValueGeneratedNever(); e.Property(x => x.Version).IsRowVersion();
        foreach (var name in new[] { "ShippingMode", "TaxMode", "TaxBase", "TaxRounding" }) e.Property<string>(name).HasMaxLength(16).IsUnicode(false);
        e.Property(x => x.ShippingNameFa).HasMaxLength(200); e.Property(x => x.ShippingNameEn).HasMaxLength(200); e.Property(x => x.ShippingDescriptionFa).HasMaxLength(2000); e.Property(x => x.ShippingDescriptionEn).HasMaxLength(2000);
    });
}
public sealed record QuoteChargeRules(string? Version, string ShippingMode, string ShippingName, string ShippingDescription, string? ShippingFeeRial, string? ShippingFreeFromRial, string ShippingReason, string TaxMode, int? TaxRateBasisPoints, string TaxBase, string TaxRounding, string? TaxableBaseRial, bool TaxIncluded);
public sealed record CheckoutCharges(long? ShippingRial, long? TaxRial, long? PayableTotalRial, QuoteChargeRules Rules);
