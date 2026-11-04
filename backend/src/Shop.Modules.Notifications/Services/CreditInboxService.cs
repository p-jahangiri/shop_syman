using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;
namespace Shop.Modules.Notifications;

public sealed class CreditInboxWriter(NotificationsDbContext db,ICreditInboxProtection protection,IPrivateRealtimeEvents realtime,
    ISmsBusinessQueue? sms = null, ISmsOrderFactsReader? orderFacts = null):ICreditReminderNotificationWriter
{
    internal static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web){UnmappedMemberHandling=System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow};
    internal static string Hash(string value)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    internal static CreditReminderNotificationEvent Open(CreditInboxNotification row,ICreditInboxProtection protection)
    {
        try{var raw=protection.Unprotect(row.OwnerId,row.Id,row.ProtectedPayload);if(Hash(raw)!=row.PayloadHash)throw NotificationRules.Unavailable();var v=JsonSerializer.Deserialize<CreditReminderNotificationEvent>(raw,Json)??throw NotificationRules.Unavailable();CreditInboxRules.Validate(v);if(v.Id!=row.Id||v.OwnerId!=row.OwnerId||v.OrderId!=row.OrderId||v.ChequeId!=row.ChequeId||v.At!=row.At)throw NotificationRules.Unavailable();return v;}catch(Exception e)when(e is JsonException or BusinessException){throw NotificationRules.Unavailable();}
    }
    public async Task RecordAsync(CreditReminderNotificationEvent value,CancellationToken ct)
    {
        if(db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel!=IsolationLevel.Serializable)throw new InvalidOperationException("Credit notifications require the shared audited Serializable transaction.");CreditInboxRules.Validate(value);var raw=JsonSerializer.Serialize(value,Json);var previous=await db.CreditInbox.AsNoTracking().SingleOrDefaultAsync(x=>x.Id==value.Id,ct);
        if(previous is not null){if(Open(previous,protection)!=value)throw NotificationRules.Unavailable();return;}
        db.CreditInbox.Add(new(){Id=value.Id,OwnerId=value.OwnerId,OrderId=value.OrderId,ChequeId=value.ChequeId,At=value.At,PayloadHash=Hash(raw),ProtectedPayload=protection.Protect(value.OwnerId,value.Id,raw)});await db.SaveChangesAsync(ct);
        if (sms is not null && orderFacts is not null) {
            var order = await orderFacts.ReadAsync(value.OrderId, ct);
            if (order is null || !order.OwnerId.Equals(value.OwnerId, StringComparison.OrdinalIgnoreCase)) throw NotificationRules.Unavailable();
            await sms.EnqueueAsync(new("credit", value.Id, "chequeReminder", value.OwnerId, value.At,
                new Dictionary<string, string>(StringComparer.Ordinal) { ["dueDate"] = SmsWorkspaceRules.PersianDueDate(value.DueDate),
                    ["amountRial"] = value.AmountRial, ["orderNumber"] = order.Reference }, order.ContainsDemo), ct);
        }
        realtime.InboxChanged(value.OwnerId);
    }
}
public sealed class CreditInboxService(NotificationsDbContext db,ICreditInboxProtection protection,TimeProvider clock,IPrivateRealtimeEvents realtime)
{
    // A separate cursor scope preserves the support inbox contract and prevents reuse across feeds.
    private static string ScopeOwner(string owner)=>"CREDIT_"+Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(NotificationRules.Owner(owner))))[..48];
    private CreditInboxData Data(CreditInboxNotification row)
    {
        var v=CreditInboxWriter.Open(row,protection);if(row.Sequence<=0||row.ReadAt is{}at&&(at.Offset!=TimeSpan.Zero||at<row.At))throw NotificationRules.Unavailable();return new(row.Id,row.Sequence.ToString(CultureInfo.InvariantCulture),v.OrderId,v.ChequeId,v.DueDate,v.AmountRial,v.CivilDay,v.At,row.ReadAt);
    }
    public async Task<CreditInboxPage> PageAsync(string owner,bool unreadOnly,string? cursor,CancellationToken ct)
    {
        owner=NotificationRules.Owner(owner);var before=NotificationRules.Before(cursor,ScopeOwner(owner),unreadOnly);var query=db.CreditInbox.AsNoTracking().Where(x=>x.OwnerId==owner&&x.Sequence<before);if(unreadOnly)query=query.Where(x=>x.ReadAt==null);var rows=await query.OrderByDescending(x=>x.Sequence).Take(51).ToArrayAsync(ct);var selected=rows.Take(50).ToArray();return new(1,unreadOnly,selected.Select(Data).ToArray(),rows.Length>50?NotificationRules.Cursor(selected[^1].Sequence,ScopeOwner(owner),unreadOnly):null);
    }
    public async Task<NotificationCount> CountAsync(string owner,CancellationToken ct){owner=NotificationRules.Owner(owner);return new(1,(await db.CreditInbox.LongCountAsync(x=>x.OwnerId==owner&&x.ReadAt==null,ct)).ToString(CultureInfo.InvariantCulture));}
    public async Task<CreditInboxReadResult> ReadAsync(string owner,string id,CancellationToken ct)
    {
        owner=NotificationRules.Owner(owner);NotificationRules.Id(id);await using var tx=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable,ct);
        var row=await db.CreditInbox.FromSqlInterpolated($"SELECT * FROM [notifications].[CreditInbox] WITH (UPDLOCK,HOLDLOCK) WHERE [OwnerId]={owner} AND [Id]={id}").AsNoTracking().SingleOrDefaultAsync(ct)??throw new BusinessException("not_found","Notification was not found.");Data(row);var now=clock.GetUtcNow().ToUniversalTime();var count=await db.CreditInbox.Where(x=>x.OwnerId==owner&&x.Id==id&&x.ReadAt==null).ExecuteUpdateAsync(s=>s.SetProperty(x=>x.ReadAt,x=>now<x.At?x.At:now),ct);var current=await db.CreditInbox.AsNoTracking().SingleOrDefaultAsync(x=>x.OwnerId==owner&&x.Id==id,ct)??throw NotificationRules.Unavailable();var result=Data(current);if(result.ReadAt is null)throw NotificationRules.Unavailable();await tx.CommitAsync(ct);if(count>0)realtime.InboxChanged(owner);return new(1,result);
    }
}
