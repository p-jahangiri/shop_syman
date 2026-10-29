using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Sales;
using Xunit;

namespace Shop.SqlTests;
// Real SQL only. Compilation/discovery does not accept these concurrency cases.
public sealed class AddressBookSqlTests(OrderFixture fixture):IClassFixture<OrderFixture>
{
    private static string Id()=>Guid.NewGuid().ToString("N");
    private static SaveAddressInput Input(string label="خانه",bool makeDefault=false,string? version=null)=>new(label,"گیرندهٔ آزمون","09121234567",new("IR","تهران","تهران","نشانی آزمون؛ دادهٔ واقعی نیست","1234567890"),makeDefault,version);
    private static async Task<JsonNode> Book(HttpClient c)=>await OrderFixture.Json(await c.GetAsync("/api/addresses"));
    private static async Task<JsonNode> Save(HttpClient c,string id,SaveAddressInput input,HttpStatusCode status=HttpStatusCode.Created)=>await OrderFixture.Json(await c.PutAsJsonAsync("/api/addresses/"+id,input),status);
    private static async Task Remove(HttpClient c,string id,string version,HttpStatusCode status=HttpStatusCode.NoContent){using var r=await c.SendAsync(new(HttpMethod.Delete,"/api/addresses/"+id){Content=JsonContent.Create(new DeleteAddressInput(version))});Assert.Equal(status,r.StatusCode);}
    private static string Version(JsonNode saved)=>saved["address"]!["version"]!.GetValue<string>();
    [Fact] public async Task NativeCrudEncryptsPrivateDetailsAndKeepsOneDefault()
    {
        var person=await fixture.Customer();using var c=person.Client;var first=Id();var second=Id();var one=await Save(c,first,Input());Assert.True(one["address"]!["isDefault"]!.GetValue<bool>());var two=await Save(c,second,Input("کار",true));Assert.True(two["address"]!["isDefault"]!.GetValue<bool>());var book=await Book(c);Assert.Equal(2,book["items"]!.AsArray().Count);Assert.Single(book["items"]!.AsArray(),x=>x!["isDefault"]!.GetValue<bool>());
        await using(var scope=fixture.Sql.Factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<SalesDbContext>();var rows=await db.Addresses.AsNoTracking().Where(a=>a.OwnerId==person.Owner).ToArrayAsync();var protect=scope.ServiceProvider.GetRequiredService<IAddressProtection>();Assert.All(rows,r=>{Assert.DoesNotContain("09121234567",r.ProtectedData);Assert.DoesNotContain("گیرنده",r.ProtectedData);Assert.Contains("ContactName",protect.Unprotect(person.Owner,r.Id,r.ProtectedData));});Assert.ThrowsAny<System.Security.Cryptography.CryptographicException>(()=>protect.Unprotect("other-owner",rows[0].Id,rows[0].ProtectedData));}
        await Remove(c,second,Version(two));book=await Book(c);Assert.Single(book["items"]!.AsArray());Assert.True(book["items"]![0]!["isDefault"]!.GetValue<bool>());await Remove(c,first,book["items"]![0]!["version"]!.GetValue<string>());Assert.Empty((await Book(c))["items"]!.AsArray());
    }
    [Fact] public async Task AnotherOwnerCannotReadUpdateOrDeleteAnAddress()
    {
        var owner=await fixture.Customer();var other=await fixture.Customer();using var a=owner.Client;using var b=other.Client;var id=Id();var saved=await Save(a,id,Input());Assert.Empty((await Book(b))["items"]!.AsArray());using var update=await b.PutAsJsonAsync("/api/addresses/"+id,Input(version:Version(saved)));Assert.Equal(HttpStatusCode.NotFound,update.StatusCode);await Remove(b,id,Version(saved),HttpStatusCode.NotFound);Assert.Single((await Book(a))["items"]!.AsArray());using var forged=await b.GetAsync("/api/addresses?ownerId="+owner.Owner);Assert.Equal(HttpStatusCode.BadRequest,forged.StatusCode);
    }
    [Fact] public async Task CreationReplayIsPersistentAndVersionedEditsRejectStaleOrChangedRequests()
    {
        var person=await fixture.Customer();using var c=person.Client;var id=Id();var one=await Save(c,id,Input());var replay=await Save(c,id,Input(),HttpStatusCode.OK);Assert.True(replay["replayed"]!.GetValue<bool>());Assert.Equal(Version(one),Version(replay));Assert.Single((await Book(c))["items"]!.AsArray());using var changed=await c.PutAsJsonAsync("/api/addresses/"+id,Input("دیگر"));Assert.Equal(HttpStatusCode.Conflict,changed.StatusCode);var edited=await Save(c,id,Input("ویرایش",version:Version(one)),HttpStatusCode.OK);Assert.NotEqual(Version(one),Version(edited));using var stale=await c.PutAsJsonAsync("/api/addresses/"+id,Input(version:Version(one)));Assert.Equal(HttpStatusCode.Conflict,stale.StatusCode);using var oldCreation=await c.PutAsJsonAsync("/api/addresses/"+id,Input());Assert.Equal(HttpStatusCode.Conflict,oldCreation.StatusCode);await Remove(c,id,Version(one),HttpStatusCode.Conflict);
    }
    [Fact] public async Task CapacityAndDefaultChangesAreBoundedAndInvalidateOldDefaultVersions()
    {
        var person=await fixture.Customer();using var c=person.Client;var first=Id();var one=await Save(c,first,Input());JsonNode? last=null;string lastId="";for(var i=1;i<20;i++){lastId=Id();last=await Save(c,lastId,Input("نشانی "+i,i==19));}using var full=await c.PutAsJsonAsync("/api/addresses/"+Id(),Input());Assert.Equal(HttpStatusCode.BadRequest,full.StatusCode);Assert.Contains("address_limit",await full.Content.ReadAsStringAsync());var book=await Book(c);Assert.Equal(20,book["items"]!.AsArray().Count);Assert.Single(book["items"]!.AsArray(),x=>x!["isDefault"]!.GetValue<bool>());await Remove(c,first,Version(one),HttpStatusCode.Conflict);await Remove(c,lastId,Version(last!));book=await Book(c);Assert.Equal(19,book["items"]!.AsArray().Count);Assert.Equal(first,book["items"]!.AsArray().Single(x=>x!["isDefault"]!.GetValue<bool>())!["id"]!.GetValue<string>());
    }
    private static async Task<HttpResponseMessage> SaveConcurrent(HttpClient c,string id,SaveAddressInput input){for(var attempt=0;;attempt++){var r=await c.PutAsJsonAsync("/api/addresses/"+id,input);if(r.StatusCode!=HttpStatusCode.Conflict||attempt==3)return r;var problem=JsonNode.Parse(await r.Content.ReadAsStringAsync());if(problem?["title"]?.GetValue<string>()!="transaction_conflict")return r;r.Dispose();}}
    [Fact] public async Task ConcurrentFirstCreatesAndDefaultSwitchesKeepExactlyOneDefault()
    {
        var person=await fixture.Customer();using var c=person.Client;var ids=new[]{Id(),Id()};var responses=await Task.WhenAll(ids.Select(id=>SaveConcurrent(c,id,Input(id[..8],true))));foreach(var r in responses){Assert.Equal(HttpStatusCode.Created,r.StatusCode);r.Dispose();}var book=await Book(c);Assert.Equal(2,book["items"]!.AsArray().Count);Assert.Single(book["items"]!.AsArray(),x=>x!["isDefault"]!.GetValue<bool>());var rows=book["items"]!.AsArray().ToArray();responses=await Task.WhenAll(rows.Select(a=>SaveConcurrent(c,a!["id"]!.GetValue<string>(),Input(a["label"]!.GetValue<string>(),true,a["version"]!.GetValue<string>()))));Assert.All(responses,r=>Assert.Contains(r.StatusCode,new[]{HttpStatusCode.OK,HttpStatusCode.Conflict}));foreach(var r in responses)r.Dispose();Assert.Single((await Book(c))["items"]!.AsArray(),x=>x!["isDefault"]!.GetValue<bool>());
    }
    [Fact] public async Task EncryptionFailureRollsBackDefaultAndBookRevision()
    {
        var person=await fixture.Customer();using var c=person.Client;var id=Id();await Save(c,id,Input());long revision;await using(var scope=fixture.Sql.Factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<SalesDbContext>();revision=(await db.AddressBooks.AsNoTracking().SingleAsync(b=>b.OwnerId==person.Owner)).Revision;var service=new AddressBookService(db,new FailingProtection(scope.ServiceProvider.GetRequiredService<IAddressProtection>()),TimeProvider.System);await Assert.ThrowsAsync<InvalidOperationException>(()=>service.SaveAsync(person.Owner,Id(),Input("خطا",true),CancellationToken.None));}
        var book=await Book(c);Assert.Single(book["items"]!.AsArray());Assert.True(book["items"]![0]!["isDefault"]!.GetValue<bool>());await using var verify=fixture.Sql.Factory.Services.CreateAsyncScope();Assert.Equal(revision,(await verify.ServiceProvider.GetRequiredService<SalesDbContext>().AddressBooks.AsNoTracking().SingleAsync(b=>b.OwnerId==person.Owner)).Revision);
    }
    [Fact] public async Task EditingAndDeletingSavedAddressDoesNotChangeRecordedOrderSnapshot()
    {
        await fixture.Settings();var person=await fixture.Customer();using var c=person.Client;var id=Id();var saved=await Save(c,id,Input());var item=await fixture.Product();var cart=await OrderFixture.Json(await c.GetAsync("/api/cart/en"));cart=await OrderFixture.Json(await c.PutAsJsonAsync("/api/cart/en",new CartInput([new(item.Variant,1)],cart["version"]?.GetValue<string>())));var quote=await OrderFixture.Json(await c.PostAsJsonAsync("/api/cart/en/quote",new CheckoutQuoteInput(cart["version"]!.GetValue<string>(),item.Method,null,Guid.NewGuid().ToString())));var v=Input();var order=await OrderFixture.Json(await c.PostAsJsonAsync("/api/orders",new CreateOrderInput(quote["quoteId"]!.GetValue<string>(),Guid.NewGuid().ToString(),v.ContactName,v.ContactPhone,v.Delivery,"",true)),HttpStatusCode.Created);var orderId=order["order"]!["summary"]!["id"]!.GetValue<string>();var edited=await Save(c,id,Input("تغییر",version:Version(saved)) with{ContactName="گیرندهٔ دیگر",Delivery=v.Delivery with{Address="نشانی ویرایش‌شدهٔ آزمون"}},HttpStatusCode.OK);await Remove(c,id,Version(edited));var recorded=await OrderFixture.Json(await c.GetAsync("/api/orders/"+orderId));Assert.Equal(v.ContactName,recorded["contactName"]!.GetValue<string>());Assert.Equal(v.Delivery.Address,recorded["delivery"]!["address"]!.GetValue<string>());
    }
    private sealed class FailingProtection(IAddressProtection inner):IAddressProtection{public string Protect(string owner,string id,string text)=>throw new InvalidOperationException("Synthetic encryption failure; no real key was changed.");public string Unprotect(string owner,string id,string cipher)=>inner.Unprotect(owner,id,cipher);}
}
