using System.Text.Json;
using Shop.SharedKernel;

namespace Shop.Modules.Sales;

// The order's immutable PascalCase quote is the authority. Never infer
// postpaid delivery from today's policy, an editable name, or a zero amount.
public static class OrderShippingSnapshots
{
    public static string? PostpaidMode(string snapshot,bool shippingRequired,long merchantShippingRial)
    {
        try {
            if(snapshot.Length is <2 or >524288)throw Unavailable();
            using var document=JsonDocument.Parse(snapshot,new JsonDocumentOptions{MaxDepth=32});
            var root=document.RootElement;Unique(root);
            if(!root.TryGetProperty("ChargeRules",out var rules)||rules.ValueKind==JsonValueKind.Null) {
                // A public camelCase response is not a valid replacement for
                // the retained internal snapshot of a postpaid order.
                if(root.TryGetProperty("chargeRules",out var wrongCase)&&wrongCase.ValueKind==JsonValueKind.Object
                    &&(Text(wrongCase,"shippingMode")=="postpaid"||Text(wrongCase,"shippingReason")=="postpaid"))throw Unavailable();
                return null;
            }
            Unique(rules);
            foreach(var property in rules.EnumerateObject())
                if(property.Name.Equals("ShippingMode",StringComparison.OrdinalIgnoreCase)&&property.Name!="ShippingMode"
                    ||property.Name.Equals("ShippingReason",StringComparison.OrdinalIgnoreCase)&&property.Name!="ShippingReason")throw Unavailable();
            var mode=Text(rules,"ShippingMode");var reason=Text(rules,"ShippingReason");
            if(mode is not(null or "unconfigured" or "free" or "flat" or "postpaid"))throw Unavailable();
            if(mode!="postpaid") { if(reason=="postpaid")throw Unavailable();return null; }
            if(merchantShippingRial!=0||!root.TryGetProperty("ShippingRequired",out var required)
                ||required.ValueKind is not(JsonValueKind.True or JsonValueKind.False)||required.GetBoolean()!=shippingRequired
                ||Text(root,"ShippingRial")!="0")throw Unavailable();
            if(!shippingRequired) { if(reason!="digital")throw Unavailable();return null; }
            if(reason!="postpaid")throw Unavailable();
            return "postpaid";
        }
        catch(Exception error)when(error is JsonException or InvalidOperationException or ArgumentException or BusinessException) { throw Unavailable(); }
    }
    private static string? Text(JsonElement node,string name)
    {
        if(!node.TryGetProperty(name,out var property))return null;
        if(property.ValueKind!=JsonValueKind.String)throw Unavailable();
        return property.GetString();
    }
    private static void Unique(JsonElement node)
    {
        if(node.ValueKind!=JsonValueKind.Object)throw Unavailable();
        var names=new HashSet<string>(StringComparer.Ordinal);
        foreach(var property in node.EnumerateObject())if(!names.Add(property.Name))throw Unavailable();
    }
    private static BusinessException Unavailable()=>new("order_shipping_unavailable","The immutable delivery-charge snapshot is unavailable; no current policy or free-delivery assumption was substituted.");
}
