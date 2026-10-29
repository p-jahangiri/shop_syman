using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Credit;
using Shop.Modules.Identity;
using Shop.Modules.Inventory;
using Shop.Modules.Sales;
using Xunit;
using IdentityContext=Shop.Modules.Identity.IdentityDbContext;
namespace Shop.SqlTests;
public abstract class CreditRequirementsSqlBase(SqlFixture fixture)
{
    protected readonly SqlFixture sql=fixture;
    protected static string Id()=>Guid.NewGuid().ToString("N");
    protected async Task<(HttpClient Client,string Owner)> Customer(){await using var scope=sql.Factory.Services.CreateAsyncScope();var users=scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>();var name="creditqa"+Id();var user=new ShopUser{UserName=name,Email=name+"@example.test",EmailConfirmed=true};Assert.True((await users.CreateAsync(user,sql.Password)).Succeeded);var signed=await scope.ServiceProvider.GetRequiredService<AuthService>().PasswordAsync(new(name,sql.Password),true,true,false,default);var client=sql.Factory.CreateClient(new(){HandleCookies=false});client.DefaultRequestHeaders.Authorization=new("Bearer",signed.AccessToken);client.DefaultRequestHeaders.Add("Origin","http://127.0.0.1:3000");return(client,user.Id.ToUpperInvariant());}
    protected async Task<HttpClient> Staff(string role,Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactory<Program>? authFactory=null){var factory=authFactory??sql.Factory;await using var scope=factory.Services.CreateAsyncScope();var users=scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>();var name="creditstaff"+Id();var user=new ShopUser{UserName=name,Email=name+"@example.test",EmailConfirmed=true,RequireMfa=true};Assert.True((await users.CreateAsync(user,sql.Password)).Succeeded);Assert.True((await users.AddToRoleAsync(user,role)).Succeeded);var client=factory.CreateClient(new(){HandleCookies=false});client.DefaultRequestHeaders.Add("Origin","http://127.0.0.1:3173");client.DefaultRequestHeaders.Add("X-Sayman-Client","admin");client.DefaultRequestHeaders.Add("X-Sayman-Admin","1");var pending=await Read(await client.PostAsJsonAsync("/api/auth/password",new{Identifier=name,Password=sql.Password}));client.DefaultRequestHeaders.Authorization=new("Bearer",pending["accessToken"]!.GetValue<string>());using(var forbidden=await client.GetAsync("/api/admin/credit/applications"))Assert.Equal(HttpStatusCode.Forbidden,forbidden.StatusCode);var setup=await Read(await client.PostAsJsonAsync("/api/auth/mfa/setup",new{}));client.DefaultRequestHeaders.Authorization=new("Bearer",setup["accessToken"]!.GetValue<string>());var signed=await Read(await client.PostAsJsonAsync("/api/auth/mfa/verify",new{Code=Totp.Code(setup["secret"]!.GetValue<string>(),DateTimeOffset.UtcNow.ToUnixTimeSeconds()/30)}));client.DefaultRequestHeaders.Authorization=new("Bearer",signed["accessToken"]!.GetValue<string>());return client;}
    protected async Task<CreditApplicationPlanOption> Plan(){await using var scope=sql.Factory.Services.CreateAsyncScope();var service=scope.ServiceProvider.GetRequiredService<CreditPlanService>();var id=await service.SaveAsync(null,new("طرح ساختگی آزمون پرونده","Synthetic application QA plan",6,3000,2500,1,true,null,null,[],null,10),default);var row=await scope.ServiceProvider.GetRequiredService<CreditDbContext>().Plans.AsNoTracking().SingleAsync(x=>x.Id==id);return new(row.Id,Convert.ToBase64String(row.Version),row.NameFa,row.NameEn,row.Months,row.MarkupBasisPoints,row.DownPaymentBasisPoints,row.IntervalMonths,row.RoundingUnitRial.ToString(System.Globalization.CultureInfo.InvariantCulture),null,null,0);}
    protected static CreateCreditApplicationInput Input(CreditApplicationPlanOption plan)=>new(plan.Id,plan.Version,"9007199254740993","fa");
    protected static async Task<JsonNode> Read(HttpResponseMessage response,string? capture=null){using(response){var raw=await response.Content.ReadAsStringAsync();Assert.True(response.IsSuccessStatusCode,$"HTTP{(int)response.StatusCode}: {raw}");if(capture is not null&&Environment.GetEnvironmentVariable("SHOP_CREDIT_REQUIREMENTS_WIRE_DIR")is{Length:>0}dir){Directory.CreateDirectory(dir);await File.WriteAllTextAsync(Path.Combine(dir,capture+".json"),raw);await File.WriteAllTextAsync(Path.Combine(dir,capture+".meta.json"),JsonSerializer.Serialize(new{actualSqlHttpResponse=true,syntheticQaOnly=true,status=(int)response.StatusCode,method=response.RequestMessage!.Method.Method,path=response.RequestMessage.RequestUri!.PathAndQuery,cacheControl=response.Headers.CacheControl?.ToString()}));}return JsonNode.Parse(raw)!;}}
    protected static string Value(JsonNode node,string key)=>node[key]!.GetValue<string>();
    protected static CreditRequirementsContent Content(string suffix="one",bool enabled=true)=>new("شرایط ساختگی "+suffix,"Synthetic requirements "+suffix,"فقط آزمون ساختگی؛ هیچ تعهد واقعی یا سند هویتی نیست. "+suffix,"Synthetic QA only; no real agreement or identity document. "+suffix,"متن ساختگی همین نسخه را در آزمون خواندم.","I read this exact synthetic test revision.",enabled,[new("sample-proof","مدرک ساختگی آزمون","Synthetic test proof","فقط فایل ساختگی","Synthetic files only",true,8388608,["image/png","application/pdf"])]);
    protected async Task<JsonNode> Publish(HttpClient staff,CreditRequirementsContent content,string? capture=null)
    {
        var current=await Read(await staff.GetAsync("/api/admin/credit/requirements"));return await Read(await staff.PostAsJsonAsync("/api/admin/credit/requirements/commands/"+Id(),new PublishCreditRequirementsInput(current["version"]?.GetValue<string>(),content)),capture);
    }
    protected async Task<JsonNode> Draft(HttpClient customer)
    {
        var plan=await Plan();return(await Read(await customer.PostAsJsonAsync("/api/credit/applications/commands/"+Id(),Input(plan))))["application"]!;
    }
    protected static AcceptCreditRequirementsInput Acceptance(JsonNode app,JsonNode current,string locale="fa")=>new(Value(app,"version"),Value(current["published"]!,"id"),Value(current,"version"),locale,true);
    protected async Task AuditConstraint(string action,bool add)
    {
        Assert.Contains(action,new[]{"CREDIT_REQUIREMENTS","CREDIT_CONSENT"});await using var scope=sql.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<IdentityContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);
        await db.Database.ExecuteSqlRawAsync(add?"ALTER TABLE [identity].[Audit] WITH NOCHECK ADD CONSTRAINT CK_CreditRequirementsAuditFailure CHECK ([Action]<>'"+action+"')":"ALTER TABLE [identity].[Audit] DROP CONSTRAINT CK_CreditRequirementsAuditFailure");
    }
}

