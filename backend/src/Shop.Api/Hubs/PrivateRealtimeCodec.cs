using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.DataProtection;
using Shop.SharedKernel;
using Shop.Modules.Notifications;
public sealed class PrivateRealtimeCodec(IDataProtectionProvider provider,TimeProvider time)
{
    private readonly IDataProtector protector=provider.CreateProtector("Sayman.PrivateRealtime.Connection.v1");
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web){PropertyNameCaseInsensitive=false,UnmappedMemberHandling=JsonUnmappedMemberHandling.Disallow,MaxDepth=4};
    private sealed record Lease(int SchemaVersion,string Token,string Binding,string Audience,long IssuedAt,long ExpiresAt);
    public static BusinessException Invalid()=>new("invalid_realtime_connection","The private connection is no longer valid.");
    public static string Owner(ClaimsPrincipal user){var values=user.FindAll("sub").Select(x=>x.Value).ToArray();if(values.Length!=1)throw Invalid();return NotificationRules.Owner(values[0]);}
    public static string Binding(ClaimsPrincipal user)
    {
        _=Owner(user);foreach(var type in new[]{"sst","jti","token_kind"}){var values=user.FindAll(type).Select(x=>x.Value).ToArray();if(values.Length!=1||values[0].Length is <1 or >256||values[0].Any(char.IsControl))throw Invalid();}
        if(user.FindFirstValue("token_kind")!="access")throw Invalid();NotificationRules.Id(user.FindFirstValue("jti")!);
        var claims=user.Claims.Where(x=>x.Type is "sub" or "sst" or "jti" or "token_kind" or "role" or "permission").Select(x=>new[]{x.Type,x.Type=="sub"?Owner(user):x.Value}).DistinctBy(x=>(x[0],x[1])).OrderBy(x=>x[0],StringComparer.Ordinal).ThenBy(x=>x[1],StringComparer.Ordinal).ToArray();if(claims.Length>128||claims.Any(x=>x[1].Length>256))throw Invalid();return Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(claims)));
    }
    private static bool Token(string value)=>value is{Length:>=16 and <=256}&&value.All(c=>char.IsAsciiLetterOrDigit(c)||c is '-'or'_');
    public string Wrap(string token,ClaimsPrincipal user,string audience)
    {
        if(!Token(token)||audience is not("customer"or"support"))throw Invalid();var now=time.GetUtcNow().ToUnixTimeMilliseconds();return protector.Protect(JsonSerializer.Serialize(new Lease(1,token,Binding(user),audience,now,checked(now+900000)),Json));
    }
    public string Unwrap(string wrapped,ClaimsPrincipal user,string audience)
    {
        try{if(wrapped is null||wrapped.Length is <32 or >4096||wrapped.Any(c=>!char.IsAsciiLetterOrDigit(c)&&c is not('-'or'_')))throw Invalid();var value=JsonSerializer.Deserialize<Lease>(protector.Unprotect(wrapped),Json)??throw Invalid();var now=time.GetUtcNow().ToUnixTimeMilliseconds();var binding=Binding(user);if(value.SchemaVersion!=1||value.Audience!=audience||audience is not("customer"or"support")||!Token(value.Token)||value.Binding is not{Length:64}||value.IssuedAt>now+15000||value.ExpiresAt<=now||value.ExpiresAt-value.IssuedAt!=900000||!CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(value.Binding),Encoding.UTF8.GetBytes(binding)))throw Invalid();return value.Token;}catch(Exception error)when(error is CryptographicException or JsonException or ArgumentException or OverflowException){throw Invalid();}
    }
}
