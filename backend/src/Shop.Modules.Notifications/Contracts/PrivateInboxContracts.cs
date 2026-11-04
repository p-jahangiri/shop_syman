using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Serialization;
using Shop.SharedKernel;
namespace Shop.Modules.Notifications;
public sealed record NotificationData(string Id,string Sequence,string TicketId,string Kind,DateTimeOffset At,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]DateTimeOffset? ReadAt);
public sealed record NotificationPage(int SchemaVersion,bool UnreadOnly,NotificationData[] Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? NextCursor);
public sealed record NotificationCount(int SchemaVersion,string UnreadCount);
public sealed record NotificationReadResult(int SchemaVersion,NotificationData Notification);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]public sealed record MarkNotificationReadInput;
public static class NotificationRules
{
    public static readonly string[] Kinds=["support_reply","support_closed","support_reopened"];
    public static BusinessException Invalid()=>new("invalid_notification","Notification id, owner or cursor is invalid.");
    public static BusinessException Unavailable()=>new("notification_unavailable","The private notification could not be read safely.");
    public static string Id(string value){if(value is null||!Guid.TryParseExact(value,"N",out var id)||id==Guid.Empty||value!=id.ToString("N"))throw Invalid();return value;}
    public static string Owner(string value){if(string.IsNullOrWhiteSpace(value)||value.Length>64||value!=value.Trim()||value.Any(c=>!char.IsAsciiLetterOrDigit(c)&&c is not ('-'or'_')))throw Invalid();return value.ToUpperInvariant();}
    private static string Scope(string owner,bool unread)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("notifications|"+Owner(owner)+"|"+(unread?"unread":"all"))));
    public static string Cursor(long before,string owner,bool unread){if(before<=0)throw Invalid();return Convert.ToBase64String(Encoding.UTF8.GetBytes("1:"+Scope(owner,unread)+":"+before.ToString(CultureInfo.InvariantCulture)));}
    public static long Before(string? cursor,string owner,bool unread)
    {
        _=Owner(owner);if(cursor is null)return long.MaxValue;try{if(cursor.Length>180)throw Invalid();var bytes=Convert.FromBase64String(cursor);if(Convert.ToBase64String(bytes)!=cursor)throw Invalid();var parts=new UTF8Encoding(false,true).GetString(bytes).Split(':');if(parts.Length!=3||parts[0]!="1"||parts[1]!=Scope(owner,unread)||!long.TryParse(parts[2],NumberStyles.None,CultureInfo.InvariantCulture,out var value)||value<=0||parts[2]!=value.ToString(CultureInfo.InvariantCulture))throw Invalid();return value;}catch(Exception e)when(e is FormatException or DecoderFallbackException){throw Invalid();}
    }
}
