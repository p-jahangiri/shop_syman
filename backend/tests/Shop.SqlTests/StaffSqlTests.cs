using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Identity;
using Xunit;

namespace Shop.SqlTests;
public sealed class StaffSqlTests : IAsyncLifetime
{
    private sealed class Clock : TimeProvider { private DateTimeOffset now=DateTimeOffset.UtcNow;public override DateTimeOffset GetUtcNow()=>now;public void Advance()=>now=now.AddSeconds(31); }
    private readonly Clock clock=new();private readonly SqlFixture sql;
    public StaffSqlTests()=>sql=new(){TimeProvider=clock};
    public Task InitializeAsync()=>sql.InitializeAsync();public Task DisposeAsync()=>sql.DisposeAsync();
    private HttpClient Client(string? token=null){var client=sql.Factory.CreateClient(new(){HandleCookies=false});client.DefaultRequestHeaders.Add("Origin","http://127.0.0.1:3173");client.DefaultRequestHeaders.Add("X-Sayman-Client","admin");client.DefaultRequestHeaders.Add("X-Sayman-Admin","1");if(token is not null)client.DefaultRequestHeaders.Authorization=new("Bearer",token);return client;}
    private static async Task<JsonNode> Json(HttpResponseMessage response){var body=await response.Content.ReadAsStringAsync();Assert.True(response.IsSuccessStatusCode,$"HTTP {(int)response.StatusCode}: {body}");return JsonNode.Parse(body)!;}
    private async Task<ShopUser> Account(string? role=null,bool verified=true,bool active=true,bool password=true){await using var scope=sql.Factory.Services.CreateAsyncScope();var users=scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>();var name="staffsql"+Guid.NewGuid().ToString("N");var user=new ShopUser{UserName=name,Email=name+"@example.test",EmailConfirmed=verified,IsActive=active,DisplayName="کارمند آزمایشی",RequireMfa=role is not null};Assert.True((await (password?users.CreateAsync(user,sql.Password):users.CreateAsync(user))).Succeeded);if(role is not null)Assert.True((await users.AddToRoleAsync(user,role)).Succeeded);return user;}
    private async Task<(HttpClient Client,string Access,string Refresh,string Secret)> SignIn(ShopUser user,string? secret=null){var client=Client();var pending=await Json(await client.PostAsJsonAsync("/api/auth/password",new{Identifier=user.UserName,sql.Password}));client.DefaultRequestHeaders.Authorization=new("Bearer",pending["accessToken"]!.GetValue<string>());if(pending["requiresEnrollment"]!.GetValue<bool>()){var setup=await Json(await client.PostAsJsonAsync("/api/auth/mfa/setup",new{}));secret=setup["secret"]!.GetValue<string>();client.DefaultRequestHeaders.Authorization=new("Bearer",setup["accessToken"]!.GetValue<string>());}Assert.NotNull(secret);clock.Advance();using var response=await client.PostAsJsonAsync("/api/auth/mfa/verify",new{Code=Totp.Code(secret!,clock.GetUtcNow().ToUnixTimeSeconds()/30)});var session=await Json(response);var access=session["accessToken"]!.GetValue<string>();client.DefaultRequestHeaders.Authorization=new("Bearer",access);return(client,access,response.Headers.GetValues("Set-Cookie").Single(x=>x.StartsWith("sayman_admin_refresh=",StringComparison.Ordinal)).Split(';')[0],secret!);}
    private async Task<JsonNode> Detail(HttpClient admin,string id)=>(await Json(await admin.GetAsync("/api/admin/staff/"+id)))["staff"]!;
    [Fact] public async Task GrantRequiresVerifiedExistingAccountRevokesCustomerSessionsAndForcesMfa()
    {
        var actor=await Account("Administrator");var login=await SignIn(actor);using var admin=login.Client;var customer=await Account();AuthResult old;
        await using(var scope=sql.Factory.Services.CreateAsyncScope())old=await scope.ServiceProvider.GetRequiredService<AuthService>().PasswordAsync(new(customer.UserName!,sql.Password),true,true,false,CancellationToken.None);
        var candidate=await Json(await admin.PostAsJsonAsync("/api/admin/staff-candidate",new{Identifier=customer.UserName}));Assert.True(candidate["contactVerified"]!.GetValue<bool>());Assert.False(candidate["alreadyStaff"]!.GetValue<bool>());Assert.Null(candidate["email"]);Assert.Null(candidate["phoneNumber"]);
        var grant=await Json(await admin.PostAsJsonAsync("/api/admin/staff",new{AccountId=customer.Id,Roles=new[]{"ContentManager"},Version=candidate["version"]!.GetValue<string>()}));Assert.Equal("ContentManager",grant["staff"]!["roles"]![0]!.GetValue<string>());
        using var obsolete=Client(old.AccessToken);Assert.Equal(HttpStatusCode.Unauthorized,(await obsolete.GetAsync("/api/auth/me")).StatusCode);
        using var oldRefresh=Client();oldRefresh.DefaultRequestHeaders.Add("Cookie","sayman_refresh="+old.RefreshToken);oldRefresh.DefaultRequestHeaders.Remove("X-Sayman-Client");oldRefresh.DefaultRequestHeaders.Remove("Origin");oldRefresh.DefaultRequestHeaders.Add("Origin","http://127.0.0.1:3000");Assert.Equal(HttpStatusCode.Unauthorized,(await oldRefresh.PostAsJsonAsync("/api/auth/refresh",new{})).StatusCode);
        var staff=await SignIn(customer);using var staffClient=staff.Client;Assert.Equal(HttpStatusCode.OK,(await staffClient.GetAsync("/api/admin/content")).StatusCode);Assert.Equal(HttpStatusCode.Forbidden,(await staffClient.GetAsync("/api/admin/staff")).StatusCode);Assert.Equal(HttpStatusCode.Forbidden,(await staffClient.PutAsJsonAsync("/api/admin/products/one",new{})).StatusCode);
        foreach(var target in new[]{await Account(verified:false),await Account(active:false),await Account(password:false)}){var found=await Json(await admin.PostAsJsonAsync("/api/admin/staff-candidate",new{Identifier=target.UserName}));Assert.Equal(HttpStatusCode.BadRequest,(await admin.PostAsJsonAsync("/api/admin/staff",new{AccountId=target.Id,Roles=new[]{"ContentManager"},Version=found["version"]!.GetValue<string>()})).StatusCode);}
        Assert.Equal(HttpStatusCode.Conflict,(await admin.PostAsJsonAsync("/api/admin/staff",new{AccountId=customer.Id,Roles=new[]{"FinanceManager"},Version=candidate["version"]!.GetValue<string>()})).StatusCode);
        await using var check=sql.Factory.Services.CreateAsyncScope();var db=check.ServiceProvider.GetRequiredService<IdentityDbContext>();Assert.True((await db.Users.SingleAsync(x=>x.Id==customer.Id)).RequireMfa);Assert.True(await db.Audit.AnyAsync(x=>x.ActorId==actor.Id&&x.Resource=="/staff/"+customer.Id&&x.Action=="STAFF_ROLE_ADDED:ContentManager"));
    }
    [Fact] public async Task RoleAndStateChangesRevokeOldAuthorityAndStaleVersionCreatesNoSuccessAudit()
    {
        var actor=await Account("Administrator");var root=await SignIn(actor);using var admin=root.Client;var target=await Account("ContentManager");var original=await SignIn(target);using var content=original.Client;var before=await Detail(admin,target.Id);var version=before["version"]!.GetValue<string>();
        var changed=(await Json(await admin.PutAsJsonAsync("/api/admin/staff/"+target.Id,new{Roles=new[]{"InventoryManager"},IsActive=true,Version=version})))["staff"]!;Assert.NotEqual(version,changed["version"]!.GetValue<string>());Assert.Equal(HttpStatusCode.Unauthorized,(await content.GetAsync("/api/admin/content")).StatusCode);
        using var oldRefresh=Client();oldRefresh.DefaultRequestHeaders.Add("Cookie",original.Refresh);Assert.Equal(HttpStatusCode.Unauthorized,(await oldRefresh.PostAsJsonAsync("/api/auth/refresh",new{})).StatusCode);
        var signed=await SignIn(target,original.Secret);using var inventory=signed.Client;Assert.Equal(HttpStatusCode.OK,(await inventory.GetAsync("/api/admin/inventory/summary")).StatusCode);Assert.Equal(HttpStatusCode.Forbidden,(await inventory.GetAsync("/api/admin/content")).StatusCode);
        await using var scope=sql.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<IdentityDbContext>();var audit=await db.Audit.CountAsync();Assert.Equal(HttpStatusCode.Conflict,(await admin.PutAsJsonAsync("/api/admin/staff/"+target.Id,new{Roles=new[]{"Administrator"},IsActive=false,Version=version})).StatusCode);Assert.Equal(audit,await db.Audit.CountAsync());
        var fresh=await Detail(admin,target.Id);var disabled=(await Json(await admin.PutAsJsonAsync("/api/admin/staff/"+target.Id,new{Roles=new[]{"InventoryManager"},IsActive=false,Version=fresh["version"]!.GetValue<string>()})))["staff"]!;Assert.False(disabled["isActive"]!.GetValue<bool>());Assert.Equal(HttpStatusCode.Unauthorized,(await inventory.GetAsync("/api/auth/me")).StatusCode);
        using var retry=Client();Assert.Equal(HttpStatusCode.Unauthorized,(await retry.PostAsJsonAsync("/api/auth/password",new{Identifier=target.UserName,sql.Password})).StatusCode);
        var history=await Json(await admin.GetAsync("/api/admin/staff/"+target.Id+"/history"));Assert.Contains(history["items"]!.AsArray(),x=>x!["action"]!.GetValue<string>()=="STAFF_ROLE_REMOVED:ContentManager");Assert.Contains(history["items"]!.AsArray(),x=>x!["action"]!.GetValue<string>()=="STAFF_DISABLED");
    }
    [Fact] public async Task ConcurrentAdministratorsCannotDisableEachOtherAndOwnCaseVariantIdIsBlocked()
    {
        var one=await Account("Administrator");var two=await Account("Administrator");var a=await SignIn(one);var b=await SignIn(two);using var clientA=a.Client;using var clientB=b.Client;
        await using(var scope=sql.Factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<IdentityDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);await db.Users.Where(x=>x.UserName=="admin").ExecuteUpdateAsync(s=>s.SetProperty(x=>x.IsActive,false));}
        var rowA=await Detail(clientA,one.Id);var rowB=await Detail(clientB,two.Id);
        var results=await Task.WhenAll(clientA.PutAsJsonAsync("/api/admin/staff/"+two.Id,new{Roles=new[]{"Administrator"},IsActive=false,Version=rowB["version"]!.GetValue<string>()}),clientB.PutAsJsonAsync("/api/admin/staff/"+one.Id,new{Roles=new[]{"Administrator"},IsActive=false,Version=rowA["version"]!.GetValue<string>()}));Assert.Single(results,x=>x.StatusCode==HttpStatusCode.OK);Assert.Single(results,x=>x.StatusCode==HttpStatusCode.Unauthorized);
        var winner=results[0].IsSuccessStatusCode?clientA:clientB;var id=results[0].IsSuccessStatusCode?one.Id:two.Id;var current=await Detail(winner,id);Assert.Equal(HttpStatusCode.BadRequest,(await winner.PutAsJsonAsync("/api/admin/staff/"+id.ToUpperInvariant(),new{Roles=new[]{"ContentManager"},IsActive=false,Version=current["version"]!.GetValue<string>()})).StatusCode);foreach(var result in results)result.Dispose();
        await using var check=sql.Factory.Services.CreateAsyncScope();var identity=check.ServiceProvider.GetRequiredService<IdentityDbContext>();var role=await identity.Roles.SingleAsync(x=>x.NormalizedName=="ADMINISTRATOR");Assert.Equal(1,await identity.Users.CountAsync(u=>u.IsActive&&identity.UserRoles.Any(ur=>ur.UserId==u.Id&&ur.RoleId==role.Id)));
    }
    [Fact] public async Task RootAuditFailureRollsBackRolesStateStampSessionsAndTargetEvents()
    {
        var actor=await Account("Administrator");var root=await SignIn(actor);using var admin=root.Client;var target=await Account("ContentManager");var original=await SignIn(target);using var staff=original.Client;var detail=await Detail(admin,target.Id);
        await using var scope=sql.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<IdentityDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);var before=await db.Users.AsNoTracking().SingleAsync(x=>x.Id==target.Id);var audit=await db.Audit.CountAsync();
        await db.Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] WITH NOCHECK ADD CONSTRAINT [CK_StaffAuditFailure] CHECK ([Action]<>N'PUT')");try{Assert.False((await admin.PutAsJsonAsync("/api/admin/staff/"+target.Id,new{Roles=new[]{"FinanceManager"},IsActive=false,Version=detail["version"]!.GetValue<string>()})).IsSuccessStatusCode);}finally{await db.Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] DROP CONSTRAINT [CK_StaffAuditFailure]");}
        var after=await db.Users.AsNoTracking().SingleAsync(x=>x.Id==target.Id);Assert.Equal(before.SecurityStamp,after.SecurityStamp);Assert.Equal(before.ConcurrencyStamp,after.ConcurrencyStamp);Assert.True(after.IsActive);Assert.Equal(audit,await db.Audit.CountAsync());Assert.Equal(0,await db.Sessions.CountAsync(x=>x.UserId==target.Id&&x.RevokedAt!=null));Assert.Equal(HttpStatusCode.OK,(await staff.GetAsync("/api/admin/content")).StatusCode);Assert.Equal("ContentManager",(await Detail(admin,target.Id))["roles"]![0]!.GetValue<string>());
    }
    [Fact] public async Task ConcurrentRefreshAndDisableCannotLeaveUsableOldStaffAuthority()
    {
        var actor=await Account("Administrator");var root=await SignIn(actor);using var admin=root.Client;var target=await Account("ContentManager");var original=await SignIn(target);using var staff=original.Client;var detail=await Detail(admin,target.Id);
        using var refresh=Client();refresh.DefaultRequestHeaders.Add("Cookie",original.Refresh);
        var results=await Task.WhenAll(admin.PutAsJsonAsync("/api/admin/staff/"+target.Id,new{Roles=new[]{"ContentManager"},IsActive=false,Version=detail["version"]!.GetValue<string>()}),refresh.PostAsJsonAsync("/api/auth/refresh",new{}));
        var disabled=results[0];
        for(var attempt=0;disabled.StatusCode==HttpStatusCode.Conflict&&attempt<3;attempt++){
            var body=JsonNode.Parse(await disabled.Content.ReadAsStringAsync())!;Assert.Equal("transaction_conflict",body["title"]!.GetValue<string>());disabled.Dispose();
            disabled=await admin.PutAsJsonAsync("/api/admin/staff/"+target.Id,new{Roles=new[]{"ContentManager"},IsActive=false,Version=detail["version"]!.GetValue<string>()});
        }
        Assert.Equal(HttpStatusCode.OK,disabled.StatusCode);
        Assert.Contains(results[1].StatusCode,new[]{HttpStatusCode.OK,HttpStatusCode.Unauthorized,HttpStatusCode.Conflict});
        if(results[1].IsSuccessStatusCode){var body=await Json(results[1]);using var rotated=Client(body["accessToken"]!.GetValue<string>());Assert.Equal(HttpStatusCode.Unauthorized,(await rotated.GetAsync("/api/auth/me")).StatusCode);}
        Assert.Equal(HttpStatusCode.Unauthorized,(await staff.GetAsync("/api/admin/content")).StatusCode);Assert.False((await Detail(admin,target.Id))["isActive"]!.GetValue<bool>());
        await using var scope=sql.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<IdentityDbContext>();var user=await db.Users.SingleAsync(x=>x.Id==target.Id);Assert.False(await db.Sessions.AnyAsync(x=>x.UserId==target.Id&&x.SecurityStamp==user.SecurityStamp&&x.RevokedAt==null));
        disabled.Dispose();results[1].Dispose();
    }
    [Fact] public async Task StaffAndTargetHistoryUseBoundedPagesAndNeverExposeCustomerOrAuthenticationData()
    {
        var actor=await Account("Administrator");var root=await SignIn(actor);using var admin=root.Client;string targetId;
        await using(var scope=sql.Factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<IdentityDbContext>();var roleId=await db.Roles.Where(x=>x.Name=="ContentManager").Select(x=>x.Id).SingleAsync();var rows=Enumerable.Range(0,101).Select(i=>new ShopUser{Id="staff-page-"+i.ToString("D3"),UserName="employee"+i.ToString("D3"),NormalizedUserName="EMPLOYEE"+i.ToString("D3"),Email="page"+i+"@example.test",NormalizedEmail="PAGE"+i+"@EXAMPLE.TEST",DisplayName=i==12?"کارمَند ۱۲":"کارمند "+i,IsActive=i%2==0,RequireMfa=true}).ToArray();db.Users.AddRange(rows);db.UserRoles.AddRange(rows.Select(x=>new IdentityUserRole<string>{UserId=x.Id,RoleId=roleId}));await db.SaveChangesAsync();targetId=rows[12].Id;db.Audit.AddRange(Enumerable.Range(0,121).Select(_=>new AuditEvent{ActorId=actor.Id,Action="STAFF_ROLE_ADDED:ContentManager",Resource="/staff/"+targetId,TraceId="staff-page-sql"}));await db.SaveChangesAsync();}
        var ids=new List<string>();string? cursor=null;foreach(var count in new[]{50,50,1}){var path="/api/admin/staff?role=ContentManager"+(cursor is null?"":"&cursor="+Uri.EscapeDataString(cursor));var page=await Json(await admin.GetAsync(path));Assert.Equal(count,page["items"]!.AsArray().Count);ids.AddRange(page["items"]!.AsArray().Select(x=>x!["id"]!.GetValue<string>()));cursor=page["nextCursor"]?.GetValue<string>();Assert.DoesNotContain("passwordHash",page.ToJsonString());Assert.DoesNotContain("securityStamp",page.ToJsonString());Assert.DoesNotContain("email",page.ToJsonString());}Assert.Null(cursor);Assert.Equal(101,ids.Distinct().Count());
        var search=await Json(await admin.GetAsync("/api/admin/staff?role=ContentManager&query="+Uri.EscapeDataString("كارمند 12")));Assert.Single(search["items"]!.AsArray());Assert.Equal(targetId,search["items"]![0]!["id"]!.GetValue<string>());
        string? next=null;var events=new List<string>();foreach(var count in new[]{50,50,21}){var page=await Json(await admin.GetAsync("/api/admin/staff/"+targetId+"/history"+(next is null?"":"?cursor="+Uri.EscapeDataString(next))));Assert.Equal(count,page["items"]!.AsArray().Count);events.AddRange(page["items"]!.AsArray().Select(x=>x!["id"]!.GetValue<string>()));next=page["nextCursor"]?.GetValue<string>();}Assert.Null(next);Assert.Equal(121,events.Distinct().Count());
    }
    [Fact] public async Task ExplicitGrantProvisionsANewKnownRoleAtomicallyAndAuditFailureRollsItBack()
    {
        var actor=await Account("Administrator");var root=await SignIn(actor);using var admin=root.Client;var target=await Account();
        await using(var scope=sql.Factory.Services.CreateAsyncScope()){
            var manager=scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole>>();var db=scope.ServiceProvider.GetRequiredService<IdentityDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);var role=await manager.FindByNameAsync("SupportAgent");Assert.NotNull(role);Assert.False(await db.UserRoles.AnyAsync(x=>x.RoleId==role.Id));Assert.True((await manager.DeleteAsync(role)).Succeeded);
        }
        var candidate=await Json(await admin.PostAsJsonAsync("/api/admin/staff-candidate",new{Identifier=target.UserName}));var input=new{AccountId=target.Id,Roles=new[]{"SupportAgent"},Version=candidate["version"]!.GetValue<string>()};
        await using(var scope=sql.Factory.Services.CreateAsyncScope())await scope.ServiceProvider.GetRequiredService<IdentityDbContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] WITH NOCHECK ADD CONSTRAINT [CK_SupportRoleAuditFailure] CHECK ([Action]<>N'POST')");
        try{using var failed=await admin.PostAsJsonAsync("/api/admin/staff",input);Assert.Equal(HttpStatusCode.Conflict,failed.StatusCode);}finally{await using var scope=sql.Factory.Services.CreateAsyncScope();await scope.ServiceProvider.GetRequiredService<IdentityDbContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] DROP CONSTRAINT [CK_SupportRoleAuditFailure]");}
        await using(var scope=sql.Factory.Services.CreateAsyncScope()){var sp=scope.ServiceProvider;Assert.False(await sp.GetRequiredService<RoleManager<IdentityRole>>().RoleExistsAsync("SupportAgent"));Assert.Empty(await sp.GetRequiredService<UserManager<ShopUser>>().GetRolesAsync(await sp.GetRequiredService<UserManager<ShopUser>>().FindByIdAsync(target.Id)??throw new InvalidOperationException()));}
        var granted=await Json(await admin.PostAsJsonAsync("/api/admin/staff",input));Assert.Equal("SupportAgent",Assert.Single(granted["staff"]!["roles"]!.AsArray())!.GetValue<string>());
        var support=await SignIn(target);using var supportClient=support.Client;Assert.Equal(HttpStatusCode.OK,(await supportClient.GetAsync("/api/admin/support/tickets")).StatusCode);Assert.Equal(HttpStatusCode.Forbidden,(await supportClient.GetAsync("/api/admin/catalog")).StatusCode);Assert.Equal(HttpStatusCode.Forbidden,(await supportClient.GetAsync("/api/admin/payments/attempts")).StatusCode);
    }

}
