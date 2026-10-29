using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Credit;
using Shop.Modules.Payments;
using Shop.Modules.Sales;
using Xunit;
namespace Shop.SqlTests;
public sealed partial class SourcingConversionHttpSqlTests
{
    internal async Task<(Scenario Scenario,System.Text.Json.Nodes.JsonNode Cart,string Method,string Plan,string Version)> CreditQuoteMixedCart(bool ordinary=true)
    {
        var setup=await Scope(async sp=>{var payment=sp.GetRequiredService<PaymentsDbContext>();var method=new PurchaseMethod{NameFa="چک ساختگی توافقی",NameEn="Synthetic accepted cheque",Kind="cheque",Enabled=true,RequiresApproval=true};payment.Methods.Add(method);await payment.SaveChangesAsync();var credit=sp.GetRequiredService<CreditDbContext>();var plan=new ChequePlan{NameFa="طرح چک ساختگی",NameEn="Synthetic quote plan",Months=6,IntervalMonths=1,DownPaymentBasisPoints=2500,Enabled=true};credit.Plans.Add(plan);await credit.SaveChangesAsync();return(method.Id,plan.Id,Convert.ToBase64String(plan.Version));});
        var s=await Create(ordinary?3:2,configureBeforeOffer:async(sp,variant)=>{var catalog=sp.GetRequiredService<CatalogDbContext>();var product=await catalog.Products.Include(x=>x.PurchaseMethods).Include(x=>x.CreditPlans).SingleAsync(x=>x.Variants.Any(v=>v.Id==variant));product.PurchaseMethods.Add(new(){MethodId=setup.Item1});product.CreditPlans.Add(new(){PlanId=setup.Item2});await catalog.SaveChangesAsync();});
        var cart=await Body(await s.Customer.GetAsync("/api/cart/en/v2"));if(ordinary)await Body(await s.Customer.PutAsJsonAsync("/api/cart/en/v2",new CartV2Input([new(s.Variant,1)],Text(cart,"version"))));var allocation=await Allocate(s);await Body(await s.Customer.PostAsJsonAsync(Offer(s)+"/convert",ConvertInput(allocation)));return(s,await Body(await s.Customer.GetAsync("/api/cart/en/v2")),setup.Item1,setup.Item2,setup.Item3);
    }
    [Fact]public async Task CreditQuoteMixedAcceptedPricesRemainHistoricalAndScopeExpiryClipsTheCalculationWithoutConsumingTheAllocation()
    {
        var x=await CreditQuoteMixedCart();var s=x.Scenario;using var customer=s.Customer;using var finance=await fixture.ReuseStaff("FinanceManager");using var auth=new CreditQuoteReviewerAuth(fixture.Sql);using var reviewer=await auth.Client();var until=DateTimeOffset.UtcNow.AddMinutes(2);var scope=await CreditCheckoutQuoteQa.Scope(customer,finance,reviewer,x.Plan,x.Version,"900719925474099300","InstallmentsTotalRial",until);var input=CreditCheckoutQuoteQa.Input(scope,Text(x.Cart,"version"),x.Method,x.Plan);var command=Id();var before=await StockFingerprint(s);
        var result=await CreditCheckoutQuoteQa.Read(await customer.PostAsJsonAsync(CreditCheckoutQuoteQa.Route(command),input));var q=result["quote"]!;Assert.Null(q["ordinaryQuote"]);var core=q["acceptedQuote"]!;Assert.Equal(5,core["schemaVersion"]!.GetValue<int>());Assert.Equal(until,q["expiresAt"]!.GetValue<DateTimeOffset>());var lines=core["lines"]!.AsArray();Assert.Equal(2,lines.Count);Assert.Equal("123",Text(lines.Single(l=>Text(l!,"lineKind")=="ordinary")!,"unitPriceRial"));Assert.Equal("9007199254740993",Text(lines.Single(l=>Text(l!,"lineKind")=="acceptedOffer")!,"unitPriceRial"));Assert.True(q["assessment"]!["withinLimit"]!.GetValue<bool>());Assert.Null(core["payableTotalRial"]);Assert.Contains("credit_quote_final_charges_unavailable",q["assessment"]!["blockers"]!.AsArray().Select(n=>n!.GetValue<string>()));Assert.Equal(before,await StockFingerprint(s));
        await Scope(async sp=>{await sp.GetRequiredService<CatalogDbContext>().Variants.Where(v=>v.Id==s.Variant).ExecuteUpdateAsync(v=>v.SetProperty(p=>p.PriceRial,999));return true;});var replay=await CreditCheckoutQuoteQa.Read(await customer.GetAsync(CreditCheckoutQuoteQa.Route(command)));Assert.Equal(q.ToJsonString(),replay["quote"]!.ToJsonString());var fresh=(await CreditCheckoutQuoteQa.Read(await customer.PostAsJsonAsync(CreditCheckoutQuoteQa.Route(Id()),input)))["quote"]!["acceptedQuote"]!;Assert.Equal("999",Text(fresh["lines"]!.AsArray().Single(l=>Text(l!,"lineKind")=="ordinary")!,"unitPriceRial"));Assert.Equal("9007199254740993",Text(fresh["lines"]!.AsArray().Single(l=>Text(l!,"lineKind")=="acceptedOffer")!,"unitPriceRial"));Assert.Equal(before,await StockFingerprint(s));
    }
    [Fact]public async Task CreditQuoteAcceptedOnlyUsesItsOwnExistingHoldAtZeroPublicAvailability()
    {
        var x=await CreditQuoteMixedCart(false);var s=x.Scenario;using var customer=s.Customer;Assert.Equal(0,(await ReadFacts(s)).PublicAvailable);using var finance=await fixture.ReuseStaff("FinanceManager");using var auth=new CreditQuoteReviewerAuth(fixture.Sql);using var reviewer=await auth.Client();var scope=await CreditCheckoutQuoteQa.Scope(customer,finance,reviewer,x.Plan,x.Version,"900719925474099300");var before=await StockFingerprint(s);var result=await CreditCheckoutQuoteQa.Read(await customer.PostAsJsonAsync(CreditCheckoutQuoteQa.Route(Id()),CreditCheckoutQuoteQa.Input(scope,Text(x.Cart,"version"),x.Method,x.Plan)));var q=result["quote"]!;Assert.Single(q["acceptedQuote"]!["lines"]!.AsArray());Assert.Null(q["assessment"]!["assessedAmountRial"]);Assert.False(q["canPlaceOrder"]!.GetValue<bool>());Assert.False(q["canPay"]!.GetValue<bool>());Assert.Equal(before,await StockFingerprint(s));
    }
}
