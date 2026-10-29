using System.Data.Common;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Identity;
using Shop.Modules.Payments;
using Shop.Modules.Credit;
using Shop.SharedKernel;
using Xunit;
namespace Shop.SqlTests;
// Real SQL acceptance; no in-memory alternative. Compile/list does not execute these.
public sealed class FinancePagingSqlTests(OrderFixture fixture):IClassFixture<OrderFixture>
{
    private static Task<JsonNode> Json(HttpResponseMessage response)=>OrderFixture.Json(response);
    private async Task<string[]> Categories(){await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();return await scope.ServiceProvider.GetRequiredService<CatalogDbContext>().Categories.OrderBy(c=>c.Id).Select(c=>c.Id).Take(2).ToArrayAsync();}
    [Fact] public async Task MethodPagesSeekAcross101RowsSearchPersianTextAndPreserveFullLegacyReads()
    {
        var ids=await Categories();var prefix="methodpage-"+Guid.NewGuid().ToString("N")[..8];await using(var scope=fixture.Sql.Factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<PaymentsDbContext>();db.Methods.AddRange(Enumerable.Range(0,101).Select(i=>new PurchaseMethod{Id=prefix+"-"+i.ToString("D3"),NameFa=i==12?"روش كاربَر ۱۲":"روش "+i,NameEn="Method "+i,Kind=i%3==0?"cheque":"online",RequiresApproval=i%3==0,Enabled=i%2==0,MinAmountRial=9007199254740993,MaxAmountRial=long.MaxValue,Categories=i%3==2?[]:[new(){CategoryId=ids[i%2]}]}));await db.SaveChangesAsync();}
        var all=new List<string>();string? cursor=null;foreach(var count in new[]{50,50,1}){var page=await Json(await fixture.Admin.GetAsync("/api/admin/purchase-methods-page?query="+prefix+(cursor is null?"":"&cursor="+Uri.EscapeDataString(cursor))));Assert.Equal(count,page["items"]!.AsArray().Count);all.AddRange(page["items"]!.AsArray().Select(n=>n!["id"]!.GetValue<string>()));cursor=page["nextCursor"]?.GetValue<string>();Assert.DoesNotContain("AmountRial",page.ToJsonString());Assert.DoesNotContain("description",page.ToJsonString());}Assert.Null(cursor);Assert.Equal(101,all.Distinct().Count());
        var search=await Json(await fixture.Admin.GetAsync("/api/admin/purchase-methods-page?query="+Uri.EscapeDataString(prefix+" كاربر 12")));Assert.Single(search["items"]!.AsArray());Assert.Equal(prefix+"-012",search["items"]![0]!["id"]!.GetValue<string>());
        var scoped=await Json(await fixture.Admin.GetAsync("/api/admin/purchase-methods-page?query="+prefix+"&enabled=false&kind=online&categoryId="+ids[0]));Assert.All(scoped["items"]!.AsArray(),r=>{Assert.False(r!["enabled"]!.GetValue<bool>());Assert.Equal("online",r["kind"]!.GetValue<string>());Assert.Equal(0,r["categoryCount"]!.GetValue<int>());});
        var detail=await Json(await fixture.Admin.GetAsync("/api/admin/purchase-methods/"+all[0]));Assert.Equal("9007199254740993",detail["method"]!["minAmountRial"]!.GetValue<string>());Assert.Equal(long.MaxValue.ToString(),detail["method"]!["maxAmountRial"]!.GetValue<string>());var legacy=await Json(await fixture.Admin.GetAsync("/api/admin/purchase-methods"));Assert.Equal(101,legacy.AsArray().Count(n=>n!["id"]!.GetValue<string>().StartsWith(prefix,StringComparison.Ordinal)));
    }
    [Fact] public async Task PlanPagesAndSummaryDoNotTruncateOrCountOnlyTheFirstPage()
    {
        var prefix="planpage-"+Guid.NewGuid().ToString("N")[..8];await using(var scope=fixture.Sql.Factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<CreditDbContext>();db.Plans.AddRange(Enumerable.Range(0,101).Select(i=>new ChequePlan{Id=prefix+"-"+i.ToString("D3"),NameFa=i==12?"طرح كاربَر ۱۲":"طرح "+i,NameEn="Plan "+i,Months=6,IntervalMonths=2,MarkupBasisPoints=1500,DownPaymentBasisPoints=1000,RoundingUnitRial=1,Enabled=i%2==0}));await db.SaveChangesAsync();}
        string? cursor=null;var ids=new List<string>();foreach(var count in new[]{50,50,1}){var page=await Json(await fixture.Admin.GetAsync("/api/admin/cheque-plans-page?query="+prefix+(cursor is null?"":"&cursor="+Uri.EscapeDataString(cursor))));Assert.Equal(count,page["items"]!.AsArray().Count);ids.AddRange(page["items"]!.AsArray().Select(n=>n!["id"]!.GetValue<string>()));cursor=page["nextCursor"]?.GetValue<string>();}Assert.Null(cursor);Assert.Equal(101,ids.Distinct().Count());var detail=await Json(await fixture.Admin.GetAsync("/api/admin/cheque-plans/"+ids[0]));Assert.True(detail["plan"]!.AsObject().ContainsKey("minAmountRial"));Assert.Null(detail["plan"]!["minAmountRial"]);
        var marked=await Json(await fixture.Admin.GetAsync("/api/admin/cheque-plans-page?query="+Uri.EscapeDataString(prefix+" كاربر 12")));Assert.Single(marked["items"]!.AsArray());Assert.Equal(prefix+"-012",marked["items"]![0]!["id"]!.GetValue<string>());
        var summary=await Json(await fixture.Admin.GetAsync("/api/admin/purchase-summary"));await using var check=fixture.Sql.Factory.Services.CreateAsyncScope();var plans=check.ServiceProvider.GetRequiredService<CreditDbContext>();Assert.Equal((await plans.Plans.LongCountAsync()).ToString(),summary["plans"]!.GetValue<string>());Assert.Equal((await plans.Plans.LongCountAsync(p=>p.Enabled)).ToString(),summary["enabledPlans"]!.GetValue<string>());Assert.True(long.Parse(summary["enabledPlans"]!.GetValue<string>())>=51);
    }
    private static PurchaseMethodInput MethodInput(string[] ids,string? version=null)=>new("online","روش ثابت","Fixed method","","",false,false,"9007199254740993",null,ids,version);
    private static ChequePlanInput PlanInput(string[] ids,string? version=null)=>new("طرح ثابت","Fixed plan",6,1500,1000,2,false,"9007199254740993",null,ids,version);
    [Fact] public async Task CategoryOnlyEditsRotateBothParentVersionsAndRejectStaleOverwrites()
    {
        var categories=await Categories();var method=await Json(await fixture.Admin.PostAsJsonAsync("/api/admin/purchase-methods",MethodInput([categories[0]])));var plan=await Json(await fixture.Admin.PostAsJsonAsync("/api/admin/cheque-plans",PlanInput([categories[0]])));
        foreach(var isMethod in new[]{true,false}){var id=(isMethod?method:plan)["id"]!.GetValue<string>();var route="/api/admin/"+(isMethod?"purchase-methods/":"cheque-plans/")+id;var node=isMethod?"method":"plan";var before=await Json(await fixture.Admin.GetAsync(route));var version=before[node]!["version"]!.GetValue<string>();if(isMethod)await Json(await fixture.Admin.PutAsJsonAsync(route,MethodInput([categories[1]],version)));else await Json(await fixture.Admin.PutAsJsonAsync(route,PlanInput([categories[1]],version)));var after=await Json(await fixture.Admin.GetAsync(route));Assert.NotEqual(version,after[node]!["version"]!.GetValue<string>());Assert.Equal(categories[1],after[node]!["categoryIds"]![0]!.GetValue<string>());using var stale=isMethod?await fixture.Admin.PutAsJsonAsync(route,MethodInput([categories[0]],version)):await fixture.Admin.PutAsJsonAsync(route,PlanInput([categories[0]],version));Assert.Equal(HttpStatusCode.Conflict,stale.StatusCode);var current=after[node]!["version"]!.GetValue<string>();var races=isMethod?await Task.WhenAll(fixture.Admin.PutAsJsonAsync(route,MethodInput([categories[0]],current)),fixture.Admin.PutAsJsonAsync(route,MethodInput([],current))):await Task.WhenAll(fixture.Admin.PutAsJsonAsync(route,PlanInput([categories[0]],current)),fixture.Admin.PutAsJsonAsync(route,PlanInput([],current)));Assert.Single(races,r=>r.StatusCode==HttpStatusCode.OK);Assert.Single(races,r=>r.StatusCode==HttpStatusCode.Conflict);foreach(var response in races)response.Dispose();}
    }
    [Fact] public async Task ACategoryChangeBetweenHeaderAndRulesCannotProduceMixedVersionDetails()
    {
        var categories=await Categories();foreach(var isMethod in new[]{true,false}){var created=isMethod?await Json(await fixture.Admin.PostAsJsonAsync("/api/admin/purchase-methods",MethodInput([categories[0]]))):await Json(await fixture.Admin.PostAsJsonAsync("/api/admin/cheque-plans",PlanInput([categories[0]])));var id=created["id"]!.GetValue<string>();var route="/api/admin/"+(isMethod?"purchase-methods/":"cheque-plans/")+id;var node=isMethod?"method":"plan";var before=await Json(await fixture.Admin.GetAsync(route));var version=before[node]!["version"]!.GetValue<string>();var intercept=new ChangeBeforeRules(isMethod?"[MethodCategory]":"[PlanCategory]",async()=>{if(isMethod)await Json(await fixture.Admin.PutAsJsonAsync(route,MethodInput([categories[1]],version)));else await Json(await fixture.Admin.PutAsJsonAsync(route,PlanInput([categories[1]],version)));});
            if(isMethod){await using var db=new PaymentsDbContext(new DbContextOptionsBuilder<PaymentsDbContext>().UseSqlServer(fixture.Sql.Connection).AddInterceptors(intercept).Options);Assert.Equal("version_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>new AdminPurchaseMethods(db).DetailAsync(id,CancellationToken.None))).Code);}else{await using var db=new CreditDbContext(new DbContextOptionsBuilder<CreditDbContext>().UseSqlServer(fixture.Sql.Connection).AddInterceptors(intercept).Options);Assert.Equal("version_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>new AdminCreditPlans(db).DetailAsync(id,CancellationToken.None))).Code);}Assert.Equal(1,intercept.Calls);}
    }
    private sealed class ChangeBeforeRules(string marker,Func<Task> change):DbCommandInterceptor
    {
        public int Calls;
        public override async ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command,CommandEventData eventData,InterceptionResult<DbDataReader> result,CancellationToken cancellationToken=default){if(command.CommandText.Contains(marker,StringComparison.Ordinal)&&Interlocked.CompareExchange(ref Calls,1,0)==0)await change();return result;}
    }
    private async Task<HttpClient> RoleClient(string role)
    {
        await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();var users=scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>();var name="finance"+Guid.NewGuid().ToString("N");var user=new ShopUser{UserName=name,Email=name+"@example.test",DisplayName="حساب آزمایشی مالی",EmailConfirmed=true,RequireMfa=true};Assert.True((await users.CreateAsync(user,fixture.Sql.Password)).Succeeded);Assert.True((await users.AddToRoleAsync(user,role)).Succeeded);var c=fixture.Sql.Factory.CreateClient(new(){HandleCookies=false});c.DefaultRequestHeaders.Add("Origin","http://127.0.0.1:3173");c.DefaultRequestHeaders.Add("X-Sayman-Client","admin");c.DefaultRequestHeaders.Add("X-Sayman-Admin","1");var pending=await Json(await c.PostAsJsonAsync("/api/auth/password",new{Identifier=name,fixture.Sql.Password}));c.DefaultRequestHeaders.Authorization=new("Bearer",pending["accessToken"]!.GetValue<string>());Assert.Equal(HttpStatusCode.Forbidden,(await c.GetAsync("/api/admin/purchase-summary")).StatusCode);var setup=await Json(await c.PostAsJsonAsync("/api/auth/mfa/setup",new{}));c.DefaultRequestHeaders.Authorization=new("Bearer",setup["accessToken"]!.GetValue<string>());var signed=await Json(await c.PostAsJsonAsync("/api/auth/mfa/verify",new{Code=Totp.Code(setup["secret"]!.GetValue<string>(),DateTimeOffset.UtcNow.ToUnixTimeSeconds()/30)}));c.DefaultRequestHeaders.Authorization=new("Bearer",signed["accessToken"]!.GetValue<string>());return c;
    }
    [Fact] public async Task RealMfaFinanceRoleCanReadWhileContentRoleCannotReadOrChangeConditions()
    {
        using var finance=await RoleClient("FinanceManager");using var content=await RoleClient("ContentManager");foreach(var path in new[]{"/api/admin/purchase-summary","/api/admin/purchase-methods-page","/api/admin/cheque-plans-page"}){Assert.Equal(HttpStatusCode.OK,(await finance.GetAsync(path)).StatusCode);Assert.Equal(HttpStatusCode.Forbidden,(await content.GetAsync(path)).StatusCode);}using var denied=await content.PostAsJsonAsync("/api/admin/cheque-plans",PlanInput([]));Assert.Equal(HttpStatusCode.Forbidden,denied.StatusCode);
    }
}
