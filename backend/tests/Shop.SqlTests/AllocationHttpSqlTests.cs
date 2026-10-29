using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.DataProtection.KeyManagement;
using Microsoft.AspNetCore.DataProtection.Repositories;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Identity;
using Shop.Modules.Inventory;
using Shop.Modules.Market;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;

// Actual HTTP composition and real SQL in MarketFixture's generated database.
// No owner credential, provider, checkout policy or Order2 transition is used.
public sealed class AllocationHttpSqlTests(MarketFixture fixture):IClassFixture<MarketFixture>
{
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
            if(capture is not null&&Environment.GetEnvironmentVariable("SHOP_ALLOCATION_WIRE_DIR") is {Length:>0} directory){Directory.CreateDirectory(directory);await File.WriteAllTextAsync(Path.Combine(directory,capture+".json"),raw);}
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
    private async Task<Scenario> Create(int onHand=2)
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
        using(var inventory=await fixture.ReuseStaff("InventoryManager"))await Body(await inventory.PostAsJsonAsync($"/api/admin/inventory/{variant}/adjust",new StockAdjustment(onHand,"Synthetic QA physical opening stock",Id(),null)));
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

    [Fact]public async Task AllocationAtomicallyPreservesAcceptedPriceAndPrivateSupply2WhileReplayUsesStaleVersions()
    {
        var s=await Create();using var customer=s.Customer;using var inventory=await fixture.ReuseStaff("InventoryManager");using var sales=await fixture.ReuseStaff("SalesManager");var before=await ReadFacts(s);Assert.Equal(2,before.PublicAvailable);var input=await Input(s,inventory,"allocation-candidate");var id=Id();var route=WriteRoute(s,id);
        var saved=await Body(await inventory.PutAsJsonAsync(route,input),capture:"allocate");var after=await ReadFacts(s);Assert.Equal(2,after.OnHand);Assert.Equal(0,after.Reserved);Assert.Equal(2,after.Sourcing);Assert.Equal(0,after.PublicAvailable);Assert.Equal(1,after.Allocations);Assert.Equal(1,after.Commands);Assert.Equal(1,after.Agreements);Assert.Equal(1,after.AllocationEvents);Assert.Equal(1,after.MarketAllocationEvents);Assert.Equal(before.Orders,after.Orders);Assert.Equal(before.Reservations,after.Reservations);Assert.Equal(0,after.Settings);Assert.NotEqual(before.RequestVersion,after.RequestVersion);Assert.NotEqual(before.TaskVersion,after.TaskVersion);
        var replay=await Body(await inventory.PutAsJsonAsync(route,input),capture:"allocate-replay");Assert.True(replay["replayed"]!.GetValue<bool>());Assert.Equal(Text(saved,"allocationId"),Text(replay,"allocationId"));Assert.Equal(after,await ReadFacts(s));var conflict=await Body(await inventory.PutAsJsonAsync(route,input with{Reason="Changed same UUID payload"}),HttpStatusCode.Conflict);Assert.Equal("idempotency_conflict",Text(conflict,"title"));
        var agreement=await Body(await customer.GetAsync(AgreementRoute(s)),capture:"customer-agreement");Assert.Equal("9007199254740993",Text(agreement["lines"]![0]!,"unitPriceRial"));Assert.Equal("18014398509481986",Text(agreement["lines"]![0]!,"lineTotalRial"));Assert.False(agreement["canPay"]!.GetValue<bool>());await Body(await sales.GetAsync(AgreementRoute(s,true)),capture:"admin-agreement");
        var detail=await Body(await inventory.GetAsync(AllocationRoute(id)),capture:"allocation-detail");Assert.Equal(id,Text(detail,"id"));Assert.DoesNotContain("unitPriceRial",detail.ToJsonString());await Body(await inventory.GetAsync(AllocationRoute(id)+"/events"),capture:"allocation-events");await Body(await inventory.GetAsync(AllocationRoute(id)+"/commands/allocate/"+input.RequestId),capture:"allocation-command");
        var owner=await Body(await customer.GetAsync(SupplyRoute(s)),capture:"supply2-customer-detail");Assert.Equal(2,owner["schemaVersion"]!.GetValue<int>());Assert.True(owner["reservedForRequest"]!.GetValue<bool>());Assert.False(owner["canCheckout"]!.GetValue<bool>());Assert.False(owner["canPay"]!.GetValue<bool>());NoPrivateStockProjection(owner);await Body(await customer.GetAsync($"/api/sourcing/requests/{s.Request}/supply/v2"),capture:"supply2-customer-page");
        var warehouse=await Body(await inventory.GetAsync("/api/admin/inventory/sourcing-tasks/v2/"+s.Task),capture:"supply2-inventory-detail");NoPrivateStockProjection(warehouse["task"]!);Assert.True(warehouse["task"]!["reservedForRequest"]!.GetValue<bool>());await Body(await inventory.GetAsync("/api/admin/inventory/sourcing-tasks/v2?query="+s.Task),capture:"supply2-inventory-page");await Body(await sales.GetAsync(SupplyRoute(s,true)),capture:"supply2-admin-detail");await Body(await sales.GetAsync($"/api/admin/sourcing/requests/{s.Request}/supply/v2"),capture:"supply2-admin-page");
        Assert.Equal("sourcing_supply_contract_upgrade_required",Text(await Body(await customer.GetAsync(SupplyRoute(s,false,false)),HttpStatusCode.Conflict),"title"));Assert.Equal("sourcing_supply_contract_upgrade_required",Text(await Body(await inventory.GetAsync("/api/admin/inventory/sourcing-tasks/"+s.Task),HttpStatusCode.Conflict),"title"));
        var stock=await Body(await inventory.GetAsync("/api/admin/inventory/v2/variants/"+s.Variant),capture:"stock-v2");Assert.Equal(0,stock["available"]!.GetValue<int>());Assert.Equal(0,stock["reserved"]!.GetValue<int>());Assert.Equal(2,stock["sourcingReserved"]!.GetValue<int>());Assert.Equal("inventory_contract_upgrade_required",Text(await Body(await inventory.GetAsync("/api/admin/inventory/variants/"+s.Variant),HttpStatusCode.Conflict),"title"));var sku=await Scope(sp=>sp.GetRequiredService<CatalogDbContext>().Variants.Where(v=>v.Id==s.Variant).Select(v=>v.Sku).SingleAsync());await Body(await inventory.GetAsync("/api/admin/inventory/v2/variants?query="+Uri.EscapeDataString(sku)),capture:"stock-v2-page");
    }

