using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Inventory;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;
namespace Shop.SqlTests;
public sealed partial class CashOrderPaymentSqlTests(OrderFixture fixture):IClassFixture<OrderFixture>
{
    private sealed record Scenario(HttpClient Client,string Owner,string Order,string Variant,string Method,long Amount,string SnapshotFingerprint);
    private sealed record Facts(int OnHand,int Reserved,string StockVersion,string State,string OrderVersion,string Snapshot,int Links,int OrderEvents,string ReservationState,int Movements);
    private sealed class FixedClock(DateTimeOffset at):TimeProvider{public override DateTimeOffset GetUtcNow()=>at;}
    private sealed class CrossingClock(DateTimeOffset first,DateTimeOffset later):TimeProvider{private int calls;public override DateTimeOffset GetUtcNow()=>Interlocked.Increment(ref calls)==1?first:later;}
    private static string Id()=>Guid.NewGuid().ToString("N");
    private static string Hash(string s)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(s)));
    private async Task<T> Scope<T>(Func<IServiceProvider,Task<T>> action){await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();return await action(scope.ServiceProvider);}
    private async Task<Scenario> Create(long price=100003)
    {
        await fixture.Settings(max:10);var item=await fixture.Product(price);var person=await fixture.Customer();var cart=await OrderFixture.Json(await person.Client.GetAsync("/api/cart/en"));cart=await OrderFixture.Json(await person.Client.PutAsJsonAsync("/api/cart/en",new CartInput([new(item.Variant,1)],cart["version"]?.GetValue<string>())));var quote=await OrderFixture.Json(await person.Client.PostAsJsonAsync("/api/cart/en/quote",new CheckoutQuoteInput(cart["version"]!.GetValue<string>(),item.Method,null,Id())));var order=(await OrderFixture.Json(await person.Client.PostAsJsonAsync("/api/orders",new CreateOrderInput(quote["quoteId"]!.GetValue<string>(),Id(),"Synthetic cash QA","09121234567",new("IR","QA","QA","Synthetic QA only","1234567890"),null,true)),HttpStatusCode.Created))["order"]!;return new(person.Client,person.Owner,order["summary"]!["id"]!.GetValue<string>(),item.Variant,item.Method,price+7,await Scope(async sp=>Hash((await sp.GetRequiredService<SalesDbContext>().Orders.AsNoTracking().SingleAsync(o=>o.Id==order["summary"]!["id"]!.GetValue<string>())).QuoteSnapshotJson)));
    }
    private static VerifiedCashPayment Proof(Scenario s)=>new(Id(),Id(),s.Order,s.Owner,s.Method,s.Amount,s.SnapshotFingerprint,"synthetic-test-only","qa",Hash(Id()),Hash(Id()),DateTimeOffset.UtcNow);
    private Task<CashOrderSettlement> Confirm(VerifiedCashPayment proof,TimeProvider? clock=null,bool allowDemo=true)=>Scope(sp=>sp.GetRequiredService<SalesTransactionCoordinator>().RunAsync(()=>ActivatorUtilities.CreateInstance<CashOrderPaymentService>(sp,clock??TimeProvider.System,allowDemo).ConfirmVerifiedAsync(proof,default),inventoryOnly:true));
    private Task<CashOrderPaymentReadiness> Ready(Scenario s)=>Scope(sp=>sp.GetRequiredService<SalesTransactionCoordinator>().RunAsync(()=>ActivatorUtilities.CreateInstance<CashOrderPaymentService>(sp,true).ReadAsync(s.Owner,s.Order,default),inventoryOnly:true));
    private Task<Facts> Read(Scenario s)=>Scope<Facts>(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();var inv=sp.GetRequiredService<InventoryDbContext>();var o=await db.Orders.AsNoTracking().SingleAsync(o=>o.Id==s.Order);var stock=await inv.Stock.AsNoTracking().SingleAsync(x=>x.VariantId==s.Variant);return new(stock.OnHand,stock.Reserved,Convert.ToBase64String(stock.Version),o.State.ToString(),Convert.ToBase64String(o.Version),o.QuoteSnapshotJson,await db.OrderCashPayments.CountAsync(p=>p.OrderId==s.Order),await db.Set<SalesOrderEvent>().CountAsync(e=>e.OrderId==s.Order),(await inv.Reservations.AsNoTracking().SingleAsync(r=>r.Id==o.ReservationId)).State.ToString(),await inv.Movements.CountAsync(m=>m.VariantId==s.Variant));});
    [Fact]public async Task ExactServerSnapshotAmountAboveJavascriptIntegerRangeAllocatesWithoutReducingOnHandAndReplaysHistorically()
    {
        var s=await Create(9007199254740993);using var customer=s.Client;var before=await Read(s);var ready=await Ready(s);Assert.True(ready.CanInitiate);Assert.Equal(s.Amount,ready.AmountRial);var proof=Proof(s);var result=await Confirm(proof);Assert.Equal("applied",result.Disposition);Assert.Equal("9007199254741000",result.AmountRial);var after=await Read(s);Assert.Equal("Paid",after.State);Assert.Equal("Allocated",after.ReservationState);Assert.Equal(before.OnHand,after.OnHand);Assert.Equal(before.Reserved,after.Reserved);Assert.Equal(before.StockVersion,after.StockVersion);Assert.Equal(before.Snapshot,after.Snapshot);Assert.Equal(before.Movements,after.Movements);Assert.Equal(1,after.Links);Assert.Equal(before.OrderEvents+1,after.OrderEvents);var replay=await Confirm(proof);Assert.Equal(result with{Replayed=true},replay);Assert.Equal(after,await Read(s));
    }
    [Theory][InlineData("amount")][InlineData("method")][InlineData("cancelled")][InlineData("late")]
    public async Task VerifiedButUnfulfillablePaymentsRequireReviewWithoutChangingAnOrderOrStock(string kind)
    {
        var s=await Create();using var customer=s.Client;var proof=Proof(s);TimeProvider? clock=null;
        if(kind=="amount")proof=proof with{AmountRial=proof.AmountRial+1};if(kind=="method")proof=proof with{MethodId="different"};
        if(kind=="cancelled"){var current=await OrderFixture.Json(await customer.GetAsync("/api/orders/"+s.Order));await OrderFixture.Json(await customer.PostAsJsonAsync("/api/orders/"+s.Order+"/cancel",new{Version=current["summary"]!["version"]!.GetValue<string>()}));}
        if(kind=="late")clock=new FixedClock(DateTimeOffset.UtcNow.AddHours(2));var before=await Read(s);var result=await Confirm(proof,clock);Assert.Equal("requires_review",result.Disposition);Assert.Equal(before,await Read(s));
    }
    [Fact]public async Task ConcurrentVerificationCreatesExactlyOneLinkAndChangedProofOrReusedReferenceCannotPayAgain()
    {
        var s=await Create();using var customer=s.Client;var proof=Proof(s);var results=await Task.WhenAll(Confirm(proof),Confirm(proof));Assert.Single(results,r=>!r.Replayed);Assert.Single(results,r=>r.Replayed);var after=await Read(s);Assert.Equal(1,after.Links);
        Assert.Equal("payment_proof_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Confirm(proof with{AmountRial=proof.AmountRial+1}))).Code);Assert.Equal(after,await Read(s));
        var second=await Create();using var other=second.Client;var secondBefore=await Read(second);var review=await Confirm(Proof(second)with{ReferenceHash=proof.ReferenceHash});Assert.Equal("requires_review",review.Disposition);Assert.Equal("payment_reference_already_used",review.Reason);Assert.Equal(secondBefore,await Read(second));
    }
    [Fact]public async Task CrossingTheOrderDeadlineDuringAllocationRollsBackTheWholeRootTransaction()
    {
        var s=await Create();using var customer=s.Client;var before=await Read(s);var proof=Proof(s);var error=await Assert.ThrowsAsync<BusinessException>(()=>Confirm(proof,new CrossingClock(proof.VerifiedAt,proof.VerifiedAt.AddHours(2))));Assert.Equal("payment_deadline_retry",error.Code);Assert.Equal(before,await Read(s));
    }
}
