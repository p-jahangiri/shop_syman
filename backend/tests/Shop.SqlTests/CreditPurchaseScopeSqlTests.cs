using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.IdentityModel.Tokens;
using System.Data;
using System.Text.Json;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Credit;
using Shop.Modules.Inventory;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;
using IdentityContext=Shop.Modules.Identity.IdentityDbContext;
namespace Shop.SqlTests;
public sealed class CreditPurchaseScopeSqlTests(SqlFixture fixture):CreditRequirementsSqlBase(fixture),IClassFixture<SqlFixture>,IDisposable
{
    private WebApplicationFactory<Program>? staffFactory;
    private Task<HttpClient> Staff(string role)=>base.Staff(role,staffFactory??=sql.Factory.WithWebHostBuilder(_=>{}));
    public void Dispose()=>staffFactory?.Dispose();
    private static async Task<JsonNode> Wire(HttpResponseMessage response)
    {
        var raw=await response.Content.ReadAsStringAsync();var value=await Read(response);
        if(response.RequestMessage!.RequestUri!.AbsolutePath.Contains("/purchase-scope")&&Environment.GetEnvironmentVariable("SHOP_CREDIT_SCOPE_WIRE_DIR")is{Length:>0}dir){
            Directory.CreateDirectory(dir);var name=Guid.NewGuid().ToString("N");await File.WriteAllTextAsync(Path.Combine(dir,name+".json"),raw);
            await File.WriteAllTextAsync(Path.Combine(dir,name+".meta.json"),JsonSerializer.Serialize(new{actualSqlHttpResponse=true,syntheticQaOnly=true,status=(int)response.StatusCode,method=response.RequestMessage.Method.Method,path=response.RequestMessage.RequestUri.PathAndQuery,cacheControl=response.Headers.CacheControl?.ToString()}));
        }
        return value;
    }
    private async Task<JsonNode> Approved(HttpClient customer,HttpClient finance,HttpClient reviewer,DateTimeOffset? until=null)
    {
        var current=(await Publish(finance,Content("purchase-scope")with{Documents=[]}))["current"]!;
        var app=await Draft(customer); var path="/api/credit/applications/"+Value(app,"id");
        await Wire(await customer.PostAsJsonAsync(path+"/consents/"+Id(),Acceptance(app,current)));
        var ready=await Wire(await customer.GetAsync(path+"/submission"));
        var submitted=await Wire(await customer.PostAsJsonAsync(path+"/submissions/commands/"+Id(),new SubmitCreditApplicationInput(Value(ready["application"]!,"version"),Value(ready,"consentId"),Value(ready,"requirementsRevisionId"),Value(ready,"requirementsVersion"),"fa","ساختگی برای آزمون؛ تصمیم واقعی نیست",true)));
        return await Wire(await reviewer.PostAsJsonAsync(path.Replace("/api/credit/","/api/admin/credit/")+"/reviews/commands/"+Id(),new ReviewCreditApplicationInput(Value(submitted["application"]!,"version"),Value(submitted["submission"]!,"id"),"Approved","fa","تأیید ساختگی QA؛ هیچ شخص واقعی نیست","9007199254740993",until??DateTimeOffset.UtcNow.AddHours(1),true)));
    }
    private static string Base(JsonNode app,bool staff=false)=>(staff?"/api/admin/credit/applications/":"/api/credit/applications/")+Value(app["application"]!,"id")+"/purchase-scope";
    private static GrantCreditPurchaseScopeInput Grant(JsonNode a,string basis="PayableTotalRial")=>new(Value(a["application"]!,"version"),Value(a["review"]!,"id"),basis,true);
    private static RevokeCreditPurchaseScopeInput Revoke(JsonNode a,string note="ابطال ساختگی QA 😀")=>new(Value(a["application"]!,"version"),Value(a["scope"]!,"version"),"fa",note,true);
    [Fact] public async Task ExplicitScopeCopiesApprovalAndOwnerRevokePreservesHistoricalReceiptAndCannotOrder()
    {
        using var finance=await Staff("FinanceManager");using var reviewer=await Staff("CreditReviewer");var person=await Customer();using var customer=person.Client;
        var approved=await Approved(customer,finance,reviewer);var path=Base(approved,true);
        var before=await Wire(await customer.GetAsync(Base(approved)));Assert.False(before["eligibleForQuote"]!.GetValue<bool>());Assert.Contains("credit_scope_required",before["quoteBlockers"]!.AsArray().Select(x=>x!.GetValue<string>()));Assert.False(before["canGrant"]!.GetValue<bool>());
        var command=Id();var input=Grant(approved);var granted=await Wire(await reviewer.PostAsJsonAsync(path+"/grant/"+command,input));
        Assert.Equal("9007199254740993",Value(granted["scope"]!,"limitAmountRial"));Assert.Equal(Value(approved["review"]!,"expiresAt"),Value(granted["scope"]!,"expiresAt"));Assert.NotEqual(input.ApplicationVersion,Value(granted["application"]!,"version"));
        var page=await Wire(await customer.GetAsync(Base(approved)));Assert.True(page["eligibleForQuote"]!.GetValue<bool>());Assert.False(page["canGrant"]!.GetValue<bool>());Assert.True(page["canRevoke"]!.GetValue<bool>());Assert.False(page["canPlaceOrder"]!.GetValue<bool>());Assert.False(page["canPay"]!.GetValue<bool>());
        var revokeCommand=Id();var revoked=await Wire(await customer.PostAsJsonAsync(Base(approved)+"/revoke/"+revokeCommand,Revoke(granted,"")));Assert.Equal("Revoked",Value(revoked["scope"]!,"state"));Assert.Equal("Owner",Value(revoked["scope"]!["revocation"]!,"actorKind"));Assert.NotEqual(Value(granted["application"]!,"version"),Value(revoked["application"]!,"version"));
        var replay=await Wire(await reviewer.PostAsJsonAsync(path+"/grant/"+command,input));Assert.True(replay["replayed"]!.GetValue<bool>());Assert.Equal("Active",Value(replay["scope"]!,"state"));Assert.Equal(Value(granted["application"]!,"version"),Value(replay["application"]!,"version"));
        var current=await Wire(await customer.GetAsync(Base(approved)));Assert.False(current["eligibleForQuote"]!.GetValue<bool>());Assert.False(current["canRevoke"]!.GetValue<bool>());Assert.Equal("Revoked",Value(current["scope"]!,"state"));
        await using var scope=sql.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<CreditDbContext>();var id=Value(approved["application"]!,"id");Assert.Single(await db.PurchaseScopes.Where(x=>x.ApplicationId==id).ToArrayAsync());Assert.Single(await db.ScopeRevocations.Where(x=>x.ApplicationId==id).ToArrayAsync());Assert.Equal(2,await db.ScopeCommands.CountAsync(x=>x.ApplicationId==id));Assert.Empty(await scope.ServiceProvider.GetRequiredService<SalesDbContext>().Orders.ToArrayAsync());Assert.Empty(await scope.ServiceProvider.GetRequiredService<InventoryDbContext>().Reservations.ToArrayAsync());
        Assert.Empty(await scope.ServiceProvider.GetRequiredService<IdentityContext>().Audit.Where(x=>x.Action=="CREDIT_PURCHASE_SCOPE"&&x.Resource.EndsWith(command)).Skip(1).ToArrayAsync());
    }
    [Fact] public async Task OwnerFinanceForeignOwnerAndAmbiguousInputsCannotGrantAndReceiptsRemainActorBound()
    {
        using var finance=await Staff("FinanceManager");using var reviewer=await Staff("CreditReviewer");using var anotherReviewer=await Staff("CreditReviewer");var p=await Customer();using var customer=p.Client;var stranger=await Customer();using var other=stranger.Client;
        var approved=await Approved(customer,finance,reviewer);var path=Base(approved,true);var input=Grant(approved);
        using(var r=await customer.PostAsJsonAsync(Base(approved)+"/grant/"+Id(),input))Assert.Contains(r.StatusCode,new[]{HttpStatusCode.NotFound,HttpStatusCode.MethodNotAllowed});using(var r=await finance.PostAsJsonAsync(path+"/grant/"+Id(),input))Assert.Equal(HttpStatusCode.Forbidden,r.StatusCode);
        foreach(var bad in new[]{input with{GrantConfirmed=false},input with{LimitBasis=""},input with{LimitBasis="Wallet"}})using(var r=await reviewer.PostAsJsonAsync(path+"/grant/"+Id(),bad))Assert.Equal(HttpStatusCode.BadRequest,r.StatusCode);
        using(var r=await reviewer.PostAsJsonAsync(path+"/grant/"+Id(),new{input.ApplicationVersion,input.ReviewId,input.LimitBasis,input.GrantConfirmed,amountRial="1"}))Assert.Equal(HttpStatusCode.BadRequest,r.StatusCode);
        var cmd=Id();var granted=await Wire(await reviewer.PostAsJsonAsync(path+"/grant/"+cmd,input with{LimitBasis="InstallmentsTotalRial"}));
        using(var r=await anotherReviewer.GetAsync(path+"/commands/"+cmd))Assert.Equal(HttpStatusCode.NotFound,r.StatusCode);using(var r=await other.GetAsync(Base(approved)))Assert.Equal(HttpStatusCode.NotFound,r.StatusCode);using(var r=await other.PostAsJsonAsync(Base(approved)+"/revoke/"+Id(),Revoke(granted)))Assert.Equal(HttpStatusCode.NotFound,r.StatusCode);
        using(var r=await reviewer.PostAsJsonAsync(path+"/grant/"+cmd,input))Assert.Equal(HttpStatusCode.Conflict,r.StatusCode);using(var r=await reviewer.PostAsJsonAsync(path+"/revoke/"+Id(),Revoke(granted,"")))Assert.Equal(HttpStatusCode.BadRequest,r.StatusCode);
        var revoked=await Wire(await reviewer.PostAsJsonAsync(path+"/revoke/"+Id(),Revoke(granted)));Assert.Equal("Staff",Value(revoked["scope"]!["revocation"]!,"actorKind"));
        await using var scope=sql.Factory.Services.CreateAsyncScope();var row=await scope.ServiceProvider.GetRequiredService<CreditDbContext>().ScopeRevocations.SingleAsync(x=>x.ScopeId==Value(granted["scope"]!,"id"));Assert.DoesNotContain("ابطال",Encoding.UTF8.GetString(row.ProtectedNote));
    }
    [Fact] public async Task AuditedRollbackAndConcurrentCommandsKeepOneScopeAndOneRevocation()
    {
        using var finance=await Staff("FinanceManager");using var reviewer=await Staff("CreditReviewer");var p=await Customer();using var customer=p.Client;var approved=await Approved(customer,finance,reviewer);var path=Base(approved,true);var cmd=Id();var input=Grant(approved);
        await using(var s=sql.Factory.Services.CreateAsyncScope()){var db=s.ServiceProvider.GetRequiredService<IdentityContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);await db.Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] WITH NOCHECK ADD CONSTRAINT CK_ScopeAuditFailure CHECK ([Action]<>'CREDIT_PURCHASE_SCOPE')");}
        try{using var r=await reviewer.PostAsJsonAsync(path+"/grant/"+cmd,input);Assert.Equal(HttpStatusCode.Conflict,r.StatusCode);}finally{await using var s=sql.Factory.Services.CreateAsyncScope();await s.ServiceProvider.GetRequiredService<IdentityContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] DROP CONSTRAINT CK_ScopeAuditFailure");}
        var unchanged=await Wire(await reviewer.GetAsync(path));Assert.Null(unchanged["scope"]);Assert.Equal(input.ApplicationVersion,Value(unchanged["application"]!,"version"));
        var replies=await Task.WhenAll((await Task.WhenAll(reviewer.PostAsJsonAsync(path+"/grant/"+cmd,input),reviewer.PostAsJsonAsync(path+"/grant/"+cmd,input))).Select(x=>Wire(x)));Assert.Single(replies,x=>x["replayed"]!.GetValue<bool>());var granted=replies[0];var revoke=Revoke(granted);var race=await Task.WhenAll(reviewer.PostAsJsonAsync(path+"/revoke/"+Id(),revoke),customer.PostAsJsonAsync(Base(approved)+"/revoke/"+Id(),revoke));Assert.Single(race,x=>x.StatusCode==HttpStatusCode.OK);Assert.Single(race,x=>x.StatusCode==HttpStatusCode.Conflict);foreach(var r in race)r.Dispose();
    }
    [Fact] public async Task QuoteAuthorityRequiresOwnerVersionsSerializableTransactionAndCurrentPlanWhileSqlGuardsRetainHistory()
    {
        using var finance=await Staff("FinanceManager");using var reviewer=await Staff("CreditReviewer");var p=await Customer();using var customer=p.Client;var approved=await Approved(customer,finance,reviewer);var granted=await Wire(await reviewer.PostAsJsonAsync(Base(approved,true)+"/grant/"+Id(),Grant(approved)));
        var id=Value(approved["application"]!,"id");var sid=Value(granted["scope"]!,"id");var av=Value(granted["application"]!,"version");var sv=Value(granted["scope"]!,"version");
        await using(var s=sql.Factory.Services.CreateAsyncScope()){var db=s.ServiceProvider.GetRequiredService<CreditDbContext>();var reader=s.ServiceProvider.GetRequiredService<ICreditPurchaseScopeReader>();var owner=(await db.Applications.AsNoTracking().SingleAsync(x=>x.Id==id)).OwnerId;
            await Assert.ThrowsAsync<InvalidOperationException>(()=>reader.ForQuoteAsync(owner,id,sid,av,sv,default));await using var tx=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var authority=await reader.ForQuoteAsync(owner,id,sid,av,sv,default);Assert.Equal(9007199254740993L,authority.LimitAmountRial);Assert.Equal("PayableTotalRial",authority.LimitBasis);
            await Assert.ThrowsAsync<BusinessException>(()=>reader.ForQuoteAsync("other",id,sid,av,sv,default));await Assert.ThrowsAsync<BusinessException>(()=>reader.ForQuoteAsync(owner,id,sid,"AAAAAAAAAAA=",sv,default));await tx.RollbackAsync();
        }
        await using(var s=sql.Factory.Services.CreateAsyncScope()){var db=s.ServiceProvider.GetRequiredService<CreditDbContext>();var app=await db.Applications.AsNoTracking().SingleAsync(x=>x.Id==id);var plan=await db.Plans.SingleAsync(x=>x.Id==app.PlanId);plan.NameEn+=" changed";await db.SaveChangesAsync();var owner=app.OwnerId;await using var tx=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);await Assert.ThrowsAsync<BusinessException>(()=>s.ServiceProvider.GetRequiredService<ICreditPurchaseScopeReader>().ForQuoteAsync(owner,id,sid,av,sv,default));await tx.RollbackAsync();}
        var cap=await Wire(await customer.GetAsync(Base(approved)));Assert.False(cap["eligibleForQuote"]!.GetValue<bool>());Assert.True(cap["canRevoke"]!.GetValue<bool>());await Wire(await customer.PostAsJsonAsync(Base(approved)+"/revoke/"+Id(),Revoke(granted)));
        await using(var s=sql.Factory.Services.CreateAsyncScope()){var db=s.ServiceProvider.GetRequiredService<CreditDbContext>();var e=await Assert.ThrowsAsync<SqlException>(()=>db.Database.ExecuteSqlInterpolatedAsync($"UPDATE [credit].[Applications] SET [CurrentReviewId]=NULL WHERE [Id]={id}"));Assert.Equal(547,e.Number);var migrationSource=(await db.Database.GetAppliedMigrationsAsync()).ToArray();var down=await Assert.ThrowsAsync<SqlException>(()=>db.GetService<IMigrator>().MigrateAsync("20261027092224_ManualCreditReviews"));Assert.Equal(51000,down.Number);await db.Database.MigrateAsync();Assert.Equal(migrationSource,await db.Database.GetAppliedMigrationsAsync());Assert.False(db.Database.HasPendingModelChanges());Assert.Single(await db.PurchaseScopes.Where(x=>x.ApplicationId==id).ToArrayAsync());}
    }
    private sealed class ScopeClock(DateTimeOffset now):TimeProvider { public override DateTimeOffset GetUtcNow()=>now; }
    [Fact] public async Task ExpiredScopesCannotBeUsedOrRevokedAndReadOnlyOrPendingMfaCannotWrite()
    {
        using var finance=await Staff("FinanceManager");using var reviewer=await Staff("CreditReviewer");var p=await Customer();using var customer=p.Client;var approved=await Approved(customer,finance,reviewer);var path=Base(approved,true);var original=reviewer.DefaultRequestHeaders.Authorization!;var handler=new JwtSecurityTokenHandler();var jwt=handler.ReadJwtToken(original.Parameter);
        string Token(IEnumerable<Claim> claims)=>handler.WriteToken(new JwtSecurityToken(jwt.Issuer,jwt.Audiences.Single(),claims.Where(x=>x.Type is not("exp"or"nbf")),DateTime.UtcNow.AddSeconds(-1),DateTime.UtcNow.AddMinutes(2),new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(new string('q',80))),SecurityAlgorithms.HmacSha256)));
        reviewer.DefaultRequestHeaders.Authorization=new("Bearer",Token(jwt.Claims.Where(x=>!(x.Type=="permission"&&x.Value=="credit.write"))));var readOnly=await Wire(await reviewer.GetAsync(path));Assert.False(readOnly["canGrant"]!.GetValue<bool>());using(var denied=await reviewer.PostAsJsonAsync(path+"/grant/"+Id(),Grant(approved)))Assert.Equal(HttpStatusCode.Forbidden,denied.StatusCode);
        reviewer.DefaultRequestHeaders.Authorization=new("Bearer",Token(jwt.Claims.Where(x=>x.Type!="token_kind").Append(new Claim("token_kind","mfa_pending"))));using(var denied=await reviewer.GetAsync(path))Assert.Equal(HttpStatusCode.Forbidden,denied.StatusCode);using(var denied=await reviewer.PostAsJsonAsync(path+"/grant/"+Id(),Grant(approved)))Assert.Equal(HttpStatusCode.Forbidden,denied.StatusCode);
        reviewer.DefaultRequestHeaders.Authorization=original;var granted=await Wire(await reviewer.PostAsJsonAsync(path+"/grant/"+Id(),Grant(approved)));var id=Value(granted["application"]!,"id");var sid=Value(granted["scope"]!,"id");
        await using var s=sql.Factory.Services.CreateAsyncScope();var db=s.ServiceProvider.GetRequiredService<CreditDbContext>();var owner=(await db.Applications.AsNoTracking().SingleAsync(x=>x.Id==id)).OwnerId;
        var future=DateTimeOffset.Parse(Value(granted["scope"]!,"expiresAt")).AddSeconds(1);var expired=ActivatorUtilities.CreateInstance<CreditPurchaseScopeService>(s.ServiceProvider,new ScopeClock(future));
        var cap=await expired.PageAsync(owner,false,true,id,default);Assert.Equal("Expired",cap.Scope!.State);Assert.False(cap.EligibleForQuote);Assert.False(cap.CanRevoke);
        await using var tx=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
        await Assert.ThrowsAsync<BusinessException>(()=>expired.ForQuoteAsync(owner,id,sid,Value(granted["application"]!,"version"),Value(granted["scope"]!,"version"),default));
        await Assert.ThrowsAsync<BusinessException>(()=>expired.RevokeAsync(owner,false,id,Id(),Revoke(granted),default));await tx.RollbackAsync();
        Assert.Empty(await db.ScopeRevocations.Where(x=>x.ApplicationId==id).ToArrayAsync());
    }

}
