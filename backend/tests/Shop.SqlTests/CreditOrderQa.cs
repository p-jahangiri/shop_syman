using System.Text.Json;
using System.Text.Json.Nodes;
using Xunit;
namespace Shop.SqlTests;
internal static class CreditOrderQa
{
    public static async Task<JsonNode> Read(HttpResponseMessage response)
    {
        using(response){var raw=await response.Content.ReadAsStringAsync();Assert.True(response.IsSuccessStatusCode,$"HTTP{(int)response.StatusCode}: {raw}");Assert.Contains("no-store",response.Headers.CacheControl!.ToString());var path=response.RequestMessage!.RequestUri!.PathAndQuery;
            if(Environment.GetEnvironmentVariable("SHOP_CREDIT_ORDER_WIRE_DIR")is{Length:>0}dir&&(path.StartsWith("/api/credit-orders/",StringComparison.Ordinal)||path.Contains("/credit-quote",StringComparison.Ordinal)||path.EndsWith("/purchase-scope",StringComparison.Ordinal))){Directory.CreateDirectory(dir);var name=Guid.NewGuid().ToString("N");await File.WriteAllTextAsync(Path.Combine(dir,name+".json"),raw);await File.WriteAllTextAsync(Path.Combine(dir,name+".meta.json"),JsonSerializer.Serialize(new{actualSqlHttpResponse=true,syntheticQaOnly=true,status=(int)response.StatusCode,method=response.RequestMessage.Method.Method,path,cacheControl=response.Headers.CacheControl.ToString()}));}
            return JsonNode.Parse(raw)!;
        }
    }
}
