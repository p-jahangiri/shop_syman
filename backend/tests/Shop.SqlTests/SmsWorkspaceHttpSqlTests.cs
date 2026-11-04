using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Shop.Modules.Cms;
using Shop.Modules.Identity;
using Shop.Modules.Notifications;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;

public sealed class SmsWorkspaceHttpSqlTests : IAsyncLifetime
{
    private readonly OrderFixture fixture=new();private readonly Gateway gateway=new();
    private WebApplicationFactory<Program> app=null!;private HttpClient admin=null!;
    private const string Path="/api/admin/sms/workspace", Connection="d6900000000000000000000000000001", Template="d6900000000000000000000000000002";
    private static string Id()=>Guid.NewGuid().ToString("N");
    public async Task InitializeAsync(){await fixture.InitializeAsync();app=fixture.Sql.Factory.WithWebHostBuilder(builder=>builder.ConfigureTestServices(s=>{s.RemoveAll<ITransactionalSmsGateway>();s.AddSingleton<ITransactionalSmsGateway>(gateway);}));admin=app.CreateClient(new(){HandleCookies=false});admin.DefaultRequestHeaders.Authorization=fixture.Admin.DefaultRequestHeaders.Authorization;admin.DefaultRequestHeaders.Add("Origin","http://127.0.0.1:3173");admin.DefaultRequestHeaders.Add("X-Sayman-Client","admin");}
    public async Task DisposeAsync(){admin?.Dispose();if(app is not null)await app.DisposeAsync();await fixture.DisposeAsync();}
    private static SmsWorkspaceInput Input(string? version=null,string action="replace")=>new(version,Id(),new(120,30,2),[new(Connection,"Synthetic SMS.ir","smsIr","live",true,action,action=="replace"?"synthetic-http-workspace-key":null)],[new(Template,"OTP","otp",Connection,"170274",true,"کد #CODE#",[new("CODE","code")])],SmsWorkspaceRules.Events.Select(k=>new SmsRouteInput(k,k=="otp",k=="otp"?Template:null)).ToArray());
    private static async Task<T> Read<T>(HttpResponseMessage response,HttpStatusCode expected=HttpStatusCode.OK){using(response){Assert.Equal(expected,response.StatusCode);Assert.Contains("no-store",response.Headers.CacheControl!.ToString());return (await response.Content.ReadFromJsonAsync<T>())!;}}
    private async Task<JsonNode> AuthHead()=> (await Read<JsonObject>(await admin.GetAsync("/api/admin/content")))["documents"]!.AsArray().Single(n=>n!["key"]!.GetValue<string>()=="auth" && n["locale"]!.GetValue<string>()=="fa")!;
    private async Task PublishOtp(){var head=await AuthHead();var body=new JsonObject{["mobileOtp"]=true,["registration"]=true,["emailPassword"]=true,["usernamePassword"]=true,["passwordReset"]=false};using var saved=await admin.PutAsJsonAsync("/api/admin/content/auth/fa",new ContentInput(body,head["version"]!.GetValue<string>()));Assert.Equal(HttpStatusCode.NoContent,saved.StatusCode);head=await AuthHead();using var published=await admin.PostAsJsonAsync("/api/admin/content/auth/fa/publish",new{version=head["version"]!.GetValue<string>()});Assert.Equal(HttpStatusCode.NoContent,published.StatusCode);}
    [Fact]
    public async Task WorkspaceEndpointsRequireStaffMfaOriginAndClosedInputThenSaveAuditedMetadataOnly()
    {
        using var anonymous=app.CreateClient(new(){HandleCookies=false});Assert.Equal(HttpStatusCode.Unauthorized,(await anonymous.GetAsync(Path)).StatusCode);
        using var noOrigin=app.CreateClient(new(){HandleCookies=false});noOrigin.DefaultRequestHeaders.Authorization=admin.DefaultRequestHeaders.Authorization;noOrigin.DefaultRequestHeaders.Add("X-Sayman-Client","admin");Assert.Equal(HttpStatusCode.Forbidden,(await noOrigin.PutAsJsonAsync(Path,Input())).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await admin.GetAsync(Path+"?key=true")).StatusCode);
        var bad=JsonSerializer.SerializeToNode(Input(),JsonSerializerOptions.Web)!.AsObject();bad["ownerId"]="other";Assert.Equal(HttpStatusCode.BadRequest,(await admin.PutAsJsonAsync(Path,bad)).StatusCode);
        var empty=await Read<SmsWorkspaceInfo>(await admin.GetAsync(Path));Assert.Null(empty.Version);
        var command=Input();var saved=await Read<SmsWorkspaceInfo>(await admin.PutAsJsonAsync(Path,command));Assert.True(saved.Connections.Single().KeyConfigured);
        Assert.DoesNotContain("synthetic-http-workspace-key",JsonSerializer.Serialize(saved));
        Assert.Equal(JsonSerializer.Serialize(saved),JsonSerializer.Serialize(await Read<SmsWorkspaceInfo>(await admin.PutAsJsonAsync(Path,command))));
        Assert.Equal(HttpStatusCode.Conflict,(await admin.PutAsJsonAsync(Path,Input())).StatusCode);
        await using var scope=app.Services.CreateAsyncScope();Assert.Equal(1,await scope.ServiceProvider.GetRequiredService<NotificationsDbContext>().SmsWorkspaceCommands.CountAsync());Assert.True(await scope.ServiceProvider.GetRequiredService<IdentityDbContext>().Audit.AnyAsync(a=>a.Resource==Path));Assert.Equal(0,gateway.Attempts);
    }
    [Fact]
    public async Task ConfigurableOtpRunsThroughTheRealRootBridgeAndLastCustomerLoginCannotBeDisabled()
    {
        var saved=await Read<SmsWorkspaceInfo>(await admin.PutAsJsonAsync(Path,Input()));await PublishOtp();
        using var customer=app.CreateClient(new(){HandleCookies=false});customer.DefaultRequestHeaders.Add("Origin","http://127.0.0.1:3000");
        var start=await Read<CustomerOtpStarted>(await customer.PostAsJsonAsync("/api/auth/otp",new{mobile="09125550001",requestId=Id()}));
        Assert.Equal(120,(DateTimeOffset.Parse(start.ExpiresAt)-DateTimeOffset.Parse(start.ResendAt)).TotalSeconds+30);Assert.Equal("accepted",start.Delivery);Assert.Equal(1,gateway.Attempts);
        using(var response=await customer.PostAsJsonAsync("/api/auth/otp/verify",new{challengeId=start.ChallengeId,code=gateway.Code})){Assert.Equal(HttpStatusCode.OK,response.StatusCode);}
        await using(var scope=app.Services.CreateAsyncScope()){
            var identity=scope.ServiceProvider.GetRequiredService<IdentityDbContext>();var challenge=await identity.CustomerOtpChallenges.SingleAsync();Assert.Equal(120,challenge.LifetimeSeconds);Assert.Equal(30,challenge.ResendSeconds);Assert.Equal(2,challenge.MaxAttempts);Assert.NotNull(challenge.ConsumedAt);
            var user=await identity.Users.SingleAsync(u=>u.CanonicalPhone=="+989125550001");Assert.Null(user.PasswordHash);Assert.True(user.PhoneNumberConfirmed);
        }
        var disable=Input(saved.Version,"keep");disable=disable with{Routes=disable.Routes.Select(r=>r with{Enabled=false}).ToArray()};
        var rejected=await Read<JsonObject>(await admin.PutAsJsonAsync(Path,disable),HttpStatusCode.Conflict);Assert.Equal("customer_login_continuity_conflict",rejected["title"]!.GetValue<string>());
        var retained=await Read<SmsWorkspaceInfo>(await admin.GetAsync(Path));Assert.Equal(saved.Version,retained.Version);Assert.True(retained.Routes.Single(r=>r.Event=="otp").Enabled);
        Assert.Equal(1,gateway.Attempts);
    }
    [Fact]
    public async Task ExplicitTestRequiresConsentPersistsOneQueueReceiptAndNeverDispatchesInsideTheAdminCommand()
    {
        await Read<SmsWorkspaceInfo>(await admin.PutAsJsonAsync(Path,Input()));var command=new SmsTestInput(Id(),Template,"+989120000000",false);
        Assert.Equal(HttpStatusCode.BadRequest,(await admin.PostAsJsonAsync("/api/admin/sms/messages/test",command)).StatusCode);
        var saved=await Read<SmsMessageInfo>(await admin.PostAsJsonAsync("/api/admin/sms/messages/test",command with{Confirmed=true}));Assert.Equal("queued",saved.State);
        var replay=await Read<SmsMessageInfo>(await admin.PostAsJsonAsync("/api/admin/sms/messages/test",command with{Confirmed=true}));Assert.Equal(saved.Id,replay.Id);Assert.Equal(0,gateway.Attempts);
        var page=await Read<SmsMessagesPage>(await admin.GetAsync("/api/admin/sms/messages?kind=test&state=queued"));Assert.Single(page.Items);Assert.DoesNotContain("+989",JsonSerializer.Serialize(page));
    }
    private sealed class Gateway:ITransactionalSmsGateway{public int Attempts;public string Code="";public Task<CustomerOtpSmsResult> SendAsync(TransactionalSmsRequest request,CancellationToken ct)=>request.DispatchAsync((_,_,_,_,parameters,_)=>{Attempts++;Code=parameters.Single(p=>p.Name=="CODE").Value;return Task.FromResult(new CustomerOtpSmsResult(CustomerOtpSmsDisposition.Accepted,CustomerOtpSmsReason.None,"12"));},ct);}
}
