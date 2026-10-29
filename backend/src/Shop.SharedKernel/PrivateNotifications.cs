namespace Shop.SharedKernel;
// Support owns the event; Notifications owns the private inbox. No message text is copied.
public sealed record SupportNotificationEvent(string OwnerId,string TicketId,long EventSequence,string Kind,DateTimeOffset At);
public interface IPrivateNotificationWriter
{
    Task RecordSupportAsync(SupportNotificationEvent value,CancellationToken ct);
}
