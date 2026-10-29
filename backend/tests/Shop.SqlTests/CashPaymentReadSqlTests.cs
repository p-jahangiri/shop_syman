using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Payments;
using Shop.SharedKernel;
using Xunit;
namespace Shop.SqlTests;
public sealed partial class CashOrderPaymentSqlTests
{
    [Fact]public async Task ActualPrivatePaymentReadsReturnStringRialWithoutAuthorityReferenceOrOtherOwnersData()
    {
        var p=await PendingAttempt(9007199254740993);using var customer=p.Scenario.Client;await PaymentWire(await customer.GetAsync("/api/payments/orders/"+p.Scenario.Order),"pending-page","customer-page");await Settle(p);var before=await Read(p.Scenario);var paymentBefore=await PaymentFacts(p);
        var page=await PaymentWire(await customer.GetAsync("/api/payments/orders/"+p.Scenario.Order),"verified-page","customer-page");var item=Assert.Single(page["items"]!.AsArray());Assert.Equal("9007199254741000",item!["amountRial"]!.GetValue<string>());Assert.Equal("9007199254741000",item["verifiedAmountRial"]!.GetValue<string>());Assert.Equal("verified",item["state"]!.GetValue<string>());
        var own=await PaymentWire(await customer.GetAsync("/api/payments/attempts/"+p.Attempt),"verified-detail","detail");Assert.Equal(p.Attempt,own["attempt"]!["id"]!.GetValue<string>());var admin=await PaymentWire(await fixture.Admin.GetAsync("/api/admin/payments/attempts?orderId="+p.Scenario.Order),"admin-page","admin-page");Assert.Equal(p.Attempt,Assert.Single(admin["items"]!.AsArray())!["id"]!.GetValue<string>());
        foreach(var raw in new[]{page.ToJsonString(),own.ToJsonString(),admin.ToJsonString()})foreach(var field in new[]{"ownerId","authority","protectedAuthority","authorityHash","referenceHash","accountKey","payloadHash"})Assert.DoesNotContain("\""+field+"\":",raw,StringComparison.OrdinalIgnoreCase);
        var stranger=await fixture.Customer();using var foreign=stranger.Client;var empty=await PaymentWire(await foreign.GetAsync("/api/payments/orders/"+p.Scenario.Order),"foreign-page","customer-page");Assert.Empty(empty["items"]!.AsArray());using var denied=await foreign.GetAsync("/api/payments/attempts/"+p.Attempt);Assert.Equal(HttpStatusCode.NotFound,denied.StatusCode);using var staff=await customer.GetAsync("/api/admin/payments/attempts");Assert.Equal(HttpStatusCode.Forbidden,staff.StatusCode);
        using var guest=fixture.Sql.Factory.CreateClient(new(){HandleCookies=false});using var anonymous=await guest.GetAsync("/api/payments/attempts/"+p.Attempt);Assert.Equal(HttpStatusCode.Unauthorized,anonymous.StatusCode);Assert.Contains("no-store",anonymous.Headers.CacheControl!.ToString());Assert.Equal(before,await Read(p.Scenario));Assert.Equal(paymentBefore,await PaymentFacts(p));
    }
    [Fact]public async Task FiltersAndCursorAreBoundToPrivateScopeAndIncompleteVerifiedStateFailsClosed()
    {
        var p=await PendingAttempt();using var customer=p.Scenario.Client;
        foreach(var route in new[]{"/api/payments/attempts/"+p.Attempt+"?owner=other","/api/payments/orders/"+p.Scenario.Order+"?state=verified","/api/admin/payments/attempts?state=paid","/api/admin/payments/attempts?cursor=invalid","/api/admin/payments/attempts?owner=other"}){
            using var response=await(route.Contains("/admin/")?fixture.Admin:customer).GetAsync(route);Assert.Equal(HttpStatusCode.BadRequest,response.StatusCode);Assert.Contains("no-store",response.Headers.CacheControl!.ToString());
        }
        await Scope(async sp=>{await sp.GetRequiredService<PaymentsDbContext>().CashAttempts.Where(a=>a.Id==p.Attempt).ExecuteUpdateAsync(s=>s.SetProperty(a=>a.State,"verified"));return true;});
        using(var detail=await customer.GetAsync("/api/payments/attempts/"+p.Attempt))Assert.Equal(HttpStatusCode.ServiceUnavailable,detail.StatusCode);
        using var corrupt=await customer.GetAsync("/api/payments/orders/"+p.Scenario.Order);Assert.Equal(HttpStatusCode.ServiceUnavailable,corrupt.StatusCode);var problem=await corrupt.Content.ReadFromJsonAsync<JsonNode>();Assert.Equal("payment_attempt_unavailable",problem!["title"]!.GetValue<string>());
    }
    [Fact]public async Task SeekPaginationIsDeterministicAndRejectsCursorFromAnotherCustomerOrFilter()
    {
        var owner="synthetic-page-"+Id();var order=Id();await Scope(async sp=>{var db=sp.GetRequiredService<PaymentsDbContext>();var now=DateTimeOffset.UtcNow;for(var n=0;n<53;n++)db.CashAttempts.Add(new(){Id=Id(),OwnerId=owner,OrderId=order,MethodId="online",RequestId=Id(),PayloadHash=Hash(Id()),ProviderKey="synthetic",AccountKey="qa",AmountRial=9007199254740993,SnapshotFingerprint=Hash(Id()),OriginalOrderVersion="AAAAAAAAAAE=",ContainsDemo=true,CreatedAt=now,ChangedAt=now,OrderExpiresAt=now.AddHours(1)});await db.SaveChangesAsync();return true;});
        await Scope(async sp=>{var service=new CashPaymentReadService(sp.GetRequiredService<PaymentsDbContext>(),true);var first=await service.PageAsync(owner,new(null,order),null,default);Assert.Equal(50,first.Items.Length);Assert.NotNull(first.NextCursor);var second=await service.PageAsync(owner,new(null,order),first.NextCursor,default);Assert.Equal(3,second.Items.Length);Assert.Null(second.NextCursor);Assert.Equal(53,first.Items.Concat(second.Items).Select(x=>x.Id).Distinct().Count());Assert.Equal(first.Items.Select(x=>x.Id).OrderDescending(StringComparer.Ordinal),first.Items.Select(x=>x.Id));
            foreach(var action in new Func<Task>[] {async()=>{await service.PageAsync("other-owner",new(null,order),first.NextCursor,default);},async()=>{await service.PageAsync(owner,new("created",order),first.NextCursor,default);}})Assert.Equal("invalid_payment_filter",(await Assert.ThrowsAsync<BusinessException>(action)).Code);Assert.Empty((await new CashPaymentReadService(sp.GetRequiredService<PaymentsDbContext>(),false).PageAsync(owner,new(null,order),null,default)).Items);return true;});
    }
}