    [Fact]public async Task InsufficientActualStockRollsBackSalesAuthorityMarketVersionsAndEveryAllocationEffect()
    {
        var s=await Create(1);using var customer=s.Customer;using var inventory=await fixture.ReuseStaff("InventoryManager");var input=await Input(s,inventory);var id=Id();var route=WriteRoute(s,id);var before=await ReadFacts(s);var audits=await Scope(sp=>sp.GetRequiredService<IdentityDbContext>().Audit.CountAsync(a=>a.Resource==route));var failed=await Body(await inventory.PutAsJsonAsync(route,input),HttpStatusCode.BadRequest);Assert.Equal("insufficient_stock",Text(failed,"title"));Assert.Equal(before,await ReadFacts(s));Assert.Equal(audits,await Scope(sp=>sp.GetRequiredService<IdentityDbContext>().Audit.CountAsync(a=>a.Resource==route)));await Body(await customer.GetAsync(AgreementRoute(s)),HttpStatusCode.NotFound);
    }

    [Fact]public async Task AuditFailureRollsBackAlreadyWrittenAgreementStockAndMarketThenTheExactCommandRetries()
    {
        var s=await Create();using var customer=s.Customer;using var inventory=await fixture.ReuseStaff("InventoryManager");var input=await Input(s,inventory);var id=Id();var route=WriteRoute(s,id);var before=await ReadFacts(s);var constraint="CK_AllocationAudit_"+Id();
        // SQL identifiers and CHECK literals cannot be command parameters.
        // Both fragments belong to this GUID fixture and are validated before DDL.
        Assert.Matches("^CK_AllocationAudit_[a-f0-9]{32}$",constraint);
        Assert.Matches("^/api/admin/inventory/sourcing-requests/[a-f0-9]{32}/tasks/[a-f0-9]{32}/allocations/[a-f0-9]{32}$",route);
        var add="ALTER TABLE [identity].[Audit] WITH NOCHECK ADD CONSTRAINT ["+constraint+"] CHECK ([Resource]<>N'"+route+"')";
        var drop="ALTER TABLE [identity].[Audit] DROP CONSTRAINT ["+constraint+"]";
        await Scope(async sp=>{await sp.GetRequiredService<IdentityDbContext>().Database.ExecuteSqlRawAsync(add);return true;});
        try{await Body(await inventory.PutAsJsonAsync(route,input),HttpStatusCode.Conflict);}finally{await Scope(async sp=>{await sp.GetRequiredService<IdentityDbContext>().Database.ExecuteSqlRawAsync(drop);return true;});}
        Assert.Equal(before,await ReadFacts(s));await Body(await inventory.PutAsJsonAsync(route,input));Assert.Equal(2,(await ReadFacts(s)).Sourcing);
    }

