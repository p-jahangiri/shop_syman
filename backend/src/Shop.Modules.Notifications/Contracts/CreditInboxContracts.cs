using System.Globalization;
using System.Text.Json.Serialization;
using Shop.SharedKernel;
namespace Shop.Modules.Notifications;

public sealed record CreditInboxData(string Id,string Sequence,string OrderId,string ChequeId,string DueDate,string AmountRial,string CivilDay,DateTimeOffset At,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]DateTimeOffset? ReadAt);
public sealed record CreditInboxPage(int SchemaVersion,bool UnreadOnly,CreditInboxData[] Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? NextCursor);
public sealed record CreditInboxReadResult(int SchemaVersion,CreditInboxData Notification);
public interface ICreditInboxProtection
{
    byte[] Protect(string owner,string id,string text);
    string Unprotect(string owner,string id,byte[] value);
}
public static class CreditInboxRules
{
    public static void Validate(CreditReminderNotificationEvent value)
    {
        if(value is null)throw NotificationRules.Invalid();foreach(var id in new[]{value.Id,value.OrderId,value.ChequeId})NotificationRules.Id(id);if(value.OwnerId!=NotificationRules.Owner(value.OwnerId)||value.At.Offset!=TimeSpan.Zero)throw NotificationRules.Invalid();
        DateOnly Date(string v){if(v is null||!DateOnly.TryParseExact(v,"yyyy-MM-dd",CultureInfo.InvariantCulture,DateTimeStyles.None,out var date)||date.Year<2000||date.ToString("yyyy-MM-dd",CultureInfo.InvariantCulture)!=v)throw NotificationRules.Invalid();return date;}
        Date(value.DueDate);var civil=Date(value.CivilDay);if(civil!=DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(value.At,TimeZoneInfo.FindSystemTimeZoneById("Asia/Tehran")).DateTime)||!long.TryParse(value.AmountRial,NumberStyles.None,CultureInfo.InvariantCulture,out var amount)||amount<=0||amount.ToString(CultureInfo.InvariantCulture)!=value.AmountRial)throw NotificationRules.Invalid();
    }
}
