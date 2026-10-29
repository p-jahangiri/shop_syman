using System.Data;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Credit;
using Shop.Modules.Inventory;
using Shop.Modules.Sales;
using Xunit;
namespace Shop.SqlTests;
public sealed class CreditScheduleAcceptedSqlTests(MarketFixture fixture):IClassFixture<MarketFixture>
{
    private static string Id()=>Guid.NewGuid().ToString("N");private static string V(JsonNode x,string key)=>CreditCheckoutQuoteQa.Text(x,key);private static Task<JsonNode> Read(HttpResponseMessage response)=>CreditScheduleQa.Read(response);
    [Theory][InlineData(false)][InlineData(true)]
    public async Task AcceptedAndMixedScheduleReadsOnlyFrozenAgreedAmountsWithoutAnotherReservationOrUse(bool ordinary)
    {
        var helper=new SourcingConversionHttpSqlTests(fixture);var x=await helper.CreditQuoteMixedCart(ordinary);var s=x.Scenario;using var customer=s.Customer;using var finance=await fixture.ReuseStaff("FinanceManager");using var auth=new CreditQuoteReviewerAuth(fixture.Sql);using var reviewer=await auth.Client();
        await using(var scope=fixture.Sql.Factory.Services.CreateAsyncScope()){var sp=scope.ServiceProvider;var db=sp.GetRequiredService<SalesDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);await using var tx=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);var policy=await db.ChargePolicies.AsNoTracking().SingleOrDefaultAsync();await sp.GetRequiredService<CheckoutChargePolicyService>().SaveAsync(new("flat","ارسال ساختگی","Synthetic QA","D21 QA only","D21 QA only","12345",null,"exempt",null,"goods","half_up",policy is null?null:Convert.ToBase64String(policy.Version)),default);var settings=await db.OrderSettings.AsNoTracking().SingleOrDefaultAsync();await sp.GetRequiredService<CheckoutOrderSettingsService>().SaveAsync(new(true,60,2,settings is null?null:Convert.ToBase64String(settings.Version),true),default);await tx.CommitAsync();}
        var authority=await CreditCheckoutQuoteQa.Scope(customer,finance,reviewer,x.Plan,x.Version,"900719925474099300","InstallmentsTotalRial");var quote=(await Read(await customer.PostAsJsonAsync(CreditCheckoutQuoteQa.Route(Id()),CreditCheckoutQuoteQa.Input(authority,V(x.Cart,"version"),x.Method,x.Plan))))["quote"]!;var input=new CreditOrderInput(V(quote,"id"),V(quote,"fingerprint"),"Synthetic calendar agreement QA","09100000000",new("IR","تهران","تهران","Synthetic software QA address only","1234567890"),"Software QA only",true,true);var created=await Read(await customer.PostAsJsonAsync("/api/credit-orders/commands/"+Id(),input));var order=created["order"]!;var id=V(order["summary"]!,"id");
        await using var readScope=fixture.Sql.Factory.Services.CreateAsyncScope();var sales=readScope.ServiceProvider.GetRequiredService<SalesDbContext>();var owner=await sales.Orders.Where(o=>o.Id==id).Select(o=>o.OwnerId).SingleAsync();var path="/api/admin/credit/orders/"+owner+"/"+id+"/schedule";var anchor=DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow,TimeZoneInfo.FindSystemTimeZoneById("Asia/Tehran")).DateTime).ToString("yyyy-MM-dd",System.Globalization.CultureInfo.InvariantCulture);var request=new CreditSchedulePreviewInput(V(order["summary"]!,"version"),null,"Persian",anchor);var preview=await Read(await finance.PostAsJsonAsync(path+"/preview",request));var result=await Read(await finance.PostAsJsonAsync(path+"/commands/"+Id(),new SaveCreditScheduleInput(request.OrderVersion,null,request.CalendarKind,request.AnchorDate,V(preview,"fingerprint"),true)));var calculation=result["revision"]!["calculation"]!;
        Assert.Equal(V(quote["acceptedQuote"]!,"payableTotalRial"),V(calculation,"payableTotalRial"));Assert.Equal(V(quote["acceptedQuote"]!,"downPaymentRial"),V(calculation,"planDownPaymentRial"));Assert.Equal("12345",V(calculation,"chargesOutsideChequesRial"));Assert.Equal(quote["acceptedQuote"]!["installments"]!.AsArray().Select(l=>V(l!,"amountRial")),calculation["lines"]!.AsArray().Select(l=>V(l!,"amountRial")));Assert.Equal(V(quote,"id"),V(result["revision"]!,"creditQuoteId"));Assert.Equal("Planned",V(result["revision"]!,"state"));
        var credit=readScope.ServiceProvider.GetRequiredService<CreditDbContext>();Assert.Single(await credit.PurchaseScopeUses.Where(u=>u.OrderId==id).ToArrayAsync());Assert.Single(await credit.ScheduleRevisions.Where(r=>r.OrderId==id).ToArrayAsync());var stock=await readScope.ServiceProvider.GetRequiredService<InventoryDbContext>().Stock.AsNoTracking().SingleAsync(v=>v.VariantId==s.Variant);Assert.Equal(ordinary?3:2,stock.Reserved);Assert.Equal(0,stock.SourcingReserved);Assert.Equal(OrderState.AwaitingPayment,(await sales.Orders.SingleAsync(o=>o.Id==id)).State);
    }
}
