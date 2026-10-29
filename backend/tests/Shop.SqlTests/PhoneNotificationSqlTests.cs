using System.Data;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Identity;
using Shop.Modules.Notifications;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;

public sealed class PhoneNotificationSqlTests(SqlFixture fixture):IClassFixture<SqlFixture>
{
    private static string Id()=>Guid.NewGuid().ToString("N");
    private static PhoneDiscoveryNotificationEvent Event(string owner,bool quote=false)=>new(Id(),owner,quote?"sourcing_offer_published":"phone_available",Id(),Id(),quote?Id():null,quote?Id():null,quote?null:"galaxy-a56-5g",quote?null:"qa-variant-256-black",DateTimeOffset.UtcNow);
    private async Task<(HttpClient Client,string Owner)> Customer()
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var users=scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>();var name="phoneinbox"+Id();
        var user=new ShopUser{UserName=name,Email=name+"@example.test",EmailConfirmed=true,DisplayName="Private phone notification QA"};Assert.True((await users.CreateAsync(user,fixture.Password)).Succeeded);
        var session=await scope.ServiceProvider.GetRequiredService<AuthService>().PasswordAsync(new(name,fixture.Password),true,true,false,default);
        var client=fixture.Factory.CreateClient(new(){HandleCookies=false});client.DefaultRequestHeaders.Add("Origin","http://127.0.0.1:3000");client.DefaultRequestHeaders.Authorization=new("Bearer",session.AccessToken);return(client,user.Id);
    }
    private async Task Record(params PhoneDiscoveryNotificationEvent[] values)
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<NotificationsDbContext>();var writer=scope.ServiceProvider.GetRequiredService<IPhoneDiscoveryNotificationWriter>();
        await using var transaction=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);foreach(var value in values)await writer.RecordAsync(value,default);await transaction.CommitAsync();
    }
    private static async Task<JsonNode> Body(HttpResponseMessage response,string? capture=null)
    {
        using(response){var raw=await response.Content.ReadAsStringAsync();Assert.True(response.IsSuccessStatusCode,$"{response.StatusCode}: {raw}");Assert.Contains("no-store",response.Headers.CacheControl!.ToString());
            if(capture is not null&&Environment.GetEnvironmentVariable("SHOP_PHONE_NOTIFICATION_WIRE_DIR")is{Length:>0}directory){Directory.CreateDirectory(directory);await File.WriteAllTextAsync(Path.Combine(directory,capture+".json"),raw);await File.WriteAllTextAsync(Path.Combine(directory,capture+".meta.json"),System.Text.Json.JsonSerializer.Serialize(new{method=response.RequestMessage!.Method.Method,path=response.RequestMessage.RequestUri!.PathAndQuery,status=(int)response.StatusCode,actualSqlHttpResponse=true,syntheticQaOnly=true,cacheControl=response.Headers.CacheControl.ToString()}));}
            return JsonNode.Parse(raw)!;}
    }
    private static string Value(JsonNode row,string key)=>row[key]!.GetValue<string>();

    [Fact]public async Task BothPhoneEventKindsAreOwnerBoundEncryptedAndIndependentFromSupportAndCreditFeeds()
    {
        var person=await Customer();using var client=person.Client;var available=Event(person.Owner);var quote=Event(person.Owner,true);await Record(available,quote);
        var page=await Body(await client.GetAsync("/api/notifications/phones"),"all");var items=page["items"]!.AsArray();Assert.Equal(2,items.Count);Assert.Equal(new[]{"sourcing_offer_published","phone_available"},items.Select(item=>Value(item!,"kind")));
        Assert.Equal(quote.RequestId,Value(items[0]!,"requestId"));Assert.Equal(quote.OfferId,Value(items[0]!,"offerId"));Assert.Null(items[0]!["storeSlug"]);Assert.Equal(available.StoreSlug,Value(items[1]!,"storeSlug"));Assert.Null(items[1]!["requestId"]);Assert.Null(page["nextCursor"]);
        Assert.Equal("2",Value(await Body(await client.GetAsync("/api/notifications/phones/unread-count"),"count"),"unreadCount"));
        Assert.Empty((await Body(await client.GetAsync("/api/notifications")))["items"]!.AsArray());Assert.Empty((await Body(await client.GetAsync("/api/notifications/credit-reminders")))["items"]!.AsArray());
        foreach(var field in new[]{"ownerId","source","referencePriceRial","priceRial","phoneNumber","email","protectedPayload","payloadHash","ticketId"})Assert.DoesNotContain('"'+field+'"',page.ToJsonString(),StringComparison.OrdinalIgnoreCase);
        var other=await Customer();using var foreign=other.Client;Assert.Empty((await Body(await foreign.GetAsync("/api/notifications/phones"),"other-owner"))["items"]!.AsArray());
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<NotificationsDbContext>();var stored=await db.PhoneInbox.AsNoTracking().SingleAsync(row=>row.Id==quote.Id);Assert.Equal(NotificationRules.Owner(person.Owner),stored.OwnerId);Assert.DoesNotContain(quote.RequestId!,Encoding.UTF8.GetString(stored.ProtectedPayload),StringComparison.Ordinal);Assert.DoesNotContain(quote.OfferId!,Encoding.UTF8.GetString(stored.ProtectedPayload),StringComparison.Ordinal);
    }

    [Fact]public async Task WriterRequiresSerializableTransactionAndReplaysOnlyTheSameCanonicalOwnerAndPayload()
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<NotificationsDbContext>();var writer=scope.ServiceProvider.GetRequiredService<IPhoneDiscoveryNotificationWriter>();var value=Event("owner-"+Id());
        await Assert.ThrowsAsync<InvalidOperationException>(()=>writer.RecordAsync(value,default));
        await using(var wrong=await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted)){await Assert.ThrowsAsync<InvalidOperationException>(()=>writer.RecordAsync(value,default));await wrong.RollbackAsync();}
        await using var transaction=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);await writer.RecordAsync(value,default);await writer.RecordAsync(value with{OwnerId=value.OwnerId.ToUpperInvariant()},default);
        Assert.Equal("notification_unavailable",(await Assert.ThrowsAsync<BusinessException>(()=>writer.RecordAsync(value with{At=value.At.AddTicks(1)},default))).Code);
        Assert.Equal("notification_unavailable",(await Assert.ThrowsAsync<BusinessException>(()=>writer.RecordAsync(value with{OwnerId="OTHER"},default))).Code);
        await transaction.CommitAsync();Assert.Single(await db.PhoneInbox.AsNoTracking().Where(row=>row.Id==value.Id).ToArrayAsync());
        var pulses=scope.ServiceProvider.GetRequiredService<PrivateRealtimeQueue>().Drain();Assert.Single(pulses);Assert.Equal("notifications",pulses[0].Scope);Assert.Equal(PrivateRealtimeQueue.AccountGroup(value.OwnerId),pulses[0].Group);
    }

    [Fact]public async Task ASharedTransactionRollbackLeavesNoPhoneNoticeAndTheSameEventCanBeRetriedOnce()
    {
        var value=Event("rollback-"+Id());
        await using(var scope=fixture.Factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<NotificationsDbContext>();await using var transaction=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);await scope.ServiceProvider.GetRequiredService<IPhoneDiscoveryNotificationWriter>().RecordAsync(value,default);await transaction.RollbackAsync();}
        await using(var scope=fixture.Factory.Services.CreateAsyncScope())Assert.False(await scope.ServiceProvider.GetRequiredService<NotificationsDbContext>().PhoneInbox.AnyAsync(row=>row.Id==value.Id));
        await Record(value,value);await using var final=fixture.Factory.Services.CreateAsyncScope();Assert.Equal(1,await final.ServiceProvider.GetRequiredService<NotificationsDbContext>().PhoneInbox.CountAsync(row=>row.Id==value.Id));
    }

    [Fact]public async Task ConcurrentReadAcknowledgementsStayMonotoneAndCannotAcknowledgeAnotherAccount()
    {
        var person=await Customer();using var client=person.Client;var value=Event(person.Owner);await Record(value);var path="/api/notifications/phones/"+value.Id+"/read";
        var other=await Customer();using var foreign=other.Client;using(var denied=await foreign.PutAsJsonAsync(path,new{}))Assert.Equal(HttpStatusCode.NotFound,denied.StatusCode);
        var responses=await Task.WhenAll(client.PutAsJsonAsync(path,new{}),client.PutAsJsonAsync(path,new{}));var first=await Body(responses[0],"read");var second=await Body(responses[1],"read-concurrent");Assert.Equal(first.ToJsonString(),second.ToJsonString());Assert.NotNull(first["notification"]!["readAt"]);
        Assert.Equal(first.ToJsonString(),(await Body(await client.PutAsJsonAsync(path,new{}),"read-repeat")).ToJsonString());Assert.Equal("0",Value(await Body(await client.GetAsync("/api/notifications/phones/unread-count"),"count-after-read"),"unreadCount"));Assert.Empty((await Body(await client.GetAsync("/api/notifications/phones?unreadOnly=true"),"unread-after-read"))["items"]!.AsArray());
    }

    [Fact]public async Task PhoneSeekPagesBindOwnerUnreadAndFamilyWithoutRoundingSequenceIdentifiers()
    {
        var owner="paging-"+Id();var events=Enumerable.Range(0,53).Select(_=>Event(owner)).ToArray();await Record(events);
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var service=scope.ServiceProvider.GetRequiredService<PhoneInboxService>();var first=await service.PageAsync(owner,false,null,default);Assert.Equal(50,first.Items.Length);Assert.NotNull(first.NextCursor);var second=await service.PageAsync(owner,false,first.NextCursor,default);Assert.Equal(3,second.Items.Length);Assert.Null(second.NextCursor);Assert.Equal(53,first.Items.Concat(second.Items).Select(item=>item.Id).Distinct().Count());
        Assert.True(first.Items.Zip(first.Items.Skip(1)).All(pair=>long.Parse(pair.First.Sequence)>long.Parse(pair.Second.Sequence)));Assert.Equal("53",(await service.CountAsync(owner,default)).UnreadCount);
        foreach(var invalid in new Func<Task>[] {()=>service.PageAsync(owner,true,first.NextCursor,default),()=>service.PageAsync("OTHER",false,first.NextCursor,default),()=>service.PageAsync(owner,false,NotificationRules.Cursor(1000,owner,false),default),()=>scope.ServiceProvider.GetRequiredService<PrivateInboxService>().PageAsync(owner,false,first.NextCursor,default)})
            Assert.Equal("invalid_notification",(await Assert.ThrowsAsync<BusinessException>(invalid)).Code);
    }

    [Fact]public async Task CorruptPhonePayloadFailsClosedBeforeReadAcknowledgement()
    {
        var owner="corrupt-"+Id();var value=Event(owner,true);await Record(value);
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<NotificationsDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE [notifications].[PhoneInbox] SET [PayloadHash]={new string('A',64)} WHERE [Id]={value.Id}");var service=scope.ServiceProvider.GetRequiredService<PhoneInboxService>();
        Assert.Equal("notification_unavailable",(await Assert.ThrowsAsync<BusinessException>(()=>service.PageAsync(owner,false,null,default))).Code);Assert.Equal("notification_unavailable",(await Assert.ThrowsAsync<BusinessException>(()=>service.ReadAsync(owner,value.Id,default))).Code);Assert.Null((await db.PhoneInbox.AsNoTracking().SingleAsync(row=>row.Id==value.Id)).ReadAt);
    }

    [Fact]public async Task PhoneHistoryCannotChangeOrBecomeUnreadAndClockRollbackClampsTheFirstRead()
    {
        var owner="immutable-"+Id();var value=Event(owner);await Record(value);
        for(var method=0;method<4;method++)foreach(var mode in new[]{"owner","source","delete"}){
            await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<NotificationsDbContext>();var row=await db.PhoneInbox.SingleAsync(item=>item.Id==value.Id);
            if(mode=="owner")row.OwnerId="OTHER";else if(mode=="source")row.ConfigurationId=Id();else db.PhoneInbox.Remove(row);
            Assert.Equal("notification_history_immutable",(await Assert.ThrowsAsync<BusinessException>(async()=>{switch(method){case 0:db.SaveChanges();break;case 1:db.SaveChanges(false);break;case 2:await db.SaveChangesAsync();break;case 3:await db.SaveChangesAsync(false);break;}})).Code);
        }
        await using var final=fixture.Factory.Services.CreateAsyncScope();var context=final.ServiceProvider.GetRequiredService<NotificationsDbContext>();var service=new PhoneInboxService(context,final.ServiceProvider.GetRequiredService<IPhoneInboxProtection>(),new FixedTime(value.At.AddYears(-1)),final.ServiceProvider.GetRequiredService<IPrivateRealtimeEvents>());
        Assert.Equal(value.At,(await service.ReadAsync(owner,value.Id,default)).Notification.ReadAt);var current=await context.PhoneInbox.SingleAsync(item=>item.Id==value.Id);current.ReadAt=null;Assert.Equal("notification_history_immutable",(await Assert.ThrowsAsync<BusinessException>(()=>context.SaveChangesAsync())).Code);
    }

    [Fact]public async Task PrivatePhoneEndpointsRejectGuestForgedOwnerUnknownQueryAndForeignOrigin()
    {
        using var guest=fixture.Factory.CreateClient(new(){HandleCookies=false});using(var anonymous=await guest.GetAsync("/api/notifications/phones")){Assert.Equal(HttpStatusCode.Unauthorized,anonymous.StatusCode);Assert.Contains("no-store",anonymous.Headers.CacheControl!.ToString());Assert.Contains("noindex",string.Join(',',anonymous.Headers.GetValues("X-Robots-Tag")));}
        var person=await Customer();using var client=person.Client;var value=Event(person.Owner);await Record(value);var path="/api/notifications/phones/"+value.Id+"/read";
        using(var forged=await client.PutAsJsonAsync(path,new{OwnerId=person.Owner}))Assert.Equal(HttpStatusCode.BadRequest,forged.StatusCode);
        foreach(var suffix in new[]{"?owner=other","?unreadOnly=1","?unreadOnly=true&unreadOnly=false","?cursor=invalid","?cursor=","?limit=50"}){using var bad=await client.GetAsync("/api/notifications/phones"+suffix);Assert.Equal(HttpStatusCode.BadRequest,bad.StatusCode);}
        using(var bad=await client.GetAsync("/api/notifications/phones/unread-count?cursor=invalid"))Assert.Equal(HttpStatusCode.BadRequest,bad.StatusCode);
        client.DefaultRequestHeaders.Remove("Origin");client.DefaultRequestHeaders.Add("Origin","https://foreign.invalid");using(var denied=await client.PutAsJsonAsync(path,new{}))Assert.Equal(HttpStatusCode.Forbidden,denied.StatusCode);using(var denied=await client.GetAsync("/api/notifications/phones"))Assert.Equal(HttpStatusCode.Forbidden,denied.StatusCode);
    }

    [Fact]public async Task DowngradeCannotDiscardAnExistingPhoneNotification()
    {
        var value=Event("downgrade-"+Id());await Record(value);await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<NotificationsDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);
        var error=await Assert.ThrowsAsync<Microsoft.Data.SqlClient.SqlException>(()=>db.GetService<IMigrator>().MigrateAsync("20261028010957_PrivateCreditReminderInbox"));Assert.Equal(51000,error.Number);Assert.True(await db.PhoneInbox.AnyAsync(row=>row.Id==value.Id));
    }

    private sealed class FixedTime(DateTimeOffset at):TimeProvider{public override DateTimeOffset GetUtcNow()=>at;}
}
