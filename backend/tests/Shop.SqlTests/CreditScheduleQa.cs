using System.Text.Json;
using System.Text.Json.Nodes;
using Xunit;
namespace Shop.SqlTests;
internal static class CreditScheduleQa
{
    private static string Id()=>Guid.NewGuid().ToString("N");
    public static async Task<JsonNode> Read(HttpResponseMessage response)
    {
        using(response){var raw=await response.Content.ReadAsStringAsync();Assert.True(response.IsSuccessStatusCode,$"HTTP{(int)response.StatusCode}: {raw}");Assert.Contains("no-store",response.Headers.CacheControl!.ToString());if(Environment.GetEnvironmentVariable("SHOP_CREDIT_SCHEDULE_WIRE_DIR")is{Length:>0}dir&&response.RequestMessage!.RequestUri!.AbsolutePath.Contains("/credit/orders")){Directory.CreateDirectory(dir);var id=Id();await File.WriteAllTextAsync(Path.Combine(dir,id+".json"),raw);await File.WriteAllTextAsync(Path.Combine(dir,id+".meta.json"),JsonSerializer.Serialize(new{actualSqlHttpResponse=true,syntheticQaOnly=true,status=(int)response.StatusCode,method=response.RequestMessage.Method.Method,path=response.RequestMessage.RequestUri.PathAndQuery,cacheControl=response.Headers.CacheControl.ToString()}));}return JsonNode.Parse(raw)!;}
    }
}
