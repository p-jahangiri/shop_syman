using System.Net;
using System.Net.Http.Json;
using Shop.Modules.Support;
using Xunit;
namespace Shop.Tests;
public sealed class TicketAuthorizationTests(ApiFactory factory):IClassFixture<ApiFactory>
{
    [Theory][InlineData("mfa_pending","support.read,support.write","SupportAgent")][InlineData("access","support.write","SupportAgent")][InlineData("access","sales.read,sales.write","SalesManager")][InlineData("access","support.read,support.write","")]
    public async Task PrivateStaffRoutesRequireCompletedStaffIdentityAndBothRelevantPermissions(string kind,string permissions,string role)
    {
        using var c=factory.CreateClient();c.DefaultRequestHeaders.Add("X-Test-Kind",kind);c.DefaultRequestHeaders.Add("X-Test-Permissions",permissions);c.DefaultRequestHeaders.Add("X-Test-Roles",role);c.DefaultRequestHeaders.Add("Origin","http://127.0.0.1:3173");var id=new string('a',32);var command=new string('b',32);
        using(var read=await c.GetAsync("/api/admin/support/tickets"))Assert.Equal(HttpStatusCode.Forbidden,read.StatusCode);
        using(var reply=await c.PostAsJsonAsync($"/api/admin/support/tickets/{id}/replies/{command}",new ReplyTicketInput("AAAAAAAAAAE=","private test reply","en")))Assert.Equal(HttpStatusCode.Forbidden,reply.StatusCode);
        foreach(var path in new[]{"/api/admin/support/files/capabilities",$"/api/admin/support/tickets/{id}/attachments",$"/api/admin/support/tickets/{id}/attachments/{command}"})using(var response=await c.GetAsync(path))Assert.Equal(HttpStatusCode.Forbidden,response.StatusCode);
        using(var file=await c.PostAsync($"/api/admin/support/tickets/{id}/attachments/{command}",new StringContent("not parsed before authorization")))Assert.Equal(HttpStatusCode.Forbidden,file.StatusCode);
    }
    [Fact]public async Task AReadOnlySupportSessionCannotReplyChangeStateOrReadCommandReceipts()
    {
        using var c=factory.CreateClient();c.DefaultRequestHeaders.Add("X-Test-Kind","access");c.DefaultRequestHeaders.Add("X-Test-Permissions","support.read");c.DefaultRequestHeaders.Add("X-Test-Roles","SupportAgent");c.DefaultRequestHeaders.Add("Origin","http://127.0.0.1:3173");var id=new string('a',32);var command=new string('b',32);
        using(var reply=await c.PostAsJsonAsync($"/api/admin/support/tickets/{id}/replies/{command}",new ReplyTicketInput("AAAAAAAAAAE=","private test reply","en")))Assert.Equal(HttpStatusCode.Forbidden,reply.StatusCode);
        using(var state=await c.PutAsJsonAsync($"/api/admin/support/tickets/{id}/state/{command}",new ChangeTicketStateInput("AAAAAAAAAAE=","Closed")))Assert.Equal(HttpStatusCode.Forbidden,state.StatusCode);
        using(var receipt=await c.GetAsync("/api/admin/support/commands/"+command))Assert.Equal(HttpStatusCode.Forbidden,receipt.StatusCode);
        using(var file=await c.PostAsync($"/api/admin/support/tickets/{id}/attachments/{command}",new StringContent("not parsed before authorization")))Assert.Equal(HttpStatusCode.Forbidden,file.StatusCode);
    }
    [Fact]public async Task AnonymousPrivateFileReadsAndUploadsFailBeforeBodyParsingWithNoStoreHeaders()
    {
        using var c=factory.CreateClient();var id=new string('a',32);foreach(var prefix in new[]{"/api/support","/api/admin/support"}){
            foreach(var path in new[]{prefix+"/files/capabilities",prefix+$"/tickets/{id}/attachments",prefix+$"/tickets/{id}/attachments/{id}"}){using var response=await c.GetAsync(path);Assert.Equal(HttpStatusCode.Unauthorized,response.StatusCode);Assert.Contains("no-store",response.Headers.CacheControl!.ToString());Assert.Contains("noindex",response.Headers.GetValues("X-Robots-Tag").Single());}
            using var upload=await c.PostAsync(prefix+$"/tickets/{id}/attachments/{id}",new StringContent("not parsed"));Assert.Equal(HttpStatusCode.Unauthorized,upload.StatusCode);
        }
    }
}
