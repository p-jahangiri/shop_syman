using System.Globalization;
using Shop.SharedKernel;
namespace Shop.Modules.Sales;

public sealed record CreditQuoteAuthorityData(string ApplicationId,string ApplicationVersion,string ScopeId,string ScopeVersion,string ReviewId,string SubmissionId,string LimitBasis,string LimitAmountRial,DateTimeOffset ExpiresAt,string PlanId,string PlanVersion,string PlanSnapshotHash);
public sealed record CreditQuoteAssessmentData(string LimitBasis,string LimitAmountRial,[property:System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.Never)]string? AssessedAmountRial,[property:System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.Never)]bool? WithinLimit,string[] Blockers);
public static class CreditQuoteAssessment
{
    public static CreditQuoteAuthorityData Snapshot(CreditPurchaseAuthority authority) => new(authority.ApplicationId,authority.ApplicationVersion,authority.ScopeId,authority.ScopeVersion,authority.ReviewId,authority.SubmissionId,authority.LimitBasis,Money(authority.LimitAmountRial),authority.ExpiresAt,authority.PlanId,authority.PlanVersion,authority.PlanSnapshotHash);
    public static CreditQuoteAssessmentData Assess(CreditPurchaseAuthority authority,PurchaseMethodData? method,CreditPlanData? plan,string goodsTotalRial,string downPaymentRial,string? payableTotalRial,ChequeAmount[] installments,string[] quoteBlockers)
    {
        if(authority is null||authority.LimitAmountRial<=0||authority.LimitBasis is not("PayableTotalRial"or"InstallmentsTotalRial")||method is not{Kind:"cheque",Enabled:true}||plan is not{Enabled:true}||plan.Id!=authority.PlanId||installments is null||quoteBlockers is null)throw Invalid();
        var goods=Amount(goodsTotalRial);var down=Amount(downPaymentRial);var payable=payableTotalRial is null?(long?)null:Amount(payableTotalRial);long total=0;
        try{
            if(plan.Months is <1 or >60||plan.IntervalMonths<1||plan.Months%plan.IntervalMonths!=0||installments.Length!=(goods==down?0:plan.Months/plan.IntervalMonths))throw Invalid();
            for(var i=0;i<installments.Length;i++){var item=installments[i];if(item.Sequence!=i+1||item.MonthOffset!=(i+1)*plan.IntervalMonths||Amount(item.AmountRial)<=0)throw Invalid();total=checked(total+Amount(item.AmountRial));}
            if(down>goods||checked(total+down)!=goods||payable is{}full&&full<goods)throw Invalid();
        }catch(OverflowException){throw new BusinessException("credit_quote_amount_limit","The cheque quote exceeds the supported integer rial amount.");}
        var assessed=authority.LimitBasis=="PayableTotalRial"?payable:total;bool? within=assessed is{}value?value<=authority.LimitAmountRial:null;
        var blockers=quoteBlockers.Where(x=>x!="credit_approval_required").ToList();
        if(assessed is null)blockers.Add("credit_quote_amount_unavailable");else if(within==false)blockers.Add("credit_scope_limit_exceeded");
        if(payable is null)blockers.Add("credit_quote_final_charges_unavailable");
        // A comparison is not a stock reservation or a single-use order claim.
        blockers.Add("credit_order_not_configured");
        return new(authority.LimitBasis,Money(authority.LimitAmountRial),assessed is{}amount?Money(amount):null,within,blockers.Distinct(StringComparer.Ordinal).ToArray());
    }
    private static long Amount(string value){if(value is null||value.Length is <1 or >19||value.Length>1&&value[0]=='0'||value.Any(c=>!char.IsAsciiDigit(c))||!long.TryParse(value,NumberStyles.None,CultureInfo.InvariantCulture,out var amount))throw Invalid();return amount;}
    private static string Money(long value)=>value.ToString(CultureInfo.InvariantCulture);
    private static BusinessException Invalid()=>new("invalid_credit_quote","The selected cheque quote and purchase scope do not agree.");
}