    [Fact]public async Task InventorySalesFinanceAndCustomerOwnershipCannotCrossAllocationOrPricePolicies()
    {
        var s=await Create();using var customer=s.Customer;using var inventory=await fixture.ReuseStaff("InventoryManager");using var sales=await fixture.ReuseStaff("SalesManager");using var finance=await fixture.ReuseStaff("FinanceManager");var other=await Customer();using var stranger=other.Client;var input=await Input(s,inventory);var id=Id();
        foreach(var actor in new[]{sales,finance,customer})await Body(await actor.PutAsJsonAsync(WriteRoute(s,id),input),HttpStatusCode.Forbidden);await Body(await inventory.PutAsJsonAsync(WriteRoute(s,id),input));
        await Body(await inventory.GetAsync(AgreementRoute(s,true)),HttpStatusCode.Forbidden);await Body(await sales.GetAsync(AllocationRoute(id)),HttpStatusCode.Forbidden);await Body(await sales.GetAsync("/api/admin/inventory/sourcing-tasks/"+s.Task+"/allocation"),HttpStatusCode.Forbidden);await Body(await customer.GetAsync(AllocationRoute(id)),HttpStatusCode.Forbidden);await Body(await stranger.GetAsync(AgreementRoute(s)),HttpStatusCode.NotFound);await Body(await stranger.GetAsync(SupplyRoute(s)),HttpStatusCode.NotFound);
        using var anonymous=fixture.Sql.Factory.CreateClient(new(){HandleCookies=false});await Body(await anonymous.GetAsync(AllocationRoute(id)),HttpStatusCode.Unauthorized);await Body(await anonymous.GetAsync(AgreementRoute(s)),HttpStatusCode.Unauthorized);var admin=await Body(await sales.GetAsync(AgreementRoute(s,true)));Assert.Equal("9007199254740993",Text(admin["lines"]![0]!,"unitPriceRial"));NoPrivateStockProjection(await Body(await customer.GetAsync(SupplyRoute(s))));
    }

    [Fact]public async Task WrongReleaseRouteIsRejectedWithoutEffectsBeforeTheCorrectCommandRetries()
    {
        var s=await Create();using var customer=s.Customer;using var inventory=await fixture.ReuseStaff("InventoryManager");var input=await Input(s,inventory);var id=Id();var first=await Body(await inventory.PutAsJsonAsync(WriteRoute(s,id),input));var release=new SourcingAllocationReleaseInput(Id(),s.Acceptance,Text(first,"version"),"Explicit synthetic release");var before=await ReadFacts(s);var wrong=s with{Request=Id(),Task=Id()};await Body(await inventory.PostAsJsonAsync(WriteRoute(wrong,id)+"/release",release),HttpStatusCode.NotFound);Assert.Equal(before,await ReadFacts(s));
        var done=await Body(await inventory.PostAsJsonAsync(WriteRoute(s,id)+"/release",release),capture:"release");Assert.Equal("Released",Text(done,"state"));Assert.Equal(0,(await ReadFacts(s)).Sourcing);Assert.Equal(2,(await ReadFacts(s)).PublicAvailable);var replay=await Body(await inventory.PostAsJsonAsync(WriteRoute(s,id)+"/release",release));Assert.True(replay["replayed"]!.GetValue<bool>());Assert.Equal(2,(await ReadFacts(s)).Commands);await Body(await inventory.GetAsync(AllocationRoute(id)+"/commands/release/"+release.RequestId),capture:"release-command");var oldStock=await Body(await inventory.GetAsync("/api/admin/inventory/variants/"+s.Variant));Assert.Equal(2,oldStock["available"]!.GetValue<int>());Assert.False(oldStock.AsObject().ContainsKey("sourcingReserved"));
    }

