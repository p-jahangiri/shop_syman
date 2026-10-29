using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection.KeyManagement;
using Microsoft.AspNetCore.DataProtection.Repositories;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Identity;
using Shop.Modules.Market;
using Shop.SharedKernel;
using System.Data;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Inventory;
using Shop.Modules.Sales;
using Xunit;

namespace Shop.SqlTests;

public sealed partial class OrderV2HttpSqlTests(MarketFixture fixture):IClassFixture<MarketFixture>
{
    private static readonly object Order2WireGate=new();
    private static async Task<JsonNode> Order2Body(HttpResponseMessage response,HttpStatusCode expected=HttpStatusCode.OK,string? kind=null,string? name=null)
    {
        using(response){var responseBytes=await response.Content.ReadAsByteArrayAsync();var raw=Encoding.UTF8.GetString(responseBytes);Assert.True(response.StatusCode==expected,$"HTTP {(int)response.StatusCode}, expected {(int)expected}: {raw}");Assert.Contains("no-store",response.Headers.CacheControl!.ToString());
            if(kind is not null&&name is not null&&Environment.GetEnvironmentVariable("SHOP_ORDER2_WIRE_DIR") is {Length:>0} directory){
                if(name.Any(c=>!char.IsAsciiLetterOrDigit(c)&&c!='-')||name!=name.ToLowerInvariant())throw new InvalidOperationException("Use static bounded wire filenames.");
                lock(Order2WireGate){
                    Directory.CreateDirectory(directory);var file="order2-"+name+".json";var bytes=responseBytes;File.WriteAllBytes(Path.Combine(directory,file),bytes);
                    var path=Path.Combine(directory,"order2-wire-manifest.json");var manifest=File.Exists(path)?JsonNode.Parse(File.ReadAllText(path))!.AsObject():new JsonObject{["schemaVersion"]=1,["source"]="OrderV2HttpSqlTests",["actualSqlHttpResponseBodies"]=true,["entries"]=new JsonArray()};
                    var entries=manifest["entries"]!.AsArray();if(entries.Any(e=>e!["file"]!.GetValue<string>()==file))throw new InvalidOperationException("A wire response name may only be captured once per run.");
                    entries.Add(new JsonObject{["kind"]=kind,["file"]=file,["sha256"]=Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes)).ToLowerInvariant()});File.WriteAllText(path,manifest.ToJsonString(new JsonSerializerOptions{WriteIndented=true}));
                }
            }
            return JsonNode.Parse(raw)!;
        }
    }
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web);
    private static string Id()=>Guid.NewGuid().ToString("N");
    private static string Text(JsonNode node,string name)=>node[name]!.GetValue<string>();
    private sealed class FixedClock(DateTimeOffset instant):TimeProvider{public override DateTimeOffset GetUtcNow()=>instant;}
    private sealed record Scenario(HttpClient Customer,string Owner,string Request,string Task,string Offer,string Line,string Variant,string Acceptance,DateTimeOffset PurchaseUntil);
    private sealed record Facts(int OnHand,int Reserved,int Sourcing,int PublicAvailable,int Allocations,int Commands,int Agreements,int AllocationEvents,int MarketAllocationEvents,int Orders,int Reservations,int Settings,string RequestVersion,string TaskVersion,string OfferVersion);
    private static string WriteRoute(Scenario s,string allocation)=>$"/api/admin/inventory/sourcing-requests/{s.Request}/tasks/{s.Task}/allocations/{allocation}";
    private static string AllocationRoute(string allocation)=>"/api/admin/inventory/sourcing-allocations/"+allocation;
    private static string SupplyRoute(Scenario s,bool admin=false,bool v2=true)=>$"/api/{(admin?"admin/":"")}sourcing/requests/{s.Request}/supply/{(v2?"v2/":"")}{s.Task}";
    private static string AgreementRoute(Scenario s,bool admin=false)=>$"/api/{(admin?"admin/":"")}sourcing/requests/{s.Request}/agreements/{s.Acceptance}";
    private static async Task<JsonNode> Body(HttpResponseMessage response,HttpStatusCode expected=HttpStatusCode.OK,string? capture=null)
    {
        using(response){var raw=await response.Content.ReadAsStringAsync();Assert.True(response.StatusCode==expected,$"HTTP {(int)response.StatusCode}, expected {(int)expected}: {raw}");Assert.Contains("no-store",response.Headers.CacheControl!.ToString());
            if(capture is not null&&Environment.GetEnvironmentVariable("SHOP_CART2_WIRE_DIR") is {Length:>0} directory){Directory.CreateDirectory(directory);await File.WriteAllTextAsync(Path.Combine(directory,capture+".json"),raw);}
            return raw.Length==0?new JsonObject():JsonNode.Parse(raw)!;
        }
    }
    private async Task<T> Scope<T>(Func<IServiceProvider,Task<T>> action)
    {
        await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();Assert.StartsWith("SaymanTest_",scope.ServiceProvider.GetRequiredService<InventoryDbContext>().Database.GetDbConnection().Database);return await action(scope.ServiceProvider);
    }
    private async Task<(HttpClient Client,string Owner)> Customer()=>await Scope(async sp=>{
        var users=sp.GetRequiredService<UserManager<ShopUser>>();var name="allocation"+Id();var user=new ShopUser{UserName=name,Email=name+"@example.test",EmailConfirmed=true,DisplayName="Synthetic allocation HTTP customer"};Assert.True((await users.CreateAsync(user,fixture.Sql.Password)).Succeeded);
        var session=await sp.GetRequiredService<AuthService>().PasswordAsync(new(name,fixture.Sql.Password),true,true,false,default);var client=fixture.Sql.Factory.CreateClient(new(){HandleCookies=false});client.DefaultRequestHeaders.Add("Origin","http://127.0.0.1:3000");client.DefaultRequestHeaders.Authorization=new("Bearer",session.AccessToken);return(client,user.Id);
    });
    private async Task<Scenario> Create(int onHand=2,bool openingStock=true)
    {
        var key=Id();var model=new CatalogModelInput("phones","samsung","allocation-"+key,[new("fa","گوشی تخصیص مصنوعی "+key,"فقط SQL آزمایشی"),new("en","Synthetic allocation phone "+key,"SQL QA only")],[new("battery",TextFa:"باتری نمونه",TextEn:"Synthetic battery")],["/products/phone-green.svg"],null);
        var listing=Text(await Body(await fixture.Writer.PostAsJsonAsync("/api/admin/market/models",new CreateMarketModelInput(model,new("Published","qa-allocation",key,"منبع مصنوعی","Synthetic source",null,"unknown",null,null,null,true)))),"id");
        var person=await Customer();var cart=await Body(await person.Client.GetAsync("/api/cart/en/sourcing"));cart=await Body(await person.Client.PutAsJsonAsync("/api/cart/en/sourcing",new CartSourcingInput([new(listing,2)],cart["version"]?.GetValue<string>())));var candidate=cart["lines"]![0]!["candidate"]!;var productId=Text(candidate["model"]!,"id");var submitted=await Body(await person.Client.PostAsJsonAsync("/api/cart/en/sourcing/submit",new SourcingSubmitInput(Id(),Text(cart,"version"),[new(listing,Text(candidate,"fingerprint"))])),HttpStatusCode.Created);var request=Text(submitted,"id");var variant=Id();
        await Scope(async sp=>{var db=sp.GetRequiredService<CatalogDbContext>();var product=await db.Products.Include(p=>p.PurchaseMethods).SingleAsync(p=>p.Id==productId);product.Status="Published";product.PurchaseMethods.Add(new(){ProductId=productId,MethodId="online"});db.Variants.Add(new(){Id=variant,ProductId=productId,Sku="QA-ALLOCATION-"+key,PriceRial=123,IsActive=true,LabelFa="SKU واقعی نمونه",LabelEn="Actual synthetic SKU",WarrantyFa="گارانتی مصنوعی",WarrantyEn="Synthetic warranty"});await db.SaveChangesAsync();return true;});
        using var finance=await fixture.ReuseStaff("FinanceManager");var parent=await Body(await finance.GetAsync($"/api/admin/sourcing/requests/{request}"));var sku=await Body(await finance.GetAsync($"/api/admin/sourcing/requests/{request}/offer-skus/{variant}?listingId={listing}"));var offer=Id();var line=Id();var now=DateTimeOffset.UtcNow;var offerPath=$"/api/admin/sourcing/requests/{request}/offers/{offer}";
        await Body(await finance.PutAsJsonAsync(offerPath,new SourcingOfferSaveInput(Id(),Text(parent["summary"]!,"version"),null,[new(line,listing,variant,2,"9007199254740993",Text(sku,"materialFingerprint"),Text(sku,"currentFingerprint"))],"رضایت مصنوعی غیرمالی آزمون SQL","Synthetic nonfinancial consent for SQL QA",now.AddMinutes(20),now.AddHours(2))));var draft=await Body(await finance.GetAsync(offerPath));await Body(await finance.PostAsJsonAsync(offerPath+"/publish",new SourcingOfferPublishInput(Id(),Text(draft,"requestVersion"),Text(draft["offer"]!["summary"]!,"version"),Text(draft["offer"]!["summary"]!,"termsHash"))));
        var customerOffer=$"/api/sourcing/requests/{request}/offers/{offer}";var published=await Body(await person.Client.GetAsync(customerOffer));await Body(await person.Client.PostAsJsonAsync(customerOffer+"/accept",new SourcingOfferActionInput(Id(),Text(published,"requestVersion"),Text(published["offer"]!["summary"]!,"version"),Text(published["offer"]!["summary"]!,"termsHash"))));var accepted=await Body(await person.Client.GetAsync(customerOffer));var summary=accepted["offer"]!["summary"]!;var task=Id();
        using(var sales=await fixture.ReuseStaff("SalesManager"))await Body(await sales.PutAsJsonAsync(offerPath+"/supply/"+task,new SourcingSupplyStartInput(Id(),Text(accepted,"requestVersion"),Text(summary,"version"),Text(summary,"termsHash"))));
        // Explicit synthetic physical quantity through the existing real ledger
        // command, after consent. This never seeds or adjusts the owner's DB.
        if(openingStock)using(var inventory=await fixture.ReuseStaff("InventoryManager"))await Body(await inventory.PostAsJsonAsync($"/api/admin/inventory/{variant}/adjust",new StockAdjustment(onHand,"Synthetic QA physical opening stock",Id(),null)));
        return new(person.Client,person.Owner,request,task,offer,line,variant,Text(accepted["offer"]!,"acceptanceId"),summary["purchaseUntil"]!.GetValue<DateTimeOffset>());
    }
    private async Task<SourcingAllocationInput> Input(Scenario s,HttpClient inventory,string? capture=null)
    {
        var candidate=await Body(await inventory.GetAsync("/api/admin/inventory/sourcing-tasks/"+s.Task+"/allocation"),capture:capture);NoPrivateStockProjection(candidate);Assert.True(candidate["canAttemptAllocation"]!.GetValue<bool>());Assert.False(candidate["canCheckout"]!.GetValue<bool>());Assert.False(candidate["canPay"]!.GetValue<bool>());Assert.Equal(s.Request,Text(candidate,"requestId"));Assert.Equal(s.Task,Text(candidate,"taskId"));Assert.Equal(s.Acceptance,Text(candidate,"acceptanceId"));
        foreach(var name in new[]{"requestVersion","taskVersion","offerVersion"})Assert.Equal(8,Convert.FromBase64String(Text(candidate,name)).Length);Assert.Matches("^[A-F0-9]{64}$",Text(candidate,"termsHash"));var stock=candidate["stock"]![0]!;Assert.Equal(8,Convert.FromBase64String(Text(stock,"version")).Length);
        return new(Id(),Text(candidate,"requestVersion"),Text(candidate,"taskVersion"),Text(candidate,"offerVersion"),s.Acceptance,Text(candidate,"termsHash"),DateTimeOffset.UtcNow.AddMinutes(10),"Synthetic actual-stock allocation",[new(s.Line,Text(stock,"version"),Text(stock,"trackingMode"),[])]);
    }
    private Task<Facts> ReadFacts(Scenario s)=>Scope(async sp=>{
        var db=sp.GetRequiredService<InventoryDbContext>();var market=sp.GetRequiredService<MarketDbContext>();var sales=sp.GetRequiredService<SalesDbContext>();var stock=await db.Stock.AsNoTracking().SingleAsync(x=>x.VariantId==s.Variant);
        return new Facts(stock.OnHand,stock.Reserved,stock.SourcingReserved,await db.Database.SqlQuery<int>($"SELECT [Available] AS [Value] FROM [inventory].[AvailableStockV1] WHERE [VariantId]={s.Variant}").SingleAsync(),await db.SourcingAllocations.CountAsync(a=>a.TaskId==s.Task),await db.SourcingAllocationCommands.CountAsync(c=>c.TaskId==s.Task),await sales.SourcingPriceAgreements.CountAsync(a=>a.AcceptanceId==s.Acceptance),await db.SourcingAllocationEvents.CountAsync(e=>db.SourcingAllocations.Any(a=>a.Id==e.AllocationId&&a.TaskId==s.Task)),await market.SourcingSupplyEvents.CountAsync(e=>e.TaskId==s.Task&&e.ReasonCode=="stock_allocated"),await sales.Orders.CountAsync(),await db.Reservations.CountAsync(),await sales.OrderSettings.CountAsync(),Convert.ToBase64String((await market.SourcingRequests.AsNoTracking().SingleAsync(r=>r.Id==s.Request)).Version),Convert.ToBase64String((await market.SourcingSupplyTasks.AsNoTracking().SingleAsync(t=>t.Id==s.Task)).Version),Convert.ToBase64String((await market.SourcingOffers.AsNoTracking().SingleAsync(o=>o.Id==s.Offer)).Version));
    });
    private static void NoPrivateStockProjection(JsonNode node)
    {
        var raw=node.ToJsonString();foreach(var name in new[]{"ownerId","actorId","unitIds","unitId","sourceKey","sourceNameFa","sourceNameEn","reference","internalNote","protectedNote","unitPriceRial","lineTotalRial","serial","imei1","imei2"})Assert.DoesNotContain("\""+name+"\":",raw,StringComparison.OrdinalIgnoreCase);
    }
    private async Task<string> Keys()=>await Scope(sp=>Task.FromResult(Assert.IsType<FileSystemXmlRepository>(sp.GetRequiredService<IOptions<KeyManagementOptions>>().Value.XmlRepository).Directory.FullName));
    private static HttpClient CopyClient(SqlFactory factory,HttpClient original){var result=factory.CreateClient(new(){HandleCookies=false});foreach(var header in original.DefaultRequestHeaders)result.DefaultRequestHeaders.TryAddWithoutValidation(header.Key,header.Value);return result;}

    private static string Offer(Scenario s)=>$"/api/sourcing/requests/{s.Request}/offers/{s.Offer}";
    private async Task<JsonNode> Allocate(Scenario s)
    {
        using var inventory=await fixture.ReuseStaff("InventoryManager");
        await Body(await inventory.PutAsJsonAsync(WriteRoute(s,Id()),await Input(s,inventory)));
        return await Body(await s.Customer.GetAsync(Offer(s)+"/purchase"));
    }
    private static SourcingConversionInput ConvertInput(JsonNode c)=>new(Id(),Text(c,"taskId"),Text(c,"requestVersion"),Text(c,"taskVersion"),Text(c,"offerVersion"),Text(c,"acceptanceId"),Text(c["agreement"]!,"id"),Text(c["agreement"]!,"version"),Text(c["allocation"]!,"allocationId"),Text(c["allocation"]!,"version"),Text(c,"termsHash"),c["cartVersion"]?.GetValue<string>());
    private async Task<string> StockFingerprint(Scenario s)=>await Scope(async sp=>{
        var db=sp.GetRequiredService<InventoryDbContext>();var sales=sp.GetRequiredService<SalesDbContext>();
        var stock=await db.Stock.AsNoTracking().SingleAsync(x=>x.VariantId==s.Variant);
        var allocations=await db.SourcingAllocations.AsNoTracking().Where(a=>a.AcceptanceId==s.Acceptance).OrderBy(a=>a.Id).ToArrayAsync();
        var agreement=await sales.SourcingPriceAgreements.AsNoTracking().SingleOrDefaultAsync(a=>a.AcceptanceId==s.Acceptance);
        return JsonSerializer.Serialize(new{Stock=stock,Allocations=allocations,Agreement=agreement,Orders=await sales.Orders.CountAsync(),Reservations=await db.Reservations.CountAsync(),Settings=await sales.OrderSettings.CountAsync()},Json);
    });
    private static string Quote4Route(string locale="en")=>$"/api/cart/{locale}/v2/quote";
    private async Task<(Scenario Scenario,JsonNode Cart)> Quote4Cart(int onHand=3,bool ordinary=true,bool inquiry=false)
    {
        var s=await Create(onHand);
        var cart=await Body(await s.Customer.GetAsync("/api/cart/en/v2"));
        if(ordinary)cart=await Body(await s.Customer.PutAsJsonAsync("/api/cart/en/v2",new CartV2Input([new(s.Variant,1)],Text(cart,"version")))) ;
        if(inquiry){
            var key=Id();var model=new CatalogModelInput("phones","samsung","quote4-inquiry-"+key,[new("fa","مدل استعلام مستقل "+key,"فقط آزمون"),new("en","Separate inquiry model "+key,"QA only")],[new("battery",TextFa:"باتری نمونه",TextEn:"Synthetic battery")],["/products/phone-green.svg"],null);
            var listing=Text(await Body(await fixture.Writer.PostAsJsonAsync("/api/admin/market/models",new CreateMarketModelInput(model,new("Published","qa-quote4-inquiry",key,"منبع مصنوعی","Synthetic source",null,"unknown",null,null,null,true)))),"id");
            cart=await Body(await s.Customer.PutAsJsonAsync("/api/cart/en/sourcing",new CartSourcingInput([new(listing,3)],Text(cart,"version"))));
        }
        var candidate=await Allocate(s);
        await Body(await s.Customer.PostAsJsonAsync(Offer(s)+"/convert",ConvertInput(candidate)));
        return(s,await Body(await s.Customer.GetAsync("/api/cart/en/v2")));
    }

    private async Task<Scenario> Quote4SecondAgreement(Scenario first,bool finishConversion=true)
    {
        var customer=first.Customer;
        var listing=await Scope(async sp=>(await sp.GetRequiredService<MarketDbContext>().SourcingRequests.Include(r=>r.Lines).SingleAsync(r=>r.Id==first.Request)).Lines.Single().ListingId);
        var cart=await Body(await customer.GetAsync("/api/cart/en/sourcing"));
        cart=await Body(await customer.PutAsJsonAsync("/api/cart/en/sourcing",new CartSourcingInput([new(listing,1)],Text(cart,"version"))));
        var candidate=cart["lines"]![0]!["candidate"]!;
        var submitted=await Body(await customer.PostAsJsonAsync("/api/cart/en/sourcing/submit",new SourcingSubmitInput(Id(),Text(cart,"version"),[new(listing,Text(candidate,"fingerprint"))])),HttpStatusCode.Created);
        var request=Text(submitted,"id");using var finance=await fixture.ReuseStaff("FinanceManager");
        var parent=await Body(await finance.GetAsync($"/api/admin/sourcing/requests/{request}"));var sku=await Body(await finance.GetAsync($"/api/admin/sourcing/requests/{request}/offer-skus/{first.Variant}?listingId={listing}"));
        var offer=Id();var line=Id();var now=DateTimeOffset.UtcNow;var path=$"/api/admin/sourcing/requests/{request}/offers/{offer}";
        await Body(await finance.PutAsJsonAsync(path,new SourcingOfferSaveInput(Id(),Text(parent["summary"]!,"version"),null,[new(line,listing,first.Variant,1,"777",Text(sku,"materialFingerprint"),Text(sku,"currentFingerprint"))],"توافق دوم مصنوعی","Second synthetic agreement",now.AddMinutes(20),now.AddHours(2))));
        var draft=await Body(await finance.GetAsync(path));await Body(await finance.PostAsJsonAsync(path+"/publish",new SourcingOfferPublishInput(Id(),Text(draft,"requestVersion"),Text(draft["offer"]!["summary"]!,"version"),Text(draft["offer"]!["summary"]!,"termsHash"))));
        var customerPath=$"/api/sourcing/requests/{request}/offers/{offer}";var published=await Body(await customer.GetAsync(customerPath));
        await Body(await customer.PostAsJsonAsync(customerPath+"/accept",new SourcingOfferActionInput(Id(),Text(published,"requestVersion"),Text(published["offer"]!["summary"]!,"version"),Text(published["offer"]!["summary"]!,"termsHash"))));
        var accepted=await Body(await customer.GetAsync(customerPath));var summary=accepted["offer"]!["summary"]!;var task=Id();
        using(var sales=await fixture.ReuseStaff("SalesManager"))await Body(await sales.PutAsJsonAsync(path+"/supply/"+task,new SourcingSupplyStartInput(Id(),Text(accepted,"requestVersion"),Text(summary,"version"),Text(summary,"termsHash"))));
        var second=first with{Request=request,Task=task,Offer=offer,Line=line,Acceptance=Text(accepted["offer"]!,"acceptanceId"),PurchaseUntil=summary["purchaseUntil"]!.GetValue<DateTimeOffset>()};
        if(finishConversion){var purchase=await Allocate(second);await Body(await customer.PostAsJsonAsync(Offer(second)+"/convert",ConvertInput(purchase)));}return second;
    }
    // Every policy below exists only in this class fixture's generated GUID
    // database, using the owner's D21 synthetic QA values, and is removed in
    // finally before another test may observe the fixture.
    private sealed class Order2PolicyLease(Func<Task> cleanup):IAsyncDisposable{public ValueTask DisposeAsync()=>new(cleanup());}
    private async Task<Order2PolicyLease> Order2Policies()
    {
        await Scope(async sp=>{
            var db=sp.GetRequiredService<SalesDbContext>();Assert.False(await db.OrderSettings.AnyAsync());Assert.False(await db.ChargePolicies.AnyAsync());
            await sp.GetRequiredService<SalesTransactionCoordinator>().RunAsync(async()=>{
                await sp.GetRequiredService<CheckoutOrderSettingsService>().SaveAsync(new(true,60,2,null),default);
                await sp.GetRequiredService<CheckoutChargePolicyService>().SaveAsync(new("flat","ارسال مصنوعی QA","Synthetic QA shipping","","","12345",null,"exempt",null,"goods","half_up",null),default);return true;
            });return true;
        });
        return new(async()=>{await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();await db.OrderSettings.Where(s=>s.Id==1).ExecuteDeleteAsync();await db.ChargePolicies.Where(p=>p.Id==1).ExecuteDeleteAsync();return true;});});
    }
    private static string Quote5Route(string locale="en")=>$"/api/cart/{locale}/v2/order-quote";
    private async Task<JsonNode> Order2Quote(Scenario s,JsonNode? cart=null,string? request=null,string locale="en",string? wireName=null)
    {
        cart??=await Body(await s.Customer.GetAsync("/api/cart/"+locale+"/v2"));
        return await Order2Body(await s.Customer.PostAsJsonAsync(Quote5Route(locale),new CheckoutQuoteInput(Text(cart,"version"),"online",null,request??Id())),kind:wireName is null?null:"quote5",name:wireName);
    }
    private static CreateOrderInput Order2Input(string quote)=>new(quote,Id(),"Synthetic Order2 customer","09121234567",new("IR","تهران","تهران","نشانی مصنوعی برای آزمون Order2 SQL","1234567890"),"Synthetic QA only",true);
    private async Task<string> Order2Effects(Scenario s)=>await Scope(async sp=>{
        var db=sp.GetRequiredService<SalesDbContext>();var inv=sp.GetRequiredService<InventoryDbContext>();
        return System.Text.Json.JsonSerializer.Serialize(new{
            Cart=await db.Carts.AsNoTracking().Where(c=>c.OwnerId==s.Owner).Select(c=>new{c.Id,c.Revision,c.Version,Ordinary=c.Lines.Select(l=>new{l.VariantId,l.Quantity}),Offers=c.OfferLines.Select(l=>new{l.Id,l.AgreementId}),Inquiry=c.SourcingLines.Select(l=>new{l.ListingId,l.Quantity})}).SingleAsync(),
            Stock=await inv.Stock.AsNoTracking().SingleAsync(x=>x.VariantId==s.Variant),
            Agreement=await db.SourcingPriceAgreements.AsNoTracking().SingleAsync(a=>a.AcceptanceId==s.Acceptance),
            Allocations=await inv.SourcingAllocations.AsNoTracking().Where(a=>a.AcceptanceId==s.Acceptance).OrderBy(a=>a.Id).ToArrayAsync(),
            Orders=await db.Orders.CountAsync(o=>o.OwnerId==s.Owner),Reservations=await inv.Reservations.CountAsync(r=>r.OwnerId==s.Owner),Outbox=await db.OrderOutbox.CountAsync(e=>db.Orders.Any(o=>o.Id==e.OrderId&&o.OwnerId==s.Owner))
        },Json);
    });
    [Fact]public async Task Order2TransfersExactAcceptedPricesAndOrdinarySkuPreservesInquiryAndHistoricalSnapshots()
    {
        await using var policy=await Order2Policies();var data=await Quote4Cart(3,true,true);var s=data.Scenario;using var customer=s.Customer;
        var preview=await Order2Body(await customer.PostAsJsonAsync(Quote5Route("fa"),new CheckoutQuoteInput(Text(data.Cart,"version"),null,null,null)),kind:"quote5",name:"preview-fa");
        Assert.Equal(5,preview["schemaVersion"]!.GetValue<int>());Assert.True(preview.AsObject().ContainsKey("quoteId"));Assert.Null(preview["quoteId"]);Assert.False(preview["canPlaceOrder"]!.GetValue<bool>());Assert.False(preview["canPay"]!.GetValue<bool>());
        await Order2Quote(s,data.Cart,locale:"fa",wireName:"mixed-saved-fa");
        var command=Id();var quote=await Order2Quote(s,data.Cart,command,wireName:"mixed-saved-en");Assert.True(quote["temporaryOrder"]!["canCreate"]!.GetValue<bool>());
        var input=Order2Input(Text(quote,"quoteId"));var result=await Order2Body(await customer.PostAsJsonAsync("/api/orders/v2",input),HttpStatusCode.Created,"order2-create","created");var order=result["order"]!;var id=Text(order["summary"]!,"id");
        Assert.False(result["replayed"]!.GetValue<bool>());Assert.Equal(2,order["schemaVersion"]!.GetValue<int>());Assert.Equal(2,order["originalSnapshotVersion"]!.GetValue<int>());Assert.Equal(3,order["summary"]!["itemCount"]!.GetValue<int>());Assert.Equal("18014398509494454",Text(order,"payableTotalRial"));Assert.False(order["canPay"]!.GetValue<bool>());Assert.Equal("gateway_unconfigured",Text(order,"paymentAvailability"));
        Assert.Equal(quote["lines"]!.AsArray().Select(l=>Text(l!,"lineId")).Order(),order["lines"]!.AsArray().Select(l=>Text(l!,"lineId")).Order());
        var accepted=Assert.Single(order["lines"]!.AsArray(),l=>Text(l!,"lineKind")=="acceptedOffer")!;Assert.Equal("9007199254740993",Text(accepted,"unitPriceRial"));Assert.Equal("Synthetic nonfinancial consent for SQL QA",Text(accepted["accepted"]!,"termsEn"));Assert.Equal(1,accepted["accepted"]!["revision"]!.GetValue<int>());
        await Scope(async sp=>{
            var sales=sp.GetRequiredService<SalesDbContext>();var inv=sp.GetRequiredService<InventoryDbContext>();var stored=await sales.Orders.Include(o=>o.Lines).Include(o=>o.LinesV2).SingleAsync(o=>o.Id==id);Assert.Equal(2,stored.SnapshotVersion);Assert.Empty(stored.Lines);Assert.Equal(2,stored.LinesV2.Count);var savedQuote=JsonSerializer.Deserialize<CheckoutQuoteV5Data>(stored.QuoteSnapshotJson,Json)!;Assert.Equal(Text(quote,"quoteId"),savedQuote.QuoteId);Assert.Equal(quote["lines"]!.ToJsonString(),JsonSerializer.SerializeToNode(savedQuote.Lines,Json)!.ToJsonString());
            var agreement=await sales.SourcingPriceAgreements.SingleAsync(a=>a.AcceptanceId==s.Acceptance);Assert.Equal("Consumed",agreement.State);Assert.Equal(id,agreement.ConsumedOrderId);
            var allocation=await inv.SourcingAllocations.SingleAsync(a=>a.AcceptanceId==s.Acceptance);Assert.Equal("Transferred",allocation.State);Assert.False(allocation.IsActive);
            var stock=await inv.Stock.SingleAsync(x=>x.VariantId==s.Variant);Assert.Equal(3,stock.OnHand);Assert.Equal(3,stock.Reserved);Assert.Equal(0,stock.SourcingReserved);
            var cart=await sales.Carts.Include(c=>c.Lines).Include(c=>c.OfferLines).Include(c=>c.SourcingLines).SingleAsync(c=>c.OwnerId==s.Owner);Assert.Empty(cart.Lines);Assert.Empty(cart.OfferLines);Assert.Single(cart.SourcingLines);
            Assert.Single(await sales.OrderOutbox.Where(e=>e.OrderId==id).ToArrayAsync());await sp.GetRequiredService<CatalogDbContext>().Variants.Where(v=>v.Id==s.Variant).ExecuteUpdateAsync(v=>v.SetProperty(x=>x.PriceRial,999).SetProperty(x=>x.WarrantyEn,"Changed public warranty"));return true;
        });
        var read=await Order2Body(await customer.GetAsync("/api/orders/v2/"+id),kind:"order2-detail",name:"detail");Assert.Equal(order.ToJsonString(),read.ToJsonString());
        var replay=await Order2Body(await customer.PostAsJsonAsync("/api/orders/v2",input),kind:"order2-create",name:"replayed");Assert.True(replay["replayed"]!.GetValue<bool>());Assert.Equal(order.ToJsonString(),replay["order"]!.ToJsonString());
        var page=await Order2Body(await customer.GetAsync("/api/orders/v2"),kind:"order2-page",name:"page");Assert.Equal(3,Assert.Single(page["items"]!.AsArray())!["itemCount"]!.GetValue<int>());
        var oldRead=await Body(await customer.GetAsync("/api/orders/"+id),HttpStatusCode.Conflict);Assert.Equal("order_contract_upgrade_required",Text(oldRead,"title"));
        var receipt=await Order2Quote(s,data.Cart,command,wireName:"consumed-replay-en");Assert.False(receipt["temporaryOrder"]!["canCreate"]!.GetValue<bool>());Assert.Equal(Text(quote,"expiresAt"),Text(receipt,"expiresAt"));Assert.Equal(Text(quote,"payableTotalRial"),Text(receipt,"payableTotalRial"));
    }
    [Fact]public async Task ConcurrentOrder2RetryHasOneTransferOrderOutboxAndOriginalDeadline()
    {
        await using var policy=await Order2Policies();var data=await Quote4Cart();var s=data.Scenario;using var customer=s.Customer;var quote=await Order2Quote(s,data.Cart);var input=Order2Input(Text(quote,"quoteId"));
        var responses=await Task.WhenAll(customer.PostAsJsonAsync("/api/orders/v2",input),customer.PostAsJsonAsync("/api/orders/v2",input));
        try{Assert.Single(responses,r=>r.StatusCode==HttpStatusCode.Created);Assert.Single(responses,r=>r.StatusCode==HttpStatusCode.OK);var bodies=await Task.WhenAll(responses.Select(async r=>JsonNode.Parse(await r.Content.ReadAsStringAsync())!));Assert.Equal(bodies[0]["order"]!.ToJsonString(),bodies[1]["order"]!.ToJsonString());}
        finally{foreach(var response in responses)response.Dispose();}
        await Scope(async sp=>{var sales=sp.GetRequiredService<SalesDbContext>();var inv=sp.GetRequiredService<InventoryDbContext>();Assert.Single(await sales.Orders.Where(o=>o.OwnerId==s.Owner).ToArrayAsync());Assert.Single(await inv.Reservations.Where(r=>r.OwnerId==s.Owner).ToArrayAsync());Assert.Single(await sales.OrderOutbox.Where(e=>sales.Orders.Any(o=>o.Id==e.OrderId&&o.OwnerId==s.Owner)).ToArrayAsync());return true;});
        await Body(await customer.PostAsJsonAsync("/api/orders/v2",input with{Note="Changed body"}),HttpStatusCode.Conflict);
    }
    [Theory][InlineData("order")][InlineData("agreement")][InlineData("cart")][InlineData("outbox")]
    public async Task FailureAtEverySalesWriteBoundaryRollsBackTransferAndRetriesSameOrder2Command(string stage)
    {
        await using var policy=await Order2Policies();var data=await Quote4Cart();var s=data.Scenario;using var customer=s.Customer;var quote=await Order2Quote(s,data.Cart);var input=Order2Input(Text(quote,"quoteId"));var before=await Order2Effects(s);
        // A dedicated GUID database and sequential test class own these fixed
        // constraint names. No identifier or value is inserted into SQL text.
        await Scope(async sp=>{await AddOrder2FailureConstraint(sp.GetRequiredService<SalesDbContext>(),stage);return true;});
        try{await Body(await customer.PostAsJsonAsync("/api/orders/v2",input),HttpStatusCode.Conflict);}
        finally{await Scope(async sp=>{await DropOrder2FailureConstraint(sp.GetRequiredService<SalesDbContext>(),stage);return true;});}
        Assert.Equal(before,await Order2Effects(s));await Body(await customer.PostAsJsonAsync("/api/orders/v2",input),HttpStatusCode.Created);
    }
    private static Task<int> AddOrder2FailureConstraint(SalesDbContext db,string stage)=>stage switch{
        "order"=>db.Database.ExecuteSqlRawAsync("ALTER TABLE [sales].[Orders] WITH NOCHECK ADD CONSTRAINT [CK_Order2_QA_Order] CHECK ([Number]<0)"),
        "agreement"=>db.Database.ExecuteSqlRawAsync("ALTER TABLE [sales].[SourcingPriceAgreements] WITH NOCHECK ADD CONSTRAINT [CK_Order2_QA_Agreement] CHECK ([State]<>'Consumed')"),
        "cart"=>db.Database.ExecuteSqlRawAsync("ALTER TABLE [sales].[Carts] WITH NOCHECK ADD CONSTRAINT [CK_Order2_QA_Cart] CHECK ([Revision]<0)"),
        "outbox"=>db.Database.ExecuteSqlRawAsync("ALTER TABLE [sales].[OrderOutbox] WITH NOCHECK ADD CONSTRAINT [CK_Order2_QA_Outbox] CHECK ([OrderId]<>[OrderId])"),
        _=>throw new ArgumentOutOfRangeException(nameof(stage))
    };
    private static Task<int> DropOrder2FailureConstraint(SalesDbContext db,string stage)=>stage switch{
        "order"=>db.Database.ExecuteSqlRawAsync("ALTER TABLE [sales].[Orders] DROP CONSTRAINT [CK_Order2_QA_Order]"),
        "agreement"=>db.Database.ExecuteSqlRawAsync("ALTER TABLE [sales].[SourcingPriceAgreements] DROP CONSTRAINT [CK_Order2_QA_Agreement]"),
        "cart"=>db.Database.ExecuteSqlRawAsync("ALTER TABLE [sales].[Carts] DROP CONSTRAINT [CK_Order2_QA_Cart]"),
        "outbox"=>db.Database.ExecuteSqlRawAsync("ALTER TABLE [sales].[OrderOutbox] DROP CONSTRAINT [CK_Order2_QA_Outbox]"),
        _=>throw new ArgumentOutOfRangeException(nameof(stage))
    };
    [Fact]public async Task ConcurrentCancellationReleasesOnlyOrderReservationAndNeverRevivesAgreementOrAllocation()
    {
        await using var policy=await Order2Policies();var data=await Quote4Cart();var s=data.Scenario;using var customer=s.Customer;var quote=await Order2Quote(s,data.Cart);var input=Order2Input(Text(quote,"quoteId"));var created=await Body(await customer.PostAsJsonAsync("/api/orders/v2",input),HttpStatusCode.Created);var order=created["order"]!;var id=Text(order["summary"]!,"id");var cancel=new CancelOrderInput(Text(order["summary"]!,"version"));
        var responses=await Task.WhenAll(customer.PostAsJsonAsync("/api/orders/v2/"+id+"/cancel",cancel),customer.PostAsJsonAsync("/api/orders/v2/"+id+"/cancel",cancel));foreach(var response in responses)Assert.Equal("Cancelled",Text((await Body(response))["summary"]!,"state"));
        await Order2Body(await customer.GetAsync("/api/orders/v2/"+id),kind:"order2-detail",name:"cancelled");
        await Scope(async sp=>{var sales=sp.GetRequiredService<SalesDbContext>();var inv=sp.GetRequiredService<InventoryDbContext>();var stock=await inv.Stock.SingleAsync(x=>x.VariantId==s.Variant);Assert.Equal(3,stock.OnHand);Assert.Equal(0,stock.Reserved);Assert.Equal(0,stock.SourcingReserved);Assert.Equal("Consumed",(await sales.SourcingPriceAgreements.SingleAsync(a=>a.AcceptanceId==s.Acceptance)).State);Assert.Equal("Transferred",(await inv.SourcingAllocations.SingleAsync(a=>a.AcceptanceId==s.Acceptance)).State);Assert.Equal(2,await sales.Set<SalesOrderEvent>().CountAsync(e=>e.OrderId==id));return true;});
        var replay=await Body(await customer.PostAsJsonAsync("/api/orders/v2",input));Assert.Equal("Cancelled",Text(replay["order"]!["summary"]!,"state"));Assert.Equal(Text(order["summary"]!,"expiresAt"),Text(replay["order"]!["summary"]!,"expiresAt"));
    }
    [Theory][InlineData("price")][InlineData("material")][InlineData("settings")]
    public async Task ChangedLiveQuote5ConditionsRejectOrderBeforeTransfer(string change)
    {
        await using var policy=await Order2Policies();var data=await Quote4Cart();var s=data.Scenario;using var customer=s.Customer;var quote=await Order2Quote(s,data.Cart);
        await Scope(async sp=>{if(change=="settings"){var db=sp.GetRequiredService<SalesDbContext>();var row=await db.OrderSettings.SingleAsync();row.ReservationMinutes=59;await db.SaveChangesAsync();}else{var db=sp.GetRequiredService<CatalogDbContext>();if(change=="price")await db.Variants.Where(v=>v.Id==s.Variant).ExecuteUpdateAsync(v=>v.SetProperty(x=>x.PriceRial,124));else await db.Variants.Where(v=>v.Id==s.Variant).ExecuteUpdateAsync(v=>v.SetProperty(x=>x.WarrantyEn,"Changed material warranty"));}return true;});
        var before=await Order2Effects(s);await Body(await customer.PostAsJsonAsync("/api/orders/v2",Order2Input(Text(quote,"quoteId"))),HttpStatusCode.Conflict);Assert.Equal(before,await Order2Effects(s));
    }
    [Fact]public async Task Quote4RemainsCalculatorAndQuote5RejectsForgedOwnerMoneyOrCrossContractCommand()
    {
        await using var policy=await Order2Policies();var data=await Quote4Cart();var s=data.Scenario;using var customer=s.Customer;var command=Id();var input=new CheckoutQuoteInput(Text(data.Cart,"version"),"online",null,command);
        var calculator=await Body(await customer.PostAsJsonAsync(Quote4Route(),input));Assert.False(calculator["temporaryOrder"]!["canCreate"]!.GetValue<bool>());
        Assert.Equal("quote_contract_conflict",Text(await Body(await customer.PostAsJsonAsync(Quote5Route(),input),HttpStatusCode.Conflict),"title"));
        var before=await Order2Effects(s);await Body(await customer.PostAsJsonAsync("/api/orders/v2",Order2Input(Text(calculator,"quoteId"))),HttpStatusCode.Conflict);Assert.Equal(before,await Order2Effects(s));
        var quote=await Order2Quote(s,data.Cart);var orderInput=System.Text.Json.JsonSerializer.SerializeToNode(Order2Input(Text(quote,"quoteId")),Json)!.AsObject();orderInput["ownerId"]="forged";orderInput["payableTotalRial"]="1";await Body(await customer.PostAsJsonAsync("/api/orders/v2",orderInput),HttpStatusCode.BadRequest);Assert.Equal(before,await Order2Effects(s));
        var stranger=await Customer();using var other=stranger.Client;await Body(await other.PostAsJsonAsync("/api/orders/v2",Order2Input(Text(quote,"quoteId"))),HttpStatusCode.NotFound);
    }
    [Fact]public async Task TwoAcceptedAgreementsAndOrdinarySameSkuCreateThreeOrderLinesOneReservationItemAndTwoEvents()
    {
        await using var policy=await Order2Policies();var s=await Create(4,openingStock:false);using var customer=s.Customer;var second=await Quote4SecondAgreement(s,finishConversion:false);
        using(var inventory=await fixture.ReuseStaff("InventoryManager"))await Body(await inventory.PostAsJsonAsync($"/api/admin/inventory/{s.Variant}/adjust",new StockAdjustment(4,"Synthetic stock received after both accepted requests",Id(),null)));
        var cart=await Body(await customer.GetAsync("/api/cart/en/v2"));cart=await Body(await customer.PutAsJsonAsync("/api/cart/en/v2",new CartV2Input([new(s.Variant,1)],Text(cart,"version"))));
        foreach(var scenario in new[]{s,second}){var purchase=await Allocate(scenario);await Body(await customer.PostAsJsonAsync(Offer(scenario)+"/convert",ConvertInput(purchase)));}
        var quote=await Order2Quote(s,wireName:"three-prices-saved-en");var order=(await Order2Body(await customer.PostAsJsonAsync("/api/orders/v2",Order2Input(Text(quote,"quoteId"))),HttpStatusCode.Created,"order2-create","three-prices-created"))["order"]!;var id=Text(order["summary"]!,"id");
        Assert.Equal(3,order["lines"]!.AsArray().Count);Assert.Equal(3,order["lines"]!.AsArray().Select(l=>Text(l!,"lineId")).Distinct().Count());Assert.Equal(new[]{"123","777","9007199254740993"},order["lines"]!.AsArray().Select(l=>Text(l!,"unitPriceRial")).OrderBy(long.Parse).ToArray());Assert.Equal(4,order["summary"]!["itemCount"]!.GetValue<int>());
        await Scope(async sp=>{var sales=sp.GetRequiredService<SalesDbContext>();var inv=sp.GetRequiredService<InventoryDbContext>();var reservation=await inv.Reservations.Include(r=>r.Items).SingleAsync(r=>r.OrderId==id);Assert.Equal(4,Assert.Single(reservation.Items).Quantity);Assert.Equal(3,await sales.OrderLinesV2.CountAsync(l=>l.OrderId==id));Assert.Equal(2,await sales.OrderOutbox.CountAsync(e=>e.OrderId==id));Assert.Equal(2,await sales.SourcingPriceAgreements.CountAsync(a=>a.OwnerId==s.Owner&&a.State=="Consumed"&&a.ConsumedOrderId==id));var stock=await inv.Stock.SingleAsync(x=>x.VariantId==s.Variant);Assert.Equal(4,stock.Reserved);Assert.Equal(0,stock.SourcingReserved);return true;});
    }
    [Fact]public async Task SalesAndInventoryExpiryRaceDispatchesOrder2AndHistoricalReplayNeverRenewsItsDeadline()
    {
        await using var policy=await Order2Policies();var data=await Quote4Cart();var s=data.Scenario;using var customer=s.Customer;var command=Id();var quote=await Order2Quote(s,data.Cart,command);var input=Order2Input(Text(quote,"quoteId"));var first=(await Body(await customer.PostAsJsonAsync("/api/orders/v2",input),HttpStatusCode.Created))["order"]!;var deadline=first["summary"]!["expiresAt"]!.GetValue<DateTimeOffset>();
        await using var shifted=new SqlFactory(fixture.Sql.Connection,fixture.Sql.Password,await Keys(),new FixedClock(deadline));using var late=CopyClient(shifted,customer);
        var sales=shifted.Services.GetRequiredService<OrderExpiryRunner>().RunAsync(default);
        var inventory=Task.Run(async()=>{await using var scope=shifted.Services.CreateAsyncScope();return await scope.ServiceProvider.GetRequiredService<StockReservationService>().ExpireBatchAsync(100,default);});
        var result=await sales;await inventory;Assert.Equal(0,result.Failed);
        var replay=await Order2Body(await late.PostAsJsonAsync("/api/orders/v2",input),kind:"order2-create",name:"expired-replayed");Assert.True(replay["replayed"]!.GetValue<bool>());Assert.Equal("Expired",Text(replay["order"]!["summary"]!,"state"));Assert.Equal(Text(first["summary"]!,"expiresAt"),Text(replay["order"]!["summary"]!,"expiresAt"));
        await Order2Body(await late.PostAsJsonAsync(Quote5Route(),new CheckoutQuoteInput(Text(data.Cart,"version"),"online",null,command)),kind:"quote5",name:"expired-quote-replay");
        await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();var inv=sp.GetRequiredService<InventoryDbContext>();var stock=await inv.Stock.SingleAsync(x=>x.VariantId==s.Variant);Assert.Equal(0,stock.Reserved);Assert.Equal(0,stock.SourcingReserved);Assert.Equal(3,stock.OnHand);Assert.Equal("Consumed",(await db.SourcingPriceAgreements.SingleAsync(a=>a.AcceptanceId==s.Acceptance)).State);Assert.Equal("Transferred",(await inv.SourcingAllocations.SingleAsync(a=>a.AcceptanceId==s.Acceptance)).State);Assert.Equal(2,await db.Set<SalesOrderEvent>().CountAsync(e=>e.OrderId==Text(first["summary"]!,"id")));return true;});
    }
    [Fact]public async Task ProductionCannotReadOrReplayDemoOrder2AfterItsCartHasBeenConsumed()
    {
        await using var policy=await Order2Policies();var data=await Quote4Cart();var s=data.Scenario;using var customer=s.Customer;var quote=await Order2Quote(s,data.Cart);var input=Order2Input(Text(quote,"quoteId"));var first=(await Body(await customer.PostAsJsonAsync("/api/orders/v2",input),HttpStatusCode.Created))["order"]!;var id=Text(first["summary"]!,"id");
        await Scope(async sp=>{var service=ActivatorUtilities.CreateInstance<OrderV2Service>(sp,false);Assert.Equal("not_found",(await Assert.ThrowsAsync<Shop.SharedKernel.BusinessException>(()=>service.ReadAsync(s.Owner,id,default))).Code);Assert.Equal("not_found",(await Assert.ThrowsAsync<Shop.SharedKernel.BusinessException>(()=>sp.GetRequiredService<SalesTransactionCoordinator>().RunAsync(()=>service.CreateAsync(s.Owner,input,default)))).Code);return true;});
    }
    [Fact]public async Task VersionedHistoryAdaptsActualLegacyOrderAndCancelWithoutRewritingItsSnapshot()
    {
        await using var policy=await Order2Policies();var data=await Quote4Cart();var s=data.Scenario;using var customer=s.Customer;
        using(var remove=new HttpRequestMessage(HttpMethod.Delete,"/api/cart/en/v2/offers/"+s.Acceptance){Content=JsonContent.Create(new CartOfferRemoveInput(Id(),Text(data.Cart,"version")))})await Body(await customer.SendAsync(remove));
        var cart=await Body(await customer.GetAsync("/api/cart/en"));var quote=await Body(await customer.PostAsJsonAsync("/api/cart/en/quote",new CheckoutQuoteInput(Text(cart,"version"),"online",null,Id())));var input=Order2Input(Text(quote,"quoteId"));var legacyOrder=(await Body(await customer.PostAsJsonAsync("/api/orders",input),HttpStatusCode.Created))["order"]!;var id=Text(legacyOrder["summary"]!,"id");
        var before=await Scope(async sp=>(await sp.GetRequiredService<SalesDbContext>().Orders.AsNoTracking().SingleAsync(o=>o.Id==id)).QuoteSnapshotJson);
        var current=await Order2Body(await customer.GetAsync("/api/orders/v2/"+id),kind:"order2-detail",name:"legacy-detail");Assert.Equal(1,current["originalSnapshotVersion"]!.GetValue<int>());var line=Assert.Single(current["lines"]!.AsArray())!;Assert.Null(line["categoryId"]);Assert.Null(line["accepted"]);Assert.Equal(Text(legacyOrder,"payableTotalRial"),Text(current,"payableTotalRial"));
        var cancelled=await Order2Body(await customer.PostAsJsonAsync("/api/orders/v2/"+id+"/cancel",new CancelOrderInput(Text(current["summary"]!,"version"))),kind:"order2-detail",name:"legacy-cancelled");Assert.Equal("Cancelled",Text(cancelled["summary"]!,"state"));Assert.Equal(1,cancelled["originalSnapshotVersion"]!.GetValue<int>());
        await Order2Body(await customer.GetAsync("/api/orders/v2"),kind:"order2-page",name:"legacy-page");
        await Body(await customer.PostAsJsonAsync("/api/orders/v2",input),HttpStatusCode.Conflict);await Scope(async sp=>{var stored=await sp.GetRequiredService<SalesDbContext>().Orders.SingleAsync(o=>o.Id==id);Assert.Null(stored.SnapshotVersion);Assert.Equal(before,stored.QuoteSnapshotJson);return true;});
    }
    [Fact]public async Task UnconfiguredFinancialSettingsKeepOrder2UnavailableWithoutInventingAnyPolicy()
    {
        var data=await Quote4Cart();var s=data.Scenario;using var customer=s.Customer;var quote=await Order2Quote(s,data.Cart);Assert.False(quote["temporaryOrder"]!["canCreate"]!.GetValue<bool>());Assert.Null(quote["shippingRial"]);Assert.Null(quote["taxRial"]);Assert.Null(quote["payableTotalRial"]);
        var before=await Order2Effects(s);await Body(await customer.PostAsJsonAsync("/api/orders/v2",Order2Input(Text(quote,"quoteId"))),HttpStatusCode.Conflict);Assert.Equal(before,await Order2Effects(s));
        await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();Assert.False(await db.OrderSettings.AnyAsync());Assert.False(await db.ChargePolicies.AnyAsync());return true;});
    }
    [Fact]public async Task ExactQuote5DeadlineRejectsOrderBeforeAnyStockOrAgreementTransfer()
    {
        await using var policy=await Order2Policies();var data=await Quote4Cart();var s=data.Scenario;using var customer=s.Customer;var quote=await Order2Quote(s,data.Cart);var before=await Order2Effects(s);var deadline=quote["expiresAt"]!.GetValue<DateTimeOffset>();
        await using var shifted=new SqlFactory(fixture.Sql.Connection,fixture.Sql.Password,await Keys(),new FixedClock(deadline));using var late=CopyClient(shifted,customer);
        Assert.Equal("quote_expired_conflict",Text(await Body(await late.PostAsJsonAsync("/api/orders/v2",Order2Input(Text(quote,"quoteId"))),HttpStatusCode.Conflict),"title"));Assert.Equal(before,await Order2Effects(s));
    }
}
