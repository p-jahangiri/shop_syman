namespace Shop.SharedKernel;

// Credit supplies only retained cheque facts; Notifications owns encrypted inbox data.
// No instrument reference, financial note, actor or customer contact crosses this boundary.
public sealed record CreditReminderNotificationEvent(string Id,string OwnerId,string OrderId,string ChequeId,string DueDate,string AmountRial,string CivilDay,DateTimeOffset At);
public interface ICreditReminderNotificationWriter
{
    Task RecordAsync(CreditReminderNotificationEvent value,CancellationToken ct);
}