    [Fact]public async Task ConsumedSalesAuthorityRejectsExplicitReleaseWhileInventoryIsStillActive()
    {
        var s=await Create();using var customer=s.Customer;using var inventory=await fixture.ReuseStaff("InventoryManager");var input=await Input(s,inventory);var id=Id();var allocated=await Body(await inventory.PutAsJsonAsync(WriteRoute(s,id),input));
        // Inject only the future Sales consumption marker into this GUID QA.
        // No actual Order2, reservation transfer or order creation is claimed.
        await Scope(async sp=>{var sales=sp.GetRequiredService<SalesDbContext>();var row=await sales.SourcingPriceAgreements.SingleAsync(a=>a.AcceptanceId==s.Acceptance);row.State="Consumed";row.ConsumedOrderId=Id();await sales.SaveChangesAsync();return true;});var before=await ReadFacts(s);var agreement=await Body(await customer.GetAsync(AgreementRoute(s)));
        var release=new SourcingAllocationReleaseInput(Id(),s.Acceptance,Text(allocated,"version"),"Must not release a Sales-consumed share");var failed=await Body(await inventory.PostAsJsonAsync(WriteRoute(s,id)+"/release",release),HttpStatusCode.Conflict);Assert.Equal("sourcing_agreement_consumed_conflict",Text(failed,"title"));Assert.Equal(before,await ReadFacts(s));Assert.Equal(agreement.ToJsonString(),(await Body(await customer.GetAsync(AgreementRoute(s)))).ToJsonString());Assert.Equal("Active",Text(await Body(await inventory.GetAsync(AllocationRoute(id))),"state"));
    }

    [Fact]public async Task HistoricalReleaseReplaysAfterLaterSalesConsumptionButANewCommandIsFenced()
    {
        var s=await Create();using var customer=s.Customer;using var inventory=await fixture.ReuseStaff("InventoryManager");var input=await Input(s,inventory);var id=Id();var allocated=await Body(await inventory.PutAsJsonAsync(WriteRoute(s,id),input));var release=new SourcingAllocationReleaseInput(Id(),s.Acceptance,Text(allocated,"version"),"Historical explicit release");var route=WriteRoute(s,id)+"/release";var released=await Body(await inventory.PostAsJsonAsync(route,release));Assert.False(released["replayed"]!.GetValue<bool>());
        // Synthetic stored future Order2 marker, not a real order transition.
        await Scope(async sp=>{var sales=sp.GetRequiredService<SalesDbContext>();var row=await sales.SourcingPriceAgreements.SingleAsync(a=>a.AcceptanceId==s.Acceptance);row.State="Consumed";row.ConsumedOrderId=Id();await sales.SaveChangesAsync();return true;});var before=await ReadFacts(s);var agreement=await Body(await customer.GetAsync(AgreementRoute(s)));
        var replay=await Body(await inventory.PostAsJsonAsync(route,release));Assert.True(replay["replayed"]!.GetValue<bool>());Assert.Equal(Text(released,"commandId"),Text(replay,"commandId"));Assert.Equal(Text(released,"version"),Text(replay,"version"));Assert.Equal(before,await ReadFacts(s));
        var failed=await Body(await inventory.PostAsJsonAsync(route,release with{RequestId=Id()}),HttpStatusCode.Conflict);Assert.Equal("sourcing_agreement_consumed_conflict",Text(failed,"title"));Assert.Equal(before,await ReadFacts(s));Assert.Equal(agreement.ToJsonString(),(await Body(await customer.GetAsync(AgreementRoute(s)))).ToJsonString());
    }

