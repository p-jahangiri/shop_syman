using System.Globalization;
using System.Numerics;
using System.Text.Json;
using Shop.SharedKernel;

namespace Shop.Modules.Sales;

public static class OrderTaxSnapshots
{
    // NULL is an unknown included component, never a zero/exempt tax. The
    // nullable wire flag is emitted only for this newly explicit policy.
    public static bool? BreakdownKnown(SalesOrder order)
    {
        try {
            if(order.QuoteSnapshotJson.Length is <2 or >524288)throw Unavailable();
            if(order.TaxBreakdownKnown ? order.TaxRial is null or <0 : !order.TaxIncluded||order.TaxRial is not null)throw Unavailable();
            var payable=(BigInteger)order.GoodsTotalRial+order.ShippingRial+(order.TaxIncluded?0:order.TaxRial!.Value);
            if(order.GoodsTotalRial<0||order.ShippingRial<0||order.PayableTotalRial<=0||payable!=order.PayableTotalRial)throw Unavailable();
            using var document=JsonDocument.Parse(order.QuoteSnapshotJson,new JsonDocumentOptions{MaxDepth=32});
            var root=document.RootElement;Unique(root);
            if(!root.TryGetProperty("ChargeRules",out var rules)||rules.ValueKind==JsonValueKind.Null) {
                if(!order.TaxBreakdownKnown)throw Unavailable();
                if(root.TryGetProperty("chargeRules",out var wrongCase)&&wrongCase.ValueKind==JsonValueKind.Object
                    &&wrongCase.TryGetProperty("taxMode",out var wrongMode)&&wrongMode.ValueKind==JsonValueKind.String&&wrongMode.GetString()=="included_unitemized")throw Unavailable();
                return null;
            }
            Unique(rules);
            foreach(var property in rules.EnumerateObject())
                if(property.Name.Equals("TaxMode",StringComparison.OrdinalIgnoreCase)&&property.Name!="TaxMode")throw Unavailable();
            var hasMode=rules.TryGetProperty("TaxMode",out var mode);
            if(hasMode&&(mode.ValueKind!=JsonValueKind.String||mode.GetString() is not("unconfigured" or "exempt" or "exclusive" or "inclusive" or "included_unitemized")))throw Unavailable();
            var unitemized=hasMode&&mode.GetString()=="included_unitemized";
            if(!unitemized) { if(!order.TaxBreakdownKnown)throw Unavailable();return null; }
            if(order.TaxBreakdownKnown||!order.TaxIncluded||order.TaxRial is not null
                ||!rules.TryGetProperty("TaxIncluded",out var included)||included.ValueKind!=JsonValueKind.True
                ||!rules.TryGetProperty("TaxRateBasisPoints",out var rate)||rate.ValueKind!=JsonValueKind.Null
                ||!root.TryGetProperty("TaxRial",out var tax)||tax.ValueKind!=JsonValueKind.Null
                ||Text(root,"GoodsTotalRial")!=Money(order.GoodsTotalRial)
                ||Text(root,"ShippingRial")!=Money(order.ShippingRial)
                ||Text(root,"PayableTotalRial")!=Money(order.PayableTotalRial))throw Unavailable();
            return false;
        }
        catch(Exception error)when(error is JsonException or InvalidOperationException or ArgumentException or BusinessException) { throw Unavailable(); }
    }
    private static string? Text(JsonElement element,string name)=>element.TryGetProperty(name,out var value)&&value.ValueKind==JsonValueKind.String?value.GetString():null;
    private static string Money(long amount)=>amount.ToString(CultureInfo.InvariantCulture);
    private static void Unique(JsonElement value)
    {
        if(value.ValueKind!=JsonValueKind.Object)throw Unavailable();
        var names=new HashSet<string>(StringComparer.Ordinal);
        foreach(var property in value.EnumerateObject())if(!names.Add(property.Name))throw Unavailable();
    }
    private static BusinessException Unavailable()=>new("order_tax_unavailable","The immutable included-tax disclosure is unavailable; no unknown tax component was replaced with zero or an exemption.");
}
