using Microsoft.AspNetCore.TestHost;
using System.Data;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Credit;
using Shop.Modules.Inventory;
using Shop.Modules.Payments;
using Shop.Modules.Sales;
using Xunit;
using IdentityContext=Shop.Modules.Identity.IdentityDbContext;
namespace Shop.SqlTests;
internal static class CreditCheckoutQuoteQa
{
    public static string Id()=>Guid.NewGuid().ToString("N");
    public static string Text(JsonNode n,string key)=>n[key]!.GetValue<string>();
    public static async Task<JsonNode> Read(HttpResponseMessage response)
    {
        using(response){var raw=await response.Content.ReadAsStringAsync();Assert.True(response.IsSuccessStatusCode,$"HTTP{(int)response.StatusCode}: {raw}");Assert.Contains("no-store",response.Headers.CacheControl!.ToString());
            if(response.RequestMessage!.RequestUri!.AbsolutePath.Contains("/credit-quote")&&Environment.GetEnvironmentVariable("SHOP_CREDIT_QUOTE_WIRE_DIR")is{Length:>0}dir){Directory.CreateDirectory(dir);var name=Id();await File.WriteAllTextAsync(Path.Combine(dir,name+".json"),raw);await File.WriteAllTextAsync(Path.Combine(dir,name+".meta.json"),JsonSerializer.Serialize(new{actualSqlHttpResponse=true,syntheticQaOnly=true,status=(int)response.StatusCode,method=response.RequestMessage.Method.Method,path=response.RequestMessage.RequestUri.PathAndQuery,cacheControl=response.Headers.CacheControl.ToString()}));}
            return JsonNode.Parse(raw)!;
        }
    }
    public static async Task<JsonNode> Scope(HttpClient customer,HttpClient finance,HttpClient reviewer,string plan,string planVersion,string limit="9007199254740993",string basis="PayableTotalRial",DateTimeOffset? until=null)
    {
        var current=await Read(await finance.GetAsync("/api/admin/credit/requirements"));var published=await Read(await finance.PostAsJsonAsync("/api/admin/credit/requirements/commands/"+Id(),new PublishCreditRequirementsInput(current["version"]?.GetValue<string>(),new("شرایط ساختگی محاسبه","Synthetic quote terms","فقط آزمون؛ هیچ تعهد یا شخص واقعی نیست","Synthetic software QA only; no real person or obligation","متن صرفاً ساختگی آزمون","Synthetic QA text only",true,[]))));current=published["current"]!;
        var draft=await Read(await customer.PostAsJsonAsync("/api/credit/applications/commands/"+Id(),new CreateCreditApplicationInput(plan,planVersion,limit,"fa")));var app=draft["application"]!;var path="/api/credit/applications/"+Text(app,"id");
        await Read(await customer.PostAsJsonAsync(path+"/consents/"+Id(),new AcceptCreditRequirementsInput(Text(app,"version"),Text(current["published"]!,"id"),Text(current,"version"),"fa",true)));
        var ready=await Read(await customer.GetAsync(path+"/submission"));var submitted=await Read(await customer.PostAsJsonAsync(path+"/submissions/commands/"+Id(),new SubmitCreditApplicationInput(Text(ready["application"]!,"version"),Text(ready,"consentId"),Text(ready,"requirementsRevisionId"),Text(ready,"requirementsVersion"),"fa","ساختگی برای محاسبه؛ بدون تعهد واقعی",true)));
        var staffPath=path.Replace("/api/credit/","/api/admin/credit/");var approval=await Read(await reviewer.PostAsJsonAsync(staffPath+"/reviews/commands/"+Id(),new ReviewCreditApplicationInput(Text(submitted["application"]!,"version"),Text(submitted["submission"]!,"id"),"Approved","fa","تأیید کاملاً ساختگی آزمون نرم‌افزار؛ هیچ ارزیابی شخص واقعی نیست",limit,until??DateTimeOffset.UtcNow.AddHours(1),true)));
        return await Read(await reviewer.PostAsJsonAsync(staffPath+"/purchase-scope/grant/"+Id(),new GrantCreditPurchaseScopeInput(Text(approval["application"]!,"version"),Text(approval["review"]!,"id"),basis,true)));
    }
    public static CreditCheckoutQuoteInput Input(JsonNode scope,string cartVersion,string method,string plan)=>new(cartVersion,method,plan,Text(scope["application"]!,"id"),Text(scope["scope"]!,"id"),Text(scope["application"]!,"version"),Text(scope["scope"]!,"version"));
    public static string Route(string command,string locale="en")=>"/api/cart/"+locale+"/v2/credit-quote/commands/"+command;
}
internal sealed class CreditQuoteReviewerAuth(SqlFixture fixture):CreditRequirementsSqlBase(fixture),IDisposable
{
    private readonly WebApplicationFactory<Program> factory=fixture.Factory.WithWebHostBuilder(_=>{});
    public Task<HttpClient> Client()=>Staff("CreditReviewer",factory);
    public void Dispose()=>factory.Dispose();
}
public sealed class CreditCheckoutQuoteSqlTests(SqlFixture fixture):CreditRequirementsSqlBase(fixture),IClassFixture<SqlFixture>,IDisposable
{
    private WebApplicationFactory<Program>? staffFactory;private Task<HttpClient> Staff(string role)=>base.Staff(role,staffFactory??=sql.Factory.WithWebHostBuilder(_=>{}));public void Dispose()=>staffFactory?.Dispose();
    private sealed record Goods(string Variant,string Method,CreditApplicationPlanOption Plan);
    private async Task<Goods> Product(long price=100003,bool charges=true)
    {
        var plan=await Plan();await using var scope=sql.Factory.Services.CreateAsyncScope();var sp=scope.ServiceProvider;var catalog=sp.GetRequiredService<CatalogDbContext>();var payments=sp.GetRequiredService<PaymentsDbContext>();var method=new PurchaseMethod{NameFa="چک ساختگی",NameEn="Synthetic cheque",Kind="cheque",Enabled=true,RequiresApproval=true};payments.Methods.Add(method);await payments.SaveChangesAsync();var category=await catalog.Categories.Where(x=>x.IsActive).Select(x=>x.Id).FirstAsync();var brand=await catalog.Brands.Where(x=>x.IsActive).Select(x=>x.Id).FirstAsync();
        var product=new Product{Slug="creditquote-"+Id(),CategoryId=category,BrandId=brand,Status="Published",Translations=[new(){Locale="fa",Name="کالای ساختگی محاسبه",SearchName="ساختگی"},new(){Locale="en",Name="Synthetic quote item",SearchName="synthetic quote"}],PurchaseMethods=[new(){MethodId=method.Id}],CreditPlans=[new(){PlanId=plan.Id}]};var variant=new ProductVariant{Sku="CREDITQUOTE-"+Id(),SearchSku="qa",PriceRial=price,IsActive=true};product.Variants.Add(variant);catalog.Products.Add(product);await catalog.SaveChangesAsync();var inventory=sp.GetRequiredService<InventoryDbContext>();inventory.Stock.Add(new(){VariantId=variant.Id,OnHand=5});await inventory.SaveChangesAsync();
        var sales=sp.GetRequiredService<SalesDbContext>();Assert.StartsWith("SaymanTest_",sales.Database.GetDbConnection().Database);var policy=await sales.ChargePolicies.SingleOrDefaultAsync();if(policy is null){policy=new();sales.ChargePolicies.Add(policy);}policy.ShippingMode=charges?"flat":"unconfigured";policy.ShippingFeeRial=charges?12345:null;policy.ShippingNameFa=charges?"ارسال ساختگی":"";policy.ShippingNameEn=charges?"Synthetic QA shipping":"";policy.TaxMode=charges?"exempt":"unconfigured";policy.TaxBase="goods";policy.TaxRateBasisPoints=null;await sales.SaveChangesAsync();return new(variant.Id,method.Id,plan);
    }
    private static async Task<JsonNode> Cart(HttpClient customer,Goods goods)=>await CreditCheckoutQuoteQa.Read(await customer.PutAsJsonAsync("/api/cart/en",new CartInput([new(goods.Variant,1)],null)));
    private async Task<(Goods Goods,JsonNode Scope,JsonNode Cart,HttpClient Customer)> Ready(HttpClient finance,HttpClient reviewer,string basis="PayableTotalRial",string limit="9007199254740993",long price=100003,bool charges=true)
    {
        var goods=await Product(price,charges);var p=await Customer();var cart=await Cart(p.Client,goods);var scope=await CreditCheckoutQuoteQa.Scope(p.Client,finance,reviewer,goods.Plan.Id,goods.Plan.Version,limit,basis);return(goods,scope,cart,p.Client);
    }
    [Fact]public async Task OrdinaryQuoteUsesServerAmountsAndPreservesHistoricalReceiptAfterScopeRevocationWithoutStockOrOrderWrites()
    {
        using var finance=await Staff("FinanceManager");using var reviewer=await Staff("CreditReviewer");var s=await Ready(finance,reviewer);using var customer=s.Customer;var input=CreditCheckoutQuoteQa.Input(s.Scope,Value(s.Cart,"version"),s.Goods.Method,s.Goods.Plan.Id);var command=Id();var path=CreditCheckoutQuoteQa.Route(command);var result=await CreditCheckoutQuoteQa.Read(await customer.PostAsJsonAsync(path,input));var quote=result["quote"]!;Assert.Null(quote["acceptedQuote"]);var basis=quote["ordinaryQuote"]!;Assert.Equal("100003",Value(basis,"itemsSubtotalRial"));Assert.Equal("12345",Value(basis,"shippingRial"));Assert.Equal(Value(basis,"payableTotalRial"),Value(quote["assessment"]!,"assessedAmountRial"));Assert.True(quote["assessment"]!["withinLimit"]!.GetValue<bool>());Assert.False(quote["canPlaceOrder"]!.GetValue<bool>());Assert.False(quote["canPay"]!.GetValue<bool>());
        var id=Value(quote,"id");var detail=await CreditCheckoutQuoteQa.Read(await customer.GetAsync("/api/cart/en/v2/credit-quotes/"+id));Assert.Equal(quote.ToJsonString(),detail.ToJsonString());
        var app=s.Scope["application"]!;await Read(await customer.PostAsJsonAsync("/api/credit/applications/"+Value(app,"id")+"/purchase-scope/revoke/"+Id(),new RevokeCreditPurchaseScopeInput(Value(app,"version"),Value(s.Scope["scope"]!,"version"),"fa","",true)));
        var replay=await CreditCheckoutQuoteQa.Read(await customer.PostAsJsonAsync(path,input));Assert.True(replay["replayed"]!.GetValue<bool>());Assert.Equal(quote.ToJsonString(),replay["quote"]!.ToJsonString());var receipt=await CreditCheckoutQuoteQa.Read(await customer.GetAsync(path));Assert.Equal(quote.ToJsonString(),receipt["quote"]!.ToJsonString());using(var stale=await customer.PostAsJsonAsync(CreditCheckoutQuoteQa.Route(Id()),input))Assert.Equal(HttpStatusCode.Conflict,stale.StatusCode);
        await using var scope=sql.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<SalesDbContext>();var stored=await db.CreditCheckoutQuotes.SingleAsync(x=>x.Id==id);Assert.Equal(3,stored.BaseContractVersion);Assert.NotEqual(command,(await db.Quotes.SingleAsync(x=>x.Id==stored.BaseQuoteId)).RequestId);Assert.Single(await scope.ServiceProvider.GetRequiredService<IdentityContext>().Audit.Where(x=>x.Action=="SALES_CREDIT_QUOTE"&&x.Resource==path).ToArrayAsync());Assert.Empty(await db.Orders.ToArrayAsync());Assert.Empty(await scope.ServiceProvider.GetRequiredService<InventoryDbContext>().Reservations.ToArrayAsync());Assert.Equal(0,(await scope.ServiceProvider.GetRequiredService<InventoryDbContext>().Stock.SingleAsync(x=>x.VariantId==s.Goods.Variant)).Reserved);
    }
    [Fact]public async Task MissingChargesAndInsufficientScopeRemainExplicitAndNeitherBudgetBasisTreatsUnknownAsZero()
    {
        using var finance=await Staff("FinanceManager");using var reviewer=await Staff("CreditReviewer");var a=await Ready(finance,reviewer,charges:false);using var ca=a.Customer;var qa=(await CreditCheckoutQuoteQa.Read(await ca.PostAsJsonAsync(CreditCheckoutQuoteQa.Route(Id()),CreditCheckoutQuoteQa.Input(a.Scope,Value(a.Cart,"version"),a.Goods.Method,a.Goods.Plan.Id))))["quote"]!;Assert.Null(qa["assessment"]!["assessedAmountRial"]);Assert.Null(qa["assessment"]!["withinLimit"]);
        var b=await Ready(finance,reviewer,"InstallmentsTotalRial",charges:false);using var cb=b.Customer;var qb=(await CreditCheckoutQuoteQa.Read(await cb.PostAsJsonAsync(CreditCheckoutQuoteQa.Route(Id()),CreditCheckoutQuoteQa.Input(b.Scope,Value(b.Cart,"version"),b.Goods.Method,b.Goods.Plan.Id))))["quote"]!;Assert.True(qb["assessment"]!["withinLimit"]!.GetValue<bool>());Assert.Contains("credit_quote_final_charges_unavailable",qb["assessment"]!["blockers"]!.AsArray().Select(x=>x!.GetValue<string>()));
        var c=await Ready(finance,reviewer,limit:"1");using var cc=c.Customer;var qc=(await CreditCheckoutQuoteQa.Read(await cc.PostAsJsonAsync(CreditCheckoutQuoteQa.Route(Id()),CreditCheckoutQuoteQa.Input(c.Scope,Value(c.Cart,"version"),c.Goods.Method,c.Goods.Plan.Id))))["quote"]!;Assert.False(qc["assessment"]!["withinLimit"]!.GetValue<bool>());Assert.Contains("credit_scope_limit_exceeded",qc["assessment"]!["blockers"]!.AsArray().Select(x=>x!.GetValue<string>()));
    }
    [Fact]public async Task OwnerInputAndCurrentPlanAreAuthoritativeWhileConcurrentReplayWritesOneQuoteAndAuditFailureRollsBackBothQuotes()
    {
        using var finance=await Staff("FinanceManager");using var reviewer=await Staff("CreditReviewer");var s=await Ready(finance,reviewer);using var customer=s.Customer;var other=await Customer();using var stranger=other.Client;var input=CreditCheckoutQuoteQa.Input(s.Scope,Value(s.Cart,"version"),s.Goods.Method,s.Goods.Plan.Id);var command=Id();var path=CreditCheckoutQuoteQa.Route(command);
        using(var foreign=await stranger.PostAsJsonAsync(path,input))Assert.Equal(HttpStatusCode.NotFound,foreign.StatusCode);using(var forged=await customer.PostAsJsonAsync(path,new{input.CartVersion,input.MethodId,input.PlanId,input.ApplicationId,input.ScopeId,input.ApplicationVersion,input.ScopeVersion,payableTotalRial="1"}))Assert.Equal(HttpStatusCode.BadRequest,forged.StatusCode);
        await using(var scope=sql.Factory.Services.CreateAsyncScope())await scope.ServiceProvider.GetRequiredService<IdentityContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] WITH NOCHECK ADD CONSTRAINT CK_CreditQuoteAuditFailure CHECK ([Action]<>'SALES_CREDIT_QUOTE')");
        try{using var failed=await customer.PostAsJsonAsync(path,input);Assert.Equal(HttpStatusCode.Conflict,failed.StatusCode);}finally{await using var scope=sql.Factory.Services.CreateAsyncScope();await scope.ServiceProvider.GetRequiredService<IdentityContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] DROP CONSTRAINT CK_CreditQuoteAuditFailure");}
        await using(var scope=sql.Factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<SalesDbContext>();Assert.False(await db.CreditCheckoutQuotes.AnyAsync(x=>x.CommandId==command));var owner=(await scope.ServiceProvider.GetRequiredService<CreditDbContext>().Applications.SingleAsync(x=>x.Id==input.ApplicationId)).OwnerId;var baseRequest=CreditCheckoutQuoteService.BaseRequestId(owner,command);Assert.False(await db.Quotes.AnyAsync(x=>x.RequestId==baseRequest));}
        var replies=await Task.WhenAll((await Task.WhenAll(customer.PostAsJsonAsync(path,input),customer.PostAsJsonAsync(path,input))).Select(x=>CreditCheckoutQuoteQa.Read(x)));Assert.Single(replies,x=>x["replayed"]!.GetValue<bool>());Assert.Equal(replies[0]["quote"]!.ToJsonString(),replies[1]["quote"]!.ToJsonString());
        await using(var scope=sql.Factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<CreditDbContext>();var plan=await db.Plans.SingleAsync(x=>x.Id==s.Goods.Plan.Id);plan.Enabled=false;await db.SaveChangesAsync();}
        using(var changed=await customer.PostAsJsonAsync(CreditCheckoutQuoteQa.Route(Id()),input))Assert.Equal(HttpStatusCode.Conflict,changed.StatusCode);var historical=await CreditCheckoutQuoteQa.Read(await customer.GetAsync(path));Assert.Equal(replies[0]["quote"]!.ToJsonString(),historical["quote"]!.ToJsonString());
        using(var denied=await stranger.GetAsync(path))Assert.Equal(HttpStatusCode.NotFound,denied.StatusCode);using(var denied=await finance.GetAsync(path))Assert.Equal(HttpStatusCode.NotFound,denied.StatusCode);
    }
    [Fact]public async Task ExactLargeRialAssessmentSqlChecksAndGuardedDownProtectThePrivateSnapshot()
    {
        using var finance=await Staff("FinanceManager");using var reviewer=await Staff("CreditReviewer");var s=await Ready(finance,reviewer,limit:"900719925474099300",price:9007199254740993);using var customer=s.Customer;var result=await CreditCheckoutQuoteQa.Read(await customer.PostAsJsonAsync(CreditCheckoutQuoteQa.Route(Id()),CreditCheckoutQuoteQa.Input(s.Scope,Value(s.Cart,"version"),s.Goods.Method,s.Goods.Plan.Id)));var q=result["quote"]!;Assert.Equal("9007199254740993",Value(q["ordinaryQuote"]!,"itemsSubtotalRial"));Assert.Equal(Value(q["ordinaryQuote"]!,"payableTotalRial"),Value(q["assessment"]!,"assessedAmountRial"));var id=Value(q,"id");
        await using var scope=sql.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<SalesDbContext>();var e=await Assert.ThrowsAsync<SqlException>(()=>db.Database.ExecuteSqlInterpolatedAsync($"UPDATE [sales].[CreditCheckoutQuotes] SET [WithinLimit]=NULL WHERE [Id]={id}"));Assert.Equal(547,e.Number);var source=(await db.Database.GetAppliedMigrationsAsync()).ToArray();var migration=Assert.Single(source,m=>m.EndsWith("_CreditCheckoutQuotes",StringComparison.Ordinal));await db.GetService<IMigrator>().MigrateAsync(migration);var previous=(await db.Database.GetAppliedMigrationsAsync()).Reverse().Skip(1).First();var down=await Assert.ThrowsAsync<SqlException>(()=>db.GetService<IMigrator>().MigrateAsync(previous));Assert.Equal(51000,down.Number);Assert.Single(await db.CreditCheckoutQuotes.Where(x=>x.Id==id).ToArrayAsync());await db.Database.MigrateAsync();Assert.Equal(source,await db.Database.GetAppliedMigrationsAsync());Assert.False(db.Database.HasPendingModelChanges());
    }
    private sealed class QuoteClock(DateTimeOffset now):TimeProvider{public override DateTimeOffset GetUtcNow()=>now;}
    [Fact]public async Task ExpiryBlocksNewQuotesButNotHistoricalReceiptsAndRevocationRaceCannotCreateAnUnownedCurrentAuthority()
    {
        using var finance=await Staff("FinanceManager");using var reviewer=await Staff("CreditReviewer");var s=await Ready(finance,reviewer);using var customer=s.Customer;var input=CreditCheckoutQuoteQa.Input(s.Scope,Value(s.Cart,"version"),s.Goods.Method,s.Goods.Plan.Id);var command=Id();var path=CreditCheckoutQuoteQa.Route(command);var original=await CreditCheckoutQuoteQa.Read(await customer.PostAsJsonAsync(path,input));var expiredAt=DateTimeOffset.Parse(Value(s.Scope["scope"]!,"expiresAt")).AddSeconds(1);
        using(var future=sql.Factory.WithWebHostBuilder(b=>b.ConfigureTestServices(services=>services.AddSingleton<TimeProvider>(new QuoteClock(expiredAt))))){using var futureClient=future.CreateClient(new(){HandleCookies=false});foreach(var header in customer.DefaultRequestHeaders)futureClient.DefaultRequestHeaders.TryAddWithoutValidation(header.Key,header.Value);using(var denied=await futureClient.PostAsJsonAsync(CreditCheckoutQuoteQa.Route(Id()),input))Assert.Equal(HttpStatusCode.Conflict,denied.StatusCode);var historical=await CreditCheckoutQuoteQa.Read(await futureClient.PostAsJsonAsync(path,input));Assert.True(historical["replayed"]!.GetValue<bool>());Assert.Equal(original["quote"]!.ToJsonString(),historical["quote"]!.ToJsonString());}
        var race=await Ready(finance,reviewer);using var raceCustomer=race.Customer;var raceInput=CreditCheckoutQuoteQa.Input(race.Scope,Value(race.Cart,"version"),race.Goods.Method,race.Goods.Plan.Id);var raceCommand=Id();var app=race.Scope["application"]!;var responses=await Task.WhenAll(raceCustomer.PostAsJsonAsync(CreditCheckoutQuoteQa.Route(raceCommand),raceInput),raceCustomer.PostAsJsonAsync("/api/credit/applications/"+Value(app,"id")+"/purchase-scope/revoke/"+Id(),new RevokeCreditPurchaseScopeInput(Value(app,"version"),Value(race.Scope["scope"]!,"version"),"fa","صرفاً مسابقهٔ ساختگی QA",true)));
        Assert.Equal(HttpStatusCode.OK,responses[1].StatusCode);Assert.Contains(responses[0].StatusCode,new[]{HttpStatusCode.OK,HttpStatusCode.Conflict});if(responses[0].IsSuccessStatusCode)await CreditCheckoutQuoteQa.Read(responses[0]);else responses[0].Dispose();responses[1].Dispose();
        await using var scope=sql.Factory.Services.CreateAsyncScope();var credit=scope.ServiceProvider.GetRequiredService<CreditDbContext>();Assert.True(await credit.ScopeRevocations.AnyAsync(x=>x.ScopeId==raceInput.ScopeId));var sales=scope.ServiceProvider.GetRequiredService<SalesDbContext>();var stored=await sales.CreditCheckoutQuotes.SingleOrDefaultAsync(x=>x.CommandId==raceCommand);if(stored is not null){var revoked=await credit.ScopeRevocations.SingleAsync(x=>x.ScopeId==raceInput.ScopeId);Assert.True(stored.CreatedAt<=revoked.At);Assert.Equal(raceInput.ApplicationVersion,stored.ApplicationVersion);}Assert.Empty(await sales.Orders.ToArrayAsync());Assert.Empty(await scope.ServiceProvider.GetRequiredService<InventoryDbContext>().Reservations.ToArrayAsync());
    }

}
