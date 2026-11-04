using System.Text.Json;
using Shop.SharedKernel;

namespace Shop.Modules.Inventory;

public static class SourcingAllocationRules
{
    public const int MaximumLines=64;
    public const int MaximumUnits=100;
    public static string Fingerprint(string? value)=>value is {Length:64}&&value.All(c=>c is >= 'A' and <= 'F' or >= '0' and <= '9')?value:throw Invalid();
    public static string Id(string? value)=>SourcingReceivingRules.Id(value);
    public static string Actor(string? value)=>SourcingReceivingRules.Actor(value);
    public static string Version(string? value)=>SourcingReceivingRules.Version(value);
    public static string Reason(string? value)=>SerialRules.Reason(value);
    public static string Hash<T>(T value)=>SourcingReceivingRules.Hash(value);
    public static SourcingAllocationInput Normalize(SourcingAllocationInput input)
    {
        if(input is null||input.ExpiresAt.Offset!=TimeSpan.Zero||input.Lines is null||input.Lines.Length is <1 or >MaximumLines||input.Lines.Any(l=>l is null))throw Invalid();
        var lines=input.Lines.Select(l=>{if(l.TrackingMode is not ("none" or "serial" or "imei")||l.Units is null||l.Units.Length>MaximumUnits||l.Units.Any(u=>u is null)||l.TrackingMode=="none"&&l.Units.Length!=0||l.TrackingMode!="none"&&l.Units.Length==0)throw Invalid();return new SourcingAllocationLineInput(Id(l.OfferLineId),SourcingReceivingRules.OptionalVersion(l.StockVersion),l.TrackingMode,l.Units.Select(u=>new SourcingAllocationUnitInput(Id(u.UnitId),Version(u.Version))).OrderBy(u=>u.UnitId,StringComparer.Ordinal).ToArray());}).OrderBy(l=>l.OfferLineId,StringComparer.Ordinal).ToArray();
        var units=lines.SelectMany(l=>l.Units).ToArray();if(lines.Select(l=>l.OfferLineId).Distinct(StringComparer.Ordinal).Count()!=lines.Length||units.Length>MaximumUnits||units.Select(u=>u.UnitId).Distinct(StringComparer.Ordinal).Count()!=units.Length)throw Invalid();
        return input with{RequestId=Id(input.RequestId),RequestVersion=Version(input.RequestVersion),TaskVersion=Version(input.TaskVersion),OfferVersion=Version(input.OfferVersion),AcceptanceId=Id(input.AcceptanceId),TermsHash=Fingerprint(input.TermsHash),Reason=Reason(input.Reason),Lines=lines};
    }
    public static SourcingStockAllocationPlan NormalizePlan(SourcingStockAllocationPlan plan)
    {
        if(plan is null||plan.PurchaseUntil.Offset!=TimeSpan.Zero||plan.Lines is null||plan.Lines.Length is <1 or >MaximumLines||plan.Lines.Any(l=>l is null))throw Invalid();
        var lines=plan.Lines.Select(l=>new SourcingStockAllocationPlanLine(Id(l.OfferLineId),SourcingReceivingRules.Identifier(l.VariantId).ToUpperInvariant(),SourcingReceivingRules.Identifier(l.ProductId),l.Quantity,Fingerprint(l.MaterialFingerprint))).OrderBy(l=>l.OfferLineId,StringComparer.Ordinal).ToArray();
        if(lines.Any(l=>l.Quantity is <1 or >1000000)||lines.Select(l=>l.OfferLineId).Distinct(StringComparer.Ordinal).Count()!=lines.Length||lines.GroupBy(l=>l.VariantId,StringComparer.OrdinalIgnoreCase).Any(g=>g.Sum(l=>(long)l.Quantity)>1000000))throw Invalid();
        return plan with{RequestId=Id(plan.RequestId),TaskId=Id(plan.TaskId),OfferId=Id(plan.OfferId),AcceptanceId=Id(plan.AcceptanceId),OwnerId=Actor(plan.OwnerId),TermsHash=Fingerprint(plan.TermsHash),Lines=lines};
    }
    public static SourcingAllocationReleaseInput Normalize(SourcingAllocationReleaseInput input)
    {
        if(input is null)throw Invalid();return input with{RequestId=Id(input.RequestId),AcceptanceId=Id(input.AcceptanceId),Version=Version(input.Version),Reason=Reason(input.Reason)};
    }
    public static void ValidateCoverage(SourcingStockAllocationPlan plan,SourcingAllocationInput input)
    {
        if(plan.AcceptanceId!=input.AcceptanceId||plan.TermsHash!=input.TermsHash||plan.Lines.Length!=input.Lines.Length)throw new BusinessException("sourcing_allocation_plan_conflict","Allocate the exact complete accepted plan and terms.");var picks=input.Lines.ToDictionary(l=>l.OfferLineId,StringComparer.Ordinal);
        foreach(var line in plan.Lines)if(!picks.TryGetValue(line.OfferLineId,out var pick)||pick.TrackingMode!="none"&&pick.Units.Length!=line.Quantity)throw new BusinessException("sourcing_allocation_plan_conflict","Select exactly every accepted physical unit, without changing the quantity.");
        foreach(var group in plan.Lines.GroupBy(l=>l.VariantId,StringComparer.OrdinalIgnoreCase)){var inputs=group.Select(l=>picks[l.OfferLineId]).ToArray();if(inputs.Select(l=>l.StockVersion).Distinct(StringComparer.Ordinal).Count()!=1||inputs.Select(l=>l.TrackingMode).Distinct(StringComparer.Ordinal).Count()!=1)throw new BusinessException("sourcing_allocation_stock_conflict","All lines of a SKU must use the same current Stock version and mode.");}
    }
    public static void ValidateDeadline(DateTimeOffset expiresAt,DateTimeOffset purchaseUntil,DateTimeOffset now)
    {
        if(expiresAt.Offset!=TimeSpan.Zero||purchaseUntil.Offset!=TimeSpan.Zero||expiresAt<=now||expiresAt>purchaseUntil)throw new BusinessException("sourcing_allocation_deadline_conflict","Use an explicit future absolute allocation deadline within the accepted purchase deadline.");
    }
    public static string EffectiveState(string state,DateTimeOffset expiresAt,DateTimeOffset now)=>state=="Active"&&expiresAt<=now?"Expired":state;
    public static BusinessException Invalid()=>new("invalid_sourcing_allocation","Use complete accepted lines, explicit UTC deadline, current versions and bounded unique physical unit picks.");
}
