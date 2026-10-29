using Shop.SharedKernel;
namespace Shop.Modules.Sales;
public static class CreditOrderEligibility
{
    // This is an internal order consumer. It never changes the meaning of an
    // old quote's CanPlaceOrder or cash-only TemporaryOrder capability.
    public static void Require(CheckoutOrderSettings settings,PurchaseMethodData? method,CreditPlanData? plan,string? payable,string[] blockers)
    {
        if(!settings.ChequeOrdersEnabled||settings.Version.Length!=8||settings.ReservationMinutes is <1 or >60||settings.MaxOpenOrdersPerCustomer is <1 or >10||method is not{Enabled:true,Kind:"cheque"}||plan is not{Enabled:true}||payable is null||!long.TryParse(payable,System.Globalization.NumberStyles.None,System.Globalization.CultureInfo.InvariantCulture,out var amount)||amount<=0||blockers.Length!=1||blockers[0]!="credit_approval_required")throw new BusinessException("credit_order_unavailable_conflict","The cheque method, final charges, current plan or explicitly configured temporary-order policy is unavailable.");
    }
}
