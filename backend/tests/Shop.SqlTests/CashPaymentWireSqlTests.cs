using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Xunit;
namespace Shop.SqlTests;
public sealed partial class CashOrderPaymentSqlTests
{
    private static readonly object PaymentWireGate=new();
    private static async Task<JsonNode> PaymentWire(HttpResponseMessage response,string name,string kind)
    {
        using(response){var bytes=await response.Content.ReadAsByteArrayAsync();Assert.Equal(HttpStatusCode.OK,response.StatusCode);Assert.Contains("no-store",response.Headers.CacheControl!.ToString());
            if(Environment.GetEnvironmentVariable("SHOP_PAYMENT_WIRE_DIR") is {Length:>0} directory){
                if(Path.GetFileName(directory)!="payment-core-sql-wire"||!Regex.IsMatch(name,"^[a-z-]{1,50}$"))throw new InvalidOperationException("Fresh bounded payment wire directory required.");
                lock(PaymentWireGate){Directory.CreateDirectory(directory);var file=name+".json";using(var stream=new FileStream(Path.Combine(directory,file),FileMode.CreateNew))stream.Write(bytes);var target=Path.Combine(directory,"manifest.json");var manifest=File.Exists(target)?JsonNode.Parse(File.ReadAllText(target))!.AsObject():new JsonObject{["actualSqlHttpResponseBodies"]=true,["syntheticQaOnly"]=true,["gatewayFactIsInternalTestOnlyNotHttpInput"]=true,["entries"]=new JsonArray()};manifest["entries"]!.AsArray().Add(new JsonObject{["file"]=file,["kind"]=kind,["sha256"]=Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes)).ToLowerInvariant()});File.WriteAllText(target,manifest.ToJsonString(new JsonSerializerOptions{WriteIndented=true}));}
            }
            return JsonNode.Parse(bytes)!;
        }
    }
}
