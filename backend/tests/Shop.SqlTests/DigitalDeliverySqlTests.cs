using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Identity;
using Shop.Modules.Inventory;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;

// Every state/payment fact and fault below is confined to OrderFixture's
// generated SaymanTest_GUID database. No adapter can manufacture live payment.
public sealed class DigitalDeliverySqlTests(OrderFixture fixture):IClassFixture<OrderFixture>,IDisposable
{
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web);
    private WebApplicationFactory<Program>? requests;
    private HttpClient? admin;
    private HttpClient Admin {get {if(admin is not null)return admin;requests=fixture.Sql.Factory.WithWebHostBuilder(_=>{});admin=requests.CreateClient(new(){HandleCookies=false});foreach(var header in fixture.Admin.DefaultRequestHeaders)admin.DefaultRequestHeaders.TryAddWithoutValidation(header.Key,header.Value);return admin;}}
    public void Dispose(){admin?.Dispose();requests?.Dispose();}
    private sealed record Scenario(HttpClient Customer,string Owner,string Id,string Digital,string? Physical,int Quantity,SerialUnitData? Unit=null);
    private sealed record Facts(string State,int OnHand,int Reserved,string StockVersion,int Movements,int Dispatches,int Deliveries,int Items,int Commands,int Audits,bool Header);
    private static string Id()=>Guid.NewGuid().ToString("N");
    private static string Path(Scenario s)=>$"/api/admin/orders/{s.Owner}/{s.Id}/fulfillment/digital";
    private static string Own(Scenario s,bool v2=false)=>$"/api/orders/{(v2?"v2/":"")}{s.Id}/fulfillment/digital";
    private async Task<T> Scope<T>(Func<IServiceProvider,Task<T>> action)
    {
        await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();
        Assert.StartsWith("SaymanTest_",scope.ServiceProvider.GetRequiredService<SalesDbContext>().Database.GetDbConnection().Database);
        return await action(scope.ServiceProvider);
    }
    private static async Task<T> Body<T>(HttpResponseMessage response,string? capture=null)
    {
        using(response){var bytes=await response.Content.ReadAsByteArrayAsync();var raw=Encoding.UTF8.GetString(bytes);Assert.True(response.IsSuccessStatusCode,$"HTTP {(int)response.StatusCode}: {raw}");Assert.Contains("no-store",response.Headers.CacheControl!.ToString());Assert.Contains("noindex",response.Headers.GetValues("X-Robots-Tag").Single());Assert.Equal("digital-v1",response.Headers.GetValues("X-Sayman-Fulfillment-Contract").Single());
            if(capture is not null&&Environment.GetEnvironmentVariable("SHOP_DIGITAL_WIRE_DIR") is{Length:>0} directory){Directory.CreateDirectory(directory);await File.WriteAllBytesAsync(System.IO.Path.Combine(directory,capture+".json"),bytes);}
            return JsonSerializer.Deserialize<T>(raw,Json)!;
        }
    }
    private Task<AdminDigitalDeliveryPage> Page(Scenario s,string? capture=null)=>Read<AdminDigitalDeliveryPage>(Admin,Path(s),capture);
    private static async Task<T> Read<T>(HttpClient client,string path,string? capture=null)=>await Body<T>(await client.GetAsync(path),capture);
    // An uncommitted page has no proof; the dummy value below only exercises server rejection.
    private static DigitalDeliveryInput Input(AdminDigitalDeliveryPage page,params string[] content)=>new(page.OwnerId,Id(),page.OrderVersion,page.InventoryFingerprint??new string('A',64),"Synthetic private delivery QA only",true,[new(page.Lines[0].LineKey,content.Length==0?["SYNTHETIC-LICENSE-ONLY"]:content)]);
    private async Task<DigitalDeliveryResult> Deliver(Scenario s,DigitalDeliveryInput input,string? capture=null)=>await Body<DigitalDeliveryResult>(await Admin.PostAsJsonAsync(Path(s)+"/commands/"+input.CommandId,input),capture);
    private async Task<Scenario> Create(int quantity=2,bool paid=true,bool mixed=false,bool trackedPhysical=false,bool assignPhysical=true,bool physicalOnly=false)
    {
        await fixture.Settings(max:10);var digital=await fixture.Product(stock:Math.Max(quantity,5),digital:!physicalOnly);var physical=mixed?await fixture.Product(stock:trackedPhysical?0:5):((string Variant,string Method)?)null;
        SerialUnitData? unit=null;
        if(trackedPhysical){var sku=physical!.Value.Variant;var serialPath=$"/api/admin/inventory/variants/{sku}";var serials=await Admin.GetFromJsonAsync<SerialUnitPage>(serialPath+"/serials?state=all");await OrderFixture.Json(await Admin.PutAsJsonAsync(serialPath+"/serial-mode",new SerialModeInput("serial",serials!.Stock.Version,Id())));serials=await Admin.GetFromJsonAsync<SerialUnitPage>(serialPath+"/serials?state=all");var received=await OrderFixture.Json(await Admin.PostAsJsonAsync(serialPath+"/serials",new SerialReceiptInput([new("SYNTHETIC-DEVICE-"+Id())],"Synthetic mixed digital QA",serials!.Stock.Version,Id())));unit=JsonSerializer.Deserialize<SerialCommandResult>(received.ToJsonString(),Json)!.Units.Single();}
        var customer=await fixture.Customer();var cart=await OrderFixture.Json(await customer.Client.GetAsync("/api/cart/en"));
        CartLineInput[] lines=mixed?[new(digital.Variant,quantity),new(physical!.Value.Variant,1)]:[new(digital.Variant,quantity)];
        cart=await OrderFixture.Json(await customer.Client.PutAsJsonAsync("/api/cart/en",new CartInput(lines,cart["version"]?.GetValue<string>())));
        var quote=await OrderFixture.Json(await customer.Client.PostAsJsonAsync("/api/cart/en/quote",new CheckoutQuoteInput(cart["version"]!.GetValue<string>(),digital.Method,null,Id())));
        var order=(await OrderFixture.Json(await customer.Client.PostAsJsonAsync("/api/orders",new CreateOrderInput(quote["quoteId"]!.GetValue<string>(),Id(),"Synthetic digital customer","09121234567",mixed||physicalOnly?new("IR","QA province","QA city","Synthetic; no real shipment","1234567890"):null,"Synthetic SQL fixture only",true)),HttpStatusCode.Created))["order"]!;
        var result=new Scenario(customer.Client,customer.Owner,order["summary"]!["id"]!.GetValue<string>(),digital.Variant,physical?.Variant,quantity,unit);
        if(paid)await Scope(async sp=>await sp.GetRequiredService<SalesTransactionCoordinator>().RunAsync(async()=>{var db=sp.GetRequiredService<SalesDbContext>();var row=await db.Orders.SingleAsync(x=>x.Id==result.Id);Assert.Equal(StockReservationState.Allocated,(await sp.GetRequiredService<IStockReservations>().AllocateAsync(result.Owner,row.ReservationId,"synthetic-digital-fixture",default)).State);row.State=OrderState.Paid;row.ChangedAt=DateTimeOffset.UtcNow;await db.SaveChangesAsync();if(unit is not null&&assignPhysical)await sp.GetRequiredService<IStockSerialAssignments>().AssignAsync(new(result.Owner,row.ReservationId,"synthetic-digital-fixture",Id(),[new(unit.Id,unit.Version,DateTimeOffset.UtcNow.AddYears(1))]),default);return true;},inventoryOnly:true));
        return result;
    }
    private Task<Facts> State(Scenario s)=>Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();var inv=sp.GetRequiredService<InventoryDbContext>();var stock=await inv.Stock.AsNoTracking().SingleAsync(x=>x.VariantId==s.Digital);var ids=db.DigitalDeliveries.Where(x=>x.OrderId==s.Id).Select(x=>x.Id);return new Facts((await db.Orders.AsNoTracking().SingleAsync(x=>x.Id==s.Id)).State.ToString(),stock.OnHand,stock.Reserved,Convert.ToBase64String(stock.Version),await inv.Movements.CountAsync(x=>x.VariantId==s.Digital),await inv.PartialDispatches.CountAsync(x=>x.OrderId==s.Id),await ids.CountAsync(),await db.DigitalItems.CountAsync(x=>ids.Contains(x.DeliveryId)),await db.DigitalCommands.CountAsync(x=>x.OrderId==s.Id),await sp.GetRequiredService<IdentityDbContext>().Audit.CountAsync(x=>x.Action=="ORDER_DIGITAL_DELIVERY"&&x.Resource.StartsWith(Path(s))),await db.FulfillmentHeaders.AnyAsync(x=>x.OrderId==s.Id));});

    [Fact]public async Task PrivateDigitalHandoffIsEncryptedOwnedImmutableAndReplayableWithoutLeakingCodesInMetadata()
    {
        var s=await Create();using var customer=s.Customer;var before=await State(s);var page=await Page(s,"digital-admin-before");Assert.True(page.CanDeliver);Assert.Empty((await Read<CustomerDigitalDeliveries>(customer,Own(s))).Deliveries);
        var secret="SYNTHETIC-LICENSE-<not-a-real-code>-آ\n  keep spaces  ";var input=Input(page,secret);if(Environment.GetEnvironmentVariable("SHOP_DIGITAL_WIRE_DIR")is{Length:>0} dir){Directory.CreateDirectory(dir);await File.WriteAllTextAsync(System.IO.Path.Combine(dir,"digital-input.json"),JsonSerializer.Serialize(input,Json));}
        var result=await Deliver(s,input,"digital-result");Assert.False(result.Replayed);var after=await State(s);Assert.Equal((before.OnHand-1,before.Reserved-1,before.Movements+1,1,1,1,1),(after.OnHand,after.Reserved,after.Movements,after.Dispatches,after.Deliveries,after.Items,after.Commands));Assert.Equal("Paid",after.State);
        var own=await Read<CustomerDigitalDeliveries>(customer,Own(s),"digital-customer-summary");Assert.Single(own.Deliveries);Assert.Equal(JsonSerializer.Serialize(own),JsonSerializer.Serialize(await Read<CustomerDigitalDeliveries>(customer,Own(s,true))));var content=await Read<DigitalDeliveryContent>(customer,Own(s)+"/"+result.Delivery.Id+"/content","digital-content");Assert.Equal(secret,Assert.Single(content.Items).Content);
        var replay=await Deliver(s,input);Assert.True(replay.Replayed);var receipt=await Read<DigitalDeliveryResult>(Admin,Path(s)+"/commands/"+input.CommandId,"digital-receipt");Assert.Equal(JsonSerializer.Serialize(result with{Replayed=true}),JsonSerializer.Serialize(receipt));Assert.Equal(after,await State(s));
        foreach(var metadata in new[]{JsonSerializer.Serialize(own),JsonSerializer.Serialize(await Page(s)),JsonSerializer.Serialize(receipt)})Assert.DoesNotContain("SYNTHETIC-LICENSE",metadata);
        using(var changed=await Admin.PostAsJsonAsync(Path(s)+"/commands/"+input.CommandId,input with{Reason="different reviewed reason"}))Assert.Equal(HttpStatusCode.Conflict,changed.StatusCode);
        var stranger=await fixture.Customer();using(var client=stranger.Client){using var denied=await client.GetAsync(Own(s)+"/"+result.Delivery.Id+"/content");Assert.Equal(HttpStatusCode.NotFound,denied.StatusCode);}
        using(var staffReveal=await Admin.GetAsync(Path(s)+"/"+result.Delivery.Id+"/content"))Assert.Equal(HttpStatusCode.NotFound,staffReveal.StatusCode);
        using(var oldWorkflow=await Admin.GetAsync($"/api/admin/orders/{s.Owner}/{s.Id}/shipment"))Assert.Equal(HttpStatusCode.Conflict,oldWorkflow.StatusCode);
        await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();var item=await db.DigitalItems.SingleAsync(x=>x.DeliveryId==result.Delivery.Id);Assert.DoesNotContain(secret,Encoding.UTF8.GetString(item.ProtectedContent));Assert.InRange(item.ProtectedContent.Length,1,16384);var audit=await sp.GetRequiredService<IdentityDbContext>().Audit.SingleAsync(x=>x.Resource==Path(s)+"/commands/"+input.CommandId);Assert.DoesNotContain("SYNTHETIC-LICENSE",JsonSerializer.Serialize(audit));item.ProtectedContent=[1];await Assert.ThrowsAsync<InvalidOperationException>(()=>db.SaveChangesAsync());return true;});
        // The immutable order snapshot still determines kind after catalog edits.
        await Scope(async sp=>{var db=sp.GetRequiredService<CatalogDbContext>();await db.Products.Where(p=>p.Variants.Any(v=>v.Id==s.Digital)).ExecuteUpdateAsync(set=>set.SetProperty(p=>p.IsDigital,false));return true;});
        var second=await Deliver(s,Input(await Page(s),"SYNTHETIC-SECOND"));Assert.Equal("Fulfilled",(await State(s)).State);Assert.Equal(2,(await Page(s)).Deliveries.Length);Assert.True((await Deliver(s,input)).Replayed);Assert.NotEqual(result.Delivery.Id,second.Delivery.Id);
    }

    [Fact]public async Task ConcurrentSameCommandOrCompetingCommandsConsumeEachEntitlementOnlyOnce()
    {
        var s=await Create(quantity:1);using var customer=s.Customer;var input=Input(await Page(s));var race=await Task.WhenAll(Admin.PostAsJsonAsync(Path(s)+"/commands/"+input.CommandId,input),Admin.PostAsJsonAsync(Path(s)+"/commands/"+input.CommandId,input));var results=await Task.WhenAll(race.Select(r=>Body<DigitalDeliveryResult>(r)));Assert.Single(results,x=>x.Replayed);Assert.Single(results,x=>!x.Replayed);Assert.Single(results.Select(x=>x.Delivery.Id).Distinct());var after=await State(s);Assert.Equal((1,1,1,1),(after.Dispatches,after.Deliveries,after.Commands,after.Audits));
        var other=await Create(quantity:1);using var otherCustomer=other.Customer;var old=Input(await Page(other));var competing=old with{CommandId=Id()};var responses=await Task.WhenAll(Admin.PostAsJsonAsync(Path(other)+"/commands/"+old.CommandId,old),Admin.PostAsJsonAsync(Path(other)+"/commands/"+competing.CommandId,competing));try{Assert.Single(responses,x=>x.IsSuccessStatusCode);Assert.Single(responses,x=>x.StatusCode==HttpStatusCode.Conflict);}finally{foreach(var response in responses)response.Dispose();}Assert.Equal(1,(await State(other)).Dispatches);
    }

    [Theory][InlineData("audit")][InlineData("receipt")][InlineData("content")][InlineData("header")]
    public async Task EveryLateFailureRollsBackRootAuditInventoryLedgerContentAndFirstHandoff(string failure)
    {
        var s=await Create();using var customer=s.Customer;var page=await Page(s);var input=Input(page);var before=await State(s);
        var createSql=failure switch{
            "audit"=>"ALTER TABLE [identity].[Audit] WITH NOCHECK ADD CONSTRAINT [CK_DigitalQaFailure] CHECK ([Action]<>'ORDER_DIGITAL_DELIVERY')",
            "receipt"=>"ALTER TABLE [sales].[DigitalDeliveryCommands] WITH NOCHECK ADD CONSTRAINT [CK_DigitalQaFailure] CHECK (DATALENGTH([ProtectedReceipt])=0)",
            "content"=>"ALTER TABLE [sales].[DigitalDeliveryItems] WITH NOCHECK ADD CONSTRAINT [CK_DigitalQaFailure] CHECK (DATALENGTH([ProtectedContent])=0)",
            _=>"ALTER TABLE [sales].[FulfillmentHeaders] WITH NOCHECK ADD CONSTRAINT [CK_DigitalQaFailure] CHECK ([FirstDispatchRecordedAt] IS NULL)"};
        var dropSql=failure switch{
            "audit"=>"ALTER TABLE [identity].[Audit] DROP CONSTRAINT [CK_DigitalQaFailure]",
            "receipt"=>"ALTER TABLE [sales].[DigitalDeliveryCommands] DROP CONSTRAINT [CK_DigitalQaFailure]",
            "content"=>"ALTER TABLE [sales].[DigitalDeliveryItems] DROP CONSTRAINT [CK_DigitalQaFailure]",
            _=>"ALTER TABLE [sales].[FulfillmentHeaders] DROP CONSTRAINT [CK_DigitalQaFailure]"};
        await Scope(async sp=>{await sp.GetRequiredService<SalesDbContext>().Database.ExecuteSqlRawAsync(createSql);return true;});
        try{using var failed=await Admin.PostAsJsonAsync(Path(s)+"/commands/"+input.CommandId,input);Assert.Equal(HttpStatusCode.Conflict,failed.StatusCode);}finally{await Scope(async sp=>{await sp.GetRequiredService<SalesDbContext>().Database.ExecuteSqlRawAsync(dropSql);return true;});}
        Assert.Equal(before,await State(s));Assert.Equal(JsonSerializer.Serialize(page),JsonSerializer.Serialize(await Page(s)));Assert.False((await Deliver(s,input)).Replayed);
    }

    [Fact]public async Task MaximumEscapedUtf8ContentFitsProtectedSqlLimitAndBatchLimitsFailBeforeMutation()
    {
        var s=await Create(quantity:16);using var customer=s.Customer;var page=await Page(s);var before=await State(s);var texts=new[]{new string('<',4096),new string('"',4096),new string('\\',4096),new string('آ',2048),string.Concat(Enumerable.Repeat("😀",1024)),new string('\u2028',1365)+"x","x"+new string('\t',4095),"x"+new string('\n',4095)};var contents=Enumerable.Range(0,16).Select(i=>texts[i%texts.Length]).ToArray();
        // Exactly 64KiB of raw UTF-8 is allowed, even if API JSON escapes it.
        var maximum=Input(page,Enumerable.Repeat(new string('<',4096),16).ToArray());var overflow=maximum with{CommandId=Id(),Lines=[new(page.Lines[0].LineKey,Enumerable.Repeat(new string('<',4096),17).ToArray())]};using(var denied=await Admin.PostAsJsonAsync(Path(s)+"/commands/"+overflow.CommandId,overflow))Assert.Equal(HttpStatusCode.BadRequest,denied.StatusCode);Assert.Equal(before,await State(s));
        var result=await Deliver(s,Input(page,contents));var revealed=await Read<DigitalDeliveryContent>(customer,Own(s)+"/"+result.Delivery.Id+"/content");Assert.Equal(contents,revealed.Items.Select(x=>x.Content).ToArray());Assert.Equal("Fulfilled",(await State(s)).State);
        await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();var rows=await db.DigitalItems.Where(x=>x.DeliveryId==result.Delivery.Id).ToArrayAsync();Assert.Equal(16,rows.Length);Assert.All(rows,x=>Assert.InRange(x.ProtectedContent.Length,1,16384));return true;});
        var exact=await Create(quantity:16);using var exactCustomer=exact.Customer;var accepted=await Deliver(exact,Input(await Page(exact),Enumerable.Repeat(new string('<',4096),16).ToArray()));Assert.Equal(16,(await Read<DigitalDeliveryContent>(exactCustomer,Own(exact)+"/"+accepted.Delivery.Id+"/content")).Items.Length);
    }

    [Fact]public async Task InvalidOwnershipVersionsKindsAcknowledgementAndUnpaidStateLeaveNoHandoff()
    {
        var s=await Create(paid:false,mixed:true);using var customer=s.Customer;var before=await State(s);var page=await Page(s,"digital-admin-uncommitted");Assert.False(page.CanDeliver);Assert.Null(page.InventoryFingerprint);Assert.False(page.CreditAuthorized);Assert.Contains("payment_not_confirmed",page.Blockers);Assert.Contains("reservation_not_allocated",page.Blockers);using(var unpaid=await Admin.PostAsJsonAsync(Path(s)+"/commands/"+Id(),Input(page)))Assert.Equal(HttpStatusCode.BadRequest,unpaid.StatusCode); // route/body command mismatch is rejected before payment
        var input=Input(page);using(var unpaid=await Admin.PostAsJsonAsync(Path(s)+"/commands/"+input.CommandId,input))Assert.Equal(HttpStatusCode.Conflict,unpaid.StatusCode);Assert.Equal(before,await State(s));
        await OrderFixture.Json(await customer.PostAsJsonAsync("/api/orders/v2/"+s.Id+"/cancel",new{version=page.OrderVersion}));var cancelled=await Page(s);Assert.Equal("Cancelled",cancelled.OrderState);Assert.Null(cancelled.InventoryFingerprint);Assert.False(cancelled.CanDeliver);Assert.Equal(s.Quantity,cancelled.Lines.Single().Remaining);
        var paid=await Create(mixed:true);using var paidCustomer=paid.Customer;var ready=await Page(paid);var clean=await State(paid);
        foreach(var invalid in new[]{Input(ready)with{Acknowledge=false},Input(ready)with{OwnerId="wrong-owner"}}){using var denied=await Admin.PostAsJsonAsync(Path(paid)+"/commands/"+invalid.CommandId,invalid);Assert.Equal(HttpStatusCode.BadRequest,denied.StatusCode);}
        var stale=Input(ready)with{OrderVersion="AAAAAAAAAAA="};using(var denied=await Admin.PostAsJsonAsync(Path(paid)+"/commands/"+stale.CommandId,stale))Assert.Equal(HttpStatusCode.Conflict,denied.StatusCode);
        var physical=Input(ready)with{Lines=[new(paid.Physical!.ToUpperInvariant(),["SYNTHETIC-PHYSICAL-INJECTION"])]};using(var denied=await Admin.PostAsJsonAsync(Path(paid)+"/commands/"+physical.CommandId,physical))Assert.Equal(HttpStatusCode.Conflict,denied.StatusCode);
        var forged=JsonSerializer.SerializeToNode(Input(ready),Json)!.AsObject();forged["bankVerified"]=true;using(var denied=await Admin.PostAsJsonAsync(Path(paid)+"/commands/"+forged["commandId"]!.GetValue<string>(),forged))Assert.Equal(HttpStatusCode.BadRequest,denied.StatusCode);
        using(var denied=await customer.GetAsync(Path(paid)))Assert.Equal(HttpStatusCode.Forbidden,denied.StatusCode);using(var query=await Admin.GetAsync(Path(paid)+"?owner=forged"))Assert.Equal(HttpStatusCode.BadRequest,query.StatusCode);Assert.Equal(clean,await State(paid));
    }

    [Theory][InlineData(false,1025)][InlineData(true,1009)]
    public async Task NewOverCapacityLegacyQuoteFailsBeforePersistingQuoteOrderOrInventory(bool mixed,int quantity)
    {
        await fixture.Settings(max:10);var digital=await fixture.Product(stock:quantity,digital:true);var physical=mixed?await fixture.Product():((string Variant,string Method)?)null;var person=await fixture.Customer();using var customer=person.Client;var current=await OrderFixture.Json(await customer.GetAsync("/api/cart/en"));CartLineInput[] selections=mixed?[new(digital.Variant,quantity),new(physical!.Value.Variant,1)]:[new(digital.Variant,quantity)];var cart=await OrderFixture.Json(await customer.PutAsJsonAsync("/api/cart/en",new CartInput(selections,current["version"]?.GetValue<string>())));
        var before=await Scope(async sp=>{var stock=await sp.GetRequiredService<InventoryDbContext>().Stock.AsNoTracking().SingleAsync(x=>x.VariantId==digital.Variant);return(stock.OnHand,stock.Reserved,Version:Convert.ToBase64String(stock.Version));});
        foreach(var route in new[]{"/api/cart/en/quote"}){var version=cart["version"]!.GetValue<string>();using var response=await customer.PostAsJsonAsync(route,new CheckoutQuoteInput(version,digital.Method,null,Id()));Assert.Equal(HttpStatusCode.Conflict,response.StatusCode);Assert.Contains("digital_delivery_order_capacity_conflict",await response.Content.ReadAsStringAsync());}
        await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();var inventory=sp.GetRequiredService<InventoryDbContext>();var stock=await inventory.Stock.AsNoTracking().SingleAsync(x=>x.VariantId==digital.Variant);Assert.Equal(before,(stock.OnHand,stock.Reserved,Convert.ToBase64String(stock.Version)));var cartId=await db.Carts.Where(x=>x.OwnerId==person.Owner).Select(x=>x.Id).SingleAsync();Assert.False(await db.Quotes.AnyAsync(x=>x.CartId==cartId));Assert.False(await db.Orders.AnyAsync(x=>x.OwnerId==person.Owner));Assert.False(await inventory.Reservations.AnyAsync(x=>x.OwnerId==person.Owner));Assert.False(await inventory.Movements.AnyAsync(x=>x.VariantId==digital.Variant));return true;});
    }

    [Fact]public async Task LongDigitalCatalogMetadataCannotCreateAnUndeliverableLegacyQuoteOrReservation()
    {
        // 700 Persian characters fit Catalog's 2000-character SQL label limit,
        // but exceed the 4096 strict-JSON budget that guarantees future 16-unit batches.
        await fixture.Settings(max:10);var digital=await fixture.Product(stock:1,digital:true);await Scope(async sp=>{var catalog=sp.GetRequiredService<CatalogDbContext>();await catalog.Variants.Where(v=>v.Id==digital.Variant).ExecuteUpdateAsync(set=>set.SetProperty(v=>v.LabelEn,new string('آ',700)));return true;});var person=await fixture.Customer();using var customer=person.Client;var current=await OrderFixture.Json(await customer.GetAsync("/api/cart/en"));var cart=await OrderFixture.Json(await customer.PutAsJsonAsync("/api/cart/en",new CartInput([new(digital.Variant,1)],current["version"]?.GetValue<string>())));
        var before=await Scope(async sp=>{var stock=await sp.GetRequiredService<InventoryDbContext>().Stock.AsNoTracking().SingleAsync(x=>x.VariantId==digital.Variant);return(stock.OnHand,stock.Reserved,Version:Convert.ToBase64String(stock.Version));});
        foreach(var route in new[]{"/api/cart/en/quote"}){var version=cart["version"]!.GetValue<string>();using var response=await customer.PostAsJsonAsync(route,new CheckoutQuoteInput(version,digital.Method,null,Id()));Assert.Equal(HttpStatusCode.Conflict,response.StatusCode);Assert.Contains("digital_delivery_metadata_capacity_conflict",await response.Content.ReadAsStringAsync());}
        await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();var inventory=sp.GetRequiredService<InventoryDbContext>();var stock=await inventory.Stock.AsNoTracking().SingleAsync(x=>x.VariantId==digital.Variant);Assert.Equal(before,(stock.OnHand,stock.Reserved,Convert.ToBase64String(stock.Version)));var cartId=await db.Carts.Where(x=>x.OwnerId==person.Owner).Select(x=>x.Id).SingleAsync();Assert.False(await db.Quotes.AnyAsync(x=>x.CartId==cartId));Assert.False(await db.Orders.AnyAsync(x=>x.OwnerId==person.Owner));Assert.False(await inventory.Reservations.AnyAsync(x=>x.OwnerId==person.Owner));Assert.False(await inventory.Movements.AnyAsync(x=>x.VariantId==digital.Variant));return true;});
    }

    [Fact]public async Task ByteCapacityRejectsAnIrreversibleSmallBatchThatWouldStrandRemainingKinds()
    {
        var s=await Create(quantity:1008,mixed:true);using var customer=s.Customer;var before=await State(s);var page=await Page(s);var small=Input(page,"SYNTHETIC-SMALL-CODE");using(var denied=await Admin.PostAsJsonAsync(Path(s)+"/commands/"+small.CommandId,small)){Assert.Equal(HttpStatusCode.Conflict,denied.StatusCode);Assert.Contains("fulfillment_capacity_conflict",await denied.Content.ReadAsStringAsync());}Assert.Equal(before,await State(s));
        // The byte guarantee is about unknown future content, not today's short
        // codes. A larger current batch can preserve enough future 16-unit slots.
        var result=await Deliver(s,Input(page,Enumerable.Repeat("SYNTHETIC-SHORT-CODE",100).ToArray()));Assert.Equal(100,result.Delivery.Lines.Single().Quantity);var remaining=await Page(s);Assert.Equal(908,remaining.Lines.Single().Remaining);Assert.Equal(63,remaining.RemainingDeliverySlots);Assert.Equal("Paid",remaining.OrderState);
    }

    [Fact]public async Task MixedTrackedPhysicalUnitMustBeAssignedBeforeAnyCodeAndOnlyItsOwnPhysicalHandoffFinishesOrder()
    {
        var s=await Create(quantity:1,mixed:true,trackedPhysical:true,assignPhysical:false);using var customer=s.Customer;var page=await Page(s);Assert.False(page.CanDeliver);Assert.Contains("complete_serial_assignment_required",page.Blockers);var input=Input(page);var before=await State(s);using(var denied=await Admin.PostAsJsonAsync(Path(s)+"/commands/"+input.CommandId,input))Assert.Equal(HttpStatusCode.BadRequest,denied.StatusCode);Assert.Equal(before,await State(s));
        await Scope(async sp=>await sp.GetRequiredService<SalesTransactionCoordinator>().RunAsync(async()=>{var order=await sp.GetRequiredService<SalesDbContext>().Orders.SingleAsync(x=>x.Id==s.Id);await sp.GetRequiredService<IStockSerialAssignments>().AssignAsync(new(s.Owner,order.ReservationId,"synthetic-mixed-assignment",Id(),[new(s.Unit!.Id,s.Unit.Version,DateTimeOffset.UtcNow.AddYears(1))]),default);return true;},inventoryOnly:true));await Deliver(s,Input(await Page(s)));Assert.Equal("Paid",(await State(s)).State);
        var path=$"/api/admin/orders/{s.Owner}/{s.Id}/fulfillment";
        async Task<ParcelPage> Parcels()=>JsonSerializer.Deserialize<ParcelPage>((await OrderFixture.Json(await Admin.GetAsync(path))).ToJsonString(),Json)!;
        async Task<ParcelCommandResult> Write(string action,ParcelSummary? previous=null){var p=await Parcels();var command=new ParcelCommandInput(s.Owner,Id(),action,p.OrderVersion,previous?.Id,previous?.Version,p.InventoryFingerprint,"Synthetic mixed tracked handoff",true,action=="pack"?"SYNTHETIC-DEVICE-PARCEL":null,action=="pack"?[new(s.Physical!.ToUpperInvariant(),1,[s.Unit!.Id])]:[],action=="dispatch"?"حمل ساختگی":null,action=="dispatch"?"Synthetic carrier":null,null,action is"dispatch"or"deliver"?DateTimeOffset.UtcNow:null);return JsonSerializer.Deserialize<ParcelCommandResult>((await OrderFixture.Json(await Admin.PostAsJsonAsync(path+"/commands/"+command.CommandId,command))).ToJsonString(),Json)!;}
        var packed=await Write("pack");var hidden=await customer.GetFromJsonAsync<ParcelDetail>($"/api/orders/{s.Id}/fulfillment/parcels/{packed.Detail.Parcel.Id}");Assert.False(hidden!.UnitDetailsVisible);Assert.Empty(hidden.Units);var sent=await Write("dispatch",packed.Detail.Parcel);Assert.Equal("Paid",(await State(s)).State);var visible=await customer.GetFromJsonAsync<ParcelDetail>($"/api/orders/{s.Id}/fulfillment/parcels/{packed.Detail.Parcel.Id}");Assert.Equal(s.Unit!.Id,Assert.Single(visible!.Units).UnitId);await Write("deliver",sent.Detail.Parcel);Assert.Equal("Fulfilled",(await State(s)).State);
        await Scope(async sp=>{var unit=await sp.GetRequiredService<InventoryDbContext>().SerialUnits.SingleAsync(x=>x.Id==s.Unit.Id);Assert.Equal("delivered",unit.State);Assert.Equal(s.Id,unit.OrderId);return true;});
    }

    [Fact]public async Task LegacySinglePhysicalShipmentRetainsItsWorkflowAndHasNoDigitalContent()
    {
        var s=await Create(quantity:1,physicalOnly:true);using var customer=s.Customer;Assert.Empty((await Read<CustomerDigitalDeliveries>(customer,Own(s))).Deliveries);var page=await Page(s);Assert.Empty(page.Lines);Assert.False(page.CanDeliver);
        var old=await Admin.GetFromJsonAsync<AdminShipmentData>($"/api/admin/orders/{s.Owner}/{s.Id}/shipment");var input=new ShipmentCommandInput(s.Owner,Id(),"pack",old!.OrderVersion,null,old.InventoryFingerprint,"Synthetic legacy compatibility",true,null,null,null,null);await OrderFixture.Json(await Admin.PostAsJsonAsync($"/api/admin/orders/{s.Id}/shipment/commands",input));Assert.Empty((await Read<CustomerDigitalDeliveries>(customer,Own(s,true))).Deliveries);
        await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();Assert.True(await db.OrderShipments.AnyAsync(x=>x.OrderId==s.Id));Assert.False(await db.FulfillmentHeaders.AnyAsync(x=>x.OrderId==s.Id));Assert.False(await db.DigitalDeliveries.AnyAsync(x=>x.OrderId==s.Id));return true;});
    }

    [Fact]public async Task CorruptOneCiphertextFailsOnlyExplicitOwnedRevealAndPublishedHistoryCannotBeDeleted()
    {
        var s=await Create(quantity:1);using var customer=s.Customer;var result=await Deliver(s,Input(await Page(s)));var snapshot=await State(s);
        await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();var row=await db.DigitalItems.SingleAsync(x=>x.DeliveryId==result.Delivery.Id);db.DigitalItems.Remove(row);await Assert.ThrowsAsync<InvalidOperationException>(()=>db.SaveChangesAsync());db.ChangeTracker.Clear();await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE [sales].[DigitalDeliveryItems] SET [ProtectedContent]={new byte[]{1,2,3}} WHERE [DeliveryId]={result.Delivery.Id}");return true;});
        Assert.Single((await Read<CustomerDigitalDeliveries>(customer,Own(s))).Deliveries);Assert.Single((await Page(s)).Deliveries);using(var corrupt=await customer.GetAsync(Own(s)+"/"+result.Delivery.Id+"/content"))Assert.Equal(HttpStatusCode.ServiceUnavailable,corrupt.StatusCode);Assert.Equal(snapshot,await State(s));
        await Scope(async sp =>
        {
            var db = sp.GetRequiredService<SalesDbContext>();
            Assert.False(db.Database.HasPendingModelChanges());
            var applied = (await db.Database.GetAppliedMigrationsAsync()).ToArray();
            // Later modules independently protect their own retained rows. Test the
            // digital migration's SQL guard without downgrading those modules.
            var assembly = db.GetService<IMigrationsAssembly>();
            var migration = assembly.CreateMigration(
                assembly.Migrations["20261028222553_PrivateDigitalFulfillment"], db.Database.ProviderName!);
            var guard = Assert.IsType<Microsoft.EntityFrameworkCore.Migrations.Operations.SqlOperation>(migration.DownOperations[0]);
            var error = await Assert.ThrowsAsync<Microsoft.Data.SqlClient.SqlException>(() => db.Database.ExecuteSqlRawAsync(guard.Sql));
            Assert.Equal(51000, error.Number);
            Assert.Contains("Digital delivery history exists", error.Message);
            Assert.True(await db.DigitalDeliveries.AnyAsync(x => x.OrderId == s.Id));
            Assert.Equal(applied, await db.Database.GetAppliedMigrationsAsync());
            return true;
        });
        // A corrupt state transition must not turn existing irreversible history
        // into a fabricated pre-handoff page with a fresh/nullable proof.
        await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();var row=await db.Orders.SingleAsync(x=>x.Id==s.Id);row.State=OrderState.AwaitingPayment;await db.SaveChangesAsync();return true;});using(var badState=await Admin.GetAsync(Path(s)))Assert.Equal(HttpStatusCode.ServiceUnavailable,badState.StatusCode);
    }
}
