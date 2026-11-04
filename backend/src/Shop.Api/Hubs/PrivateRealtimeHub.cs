using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.SignalR;
using Shop.Modules.Notifications;
using Shop.SharedKernel;
public sealed record PrivateRealtimePulse(int SchemaVersion,string Scope);
public sealed record PrivateRealtimeDelivery(string Group,string Scope);
public sealed class PrivateRealtimeQueue:IPrivateRealtimeEvents
{
    private readonly HashSet<PrivateRealtimeDelivery> events=[];
    public const string StaffGroup="support:read:v1";
    public static string AccountGroup(string owner)=>"account:"+Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(NotificationRules.Owner(owner))));
    public void SupportChanged(string owner){Add(new(AccountGroup(owner),"support"));Add(new(StaffGroup,"support"));}
    public void InboxChanged(string owner)=>Add(new(AccountGroup(owner),"notifications"));
    private void Add(PrivateRealtimeDelivery value){if(events.Count>=16&&!events.Contains(value))throw new InvalidOperationException("Private realtime event capacity exceeded.");events.Add(value);}
    public PrivateRealtimeDelivery[] Drain(){var result=events.OrderBy(x=>x.Group,StringComparer.Ordinal).ThenBy(x=>x.Scope,StringComparer.Ordinal).ToArray();events.Clear();return result;}
}
// No client-invokable methods, arbitrary group join, or message mutation channel.
public sealed class PrivateRealtimeHub:Hub
{
    public override async Task OnConnectedAsync()
    {
        var http=Context.GetHttpContext()??throw new HubException("Private connection unavailable.");var owner=PrivateRealtimeCodec.Owner(Context.User!);var staff=http.Request.Path.StartsWithSegments("/api/admin/realtime");
        await Groups.AddToGroupAsync(Context.ConnectionId,staff?PrivateRealtimeQueue.StaffGroup:PrivateRealtimeQueue.AccountGroup(owner),Context.ConnectionAborted);
        await Clients.Caller.SendCoreAsync("Changed",[new PrivateRealtimePulse(1,"support")],Context.ConnectionAborted);
        if(!staff)await Clients.Caller.SendCoreAsync("Changed",[new PrivateRealtimePulse(1,"notifications")],Context.ConnectionAborted);
        await base.OnConnectedAsync();
    }
}
public interface IPrivateRealtimeDispatcher{Task DispatchAsync(PrivateRealtimeDelivery[] values,CancellationToken ct);}
public sealed class SignalRPrivateRealtimeDispatcher(IHubContext<PrivateRealtimeHub> hub):IPrivateRealtimeDispatcher
{
    public async Task DispatchAsync(PrivateRealtimeDelivery[] values,CancellationToken ct){foreach(var value in values)await hub.Clients.Group(value.Group).SendCoreAsync("Changed",[new PrivateRealtimePulse(1,value.Scope)],ct);}
}
public static class PrivateRealtimeDispatch
{
    public static async Task Invoke(HttpContext http,RequestDelegate next)
    {
        await next(http);var pending=http.RequestServices.GetRequiredService<PrivateRealtimeQueue>().Drain();if(http.Response.StatusCode is <200 or >=300||pending.Length==0)return;
        using var stop=CancellationTokenSource.CreateLinkedTokenSource(http.RequestServices.GetRequiredService<IHostApplicationLifetime>().ApplicationStopping);stop.CancelAfter(TimeSpan.FromSeconds(2));
        try{await http.RequestServices.GetRequiredService<IPrivateRealtimeDispatcher>().DispatchAsync(pending,stop.Token);}catch(Exception error)when(error is not OutOfMemoryException){http.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("PrivateRealtime").LogWarning("A committed private update could not be signalled. Clients recover by refreshing SQL state.");}
    }
}
