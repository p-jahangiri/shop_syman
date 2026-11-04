using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.WebUtilities;
using Shop.SharedKernel;
public static class PrivateRealtimeTransport
{
    public static bool IsScope(string path)=>path.StartsWith("/api/realtime",StringComparison.OrdinalIgnoreCase)||path.StartsWith("/api/admin/realtime",StringComparison.OrdinalIgnoreCase);
    public static async Task Guard(HttpContext http,RequestDelegate next,string[] origins,string[] adminOrigins)
    {
        var path=http.Request.Path.Value??"";if(!IsScope(path)){await next(http);return;}
        http.Response.Headers.CacheControl="private, no-store";http.Response.Headers.Vary="Cookie, Authorization";http.Response.Headers["X-Robots-Tag"]="noindex, nofollow";
        var staff=path.StartsWith("/api/admin/realtime",StringComparison.Ordinal);var root=staff?"/api/admin/realtime":"/api/realtime";var negotiate=path==root+"/negotiate";
        if(path!=root&&!negotiate){http.Response.StatusCode=404;return;}if(http.User.Identity?.IsAuthenticated!=true||http.User.FindFirst("token_kind")?.Value!="access"){http.Response.StatusCode=401;return;}
        var origin=http.Request.Headers.Origin.ToString();if((origin.Length>0||!HttpMethods.IsGet(http.Request.Method))&&!(staff?adminOrigins:origins).Contains(origin,StringComparer.Ordinal)){http.Response.StatusCode=403;return;}
        var query=http.Request.Query;var valid=negotiate?HttpMethods.IsPost(http.Request.Method)&&query.Count==1&&query.Keys.Single()=="negotiateVersion"&&query["negotiateVersion"].Count==1&&query["negotiateVersion"]=="1":(HttpMethods.IsGet(http.Request.Method)||HttpMethods.IsPost(http.Request.Method)||HttpMethods.IsDelete(http.Request.Method))&&query.ContainsKey("id")&&query.All(x=>x.Value.Count==1&&(x.Key=="id"||x.Key=="_"&&HttpMethods.IsGet(http.Request.Method)&&x.Value[0]is{Length:>=1 and <=20}timestamp&&timestamp.All(char.IsAsciiDigit)));
        if(!valid||http.Request.Headers.Accept.ToString().Contains("text/event-stream",StringComparison.OrdinalIgnoreCase)||http.WebSockets.IsWebSocketRequest){http.Response.StatusCode=400;return;}
        var body=await ReadBody(http.Request,4096,http.RequestAborted);if(body is null){http.Response.StatusCode=413;return;}
        if(negotiate||!HttpMethods.IsPost(http.Request.Method)){if(body.Length!=0){http.Response.StatusCode=400;return;}}
        else if(!System.Text.RegularExpressions.Regex.IsMatch(http.Request.ContentType??"",@"^text/plain(?:\s*;|$)",System.Text.RegularExpressions.RegexOptions.IgnoreCase|System.Text.RegularExpressions.RegexOptions.CultureInvariant)){http.Response.StatusCode=415;return;}
        else if(!ClientFrames(body)){http.Response.StatusCode=400;return;}
        var codec=http.RequestServices.GetRequiredService<PrivateRealtimeCodec>();var audience=staff?"support":"customer";var originalQuery=http.Request.QueryString;
        if(!negotiate){try{var token=codec.Unwrap(query["id"].ToString(),http.User,audience);http.Request.QueryString=new QueryString(QueryHelpers.AddQueryString("","id",token));}catch(BusinessException){http.Response.StatusCode=403;return;}}
        var originalBody=http.Request.Body;await using var bufferedRequest=new MemoryStream(body,false);http.Request.Body=bufferedRequest;
        try{
            if(!negotiate){await next(http);return;}
            var originalResponse=http.Response.Body;await using var response=new MemoryStream();http.Response.Body=response;
            try{
                await next(http);if(http.Response.StatusCode!=200){response.Position=0;await response.CopyToAsync(originalResponse,http.RequestAborted);return;}
                if(response.Length>4096||JsonNode.Parse(response.ToArray())is not JsonObject value||value["negotiateVersion"]?.GetValue<int>()!=1||value["connectionToken"]is not JsonValue token||!token.TryGetValue<string>(out var raw))throw new InvalidOperationException("SignalR negotiation shape changed.");
                value["connectionToken"]=codec.Wrap(raw,http.User,audience);var encoded=Encoding.UTF8.GetBytes(value.ToJsonString());http.Response.ContentLength=encoded.Length;await originalResponse.WriteAsync(encoded,http.RequestAborted);
            }finally{http.Response.Body=originalResponse;}
        }finally{http.Request.QueryString=originalQuery;http.Request.Body=originalBody;}
    }
    private static async Task<byte[]?> ReadBody(HttpRequest request,int maximum,CancellationToken ct)
    {
        if(request.ContentLength>maximum)return null;await using var result=new MemoryStream();var chunk=new byte[1024];while(true){var n=await request.Body.ReadAsync(chunk,ct);if(n==0)break;if(result.Length+n>maximum)return null;await result.WriteAsync(chunk.AsMemory(0,n),ct);}return result.ToArray();
    }
    public static bool ClientFrames(byte[] raw)
    {
        try{var text=new UTF8Encoding(false,true).GetString(raw);var frames=text.Split('\u001e');if(frames.Length is <2 or >17||frames[^1]!="")return false;foreach(var frame in frames[..^1]){if(JsonNode.Parse(frame)is not JsonObject value)return false;if(value.Count==2&&value["protocol"]?.GetValue<string>()=="json"&&value["version"]?.GetValue<int>()==1)continue;if(value.Count==1&&value["type"]?.GetValue<int>()is 6 or 7)continue;return false;}return true;}catch(Exception error)when(error is System.Text.Json.JsonException or InvalidOperationException or DecoderFallbackException or FormatException or ArgumentException){return false;}
    }
}
