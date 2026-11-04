namespace Shop.SharedKernel;
// Civil due dates belong to Credit; Sales supplies only the immutable accepted
// financial facts and the current order version under the common owner gate.
public sealed record CreditScheduleInstallmentSource(int Sequence,int MonthOffset,long AmountRial);
public sealed record CreditOrderScheduleSource(string OwnerId,string OrderId,string OrderVersion,string State,DateTimeOffset CreatedAt,DateTimeOffset ExpiresAt,string ApplicationId,string ScopeId,string CreditQuoteId,string QuoteFingerprint,string Locale,string PlanName,long PayableTotalRial,long PlanDownPaymentRial,CreditScheduleInstallmentSource[] Installments,CreditPurchaseUse? PurchaseUse=null);
public interface ICreditOrderScheduleSource
{
    Task<CreditScheduleOrderPageSource> PageForFinanceAsync(string? cursor,CancellationToken ct);
    Task<CreditOrderScheduleSource> LockAndReadAsync(string owner,string orderId,CancellationToken ct);
}

public sealed record CreditScheduleOrderSummarySource(string OrderId,string OwnerId,string Reference,string Locale,string State,DateTimeOffset CreatedAt,DateTimeOffset ExpiresAt,string PayableTotalRial,int ItemCount,string Version);
public sealed record CreditScheduleOrderPageSource(int SchemaVersion,CreditScheduleOrderSummarySource[] Items,[property:System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.Never)]string? NextCursor);
