using System.Data;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Identity;
using Shop.Modules.Support;
using Shop.SharedKernel;
using Xunit;
namespace Shop.SqlTests;
public sealed partial class TicketSqlTests(SqlFixture fixture) : IClassFixture<SqlFixture>
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
    [Fact]public async Task PrivateConversationReplyCloseReopenAndHistoricalReceiptKeepOwnersAndAuditSeparate()
    {
        var person=await Customer();using var customer=person.Client;using var staff=await Staff();var command=Id();var createPath="/api/support/tickets/commands/"+command;var created=await Body(await customer.PostAsJsonAsync(createPath,Input()),"created");var id=Value(created["ticket"]!,"id");Assert.Equal("Open",Value(created["ticket"]!,"state"));
        var reply=await Body(await staff.PostAsJsonAsync($"/api/admin/support/tickets/{id}/replies/{Id()}",new ReplyTicketInput(Version(created),"پاسخ واقعی پشتیبانِ آزمایشی","fa")),"staff-reply");Assert.Equal("WaitingCustomer",Value(reply["ticket"]!,"state"));
        var customerReply=await Body(await customer.PostAsJsonAsync($"/api/support/tickets/{id}/replies/{Id()}",new ReplyTicketInput(Version(reply),"Thanks, this is the private customer answer.","en")),"customer-reply");Assert.Equal("Open",Value(customerReply["ticket"]!,"state"));
        var closed=await Body(await customer.PutAsJsonAsync($"/api/support/tickets/{id}/state/{Id()}",new ChangeTicketStateInput(Version(customerReply),"Closed")),"closed");
        using(var denied=await customer.PostAsJsonAsync($"/api/support/tickets/{id}/replies/{Id()}",new ReplyTicketInput(Version(closed),"نباید ثبت شود","fa")))Assert.Equal(HttpStatusCode.Conflict,denied.StatusCode);
        var reopened=await Body(await staff.PutAsJsonAsync($"/api/admin/support/tickets/{id}/state/{Id()}",new ChangeTicketStateInput(Version(closed),"Open")),"reopened");Assert.Equal(3,reopened["ticket"]!["messageCount"]!.GetValue<int>());
        var replay=await Body(await customer.PostAsJsonAsync(createPath,Input()),"create-replay");Assert.True(replay["replayed"]!.GetValue<bool>());Assert.Equal(created["ticket"]!.ToJsonString(),replay["ticket"]!.ToJsonString());var receipt=await Body(await customer.GetAsync("/api/support/commands/"+command),"receipt");Assert.Equal(created["ticket"]!.ToJsonString(),receipt["ticket"]!.ToJsonString());
        var messages=await Body(await customer.GetAsync($"/api/support/tickets/{id}/messages"),"messages");Assert.Equal(3,messages["items"]!.AsArray().Count);Assert.Equal(new[]{"customer","support","customer"},messages["items"]!.AsArray().Select(x=>Value(x!,"author")));Assert.Equal(Input().Body,Value(messages["items"]![0]!,"body"));Assert.All(messages["items"]!.AsArray(),x=>Assert.IsType<string>(x!["sequence"]!.GetValue<string>()));Assert.Null(messages["nextCursor"]);
        var page=await Body(await customer.GetAsync("/api/support/tickets"),"customer-page");Assert.Single(page["items"]!.AsArray());Assert.Null(page["state"]);Assert.Null(page["nextCursor"]);await Body(await staff.GetAsync("/api/admin/support/tickets?state=Open"),"staff-page");await Body(await customer.GetAsync($"/api/support/tickets/{id}"),"detail");
        foreach(var raw in new[]{messages.ToJsonString(),page.ToJsonString(),receipt.ToJsonString()}){Assert.DoesNotContain(person.Owner,raw,StringComparison.OrdinalIgnoreCase);Assert.DoesNotContain("Private customer name",raw);foreach(var field in new[]{"actorId","ownerId","protectedBody","protectedSubject","protectedResult","payloadHash"})Assert.DoesNotContain('"'+field+'"',raw,StringComparison.OrdinalIgnoreCase);}
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<SupportDbContext>();Assert.Equal(5,await db.Events.CountAsync(x=>x.TicketId==id));Assert.Equal(5,await db.Commands.CountAsync(x=>x.TicketId==id));Assert.Equal(3,await db.Messages.CountAsync(x=>x.TicketId==id));Assert.True(await scope.ServiceProvider.GetRequiredService<Shop.Modules.Identity.IdentityDbContext>().Audit.CountAsync(x=>x.Resource.StartsWith("/api/admin/support/tickets/"+id))>=2);
        var row=await db.Tickets.AsNoTracking().SingleAsync(x=>x.Id==id);Assert.DoesNotContain(Input().Subject,Encoding.UTF8.GetString(row.ProtectedSubject));var stored=await db.Messages.AsNoTracking().Where(x=>x.TicketId==id).ToArrayAsync();Assert.All(stored,x=>Assert.DoesNotContain(Input().Body,Encoding.UTF8.GetString(x.ProtectedBody)));
    }
    [Fact]public async Task ForeignOwnersGuestsWrongRoleOriginsAndExtraInputCannotReadOrForgePrivateTickets()
    {
        var owner=await Customer();using var c=owner.Client;var created=await Body(await c.PostAsJsonAsync("/api/support/tickets/commands/"+Id(),Input()));var id=Value(created["ticket"]!,"id");var stranger=await Customer();using var other=stranger.Client;using var guest=fixture.Factory.CreateClient(new(){HandleCookies=false});using var sales=await Staff("SalesManager");
        foreach(var suffix in new[]{"","/messages"}){using var foreign=await other.GetAsync("/api/support/tickets/"+id+suffix);Assert.Equal(HttpStatusCode.NotFound,foreign.StatusCode);using var anonymous=await guest.GetAsync("/api/support/tickets/"+id+suffix);Assert.Equal(HttpStatusCode.Unauthorized,anonymous.StatusCode);Assert.Contains("no-store",anonymous.Headers.CacheControl!.ToString());Assert.Contains("noindex",string.Join(",",anonymous.Headers.GetValues("X-Robots-Tag")));}
        Assert.Empty((await Body(await other.GetAsync("/api/support/tickets")))["items"]!.AsArray());using(var denied=await sales.GetAsync("/api/admin/support/tickets"))Assert.Equal(HttpStatusCode.Forbidden,denied.StatusCode);using(var denied=await c.GetAsync("/api/admin/support/tickets"))Assert.Equal(HttpStatusCode.Forbidden,denied.StatusCode);
        using(var forged=await c.PostAsJsonAsync("/api/support/tickets/commands/"+Id(),new{Subject="title",Body="body",Locale="fa",OwnerId=stranger.Owner}))Assert.Equal(HttpStatusCode.BadRequest,forged.StatusCode);
        foreach(var suffix in new[]{"?owner=other","?state=Unknown","?state=Open&state=Closed","?cursor=invalid"}){using var bad=await c.GetAsync("/api/support/tickets"+suffix);Assert.Equal(HttpStatusCode.BadRequest,bad.StatusCode);}
        c.DefaultRequestHeaders.Remove("Origin");c.DefaultRequestHeaders.Add("Origin","https://foreign.invalid");using(var denied=await c.PostAsJsonAsync("/api/support/tickets/commands/"+Id(),Input()))Assert.Equal(HttpStatusCode.Forbidden,denied.StatusCode);
    }
    [Fact]public async Task ConcurrentDuplicateCreateAndReplyCloseRaceDoNotDuplicateMessagesOrLoseState()
    {
        var person=await Customer();using var c=person.Client;var command=Id();var path="/api/support/tickets/commands/"+command;var requests=await Task.WhenAll(c.PostAsJsonAsync(path,Input()),c.PostAsJsonAsync(path,Input()));var rows=new List<JsonNode>();foreach(var response in requests)rows.Add(await Body(response));Assert.Single(rows,x=>!x["replayed"]!.GetValue<bool>());Assert.Single(rows,x=>x["replayed"]!.GetValue<bool>());var initial=rows[0];var id=Value(initial["ticket"]!,"id");
        using(var mismatch=await c.PostAsJsonAsync(path,Input() with{Body="changed payload"}))Assert.Equal(HttpStatusCode.Conflict,mismatch.StatusCode);
        var competing=await Task.WhenAll(c.PostAsJsonAsync($"/api/support/tickets/{id}/replies/{Id()}",new ReplyTicketInput(Version(initial),"Concurrent customer reply","en")),c.PutAsJsonAsync($"/api/support/tickets/{id}/state/{Id()}",new ChangeTicketStateInput(Version(initial),"Closed")));
        Assert.Single(competing,x=>x.IsSuccessStatusCode);Assert.Single(competing,x=>x.StatusCode==HttpStatusCode.Conflict);foreach(var response in competing)response.Dispose();await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<SupportDbContext>();Assert.Equal(2,await db.Commands.CountAsync(x=>x.TicketId==id));Assert.Equal(2,await db.Events.CountAsync(x=>x.TicketId==id));var ticket=await db.Tickets.AsNoTracking().SingleAsync(x=>x.Id==id);Assert.Equal(ticket.MessageCount,await db.Messages.CountAsync(x=>x.TicketId==id));Assert.Contains(ticket.State,new[]{"Open","Closed"});
    }
}
