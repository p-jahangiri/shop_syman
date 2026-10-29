using System.Data;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.AspNetCore.Identity;
using Shop.Modules.Identity;
using Shop.Modules.Notifications;
using Shop.Modules.Support;
using Shop.SharedKernel;
using Xunit;
namespace Shop.SqlTests;
public sealed class PrivateNotificationSqlTests(SqlFixture fixture):IClassFixture<SqlFixture>
{
    private static string Id() => Guid.NewGuid().ToString("N");
    private static CreateTicketInput Input() => new("درخواست خصوصی نمونهٔ SQL", "متن نمونهٔ پشتیبانی؛ <b>همچنان متن ساده</b>", "fa");
    private async Task<(HttpClient Client, string Owner)> Customer()
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var users = scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>(); var name = "ticket"+Id();
        var user = new ShopUser { UserName=name, Email=name+"@example.test", EmailConfirmed=true, DisplayName="Private customer name" }; Assert.True((await users.CreateAsync(user,fixture.Password)).Succeeded);
        var session = await scope.ServiceProvider.GetRequiredService<AuthService>().PasswordAsync(new(name,fixture.Password),true,true,false,default); var client=fixture.Factory.CreateClient(new(){HandleCookies=false});client.DefaultRequestHeaders.Add("Origin","http://127.0.0.1:3000");client.DefaultRequestHeaders.Authorization=new("Bearer",session.AccessToken);return(client,user.Id);
    }
    private async Task<HttpClient> Staff(string role="SupportAgent")
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var users=scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>();var name="ticketstaff"+Id();var user=new ShopUser{UserName=name,Email=name+"@example.test",EmailConfirmed=true,RequireMfa=true};Assert.True((await users.CreateAsync(user,fixture.Password)).Succeeded);Assert.True((await users.AddToRoleAsync(user,role)).Succeeded);
        var c=fixture.Factory.CreateClient(new(){HandleCookies=false});c.DefaultRequestHeaders.Add("Origin","http://127.0.0.1:3173");c.DefaultRequestHeaders.Add("X-Sayman-Client","admin");c.DefaultRequestHeaders.Add("X-Sayman-Admin","1");
        var pending=await Body(await c.PostAsJsonAsync("/api/auth/password",new{Identifier=name,Password=fixture.Password}));c.DefaultRequestHeaders.Authorization=new("Bearer",pending["accessToken"]!.GetValue<string>());
        using(var denied=await c.GetAsync("/api/admin/support/tickets"))Assert.Equal(HttpStatusCode.Forbidden,denied.StatusCode);
        var setup=await Body(await c.PostAsJsonAsync("/api/auth/mfa/setup",new{}));c.DefaultRequestHeaders.Authorization=new("Bearer",setup["accessToken"]!.GetValue<string>());var signed=await Body(await c.PostAsJsonAsync("/api/auth/mfa/verify",new{Code=Totp.Code(setup["secret"]!.GetValue<string>(),DateTimeOffset.UtcNow.ToUnixTimeSeconds()/30)}));c.DefaultRequestHeaders.Authorization=new("Bearer",signed["accessToken"]!.GetValue<string>());return c;
    }
    private static async Task<JsonNode> Body(HttpResponseMessage response,string? capture=null)
    {
        using(response){var raw=await response.Content.ReadAsStringAsync();Assert.True(response.IsSuccessStatusCode,$"{response.StatusCode}: {raw}");Assert.Contains("no-store",response.Headers.CacheControl!.ToString());if(capture is not null&&Environment.GetEnvironmentVariable("SHOP_TICKET_WIRE_DIR") is {Length:>0} dir){Directory.CreateDirectory(dir);await File.WriteAllTextAsync(Path.Combine(dir,capture+".json"),raw);await File.WriteAllTextAsync(Path.Combine(dir,capture+".meta.json"),System.Text.Json.JsonSerializer.Serialize(new{method=response.RequestMessage!.Method.Method,path=response.RequestMessage.RequestUri!.PathAndQuery,status=(int)response.StatusCode,actualSqlHttpResponse=true,syntheticQaOnly=true,cacheControl=response.Headers.CacheControl.ToString()}));}return JsonNode.Parse(raw)!;}
    }
    private static string Value(JsonNode row,string key)=>row[key]!.GetValue<string>();
    private static string Version(JsonNode result)=>Value(result["ticket"]!,"version");
    private static async Task<JsonNode> NoticeBody(HttpResponseMessage response,string? capture=null)
    {
        using(response){var raw=await response.Content.ReadAsStringAsync();Assert.True(response.IsSuccessStatusCode,$"{response.StatusCode}: {raw}");Assert.Contains("no-store",response.Headers.CacheControl!.ToString());if(capture is not null&&Environment.GetEnvironmentVariable("SHOP_NOTIFICATION_WIRE_DIR")is{Length:>0}dir){Directory.CreateDirectory(dir);await File.WriteAllTextAsync(Path.Combine(dir,capture+".json"),raw);await File.WriteAllTextAsync(Path.Combine(dir,capture+".meta.json"),System.Text.Json.JsonSerializer.Serialize(new{method=response.RequestMessage!.Method.Method,path=response.RequestMessage.RequestUri!.PathAndQuery,status=(int)response.StatusCode,actualSqlHttpResponse=true,syntheticQaOnly=true,cacheControl=response.Headers.CacheControl.ToString()}));}return JsonNode.Parse(raw)!;}
    }
    [Fact]public async Task StaffEventsCreateExactlyOnePrivateNoticeEachWhileCustomerActionsAndReplaysDoNot()
    {
        var person=await Customer();using var c=person.Client;using var staff=await Staff();var created=await Body(await c.PostAsJsonAsync("/api/support/tickets/commands/"+Id(),Input()));string ticket=Value(created["ticket"]!,"id"),command=Id(),path=$"/api/admin/support/tickets/{ticket}/replies/{command}";var input=new ReplyTicketInput(Version(created),"پاسخ نمونهٔ اعلان خصوصی","fa");var reply=await Body(await staff.PostAsJsonAsync(path,input));await Body(await staff.PostAsJsonAsync(path,input));var closed=await Body(await staff.PutAsJsonAsync($"/api/admin/support/tickets/{ticket}/state/{Id()}",new ChangeTicketStateInput(Version(reply),"Closed")));var reopened=await Body(await staff.PutAsJsonAsync($"/api/admin/support/tickets/{ticket}/state/{Id()}",new ChangeTicketStateInput(Version(closed),"Open")));await Body(await c.PostAsJsonAsync($"/api/support/tickets/{ticket}/replies/{Id()}",new ReplyTicketInput(Version(reopened),"Thanks; customer actions do not notify themselves.","en")));
        var page=await NoticeBody(await c.GetAsync("/api/notifications"),"all");Assert.Equal(new[]{"support_reopened","support_closed","support_reply"},page["items"]!.AsArray().Select(x=>Value(x!,"kind")));Assert.All(page["items"]!.AsArray(),x=>{Assert.Equal(ticket,Value(x!,"ticketId"));Assert.Null(x!["readAt"]);});Assert.Null(page["nextCursor"]);Assert.Equal("3",Value(await NoticeBody(await c.GetAsync("/api/notifications/unread-count"),"unread-count"),"unreadCount"));await NoticeBody(await c.GetAsync("/api/notifications?unreadOnly=true"),"unread");foreach(var field in new[]{"ownerId","eventSequence","body","subject","protectedBody"})Assert.DoesNotContain('"'+field+'"',page.ToJsonString(),StringComparison.OrdinalIgnoreCase);
        var other=await Customer();using var stranger=other.Client;Assert.Empty((await NoticeBody(await stranger.GetAsync("/api/notifications"),"other-owner"))["items"]!.AsArray());await using var scope=fixture.Factory.Services.CreateAsyncScope();Assert.Equal(3,await scope.ServiceProvider.GetRequiredService<NotificationsDbContext>().Inbox.CountAsync(x=>x.TicketId==ticket));
    }
    [Fact]public async Task ConcurrentReadAcknowledgementsAreMonotoneOwnerBoundAndRejectForgedInput()
    {
        var person=await Customer();using var c=person.Client;using var staff=await Staff();var created=await Body(await c.PostAsJsonAsync("/api/support/tickets/commands/"+Id(),Input()));string ticket=Value(created["ticket"]!,"id");await Body(await staff.PostAsJsonAsync($"/api/admin/support/tickets/{ticket}/replies/{Id()}",new ReplyTicketInput(Version(created),"Read acknowledgement QA","en")));var page=await NoticeBody(await c.GetAsync("/api/notifications"));string id=Value(page["items"]![0]!,"id"),path="/api/notifications/"+id+"/read";var other=await Customer();using var stranger=other.Client;using(var foreign=await stranger.PutAsJsonAsync(path,new{}))Assert.Equal(HttpStatusCode.NotFound,foreign.StatusCode);
        var results=await Task.WhenAll(c.PutAsJsonAsync(path,new{}),c.PutAsJsonAsync(path,new{}));JsonNode first=await NoticeBody(results[0],"read"),second=await NoticeBody(results[1],"read-concurrent");Assert.Equal(first.ToJsonString(),second.ToJsonString());Assert.NotNull(first["notification"]!["readAt"]);Assert.Equal(first.ToJsonString(),(await NoticeBody(await c.PutAsJsonAsync(path,new{}),"read-repeat")).ToJsonString());Assert.Equal("0",Value(await NoticeBody(await c.GetAsync("/api/notifications/unread-count"),"count-after-read"),"unreadCount"));Assert.Empty((await NoticeBody(await c.GetAsync("/api/notifications?unreadOnly=true"),"unread-after-read"))["items"]!.AsArray());
        using(var forged=await c.PutAsJsonAsync(path,new{OwnerId=person.Owner}))Assert.Equal(HttpStatusCode.BadRequest,forged.StatusCode);foreach(var suffix in new[]{"?owner=other","?unreadOnly=1","?unreadOnly=true&unreadOnly=false","?cursor=invalid"}){using var bad=await c.GetAsync("/api/notifications"+suffix);Assert.Equal(HttpStatusCode.BadRequest,bad.StatusCode);}c.DefaultRequestHeaders.Remove("Origin");c.DefaultRequestHeaders.Add("Origin","https://foreign.invalid");using(var denied=await c.PutAsJsonAsync(path,new{}))Assert.Equal(HttpStatusCode.Forbidden,denied.StatusCode);using var guest=fixture.Factory.CreateClient(new(){HandleCookies=false});using var anonymous=await guest.GetAsync("/api/notifications");Assert.Equal(HttpStatusCode.Unauthorized,anonymous.StatusCode);Assert.Contains("no-store",anonymous.Headers.CacheControl!.ToString());Assert.Contains("noindex",string.Join(',',anonymous.Headers.GetValues("X-Robots-Tag")));
    }
    [Fact]public async Task NotificationFailureAndAuditFailureEachRollBackReplyEventReceiptAndInboxBeforeSameCommandRetry()
    {
        var person=await Customer();using var c=person.Client;using var staff=await Staff();var created=await Body(await c.PostAsJsonAsync("/api/support/tickets/commands/"+Id(),Input()));string ticket=Value(created["ticket"]!,"id"),command=Id(),path=$"/api/admin/support/tickets/{ticket}/replies/{command}";var input=new ReplyTicketInput(Version(created),"Must commit all modules or none.","en");
        foreach(var table in new[]{"notifications.Inbox","identity.Audit"}){
            var add=table=="notifications.Inbox"?"ALTER TABLE [notifications].[Inbox] WITH NOCHECK ADD CONSTRAINT CK_PrivateNotificationFailure CHECK ([Kind]<>'support_reply')":"ALTER TABLE [identity].[Audit] WITH NOCHECK ADD CONSTRAINT CK_PrivateNotificationFailure CHECK ([Resource] NOT LIKE '/api/admin/support/tickets/%/replies/%')";
            var drop=table=="notifications.Inbox"?"ALTER TABLE [notifications].[Inbox] DROP CONSTRAINT CK_PrivateNotificationFailure":"ALTER TABLE [identity].[Audit] DROP CONSTRAINT CK_PrivateNotificationFailure";
            await using(var scope=fixture.Factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<NotificationsDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);await db.Database.ExecuteSqlRawAsync(add);}
            try{using var failed=await staff.PostAsJsonAsync(path,input);Assert.Equal(HttpStatusCode.Conflict,failed.StatusCode);}finally{await using var scope=fixture.Factory.Services.CreateAsyncScope();await scope.ServiceProvider.GetRequiredService<NotificationsDbContext>().Database.ExecuteSqlRawAsync(drop);}
            await using(var scope=fixture.Factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<SupportDbContext>();var row=await db.Tickets.AsNoTracking().SingleAsync(x=>x.Id==ticket);Assert.Equal(Version(created),Convert.ToBase64String(row.Version));Assert.Equal(1,row.MessageCount);Assert.Single(await db.Messages.Where(x=>x.TicketId==ticket).ToArrayAsync());Assert.Single(await db.Events.Where(x=>x.TicketId==ticket).ToArrayAsync());Assert.False(await db.Commands.AnyAsync(x=>x.CommandId==command));Assert.False(await scope.ServiceProvider.GetRequiredService<NotificationsDbContext>().Inbox.AnyAsync(x=>x.TicketId==ticket));}
        }
        await Body(await staff.PostAsJsonAsync(path,input));await Body(await staff.PostAsJsonAsync(path,input));await using var final=fixture.Factory.Services.CreateAsyncScope();Assert.Single(await final.ServiceProvider.GetRequiredService<NotificationsDbContext>().Inbox.Where(x=>x.TicketId==ticket).ToArrayAsync());
    }
    [Fact]public async Task PrivateInboxSeekAndUnreadCursorStayBoundToOwnerAndFilter()
    {
        string owner=("INBOX-"+Id()).ToUpperInvariant(),ticket=Id();var at=DateTimeOffset.UtcNow;await using(var scope=fixture.Factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<NotificationsDbContext>();for(var n=1;n<=53;n++)db.Inbox.Add(new(){OwnerId=owner,TicketId=ticket,EventSequence=n,Kind="support_reply",At=at});await db.SaveChangesAsync();}
        await using var read=fixture.Factory.Services.CreateAsyncScope();var service=read.ServiceProvider.GetRequiredService<PrivateInboxService>();var first=await service.PageAsync(owner,false,null,default);Assert.Equal(50,first.Items.Length);Assert.NotNull(first.NextCursor);var second=await service.PageAsync(owner,false,first.NextCursor,default);Assert.Equal(3,second.Items.Length);Assert.Null(second.NextCursor);Assert.Equal(53,first.Items.Concat(second.Items).Select(x=>x.Id).Distinct().Count());Assert.Equal("invalid_notification",(await Assert.ThrowsAsync<BusinessException>(()=>service.PageAsync(owner,true,first.NextCursor,default))).Code);Assert.Equal("invalid_notification",(await Assert.ThrowsAsync<BusinessException>(()=>service.PageAsync("OTHER",false,first.NextCursor,default))).Code);Assert.Equal("53",(await service.CountAsync(owner,default)).UnreadCount);
    }
    [Fact]public async Task InboxHistoryCannotBeEditedDeletedOrUnreadAgainAndReadTimeClampsClockRollback()
    {
        string owner=("IMMUTABLE-"+Id()).ToUpperInvariant(),ticket=Id(),id=Id();var at=DateTimeOffset.UtcNow;await using(var scope=fixture.Factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<NotificationsDbContext>();db.Inbox.Add(new(){Id=id,OwnerId=owner,TicketId=ticket,EventSequence=1,Kind="support_reply",At=at});await db.SaveChangesAsync();}
        for(var method=0;method<4;method++)foreach(var mode in new[]{"owner","source","delete"}){await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<NotificationsDbContext>();var row=await db.Inbox.SingleAsync(x=>x.Id==id);if(mode=="owner")row.OwnerId="OTHER";else if(mode=="source")row.Kind="support_closed";else db.Inbox.Remove(row);Assert.Equal("notification_history_immutable",(await Assert.ThrowsAsync<BusinessException>(async()=>{switch(method){case 0:db.SaveChanges();break;case 1:db.SaveChanges(false);break;case 2:await db.SaveChangesAsync();break;case 3:await db.SaveChangesAsync(false);break;}})).Code);}
        await using(var scope=fixture.Factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<NotificationsDbContext>();var service=new PrivateInboxService(db,new FixedNotificationTime(at.AddYears(-1)),scope.ServiceProvider.GetRequiredService<IPrivateRealtimeEvents>());Assert.Equal(at,(await service.ReadAsync(owner,id,default)).Notification.ReadAt);var row=await db.Inbox.SingleAsync(x=>x.Id==id);row.ReadAt=null;Assert.Equal("notification_history_immutable",(await Assert.ThrowsAsync<BusinessException>(()=>db.SaveChangesAsync())).Code);}
    }
    [Fact]public async Task WriterRequiresTransactionAndDowngradeCannotDeleteExistingNotifications()
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<NotificationsDbContext>();var writer=scope.ServiceProvider.GetRequiredService<IPrivateNotificationWriter>();await Assert.ThrowsAsync<InvalidOperationException>(()=>writer.RecordSupportAsync(new("QA-"+Id(),Id(),1,"support_reply",DateTimeOffset.UtcNow),default));db.Inbox.Add(new(){OwnerId=("DOWN-"+Id()).ToUpperInvariant(),TicketId=Id(),EventSequence=1,Kind="support_closed",At=DateTimeOffset.UtcNow});await db.SaveChangesAsync();var before=await db.Inbox.CountAsync();var error=await Assert.ThrowsAsync<Microsoft.Data.SqlClient.SqlException>(()=>db.GetService<IMigrator>().MigrateAsync("0"));Assert.Equal(51000,error.Number);Assert.Equal(before,await db.Inbox.CountAsync());
    }
    private sealed class FixedNotificationTime(DateTimeOffset at):TimeProvider{public override DateTimeOffset GetUtcNow()=>at;}
}
