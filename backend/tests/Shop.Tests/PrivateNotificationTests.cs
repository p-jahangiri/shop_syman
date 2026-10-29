using System.Text.Json;
using Shop.Modules.Notifications;
using Shop.SharedKernel;
using Xunit;
namespace Shop.Tests;
public sealed class PrivateNotificationTests
{
    [Fact]public void CursorIsCanonicalAndBoundToOwnerAndUnreadFilterAtInt64Precision(){var cursor=NotificationRules.Cursor(9007199254740993,"owner-a",true);Assert.Equal(9007199254740993,NotificationRules.Before(cursor,"OWNER-A",true));Assert.Equal(long.MaxValue,NotificationRules.Before(null,"OWNER-A",false));foreach(var(owner,unread)in new[]{("OWNER-B",true),("OWNER-A",false)})Assert.Throws<BusinessException>(()=>NotificationRules.Before(cursor,owner,unread));foreach(var bad in new[]{"","invalid",cursor+" ",Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes("1:"+new string('A',64)+":01"))})Assert.Throws<BusinessException>(()=>NotificationRules.Before(bad,"OWNER-A",true));}
    [Theory][InlineData("")][InlineData(" owner")][InlineData("owner/other")][InlineData("ا")]
    public void OwnersMustBeBoundedAsciiAccountIdentifiers(string value)=>Assert.Throws<BusinessException>(()=>NotificationRules.Owner(value));
    [Fact]public void PublicSerializationKeepsNullReadStateAndDecimalSequenceWithoutOwnerOrSource(){var value=new NotificationData(new string('a',32),"9007199254740993",new string('b',32),"support_reply",DateTimeOffset.UnixEpoch,null);var raw=JsonSerializer.Serialize(new NotificationPage(1,false,[value],null),new JsonSerializerOptions(JsonSerializerDefaults.Web){DefaultIgnoreCondition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull});Assert.Contains("\"sequence\":\"9007199254740993\"",raw);Assert.Contains("\"readAt\":null",raw);Assert.Contains("\"nextCursor\":null",raw);foreach(var key in new[]{"ownerId","eventSequence","body","subject"})Assert.DoesNotContain(key,raw);}
}
