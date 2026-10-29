using System.Text.Json.Serialization;

// Contract 4 accepts selections only. Prices, ownership and held quantities
// always come from the current cart and the server's accepted agreement.
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CheckoutQuoteV4Input(string? CartVersion,string? MethodId,string? PlanId,string? RequestId);
