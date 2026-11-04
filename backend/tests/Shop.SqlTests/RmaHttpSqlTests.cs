using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Identity;
using Shop.Modules.Sales;
using Xunit;

namespace Shop.SqlTests;

internal sealed record RmaHttpOrder(HttpClient Customer,string Owner,string Id,string Variant,Func<Task<string>> OriginalFacts);

public sealed partial class RmaSqlTests
{
    // Reuse only the original order/warehouse fixture, never its test-purpose
    // RMA protector. HTTP policies/cases use the registered production DP.
    internal static async Task<RmaHttpOrder> HttpOrder(OrderFixture fixture)
    {
        var helper=new RmaSqlTests(fixture);var order=await helper.Create();await helper.Handoff(order);
        return new(order.Customer,order.Owner,order.OrderId,order.Variant,()=>helper.Effects(order));
    }
}

// A separate class fixture owns a separate SaymanTest_GUID database. Mixing
// direct-test policy ciphertext with production HTTP DP would be invalid.
public sealed class RmaHttpSqlTests(OrderFixture fixture) : IClassFixture<OrderFixture>
{
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web);
    private static string Id()=>Guid.NewGuid().ToString("N");
    private static string ContextPath(RmaHttpOrder order)=>$"/api/orders/{order.Id}/returns/context";
    private static string CreatePath(RmaHttpOrder order,string command)=>$"/api/orders/{order.Id}/returns/commands/{command}";
    private async Task<T> Scope<T>(Func<IServiceProvider,Task<T>> action)
    {
        await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();Assert.StartsWith("SaymanTest_",scope.ServiceProvider.GetRequiredService<SalesDbContext>().Database.GetDbConnection().Database);return await action(scope.ServiceProvider);
    }
    private static void Headers(HttpResponseMessage response,bool publicPolicy=false)
    {
        Assert.Equal("rma-v1",response.Headers.GetValues("X-Sayman-Returns-Contract").Single());Assert.True(response.Headers.CacheControl!.NoStore);
        Assert.Contains("noindex",response.Headers.GetValues("X-Robots-Tag").Single());
        if(publicPolicy)Assert.True(response.Headers.CacheControl.Public);
        else{Assert.True(response.Headers.CacheControl.Private);var vary=string.Join(",",response.Headers.Vary);Assert.Contains("Cookie",vary);Assert.Contains("Authorization",vary);}
    }
    private static async Task<JsonNode> Expect(HttpResponseMessage response,HttpStatusCode expected=HttpStatusCode.OK,bool publicPolicy=false)
    {
        using(response){var raw=await response.Content.ReadAsStringAsync();Assert.True(response.StatusCode==expected,$"HTTP {(int)response.StatusCode}, expected {(int)expected}: {raw}");Headers(response,publicPolicy);return raw.Length==0?new JsonObject():JsonNode.Parse(raw)!;}
    }
    private static T Value<T>(JsonNode value)=>JsonSerializer.Deserialize<T>(value.ToJsonString(),Json)!;
    private static HttpClient Client(OrderFixture fixture,HttpClient original,string? origin)
    {
        var client=fixture.Sql.Factory.CreateClient(new(){HandleCookies=false});foreach(var header in original.DefaultRequestHeaders)if(!header.Key.Equals("Origin",StringComparison.OrdinalIgnoreCase))client.DefaultRequestHeaders.TryAddWithoutValidation(header.Key,header.Value);
        if(origin is not null)client.DefaultRequestHeaders.Add("Origin",origin);return client;
    }
    private sealed record RoleClients(HttpClient Staff,HttpClient Pending,HttpClient ObsoleteEnrollment):IDisposable
    {public void Dispose(){Staff.Dispose();Pending.Dispose();ObsoleteEnrollment.Dispose();}}
    private async Task<RoleClients> Role(string role)
    {
        var tokens=await Scope(async sp=>{
            var users=sp.GetRequiredService<UserManager<ShopUser>>();var auth=sp.GetRequiredService<AuthService>();var name="rma"+Id();var user=new ShopUser{UserName=name,Email=name+"@example.test",EmailConfirmed=true,RequireMfa=true,DisplayName="Synthetic RMA HTTP staff"};
            Assert.True((await users.CreateAsync(user,fixture.Sql.Password)).Succeeded);Assert.True((await users.AddToRoleAsync(user,role)).Succeeded);
            var pending=await auth.PasswordAsync(new(name,fixture.Sql.Password),true,true,true,default);Assert.True(pending.RequiresMfa);
            var setup=JsonSerializer.SerializeToNode(await auth.SetupMfaAsync(user.Id,(await users.GetSecurityStampAsync(user))!,false,null,default),Json)!;var pendingToken=setup["accessToken"]!.GetValue<string>();
            var code=Totp.Code(setup["secret"]!.GetValue<string>(),DateTimeOffset.UtcNow.ToUnixTimeSeconds()/30);var signed=await auth.VerifyMfaAsync(user.Id,(await users.GetSecurityStampAsync(user))!,false,code,"synthetic-rma-http-staff",default);Assert.False(signed.RequiresMfa);
            // Completing enrollment changes the security stamp. Its old setup
            // JWT is obsolete; a fresh password challenge is still a valid
            // mfa_pending principal and must fail access authorization instead.
            var obsoleteStamp=new JwtSecurityTokenHandler().ReadJwtToken(pendingToken).Claims.Single(x=>x.Type=="sst").Value;
            Assert.NotEqual(obsoleteStamp,await users.Users.AsNoTracking().Where(x=>x.Id==user.Id).Select(x=>x.SecurityStamp).SingleAsync());
            var fresh=await auth.PasswordAsync(new(name,fixture.Sql.Password),true,true,true,default);Assert.True(fresh.RequiresMfa);
            return(signed.AccessToken,Pending:fresh.AccessToken,Obsolete:pendingToken);
        });
        HttpClient Make(string token){var client=fixture.Sql.Factory.CreateClient(new(){HandleCookies=false});client.DefaultRequestHeaders.Add("Origin","http://127.0.0.1:3173");client.DefaultRequestHeaders.Add("X-Sayman-Client","admin");client.DefaultRequestHeaders.Add("X-Sayman-Admin","1");client.DefaultRequestHeaders.Authorization=new("Bearer",token);return client;}
        return new(Make(tokens.AccessToken),Make(tokens.Pending),Make(tokens.Obsolete));
    }
    private async Task<RmaPolicyResult> Policy(HttpClient? writer=null)
    {
        writer??=fixture.Admin;var old=Value<RmaPolicyCurrent>(await Expect(await writer.GetAsync("/api/admin/returns/policy")));
        return Value<RmaPolicyResult>(await Expect(await writer.PutAsJsonAsync("/api/admin/returns/policy/commands/"+Id(),RmaSqlHarness.Policy(old.Current?.Version))));
    }
    private async Task<(RmaCommandResult Result,string Command,CreateRmaInput Input)> Submit(RmaHttpOrder order)
    {
        var context=Value<RmaOrderContext>(await Expect(await order.Customer.GetAsync(ContextPath(order))));Assert.True(context.CanRequest);var input=new CreateRmaInput(context.Policy.Current!.Id,context.OrderVersion,"physicalReturn",[new(context.Lines.Single().LineKey,1)],"Private HTTP owner reason "+Id(),true);var command=Id();
        using var response=await order.Customer.PutAsJsonAsync(CreatePath(order,command),input);Assert.Equal("/api/returns/"+Value<RmaCommandResult>(JsonNode.Parse(await response.Content.ReadAsStringAsync())!).Case.Case.Id,response.Headers.Location!.OriginalString);
        return(Value<RmaCommandResult>(await Expect(response,HttpStatusCode.Created)),command,input);
    }
    private Task<string> RmaFacts()=>Scope(async sp=>{
        var db=sp.GetRequiredService<SalesDbContext>();return JsonSerializer.Serialize(new{
            Policies=await db.RmaPolicyRevisions.AsNoTracking().OrderBy(x=>x.Id).ToArrayAsync(),PolicyCommands=await db.RmaPolicyCommands.AsNoTracking().OrderBy(x=>x.ActorId).ThenBy(x=>x.CommandId).ToArrayAsync(),
            Cases=await db.RmaCases.AsNoTracking().OrderBy(x=>x.Id).ToArrayAsync(),Lines=await db.RmaCaseLines.AsNoTracking().OrderBy(x=>x.CaseId).ThenBy(x=>x.LineKey).ToArrayAsync(),Events=await db.RmaCaseEvents.AsNoTracking().OrderBy(x=>x.Id).ToArrayAsync(),Commands=await db.RmaCaseCommands.AsNoTracking().OrderBy(x=>x.ActorId).ThenBy(x=>x.CommandId).ToArrayAsync(),
            Audits=await sp.GetRequiredService<IdentityDbContext>().Audit.AsNoTracking().Where(x=>x.Action.StartsWith("RMA_")).OrderBy(x=>x.Id).ToArrayAsync()
        });
    });

    [Fact]
    public async Task AnonymousPolicyIsMinimalAndEveryPrivateRouteChallengesWithPrivateContractHeaders()
    {
        var policy=(await Policy()).Policy.Current!;using var anonymous=fixture.Sql.Factory.CreateClient(new(){HandleCookies=false});
        var terms=await Expect(await anonymous.GetAsync("/api/returns/policy"),publicPolicy:true);Assert.True(terms["configured"]!.GetValue<bool>());Assert.Equal(policy.ConditionsFa,terms["conditionsFa"]!.GetValue<string>());Assert.Equal(policy.ConditionsEn,terms["conditionsEn"]!.GetValue<string>());
        Assert.Equal(new[]{"canRefund","conditionsEn","conditionsFa","configured","digitalComplaints","enabled","physicalReturns","refundAvailability","schemaVersion","windowDays","windowMode"}.Order(),terms.AsObject().Select(x=>x.Key).Order());
        foreach(var path in new[]{"/api/returns","/api/returns/"+Id(),"/api/returns/commands/"+Id(),$"/api/orders/{Id()}/returns/context","/api/admin/returns","/api/admin/returns/policy","/api/admin/returns/policy/history","/api/admin/returns/commands/"+Id()})await Expect(await anonymous.GetAsync(path),HttpStatusCode.Unauthorized);
        var command=Id();await Expect(await anonymous.PutAsJsonAsync($"/api/orders/{Id()}/returns/commands/{command}",new CreateRmaInput(Id(),"AAAAAAAAAAA=","physicalReturn",[new("SKU",1)],"Synthetic anonymous request",true)),HttpStatusCode.Unauthorized);
        await Expect(await anonymous.GetAsync("/api/returns/policy?owner=forged"),HttpStatusCode.BadRequest,publicPolicy:true);
        Assert.False(terms["canRefund"]!.GetValue<bool>());Assert.Equal("provider_unconfigured",terms["refundAvailability"]!.GetValue<string>());
    }

    [Fact]
    public async Task OwnershipMfaAndSalesPermissionsSeparateSafeSummariesFromPrivateReviewDetails()
    {
        using var sales=await Role("SalesManager");using var readOnly=await Role("FinanceManager");await Policy(sales.Staff);
        var order=await RmaSqlTests.HttpOrder(fixture);using var customer=order.Customer;var created=await Submit(order);var id=created.Result.Case.Case.Id;var before=await order.OriginalFacts();
        var other=await fixture.Customer();using var stranger=other.Client;
        foreach(var privatePath in new[]{ContextPath(order),"/api/returns/"+id,"/api/returns/commands/"+created.Command})await Expect(await stranger.GetAsync(privatePath),HttpStatusCode.NotFound);
        await Expect(await customer.GetAsync("/api/admin/returns"),HttpStatusCode.Forbidden);
        await Expect(await sales.ObsoleteEnrollment.GetAsync("/api/admin/returns"),HttpStatusCode.Unauthorized);
        await Expect(await sales.Pending.GetAsync("/api/admin/returns"),HttpStatusCode.Forbidden);
        var list=Value<RmaPage>(await Expect(await readOnly.Staff.GetAsync("/api/admin/returns")));var summary=Assert.Single(list.Items,x=>x.Id==id);Assert.Equal(order.Owner,summary.OwnerId);
        var listRaw=JsonSerializer.Serialize(list,Json);Assert.DoesNotContain(created.Input.Reason,listRaw);Assert.DoesNotContain("staffNote",listRaw);Assert.DoesNotContain("protected",listRaw,StringComparison.OrdinalIgnoreCase);
        await Expect(await readOnly.Staff.GetAsync($"/api/admin/returns/{order.Owner}/{id}"),HttpStatusCode.Forbidden);
        var review=new ReviewRmaInput(order.Owner,created.Result.Case.Case.Version,"startReview",null,"Private SalesManager investigation "+Id(),"A staff member is reviewing the request",true);var command=Id();var path=$"/api/admin/returns/{id}/commands/{command}";
        await Expect(await readOnly.Staff.PutAsJsonAsync(path,review),HttpStatusCode.Forbidden);await Expect(await readOnly.Staff.GetAsync("/api/admin/returns/commands/"+command),HttpStatusCode.Forbidden);
        var reviewed=Value<RmaCommandResult>(await Expect(await sales.Staff.PutAsJsonAsync(path,review)));Assert.Equal(review.Note,reviewed.Case.Events.Single(x=>x.Action=="startReview").StaffNote);
        var detail=Value<RmaDetail>(await Expect(await customer.GetAsync("/api/returns/"+id)));Assert.All(detail.Events,x=>Assert.Null(x.StaffNote));Assert.DoesNotContain(review.Note,JsonSerializer.Serialize(detail,Json));
        await Expect(await sales.Staff.GetAsync($"/api/admin/returns/{Id()}/{id}"),HttpStatusCode.NotFound);Assert.Equal(before,await order.OriginalFacts());
    }

    [Fact]
    public async Task OriginsQueriesAndStrictJsonCannotForgeRequestAuthorityOrCreateAudit()
    {
        await Policy();var order=await RmaSqlTests.HttpOrder(fixture);using var customer=order.Customer;var context=Value<RmaOrderContext>(await Expect(await customer.GetAsync(ContextPath(order))));var command=Id();var input=new CreateRmaInput(context.Policy.Current!.Id,context.OrderVersion,"physicalReturn",[new(context.Lines.Single().LineKey,1)],"Synthetic strict boundary request",true);var path=CreatePath(order,command);var before=await RmaFacts();var original=await order.OriginalFacts();
        using(var cross=Client(fixture,customer,"https://outside.example.test")){await Expect(await cross.PutAsJsonAsync(path,input),HttpStatusCode.Forbidden);await Expect(await cross.GetAsync(ContextPath(order)),HttpStatusCode.Forbidden);}
        using(var missing=Client(fixture,customer,null)){await Expect(await missing.PutAsJsonAsync(path,input),HttpStatusCode.Forbidden);await Expect(await missing.GetAsync(ContextPath(order)));}
        var current=Value<RmaPolicyCurrent>(await Expect(await fixture.Admin.GetAsync("/api/admin/returns/policy")));
        using(var storefront=Client(fixture,fixture.Admin,"http://127.0.0.1:3000"))await Expect(await storefront.PutAsJsonAsync("/api/admin/returns/policy/commands/"+Id(),RmaSqlHarness.Policy(current.Current!.Version)),HttpStatusCode.Forbidden);
        foreach(var query in new[]{"?owner=forged","?after=bad-cursor","?state=submitted&state=reviewing","?state=unknown"})await Expect(await customer.GetAsync("/api/returns"+query),HttpStatusCode.BadRequest);
        foreach(var query in new[]{"?owner=forged","?beforeRevision=01","?beforeRevision=0","?beforeRevision=1&beforeRevision=2"})await Expect(await fixture.Admin.GetAsync("/api/admin/returns/policy/history"+query),HttpStatusCode.BadRequest);
        await Expect(await customer.GetAsync(ContextPath(order)+"?owner=forged"),HttpStatusCode.BadRequest);await Expect(await customer.PutAsJsonAsync(path+"?owner=forged",input),HttpStatusCode.BadRequest);
        var forged=JsonSerializer.SerializeToNode(input,Json)!.AsObject();forged["ownerId"]=order.Owner;forged["refundRial"]="1";await Expect(await customer.PutAsJsonAsync(path,forged),HttpStatusCode.BadRequest);
        forged=JsonSerializer.SerializeToNode(input,Json)!.AsObject();forged["lines"]![0]!["unitPriceRial"]="1";await Expect(await customer.PutAsJsonAsync(path,forged),HttpStatusCode.BadRequest);
        var raw=JsonSerializer.Serialize(input,Json);using(var duplicate=new StringContent(raw[..^1]+",\"Reason\":\"ambiguous duplicate\"}",Encoding.UTF8,"application/json"))await Expect(await customer.PutAsync(path,duplicate),HttpStatusCode.BadRequest);
        using(var huge=new StringContent(JsonSerializer.Serialize(input with{Reason=new string('x',33000)},Json),Encoding.UTF8,"application/json"))await Expect(await customer.PutAsync(path,huge),HttpStatusCode.RequestEntityTooLarge);
        var policyBody=JsonSerializer.SerializeToNode(RmaSqlHarness.Policy(current.Current!.Version),Json)!.AsObject();policyBody.Remove("maxOpenPerOwner");await Expect(await fixture.Admin.PutAsJsonAsync("/api/admin/returns/policy/commands/"+Id(),policyBody),HttpStatusCode.BadRequest);
        Assert.Equal(before,await RmaFacts());Assert.Equal(original,await order.OriginalFacts());
    }

    [Fact]
    public async Task HistoricalHttpReceiptsReplayWithoutDuplicatingAuditOrExposingStaffNotes()
    {
        await Policy();var order=await RmaSqlTests.HttpOrder(fixture);using var customer=order.Customer;var created=await Submit(order);var id=created.Result.Case.Case.Id;var original=await order.OriginalFacts();var path=CreatePath(order,created.Command);
        var replay=Value<RmaCommandResult>(await Expect(await customer.PutAsJsonAsync(path,created.Input)));Assert.Equal(RmaRules.Serialize(created.Result with{Replayed=true}),RmaRules.Serialize(replay));
        await Expect(await customer.PutAsJsonAsync(path,created.Input with{Reason="A different command body"}),HttpStatusCode.Conflict);
        var reviewCommand=Id();var note="Never expose this staff-only investigation "+Id();var reviewPath=$"/api/admin/returns/{id}/commands/{reviewCommand}";var reviewed=Value<RmaCommandResult>(await Expect(await fixture.Admin.PutAsJsonAsync(reviewPath,new ReviewRmaInput(order.Owner,created.Result.Case.Case.Version,"startReview",null,note,"Manual review started",true))));
        var own=Value<RmaDetail>(await Expect(await customer.GetAsync("/api/returns/"+id)));Assert.DoesNotContain(note,RmaRules.Serialize(own));var old=Value<RmaCommandResult>(await Expect(await customer.GetAsync("/api/returns/commands/"+created.Command)));Assert.Equal("submitted",old.Case.Case.State);Assert.Equal(RmaRules.Serialize(created.Result with{Replayed=true}),RmaRules.Serialize(old));
        var staff=Value<RmaCommandResult>(await Expect(await fixture.Admin.GetAsync("/api/admin/returns/commands/"+reviewCommand)));Assert.Equal(RmaRules.Serialize(reviewed with{Replayed=true}),RmaRules.Serialize(staff));
        var withdrawal=Id();var withdrawPath=$"/api/returns/{id}/withdrawals/{withdrawal}";var withdrawn=Value<RmaCommandResult>(await Expect(await customer.PutAsJsonAsync(withdrawPath,new WithdrawRmaInput(own.Case.Version,"Owner withdraws only the request",true))));Assert.Equal("withdrawn",withdrawn.Case.Case.State);Assert.False(withdrawn.Case.CanRefund);Assert.False(withdrawn.Case.CanReceive);
        await Scope(async sp=>{var db=sp.GetRequiredService<IdentityDbContext>();Assert.Equal(1,await db.Audit.CountAsync(x=>x.Resource==path&&x.Action=="RMA_SUBMIT"));Assert.Equal(1,await db.Audit.CountAsync(x=>x.Resource==reviewPath&&x.Action=="RMA_REVIEW_START"));Assert.Equal(1,await db.Audit.CountAsync(x=>x.Resource==withdrawPath&&x.Action=="RMA_WITHDRAW"));var audits=await db.Audit.Where(x=>x.Resource==path||x.Resource==reviewPath||x.Resource==withdrawPath).ToArrayAsync();Assert.DoesNotContain(note,JsonSerializer.Serialize(audits,Json));Assert.DoesNotContain(created.Input.Reason,JsonSerializer.Serialize(audits,Json));return true;});
        Assert.Equal(original,await order.OriginalFacts());
    }

    [Theory]
    [InlineData("policy")]
    [InlineData("submit")]
    [InlineData("withdraw")]
    [InlineData("startReview")]
    [InlineData("completeReview")]
    public async Task EveryHttpWriteRollsBackWhenItsIdentityAuditFailsThenSameCommandCommitsOnce(string operation)
    {
        var policy=await Policy();var order=await RmaSqlTests.HttpOrder(fixture);using var customer=order.Customer;var command=Id();HttpClient client=fixture.Admin;string path;string action;object input;
        if(operation=="policy"){path="/api/admin/returns/policy/commands/"+command;action="RMA_POLICY_WRITE";input=RmaSqlHarness.Policy(policy.Policy.Current!.Version) with{Note="Private policy audit fault note"};}
        else if(operation=="submit"){
            var context=Value<RmaOrderContext>(await Expect(await customer.GetAsync(ContextPath(order))));client=customer;path=CreatePath(order,command);action="RMA_SUBMIT";input=new CreateRmaInput(context.Policy.Current!.Id,context.OrderVersion,"physicalReturn",[new(context.Lines.Single().LineKey,1)],"Private submission audit fault reason",true);
        }else{
            var created=await Submit(order);var id=created.Result.Case.Case.Id;var version=created.Result.Case.Case.Version;
            if(operation=="withdraw"){client=customer;path=$"/api/returns/{id}/withdrawals/{command}";action="RMA_WITHDRAW";input=new WithdrawRmaInput(version,"Private withdrawal audit fault reason",true);}
            else{
                if(operation=="completeReview"){var reviewing=Value<RmaCommandResult>(await Expect(await fixture.Admin.PutAsJsonAsync($"/api/admin/returns/{id}/commands/{Id()}",new ReviewRmaInput(order.Owner,version,"startReview",null,"Synthetic review setup",null,true))));version=reviewing.Case.Case.Version;}
                path=$"/api/admin/returns/{id}/commands/{command}";action=operation=="startReview"?"RMA_REVIEW_START":"RMA_REVIEW_COMPLETE";input=new ReviewRmaInput(order.Owner,version,operation,operation=="completeReview"?"declined":null,"Private review audit fault note",null,true);
            }
        }
        var before=await RmaFacts();var original=await order.OriginalFacts();
        var sql=action switch{
            "RMA_POLICY_WRITE"=>"ALTER TABLE [identity].[Audit] WITH NOCHECK ADD CONSTRAINT [CK_RmaHttpQaAuditFailure] CHECK ([Action]<>'RMA_POLICY_WRITE')",
            "RMA_SUBMIT"=>"ALTER TABLE [identity].[Audit] WITH NOCHECK ADD CONSTRAINT [CK_RmaHttpQaAuditFailure] CHECK ([Action]<>'RMA_SUBMIT')",
            "RMA_WITHDRAW"=>"ALTER TABLE [identity].[Audit] WITH NOCHECK ADD CONSTRAINT [CK_RmaHttpQaAuditFailure] CHECK ([Action]<>'RMA_WITHDRAW')",
            "RMA_REVIEW_START"=>"ALTER TABLE [identity].[Audit] WITH NOCHECK ADD CONSTRAINT [CK_RmaHttpQaAuditFailure] CHECK ([Action]<>'RMA_REVIEW_START')",
            _=>"ALTER TABLE [identity].[Audit] WITH NOCHECK ADD CONSTRAINT [CK_RmaHttpQaAuditFailure] CHECK ([Action]<>'RMA_REVIEW_COMPLETE')"};
        await Scope(async sp=>{await sp.GetRequiredService<IdentityDbContext>().Database.ExecuteSqlRawAsync(sql);return true;});
        try{await Expect(await client.PutAsJsonAsync(path,input),HttpStatusCode.Conflict);}
        finally{await Scope(async sp=>{await sp.GetRequiredService<IdentityDbContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] DROP CONSTRAINT [CK_RmaHttpQaAuditFailure]");return true;});}
        Assert.Equal(before,await RmaFacts());Assert.Equal(original,await order.OriginalFacts());
        var committed=await Expect(await client.PutAsJsonAsync(path,input),operation=="submit"?HttpStatusCode.Created:HttpStatusCode.OK);Assert.False(committed["replayed"]!.GetValue<bool>());
        var replay=await Expect(await client.PutAsJsonAsync(path,input));Assert.True(replay["replayed"]!.GetValue<bool>());var expected=committed.DeepClone();expected["replayed"]=true;Assert.Equal(expected.ToJsonString(),replay.ToJsonString());
        await Scope(async sp=>{var identity=sp.GetRequiredService<IdentityDbContext>();Assert.Equal(1,await identity.Audit.CountAsync(x=>x.Resource==path&&x.Action==action));var db=sp.GetRequiredService<SalesDbContext>();Assert.Equal(1,operation=="policy"?await db.RmaPolicyCommands.CountAsync(x=>x.CommandId==command):await db.RmaCaseCommands.CountAsync(x=>x.CommandId==command));return true;});
        Assert.Equal(original,await order.OriginalFacts());
    }
}
