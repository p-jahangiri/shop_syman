using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.DataProtection;
using Shop.Modules.Notifications;
using Shop.SharedKernel;

public static class PhoneInboxEndpoints
{
    public static IServiceCollection AddPhoneInbox(this IServiceCollection services)
    {
        services.AddScoped<IPhoneInboxProtection,DataProtectionPhoneInboxProtection>();
        services.AddScoped<IPhoneDiscoveryNotificationWriter,PhoneInboxWriter>();
        services.AddScoped<PhoneInboxService>();return services;
    }
    public static void MapPhoneInbox(this WebApplication app,string[] origins)
    {
        var group=app.MapGroup("/api/notifications/phones").RequireAuthorization("customer").RequireRateLimiting("support");
        group.AddEndpointFilter(InputValidation.Filter);
        group.AddEndpointFilter(async(context,next)=>{
            var request=context.HttpContext.Request;var origin=request.Headers.Origin.ToString();
            if((!HttpMethods.IsGet(request.Method)||origin.Length>0)&&!origins.Contains(origin,StringComparer.Ordinal))return Results.StatusCode(403);
            return await next(context);
        });
        group.MapGet("/",async(HttpContext http,PhoneInboxService service,CancellationToken ct)=>{
            if(!Query(http,"unreadOnly","cursor"))return Results.BadRequest();
            var raw=http.Request.Query["unreadOnly"].ToString();if(raw is not(""or"true"or"false"))return Results.BadRequest();
            return Results.Ok(await service.PageAsync(Actor(http),raw=="true",http.Request.Query.ContainsKey("cursor")?http.Request.Query["cursor"].ToString():null,ct));
        });
        group.MapGet("/unread-count",async(HttpContext http,PhoneInboxService service,CancellationToken ct)=>
            !Query(http)?Results.BadRequest():Results.Ok(await service.CountAsync(Actor(http),ct)));
        group.MapPut("/{id}/read",async(string id,MarkNotificationReadInput input,HttpContext http,PhoneInboxService service,CancellationToken ct)=>
            !Query(http)?Results.BadRequest():Results.Ok(await service.ReadAsync(Actor(http),id,ct)));
    }
    private static string Actor(HttpContext http)=>http.User.FindFirstValue("sub")??throw NotificationRules.Invalid();
    private static bool Query(HttpContext http,params string[] allowed)=>http.Request.Query.All(pair=>allowed.Contains(pair.Key,StringComparer.Ordinal)&&pair.Value.Count==1&&pair.Value[0]is{Length:>0});
}

public sealed class DataProtectionPhoneInboxProtection(IDataProtectionProvider provider):IPhoneInboxProtection
{
    private IDataProtector Protector(string owner,string id)
    {
        NotificationRules.Id(id);return provider.CreateProtector("Sayman.Notifications.PrivatePhoneDiscovery.v1",NotificationRules.Owner(owner),id);
    }
    public byte[] Protect(string owner,string id,string text)
    {
        var raw=new UTF8Encoding(false,true).GetBytes(text);
        try{
            if(raw.Length is<1 or>4096)throw NotificationRules.Unavailable();
            var value=Protector(owner,id).Protect(raw);if(value.Length>8192)throw NotificationRules.Unavailable();return value;
        }finally{CryptographicOperations.ZeroMemory(raw);}
    }
    public string Unprotect(string owner,string id,byte[] value)
    {
        byte[]? raw=null;
        try{
            if(value.Length is<1 or>8192)throw NotificationRules.Unavailable();
            raw=Protector(owner,id).Unprotect(value);if(raw.Length is<1 or>4096)throw NotificationRules.Unavailable();return new UTF8Encoding(false,true).GetString(raw);
        }catch(Exception error)when(error is CryptographicException or DecoderFallbackException or ArgumentException){throw NotificationRules.Unavailable();}
        finally{if(raw is not null)CryptographicOperations.ZeroMemory(raw);}
    }
}
