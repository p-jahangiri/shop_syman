using System.Text.Json;
using System.Text.Json.Serialization;
using Shop.SharedKernel;
namespace Shop.Modules.Sales;

public static class UsedOrderConditionSnapshots
{
    private static readonly JsonSerializerOptions Json=new(){NumberHandling=JsonNumberHandling.AllowReadingFromString};
    public static Dictionary<string,UsedItemConditionData> Read(string snapshot,IEnumerable<(string Key,string VariantId,string ProductId)> expectedLines)
    {
        var result=new Dictionary<string,UsedItemConditionData>(StringComparer.OrdinalIgnoreCase);
        if(!snapshot.Contains("\"UsedCondition\"",StringComparison.Ordinal))return result;
        try{
            if(snapshot.Length>524288)throw Invalid();
            var expected=expectedLines.ToDictionary(l=>l.Key,StringComparer.OrdinalIgnoreCase);
            using var document=JsonDocument.Parse(snapshot,new JsonDocumentOptions{MaxDepth=32});
            if(!document.RootElement.TryGetProperty("Lines",out var lines)||lines.ValueKind!=JsonValueKind.Array||lines.GetArrayLength()>64)throw Invalid();
            foreach(var line in lines.EnumerateArray()){
                if(!line.TryGetProperty("UsedCondition",out var condition)||condition.ValueKind==JsonValueKind.Null)continue;
                var variant=line.GetProperty("VariantId").GetString()!;var product=line.GetProperty("ProductId").GetString()!;
                var key=line.TryGetProperty("LineId",out var lineId)?lineId.GetString()!:variant;
                if(!expected.TryGetValue(key,out var target)||!string.Equals(target.VariantId,variant,StringComparison.OrdinalIgnoreCase)||!string.Equals(target.ProductId,product,StringComparison.OrdinalIgnoreCase)||result.ContainsKey(key))throw Invalid();
                if(line.TryGetProperty("LineKind",out var kind)&&kind.GetString()!="ordinary")throw Invalid();
                var data=JsonSerializer.Deserialize<UsedItemConditionData>(condition.GetRawText(),Json)??throw Invalid();UsedItemConditionRules.Validate(data);result.Add(key,data);
            }
            return result;
        }catch(Exception e)when(e is JsonException or InvalidOperationException or KeyNotFoundException or ArgumentException or BusinessException){throw Invalid();}
    }
    private static BusinessException Invalid()=>new("order_condition_unavailable","The historical used-device snapshot is unavailable; no current catalogue facts were substituted.");
}