public sealed class CreditRequirementsSqlTests(SqlFixture fixture):CreditRequirementsSqlBase(fixture),IClassFixture<SqlFixture>
{
    [Fact]public async Task ConsentRetainsTheExactPublishedRevisionLanguageAndReceiptWithoutApprovingOrReservingAnything()
    {
        using var finance=await Staff("FinanceManager");var first=await Publish(finance,Content(),"published");var current=first["current"]!;var person=await Customer();using var customer=person.Client;var app=await Draft(customer);var id=Value(app,"id");
        var before=await Read(await customer.GetAsync($"/api/credit/applications/{id}/requirements"),"case-before");Assert.True(before["canConsent"]!.GetValue<bool>());Assert.Null(before["consent"]);
        var command=Id();var input=Acceptance(app,current,"en");var path=$"/api/credit/applications/{id}/consents/{command}";var accepted=await Read(await customer.PostAsJsonAsync(path,input),"accepted");Assert.Equal("en",Value(accepted["consent"]!,"locale"));Assert.Equal(Value(current["published"]!,"id"),Value(accepted["consent"]!["requirements"]!,"id"));Assert.NotEqual(Value(app,"version"),Value(accepted["application"]!,"version"));
        var exact=await Read(await customer.GetAsync($"/api/credit/applications/{id}/requirements"),"case-accepted");Assert.False(exact["canConsent"]!.GetValue<bool>());Assert.DoesNotContain(person.Owner,exact.ToJsonString(),StringComparison.OrdinalIgnoreCase);Assert.Equal(Content().TermsFa,Value(exact["consent"]!["requirements"]!["content"]!,"termsFa"));
        var replay=await Read(await customer.PostAsJsonAsync(path,input),"accept-replay");Assert.True(replay["replayed"]!.GetValue<bool>());Assert.Equal(accepted["consent"]!.ToJsonString(),replay["consent"]!.ToJsonString());
        await Publish(finance,Content("disabled",false));var disabled=await Read(await customer.GetAsync($"/api/credit/applications/{id}/requirements"));Assert.False(disabled["canConsent"]!.GetValue<bool>());Assert.Equal(Content().TermsFa,Value(disabled["consent"]!["requirements"]!["content"]!,"termsFa"));
        await Publish(finance,Content("two"));var changed=await Read(await customer.GetAsync($"/api/credit/applications/{id}/requirements"),"case-changed");Assert.True(changed["canConsent"]!.GetValue<bool>());Assert.NotEqual(Value(changed["current"]!["published"]!,"id"),Value(changed["consent"]!["requirements"]!,"id"));
        using(var stale=await customer.PostAsJsonAsync($"/api/credit/applications/{id}/consents/{Id()}",input))Assert.Equal(HttpStatusCode.Conflict,stale.StatusCode);
        var cancelled=await Read(await customer.PutAsJsonAsync($"/api/credit/applications/{id}/cancel/{Id()}",new CancelCreditApplicationInput(Value(accepted["application"]!,"version"))));Assert.Equal("Cancelled",Value(cancelled["application"]!,"state"));
        var receipt=await Read(await customer.GetAsync(path),"historical-consent-receipt");Assert.True(receipt["replayed"]!.GetValue<bool>());Assert.Equal("Draft",Value(receipt["application"]!,"state"));Assert.Equal(accepted["consent"]!.ToJsonString(),receipt["consent"]!.ToJsonString());
        var draftDetail=await Read(await customer.GetAsync("/api/credit/applications/"+id));Assert.False(draftDetail["canSubmit"]!.GetValue<bool>());
        await using var scope=sql.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<CreditDbContext>();Assert.Single(await db.RequirementsConsents.Where(x=>x.ApplicationId==id).ToArrayAsync());Assert.Single(await db.RequirementsConsentCommands.Where(x=>x.ApplicationId==id).ToArrayAsync());Assert.Equal(3,await db.ApplicationEvents.CountAsync(x=>x.ApplicationId==id));Assert.Single(await scope.ServiceProvider.GetRequiredService<IdentityContext>().Audit.Where(x=>x.ActorId==person.Owner&&x.Action=="CREDIT_CONSENT").ToArrayAsync());Assert.Empty(await scope.ServiceProvider.GetRequiredService<SalesDbContext>().Orders.ToArrayAsync());Assert.Empty(await scope.ServiceProvider.GetRequiredService<InventoryDbContext>().Reservations.ToArrayAsync());
    }
    [Fact]public async Task PublishAndConsentAuditFailuresRollbackAllModuleStateAndOriginalCommandsCanBeRetried()
    {
        using var finance=await Staff("FinanceManager");var original=await Read(await finance.GetAsync("/api/admin/credit/requirements"));var publishCommand=Id();var publishPath="/api/admin/credit/requirements/commands/"+publishCommand;var input=new PublishCreditRequirementsInput(original["version"]?.GetValue<string>(),Content("audit"));
        await AuditConstraint("CREDIT_REQUIREMENTS",true);try{using var failed=await finance.PostAsJsonAsync(publishPath,input);Assert.Equal(HttpStatusCode.Conflict,failed.StatusCode);}finally{await AuditConstraint("CREDIT_REQUIREMENTS",false);}
        Assert.Equal(original.ToJsonString(),(await Read(await finance.GetAsync("/api/admin/credit/requirements"))).ToJsonString());
        await using(var scope=sql.Factory.Services.CreateAsyncScope())Assert.Empty(await scope.ServiceProvider.GetRequiredService<CreditDbContext>().RequirementsPublishCommands.Where(x=>x.CommandId==publishCommand).ToArrayAsync());
        var published=await Read(await finance.PostAsJsonAsync(publishPath,input));var person=await Customer();using var customer=person.Client;var app=await Draft(customer);var id=Value(app,"id");var consentCommand=Id();var consentPath=$"/api/credit/applications/{id}/consents/{consentCommand}";var accept=Acceptance(app,published["current"]!);
        await AuditConstraint("CREDIT_CONSENT",true);try{using var failed=await customer.PostAsJsonAsync(consentPath,accept);Assert.Equal(HttpStatusCode.Conflict,failed.StatusCode);}finally{await AuditConstraint("CREDIT_CONSENT",false);}
        await using(var scope=sql.Factory.Services.CreateAsyncScope()){
            var db=scope.ServiceProvider.GetRequiredService<CreditDbContext>();var row=await db.Applications.AsNoTracking().SingleAsync(x=>x.Id==id);Assert.Null(row.CurrentConsentId);Assert.Equal(Value(app,"version"),Convert.ToBase64String(row.Version));Assert.Empty(await db.RequirementsConsents.Where(x=>x.ApplicationId==id).ToArrayAsync());Assert.Empty(await db.RequirementsConsentCommands.Where(x=>x.ApplicationId==id).ToArrayAsync());Assert.Single(await db.ApplicationEvents.Where(x=>x.ApplicationId==id).ToArrayAsync());
        }
        await Read(await customer.PostAsJsonAsync(consentPath,accept));await using(var scope=sql.Factory.Services.CreateAsyncScope()){
            var db=scope.ServiceProvider.GetRequiredService<CreditDbContext>();var migrationSource=(await db.Database.GetAppliedMigrationsAsync()).ToArray();var error=await Assert.ThrowsAsync<SqlException>(()=>db.GetService<IMigrator>().MigrateAsync("20261022121338_ChequeRoundingUnit"));Assert.Equal(51000,error.Number);await db.Database.MigrateAsync();Assert.Equal(migrationSource,await db.Database.GetAppliedMigrationsAsync());Assert.False(db.Database.HasPendingModelChanges());Assert.Single(await db.RequirementsConsents.Where(x=>x.ApplicationId==id).ToArrayAsync());Assert.NotNull((await db.Applications.AsNoTracking().SingleAsync(x=>x.Id==id)).CurrentConsentId);
        }
    }
    [Fact]public async Task ConcurrentPublishingAndConsentHaveOneDurableResultAndDoNotOverwriteNewerVersions()
    {
        using var finance=await Staff("FinanceManager");var current=await Read(await finance.GetAsync("/api/admin/credit/requirements"));var command=Id();var path="/api/admin/credit/requirements/commands/"+command;var input=new PublishCreditRequirementsInput(current["version"]?.GetValue<string>(),Content("race"));
        var results=await Task.WhenAll((await Task.WhenAll(finance.PostAsJsonAsync(path,input),finance.PostAsJsonAsync(path,input))).Select(x=>Read(x)));Assert.Single(results,x=>x["replayed"]!.GetValue<bool>());Assert.Single(results,x=>!x["replayed"]!.GetValue<bool>());
        using(var mismatch=await finance.PostAsJsonAsync(path,input with{Content=Content("changed")}))Assert.Equal(HttpStatusCode.Conflict,mismatch.StatusCode);
        var person=await Customer();using var customer=person.Client;var app=await Draft(customer);var id=Value(app,"id");var consentId=Id();var consentPath=$"/api/credit/applications/{id}/consents/{consentId}";var accept=Acceptance(app,results[0]["current"]!);
        var accepted=await Task.WhenAll((await Task.WhenAll(customer.PostAsJsonAsync(consentPath,accept),customer.PostAsJsonAsync(consentPath,accept))).Select(x=>Read(x)));Assert.Single(accepted,x=>x["replayed"]!.GetValue<bool>());Assert.Single(accepted,x=>!x["replayed"]!.GetValue<bool>());
        using(var mismatch=await customer.PostAsJsonAsync(consentPath,accept with{Locale="en"}))Assert.Equal(HttpStatusCode.Conflict,mismatch.StatusCode);
        using(var stale=await customer.PutAsJsonAsync($"/api/credit/applications/{id}/cancel/{Id()}",new CancelCreditApplicationInput(Value(app,"version"))))Assert.Equal(HttpStatusCode.Conflict,stale.StatusCode);
        var nextInput=new PublishCreditRequirementsInput(Value(results[0]["current"]!,"version"),Content("next"));var next=await Task.WhenAll(finance.PostAsJsonAsync("/api/admin/credit/requirements/commands/"+Id(),nextInput),finance.PostAsJsonAsync("/api/admin/credit/requirements/commands/"+Id(),nextInput));Assert.Single(next,x=>x.StatusCode==HttpStatusCode.OK);Assert.Single(next,x=>x.StatusCode==HttpStatusCode.Conflict);foreach(var response in next)response.Dispose();
        await using var scope=sql.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<CreditDbContext>();Assert.Single(await db.RequirementsConsents.Where(x=>x.ApplicationId==id).ToArrayAsync());Assert.Equal(2,await db.ApplicationEvents.CountAsync(x=>x.ApplicationId==id));Assert.Single(await scope.ServiceProvider.GetRequiredService<IdentityContext>().Audit.Where(x=>x.ActorId==person.Owner&&x.Action=="CREDIT_CONSENT").ToArrayAsync());
    }
    [Fact]public async Task CurrentConsentForeignKeyCannotPointAtAnotherApplicationAndHistorySummariesDoNotLoadTerms()
    {
        using var finance=await Staff("FinanceManager");var published=await Publish(finance,Content("scope"));var person=await Customer();using var customer=person.Client;var app=await Draft(customer);var other=await Draft(customer);var id=Value(app,"id");var otherId=Value(other,"id");var accepted=await Read(await customer.PostAsJsonAsync($"/api/credit/applications/{id}/consents/{Id()}",Acceptance(app,published["current"]!)));var consentId=Value(accepted["consent"]!,"id");
        await using(var scope=sql.Factory.Services.CreateAsyncScope()){
            var db=scope.ServiceProvider.GetRequiredService<CreditDbContext>();var error=await Assert.ThrowsAsync<SqlException>(()=>db.Database.ExecuteSqlInterpolatedAsync($"UPDATE [credit].[Applications] SET [CurrentConsentId]={consentId} WHERE [Id]={otherId}"));Assert.Equal(547,error.Number);
        }
        var history=await Read(await finance.GetAsync("/api/admin/credit/requirements/history"),"history");Assert.DoesNotContain("termsFa",history.ToJsonString());Assert.NotEmpty(history["items"]!.AsArray());var revision=await Read(await finance.GetAsync("/api/admin/credit/requirements/revisions/"+Value(published["current"]!["published"]!,"id")),"revision");Assert.Equal(Content("scope").TermsFa,Value(revision["content"]!,"termsFa"));
    }
}

