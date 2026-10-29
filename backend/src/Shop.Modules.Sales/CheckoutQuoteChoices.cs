using Shop.SharedKernel;

namespace Shop.Modules.Sales;

// Both contracts use today's publication/purchase configuration. Price
// authority is supplied separately: Catalog for ordinary, Agreement for V4.
internal static class CheckoutQuoteChoices
{
    internal sealed record Selection(PurchaseMethodData[] Methods,CreditPlanData[] Plans,PurchaseMethodData? Method,CreditPlanData? Plan,ChequeCalculation Amounts);
    internal static Selection Select(long subtotal,IEnumerable<CheckoutVariantData> variants,PurchaseMethodData[] rules,CreditPlanData[] allPlans,string? methodId,string? planId)
    {
        if(rules.Length>64||allPlans.Length>64)throw new BusinessException("quote_configuration_limit","Consolidate purchase methods/plans before quoting this catalogue.");
        var current=variants.ToArray();
        var plans=allPlans.OrderBy(p=>p.Id,StringComparer.Ordinal).Where(p=>p.Enabled&&InRange(subtotal,p.MinAmountRial,p.MaxAmountRial)&&current.All(v=>(p.CategoryIds.Length==0||p.CategoryIds.Contains(v.Variant.CategoryId))&&(v.ChequePlanIds.Length==0||v.ChequePlanIds.Contains(p.Id)))).ToArray();
        var methods=rules.OrderBy(m=>m.Id,StringComparer.Ordinal).Where(m=>m.Enabled&&InRange(subtotal,m.MinAmountRial,m.MaxAmountRial)&&current.All(v=>v.ProductMethodIds.Contains(m.Id)&&(v.VariantMethodIds is null||v.VariantMethodIds.Contains(m.Id))&&(m.CategoryIds.Length==0||m.CategoryIds.Contains(v.Variant.CategoryId)))&&(m.Kind!="cheque"||plans.Length>0)).ToArray();
        var method=methodId is null?null:methods.SingleOrDefault(m=>m.Id==methodId)??throw new BusinessException("quote_choice_conflict","This purchase method is no longer eligible for all cart items.");
        CreditPlanData? plan=null;
        if(method?.Kind=="cheque")plan=plans.SingleOrDefault(p=>p.Id==planId)??throw new BusinessException("quote_choice_conflict","Choose an eligible cheque plan.");
        else if(planId is not null)throw new BusinessException("quote_choice_conflict","This method does not use a cheque plan.");
        return new(methods,plans,method,plan,plan is null?new(0,0,subtotal,[]):ChequeCalculator.Calculate(subtotal,plan));
    }
    private static bool InRange(long amount,long? min,long? max)=>(min is null||amount>=min)&&(max is null||amount<=max);
}
