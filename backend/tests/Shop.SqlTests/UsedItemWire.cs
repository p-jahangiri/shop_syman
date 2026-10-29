using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Xunit;
namespace Shop.SqlTests;
internal static class UsedItemWire
{
    private static readonly object Gate=new();
    internal static async Task<JsonNode> Body(HttpResponseMessage response,string name,string kind,HttpStatusCode expected=HttpStatusCode.OK)
    {
        using(response){var bytes=await response.Content.ReadAsByteArrayAsync();Assert.True(response.StatusCode==expected,$"HTTP {(int)response.StatusCode}: {System.Text.Encoding.UTF8.GetString(bytes)}");Assert.Contains("no-store",response.Headers.CacheControl!.ToString());
            if(Environment.GetEnvironmentVariable("SHOP_USED_WIRE_DIR") is {Length:>0} dir){lock(Gate){Directory.CreateDirectory(dir);var p=Path.Combine(dir,name+".json");using(var file=new FileStream(p,FileMode.CreateNew))file.Write(bytes);var manifest=Path.Combine(dir,"manifest.json");var list=File.Exists(manifest)?JsonNode.Parse(File.ReadAllText(manifest))!["entries"]!.AsArray():new JsonArray();list.Add(new JsonObject{["file"]=name+".json",["kind"]=kind,["sha256"]=Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant()});File.WriteAllText(manifest,new JsonObject{["actualSqlHttpBodies"]=true,["entries"]=list.DeepClone()}.ToJsonString(new(){WriteIndented=true}));}}
            return JsonNode.Parse(bytes)!;}
    }
}
