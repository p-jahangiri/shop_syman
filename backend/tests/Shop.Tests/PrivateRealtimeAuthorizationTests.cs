using System.Net;
using Shop.SharedKernel;
using Xunit;
namespace Shop.Tests;
public sealed class PrivateRealtimeAuthorizationTests(ApiFactory factory):IClassFixture<ApiFactory>
{
 [Theory][InlineData("mfa_pending","support.read","SupportAgent")][InlineData("access","support.write","SupportAgent")][InlineData("access","sales.read","SalesManager")][InlineData("access","support.read","")]
 public async Task StaffRealtimeNeedsTheSameCompletedSupportAuthorityAsPrivateTicketReads(string kind,string permissions,string roles){using var c=factory.CreateClient();c.DefaultRequestHeaders.Add("X-Test-Kind",kind);c.DefaultRequestHeaders.Add("X-Test-Permissions",permissions);c.DefaultRequestHeaders.Add("X-Test-Roles",roles);c.DefaultRequestHeaders.Add("Origin","http://127.0.0.1:3173");using var response=await c.PostAsync("/api/admin/realtime/negotiate?negotiateVersion=1",new StringContent(""));Assert.Equal(HttpStatusCode.Forbidden,response.StatusCode);Assert.Contains("no-store",response.Headers.CacheControl!.ToString());}
}
