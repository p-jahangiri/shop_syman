using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;

namespace Shop.Modules.Notifications;

public sealed class PhoneInboxWriter(NotificationsDbContext db,IPhoneInboxProtection protection,IPrivateRealtimeEvents realtime):IPhoneDiscoveryNotificationWriter
{
    internal static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web){PropertyNameCaseInsensitive=false,UnmappedMemberHandling=System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow,MaxDepth=4};
    internal static string Hash(string text)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)));
    internal static PhoneDiscoveryNotificationEvent Open(PhoneInboxNotification row,IPhoneInboxProtection protection)
    {
        try{
            var raw=protection.Unprotect(row.OwnerId,row.Id,row.ProtectedPayload);
            if(Hash(raw)!=row.PayloadHash)throw NotificationRules.Unavailable();
            var value=JsonSerializer.Deserialize<PhoneDiscoveryNotificationEvent>(raw,Json)??throw NotificationRules.Unavailable();
            PhoneInboxRules.Validate(value);
            if(value.Id!=row.Id||value.OwnerId!=row.OwnerId||value.Kind!=row.Kind||value.ListingId!=row.ListingId||value.ConfigurationId!=row.ConfigurationId||value.At!=row.At)
                throw NotificationRules.Unavailable();
            return value;
        }catch(Exception error)when(error is JsonException or BusinessException){throw NotificationRules.Unavailable();}
    }
    public async Task RecordAsync(PhoneDiscoveryNotificationEvent value,CancellationToken ct)
    {
        if(db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel!=IsolationLevel.Serializable)
            throw new InvalidOperationException("Phone notifications require the shared audited Serializable transaction.");
        value=PhoneInboxRules.Normalize(value);
        var previous=await db.PhoneInbox.AsNoTracking().SingleOrDefaultAsync(row=>row.Id==value.Id,ct);
        if(previous is not null){if(Open(previous,protection)!=value)throw NotificationRules.Unavailable();return;}
        var raw=JsonSerializer.Serialize(value,Json);
        db.PhoneInbox.Add(new(){Id=value.Id,OwnerId=value.OwnerId,Kind=value.Kind,ListingId=value.ListingId,ConfigurationId=value.ConfigurationId,
            At=value.At,PayloadHash=Hash(raw),ProtectedPayload=protection.Protect(value.OwnerId,value.Id,raw)});
        await db.SaveChangesAsync(ct);realtime.InboxChanged(value.OwnerId);
    }
}

public sealed class PhoneInboxService(NotificationsDbContext db,IPhoneInboxProtection protection,TimeProvider clock,IPrivateRealtimeEvents realtime)
{
    private PhoneInboxData Data(PhoneInboxNotification row)
    {
        var value=PhoneInboxWriter.Open(row,protection);
        if(row.ReadAt is{}read&&(read.Offset!=TimeSpan.Zero||read<row.At))throw NotificationRules.Unavailable();
        return new(row.Id,PhoneInboxRules.Sequence(row.Sequence),value.Kind,value.ListingId,value.ConfigurationId,value.RequestId,value.OfferId,value.StoreSlug,value.VariantId,value.At,row.ReadAt);
    }
    public async Task<PhoneInboxPage> PageAsync(string owner,bool unreadOnly,string? cursor,CancellationToken ct)
    {
        owner=NotificationRules.Owner(owner);
        var before=PhoneInboxRules.Before(cursor,owner,unreadOnly);
        var query=db.PhoneInbox.AsNoTracking().Where(row=>row.OwnerId==owner&&row.Sequence<before);
        if(unreadOnly)query=query.Where(row=>row.ReadAt==null);
        var rows=await query.OrderByDescending(row=>row.Sequence).Take(51).ToArrayAsync(ct);
        var selected=rows.Take(50).ToArray();
        return new(1,unreadOnly,selected.Select(Data).ToArray(),rows.Length>50?PhoneInboxRules.Cursor(selected[^1].Sequence,owner,unreadOnly):null);
    }
    public async Task<NotificationCount> CountAsync(string owner,CancellationToken ct)
    {
        owner=NotificationRules.Owner(owner);
        return new(1,(await db.PhoneInbox.LongCountAsync(row=>row.OwnerId==owner&&row.ReadAt==null,ct)).ToString(CultureInfo.InvariantCulture));
    }
    public async Task<PhoneInboxReadResult> ReadAsync(string owner,string id,CancellationToken ct)
    {
        owner=NotificationRules.Owner(owner);NotificationRules.Id(id);
        await using var transaction=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable,ct);
        var row=await db.PhoneInbox.FromSqlInterpolated($"SELECT * FROM [notifications].[PhoneInbox] WITH (UPDLOCK,HOLDLOCK) WHERE [OwnerId]={owner} AND [Id]={id}")
            .AsNoTracking().SingleOrDefaultAsync(ct)??throw new BusinessException("not_found","Notification was not found.");
        Data(row);
        var now=clock.GetUtcNow().ToUniversalTime();
        var changed=await db.PhoneInbox.Where(item=>item.OwnerId==owner&&item.Id==id&&item.ReadAt==null)
            .ExecuteUpdateAsync(update=>update.SetProperty(item=>item.ReadAt,item=>now<item.At?item.At:now),ct);
        var current=await db.PhoneInbox.AsNoTracking().SingleOrDefaultAsync(item=>item.OwnerId==owner&&item.Id==id,ct)??throw NotificationRules.Unavailable();
        var result=Data(current);if(result.ReadAt is null)throw NotificationRules.Unavailable();
        await transaction.CommitAsync(ct);if(changed>0)realtime.InboxChanged(owner);
        return new(1,result);
    }
}