    [Fact]public async Task ParentCloseAfterPurchaseDeadlineReleasesTheDueShareAndRevokesPriceWithoutChangingStock()
    {
        var s=await Create();using var customer=s.Customer;using var inventory=await fixture.ReuseStaff("InventoryManager");var input=await Input(s,inventory);var id=Id();await Body(await inventory.PutAsJsonAsync(WriteRoute(s,id),input));
        await using var shifted=new SqlFactory(fixture.Sql.Connection,fixture.Sql.Password,await Keys(),new FixedClock(s.PurchaseUntil));using var late=CopyClient(shifted,customer);using var lateInventory=CopyClient(shifted,inventory);var replay=await Body(await lateInventory.PutAsJsonAsync(WriteRoute(s,id),input));Assert.True(replay["replayed"]!.GetValue<bool>());var parent=await Body(await late.GetAsync($"/api/sourcing/requests/{s.Request}"));Assert.Equal(2,(await ReadFacts(s)).Sourcing);await Body(await late.PostAsJsonAsync($"/api/sourcing/requests/{s.Request}/cancel",new SourcingActionInput(Id(),Text(parent["summary"]!,"version"))));
        var after=await ReadFacts(s);Assert.Equal(2,after.OnHand);Assert.Equal(0,after.Reserved);Assert.Equal(0,after.Sourcing);Assert.Equal(2,after.PublicAvailable);var allocation=await Body(await inventory.GetAsync(AllocationRoute(id)));Assert.Equal("Expired",Text(allocation,"state"));Assert.Equal("Revoked",Text(await Body(await customer.GetAsync(AgreementRoute(s))),"state"));await Scope(async sp=>{Assert.Equal("Cancelled",(await sp.GetRequiredService<MarketDbContext>().SourcingRequests.SingleAsync(r=>r.Id==s.Request)).State);return true;});
    }

    [Fact]public async Task ConsumedSalesAuthorityStillFencesParentCloseAfterOfferExpiryAndInactivePointer()
    {
        var s=await Create();using var customer=s.Customer;using var inventory=await fixture.ReuseStaff("InventoryManager");var input=await Input(s,inventory);var id=Id();await Body(await inventory.PutAsJsonAsync(WriteRoute(s,id),input));
        // Stored future Order2 marker only; no order/payment creation is claimed.
        await Scope(async sp=>{var sales=sp.GetRequiredService<SalesDbContext>();var agreement=await sales.SourcingPriceAgreements.SingleAsync(a=>a.AcceptanceId==s.Acceptance);agreement.State="Consumed";agreement.ConsumedOrderId=Id();await sales.SaveChangesAsync();var market=sp.GetRequiredService<MarketDbContext>();(await market.SourcingOffers.SingleAsync(o=>o.Id==s.Offer)).IsActive=false;await market.SaveChangesAsync();return true;});var before=await ReadFacts(s);
        await using var shifted=new SqlFactory(fixture.Sql.Connection,fixture.Sql.Password,await Keys(),new FixedClock(s.PurchaseUntil));using var late=CopyClient(shifted,customer);var parent=await Body(await late.GetAsync($"/api/sourcing/requests/{s.Request}"));var result=await Body(await late.PostAsJsonAsync($"/api/sourcing/requests/{s.Request}/cancel",new SourcingActionInput(Id(),Text(parent["summary"]!,"version"))),HttpStatusCode.Conflict);Assert.Equal("sourcing_agreement_consumed_conflict",Text(result,"title"));Assert.Equal(before,await ReadFacts(s));Assert.Equal("Consumed",Text(await Body(await customer.GetAsync(AgreementRoute(s))),"state"));
    }

    [Fact]public async Task OnlyTheCanonicalAllocationRouteAcceptsExactly64KiBWhileMixedCaseKeeps16KiB()
    {
        var s=await Create();using var customer=s.Customer;using var inventory=await fixture.ReuseStaff("InventoryManager");var input=await Input(s,inventory);var route=WriteRoute(s,Id());var raw=JsonSerializer.Serialize(input,Json);var padding=65536-Encoding.UTF8.GetByteCount(raw);Assert.True(padding>0);var padded=raw+new string(' ',padding);Assert.Equal(65536,Encoding.UTF8.GetByteCount(padded));var before=await ReadFacts(s);
        using(var mixed=new StringContent(padded,Encoding.UTF8,"application/json"))await Body(await inventory.PutAsync(route.Replace("/api/admin/inventory/","/API/Admin/Inventory/",StringComparison.Ordinal),mixed),HttpStatusCode.RequestEntityTooLarge);
        using(var oversized=new StringContent(padded+" ",Encoding.UTF8,"application/json"))await Body(await inventory.PutAsync(route,oversized),HttpStatusCode.RequestEntityTooLarge);Assert.Equal(before,await ReadFacts(s));
        using(var canonical=new StringContent(padded,Encoding.UTF8,"application/json"))await Body(await inventory.PutAsync(route,canonical));Assert.Equal(2,(await ReadFacts(s)).Sourcing);
    }
}
