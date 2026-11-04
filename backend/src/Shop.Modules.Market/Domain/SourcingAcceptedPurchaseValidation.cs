using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Market;

// Allocation and cart conversion use the same accepted-snapshot and current
// purchasing proof. Public price changes never rewrite this accepted price.
internal static class SourcingAcceptedPurchaseValidation
{
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web);
    internal static IQueryable<SourcingOffer> Graph(IQueryable<SourcingOffer> query)=>query.Include(o=>o.Lines.OrderBy(l=>l.LineId).Take(65)).ThenInclude(l=>l.Images.OrderBy(i=>i.SortOrder).Take(25)).Include(o=>o.Lines.OrderBy(l=>l.LineId).Take(65)).ThenInclude(l=>l.Attributes.OrderBy(a=>a.Scope).ThenBy(a=>a.AttributeId).Take(129)).ThenInclude(a=>a.Options.OrderBy(v=>v.OptionId).Take(65)).Include(o=>o.Lines.OrderBy(l=>l.LineId).Take(65)).ThenInclude(l=>l.PurchaseRules.OrderBy(r=>r.Kind).ThenBy(r=>r.RuleId).Take(193)).AsSplitQuery();
    internal static AcceptedSourcingPlanLine[] Snapshot(SourcingOffer offer)
    {
        if(offer.Lines.Count is <1 or >64||offer.Lines.Any(l=>l.Images.Count>24||l.Attributes.Count>128||l.Attributes.GroupBy(a=>a.Scope).Any(g=>g.Count()>64)||l.Attributes.Any(a=>a.Options.Count>64)||l.PurchaseRules.Count>192)||offer.Lines.Select(l=>l.LineId).Distinct(StringComparer.Ordinal).Count()!=offer.Lines.Count)throw Capacity();
        if(SourcingOfferRules.Total(offer.Lines.Select(l=>(l.Quantity,l.UnitPriceRial)))!=offer.TotalRial||SourcingOfferSnapshots.TermsHash(offer)!=offer.TermsHash)throw Capacity();
        var lines=offer.Lines.OrderBy(l=>l.LineId,StringComparer.Ordinal).Select(l=>{if(l.Quantity is <1 or >1000000)throw Capacity();var data=SourcingOfferSnapshots.Read(l);SourcingOfferSnapshots.Validate(data.Sku);return new AcceptedSourcingPlanLine(data.LineId,data.ListingId,data.Quantity,data.UnitPriceRial,data.Sku);}).ToArray();
        if(JsonSerializer.SerializeToUtf8Bytes(new{offer.TermsFa,offer.TermsEn,Lines=lines},Json).Length>524288-16384)throw Capacity();return lines;
    }
    internal static async Task CheckPurchasingAsync(IPurchaseConfiguration purchasing,long total,OfferSkuSnapshot[] variants,CancellationToken ct)
    {
        var methods=await purchasing.MethodsAsync("fa",ct);var plans=await purchasing.PlansAsync("fa",ct);
        if(methods.Count>64||plans.Count>64||methods.Any(m=>m.CategoryIds.Length>500)||plans.Any(p=>p.CategoryIds.Length>500))throw Capacity();
        var eligiblePlans=plans.Where(p=>p.Enabled&&InRange(total,p.MinAmountRial,p.MaxAmountRial)&&variants.All(v=>(p.CategoryIds.Length==0||p.CategoryIds.Contains(v.Model.CategoryId))&&(v.ChequePlanIds.Length==0||v.ChequePlanIds.Contains(p.Id)))).ToArray();
        if(!methods.Any(m=>m.Enabled&&InRange(total,m.MinAmountRial,m.MaxAmountRial)&&variants.All(v=>v.ProductMethodIds.Contains(m.Id)&&(v.VariantMethodIds is null||v.VariantMethodIds.Contains(m.Id))&&(m.CategoryIds.Length==0||m.CategoryIds.Contains(v.Model.CategoryId)))&&(m.Kind!="cheque"||eligiblePlans.Length>0)))throw new BusinessException("sourcing_offer_purchase_conflict","Current purchase configuration no longer supports these exact accepted terms.");
    }
    private static bool InRange(long amount,long? min,long? max)=>(min is null||amount>=min)&&(max is null||amount<=max);
    private static BusinessException Capacity()=>new("sourcing_offer_capacity_unavailable","The accepted snapshot or purchase configuration exceeds supported bounds.");
}