// A separate real factory preserves the production authentication limiter.
// Seven password/setup/verify flows in one minute would correctly return 429.
public sealed class CreditRequirementsAuthorizationSqlTests(SqlFixture fixture):CreditRequirementsSqlBase(fixture),IClassFixture<SqlFixture>
{
    [Fact]public async Task PolicyManagementAndPrivateReviewAreSeparateAndConsentCannotBeForgedByForeignCustomersOrStaff()
    {
        using var finance=await Staff("FinanceManager");var published=await Publish(finance,Content());var person=await Customer();using var customer=person.Client;var foreign=await Customer();using var other=foreign.Client;var app=await Draft(customer);var id=Value(app,"id");var input=Acceptance(app,published["current"]!);var path=$"/api/credit/applications/{id}/consents/{Id()}";
        using(var denied=await other.PostAsJsonAsync(path,input))Assert.Equal(HttpStatusCode.NotFound,denied.StatusCode);using(var denied=await other.GetAsync($"/api/credit/applications/{id}/requirements"))Assert.Equal(HttpStatusCode.NotFound,denied.StatusCode);
        using(var denied=await finance.GetAsync($"/api/admin/credit/applications/{id}/requirements"))Assert.Equal(HttpStatusCode.Forbidden,denied.StatusCode);
        using(var reviewer=await Staff("CreditReviewer")){
            await Read(await reviewer.GetAsync($"/api/admin/credit/applications/{id}/requirements"),"reviewer-case");using var denied=await reviewer.GetAsync("/api/admin/credit/requirements");Assert.Equal(HttpStatusCode.Forbidden,denied.StatusCode);
        }
        using(var catalog=await Staff("CatalogManager")){
            await Read(await catalog.GetAsync("/api/admin/credit/requirements"));using var denied=await catalog.PostAsJsonAsync("/api/admin/credit/requirements/commands/"+Id(),new PublishCreditRequirementsInput(Value(published["current"]!,"version"),Content("forbidden")));Assert.Equal(HttpStatusCode.Forbidden,denied.StatusCode);
        }
        using(var notAccepted=await customer.PostAsJsonAsync(path,input with{Accepted=false}))Assert.Equal(HttpStatusCode.BadRequest,notAccepted.StatusCode);
        using(var oversized=await finance.PostAsync("/api/admin/credit/requirements/commands/"+Id(),new StringContent(new string(' ',49153),Encoding.UTF8,"application/json")))Assert.Equal(HttpStatusCode.RequestEntityTooLarge,oversized.StatusCode);
        using(var injected=await customer.PostAsJsonAsync(path,new{input.ApplicationVersion,input.RequirementsRevisionId,input.RequirementsVersion,input.Locale,input.Accepted,approved=true}))Assert.Equal(HttpStatusCode.BadRequest,injected.StatusCode);
        using(var query=await customer.GetAsync($"/api/credit/applications/{id}/requirements?ownerId={person.Owner}"))Assert.Equal(HttpStatusCode.BadRequest,query.StatusCode);
        using(var anonymous=sql.Factory.CreateClient(new(){HandleCookies=false})){using var denied=await anonymous.GetAsync("/api/credit/requirements");Assert.Equal(HttpStatusCode.Unauthorized,denied.StatusCode);Assert.Contains("no-store",denied.Headers.CacheControl!.ToString());Assert.Contains("noindex",denied.Headers.GetValues("X-Robots-Tag").Single());}
        var accepted=await Read(await customer.PostAsJsonAsync(path,input));using(var denied=await other.GetAsync(path))Assert.Equal(HttpStatusCode.NotFound,denied.StatusCode);Assert.Equal("Draft",Value(accepted["application"]!,"state"));
    }
}
