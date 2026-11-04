using System.Data;
using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;
namespace Shop.Modules.Notifications;
public sealed class PrivateNotificationWriter(NotificationsDbContext db,IPrivateRealtimeEvents realtime):IPrivateNotificationWriter
{
    public async Task RecordSupportAsync(SupportNotificationEvent value,CancellationToken ct)
    {
        if(db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel!=IsolationLevel.Serializable)throw new InvalidOperationException("Notification writes require the root shared Serializable transaction.");
        var owner=NotificationRules.Owner(value.OwnerId);NotificationRules.Id(value.TicketId);if(value.EventSequence<=0||!NotificationRules.Kinds.Contains(value.Kind,StringComparer.Ordinal)||value.At.Offset!=TimeSpan.Zero)throw NotificationRules.Invalid();
        var previous=await db.Inbox.AsNoTracking().SingleOrDefaultAsync(x=>x.OwnerId==owner&&x.TicketId==value.TicketId&&x.EventSequence==value.EventSequence,ct);
        if(previous is not null){if(previous.Kind!=value.Kind||previous.At!=value.At)throw NotificationRules.Unavailable();return;}
        db.Inbox.Add(new(){OwnerId=owner,TicketId=value.TicketId,EventSequence=value.EventSequence,Kind=value.Kind,At=value.At});await db.SaveChangesAsync(ct);realtime.InboxChanged(owner);
    }
}
public sealed class PrivateInboxService(NotificationsDbContext db,TimeProvider time,IPrivateRealtimeEvents realtime)
{
    private static BusinessException Missing()=>new("not_found","Notification was not found.");
    public async Task<NotificationPage> PageAsync(string owner,bool unreadOnly,string? cursor,CancellationToken ct)
    {
        owner=NotificationRules.Owner(owner);var before=NotificationRules.Before(cursor,owner,unreadOnly);var q=db.Inbox.AsNoTracking().Where(x=>x.OwnerId==owner&&x.Sequence<before);if(unreadOnly)q=q.Where(x=>x.ReadAt==null);
        var rows=await q.OrderByDescending(x=>x.Sequence).Take(51).ToArrayAsync(ct);var selected=rows.Take(50).ToArray();return new(1,unreadOnly,selected.Select(Data).ToArray(),rows.Length>50?NotificationRules.Cursor(selected[^1].Sequence,owner,unreadOnly):null);
    }
    public async Task<NotificationCount> CountAsync(string owner,CancellationToken ct){owner=NotificationRules.Owner(owner);return new(1,(await db.Inbox.LongCountAsync(x=>x.OwnerId==owner&&x.ReadAt==null,ct)).ToString(CultureInfo.InvariantCulture));}
    public async Task<NotificationReadResult> ReadAsync(string owner,string id,CancellationToken ct)
    {
        owner=NotificationRules.Owner(owner);NotificationRules.Id(id);var at=time.GetUtcNow().ToUniversalTime();
        // One monotone SQL update: concurrent retries preserve the first timestamp. Clock rollback cannot precede creation.
        var changed=await db.Inbox.Where(x=>x.OwnerId==owner&&x.Id==id&&x.ReadAt==null).ExecuteUpdateAsync(s=>s.SetProperty(x=>x.ReadAt,x=>at<x.At?x.At:at),ct);if(changed>0)realtime.InboxChanged(owner);
        var row=await db.Inbox.AsNoTracking().SingleOrDefaultAsync(x=>x.OwnerId==owner&&x.Id==id,ct)??throw Missing();if(row.ReadAt is null)throw NotificationRules.Unavailable();return new(1,Data(row));
    }
    private static NotificationData Data(InboxNotification row)
    {
        try{NotificationRules.Id(row.Id);NotificationRules.Id(row.TicketId);if(row.Sequence<=0||row.EventSequence<=0||!NotificationRules.Kinds.Contains(row.Kind,StringComparer.Ordinal)||row.At.Offset!=TimeSpan.Zero||row.ReadAt is{}read&&(read.Offset!=TimeSpan.Zero||read<row.At))throw NotificationRules.Unavailable();return new(row.Id,row.Sequence.ToString(CultureInfo.InvariantCulture),row.TicketId,row.Kind,row.At,row.ReadAt);}catch(BusinessException){throw NotificationRules.Unavailable();}
    }
}
