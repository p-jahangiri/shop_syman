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

// Cart2/convert HTTP composition in MarketFixture's generated SQL database.
// No owner credential, provider, checkout policy or Order2 transition is used.
public sealed partial class SourcingConversionHttpSqlTests(MarketFixture fixture):IClassFixture<MarketFixture>
{
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web);
    private static string Id()=>Guid.NewGuid().ToString("N");
    private static string Text(JsonNode node,string name)=>node[name]!.GetValue<string>();
    private sealed class FixedClock(DateTimeOffset instant):TimeProvider{public override DateTimeOffset GetUtcNow()=>instant;}
    internal sealed record Scenario(HttpClient Customer,string Owner,string Request,string Task,string Offer,string Line,string Variant,string Acceptance,DateTimeOffset PurchaseUntil);
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
    private async Task<Scenario> Create(int onHand=2,bool openingStock=true,Func<IServiceProvider,string,Task>? configureBeforeOffer=null)
    {
        var key=Id();var model=new CatalogModelInput("phones","samsung","allocation-"+key,[new("fa","گوشی تخصیص مصنوعی "+key,"فقط SQL آزمایشی"),new("en","Synthetic allocation phone "+key,"SQL QA only")],[new("battery",TextFa:"باتری نمونه",TextEn:"Synthetic battery")],["/products/phone-green.svg"],null);
        var listing=Text(await Body(await fixture.Writer.PostAsJsonAsync("/api/admin/market/models",new CreateMarketModelInput(model,new("Published","qa-allocation",key,"منبع مصنوعی","Synthetic source",null,"unknown",null,null,null,true)))),"id");
        var person=await Customer();var cart=await Body(await person.Client.GetAsync("/api/cart/en/sourcing"));cart=await Body(await person.Client.PutAsJsonAsync("/api/cart/en/sourcing",new CartSourcingInput([new(listing,2)],cart["version"]?.GetValue<string>())));var candidate=cart["lines"]![0]!["candidate"]!;var productId=Text(candidate["model"]!,"id");var submitted=await Body(await person.Client.PostAsJsonAsync("/api/cart/en/sourcing/submit",new SourcingSubmitInput(Id(),Text(cart,"version"),[new(listing,Text(candidate,"fingerprint"))])),HttpStatusCode.Created);var request=Text(submitted,"id");var variant=Id();
        await Scope(async sp=>{var db=sp.GetRequiredService<CatalogDbContext>();var product=await db.Products.Include(p=>p.PurchaseMethods).SingleAsync(p=>p.Id==productId);product.Status="Published";product.PurchaseMethods.Add(new(){ProductId=productId,MethodId="online"});db.Variants.Add(new(){Id=variant,ProductId=productId,Sku="QA-ALLOCATION-"+key,PriceRial=123,IsActive=true,LabelFa="SKU واقعی نمونه",LabelEn="Actual synthetic SKU",WarrantyFa="گارانتی مصنوعی",WarrantyEn="Synthetic warranty"});await db.SaveChangesAsync();return true;});
        if(configureBeforeOffer is not null)await Scope(async sp=>{await configureBeforeOffer(sp,variant);return true;});
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
    private static async Task<JsonNode> Delete(HttpClient client,string agreement,object input)
    {
        using var request=new HttpRequestMessage(HttpMethod.Delete,"/api/cart/en/v2/offers/"+agreement){Content=JsonContent.Create(input)};
        return await Body(await client.SendAsync(request));
    }

    [Fact]public async Task PurchaseCandidateIsOwnedExplicitlyNullBeforeAllocationAndNeverPayable()
    {
        var s=await Create(3);using var customer=s.Customer;
        var c=await Body(await customer.GetAsync(Offer(s)+"/purchase"),capture:"candidate-before-allocation");
        Assert.Null(c["agreement"]);Assert.Null(c["allocation"]);Assert.Null(c["conversion"]);
        Assert.True(c.AsObject().ContainsKey("agreement"));Assert.True(c.AsObject().ContainsKey("conversion"));
        Assert.False(c["canConvert"]!.GetValue<bool>());Assert.False(c["canCheckout"]!.GetValue<bool>());Assert.False(c["canPay"]!.GetValue<bool>());
        Assert.Contains("allocation_required",c["blockers"]!.AsArray().Select(x=>x!.GetValue<string>()));
        var person=await Customer();using var stranger=person.Client;
        await Body(await stranger.GetAsync(Offer(s)+"/purchase"),HttpStatusCode.NotFound);
        using var anon=fixture.Sql.Factory.CreateClient(new(){HandleCookies=false});
        await Body(await anon.GetAsync(Offer(s)+"/purchase"),HttpStatusCode.Unauthorized);
        using var sales=await fixture.ReuseStaff("SalesManager");
        await Body(await sales.GetAsync(Offer(s)+"/purchase"),HttpStatusCode.NotFound);
        await Allocate(s);c=await Body(await customer.GetAsync(Offer(s)+"/purchase"),capture:"candidate-allocated");
        Assert.True(c["canConvert"]!.GetValue<bool>());Assert.Equal("9007199254740993",Text(c["agreement"]!["lines"]![0]!,"unitPriceRial"));
        var raw=c.ToJsonString();foreach(var privateName in new[]{"ownerId","actorId","unitIds","serial","imei1","protectedNote"})Assert.DoesNotContain("\""+privateName+"\":",raw,StringComparison.OrdinalIgnoreCase);
    }

    [Fact]public async Task ConvertPreservesAllThreeLanesBlocksEveryCart1ShortcutAndReplayDoesNotResurrectRemovedLines()
    {
        var s=await Create(3);using var customer=s.Customer;
        var cart=await Body(await customer.GetAsync("/api/cart/en/v2"));
        cart=await Body(await customer.PutAsJsonAsync("/api/cart/en/v2",new CartV2Input([new(s.Variant,1)],cart["version"]?.GetValue<string>())));
        var inquiryKey=Id();var inquiryModel=new CatalogModelInput("phones","samsung","cart2-inquiry-"+inquiryKey,[new("fa","مدل جدا برای استعلام "+inquiryKey,"فقط داده آزمون"),new("en","Separate inquiry model "+inquiryKey,"QA data only")],[new("battery",TextFa:"باتری نمونه",TextEn:"Synthetic battery")],["/products/phone-green.svg"],null);
        var listing=Text(await Body(await fixture.Writer.PostAsJsonAsync("/api/admin/market/models",new CreateMarketModelInput(inquiryModel,new("Published","qa-cart2-inquiry",inquiryKey,"منبع مصنوعی","Synthetic source",null,"unknown",null,null,null,true)))),"id");
        await Body(await customer.PutAsJsonAsync("/api/cart/en/sourcing",new CartSourcingInput([new(listing,1)],Text(cart,"version"))));
        cart=await Body(await customer.GetAsync("/api/cart/en/v2"));var quoteInput=new CheckoutQuoteInput(Text(cart,"version"),"online",null,Id());
        var quote=await Body(await customer.PostAsJsonAsync("/api/cart/en/quote",quoteInput));
        var c=await Allocate(s);c=await Body(await customer.GetAsync(Offer(s)+"/purchase"),capture:"candidate-for-conversion");var input=ConvertInput(c);var before=await StockFingerprint(s);
        var receipt=await Body(await customer.PostAsJsonAsync(Offer(s)+"/convert",input),capture:"conversion-mutation");
        Assert.False(receipt["replayed"]!.GetValue<bool>());Assert.Equal(before,await StockFingerprint(s));
        cart=await Body(await customer.GetAsync("/api/cart/en/v2"),capture:"cart2-en");
        Assert.Equal(2,cart["schemaVersion"]!.GetValue<int>());Assert.Single(cart["ordinaryLines"]!.AsArray());Assert.Single(cart["offerLines"]!.AsArray());Assert.Single(cart["inquiry"]!["lines"]!.AsArray());
        Assert.Equal("123",Text(cart["ordinaryLines"]![0]!,"unitPriceRial"));Assert.Equal("9007199254740993",Text(cart["offerLines"]![0]!,"unitPriceRial"));Assert.Equal("18014398509481986",Text(cart,"offerSubtotalRial"));
        Assert.NotEqual(Text(cart["ordinaryLines"]![0]!,"lineId"),Text(cart["offerLines"]![0]!,"lineId"));Assert.False(cart["canCheckout"]!.GetValue<bool>());
        await Body(await customer.GetAsync("/api/cart/fa/v2"),capture:"cart2-fa");
        Assert.Equal("cart_contract_upgrade_required",Text(await Body(await customer.GetAsync("/api/cart/en"),HttpStatusCode.Conflict),"title"));
        Assert.Equal("cart_contract_upgrade_required",Text(await Body(await customer.PutAsJsonAsync("/api/cart/en",new CartInput([new(s.Variant,1)],Text(cart,"version"))),HttpStatusCode.Conflict),"title"));
        Assert.Equal("cart_contract_upgrade_required",Text(await Body(await customer.PostAsync("/api/cart/en/merge",null),HttpStatusCode.Conflict),"title"));
        Assert.Equal("cart_contract_upgrade_required",Text(await Body(await customer.PostAsJsonAsync("/api/cart/en/quote",quoteInput),HttpStatusCode.Conflict),"title"));
        var orderInput=new CreateOrderInput(Text(quote,"quoteId"),Id(),"Synthetic customer","09121234567",new("IR","تهران","تهران","نشانی مصنوعی برای آزمون SQL","1234567890"),"QA only",true);
        Assert.Equal("cart_contract_upgrade_required",Text(await Body(await customer.PostAsJsonAsync("/api/orders",orderInput),HttpStatusCode.Conflict),"title"));
        var replay=await Body(await customer.PostAsJsonAsync(Offer(s)+"/convert",input),capture:"conversion-replay");Assert.True(replay["replayed"]!.GetValue<bool>());Assert.Equal(Text(receipt,"conversionId"),Text(replay,"conversionId"));
        await Body(await customer.GetAsync(Offer(s)+"/commands/convert/"+input.RequestId),capture:"conversion-command");
        var agreementId=Text(receipt,"agreementId");var remove=new CartOfferRemoveInput(Id(),Text(cart,"version"));var removed=await Delete(customer,agreementId,remove);Assert.False(removed["replayed"]!.GetValue<bool>());
        await Body(await customer.GetAsync($"/api/cart/en/v2/offers/{agreementId}/commands/remove/{remove.RequestId}"),capture:"removal-command");
        replay=await Body(await customer.PostAsJsonAsync(Offer(s)+"/convert",input));Assert.True(replay["replayed"]!.GetValue<bool>());
        cart=await Body(await customer.GetAsync("/api/cart/en/v2"),capture:"cart2-removed");Assert.Empty(cart["offerLines"]!.AsArray());Assert.Single(cart["ordinaryLines"]!.AsArray());Assert.Single(cart["inquiry"]!["lines"]!.AsArray());Assert.True(cart["canCheckout"]!.GetValue<bool>());
        Assert.Equal(before,await StockFingerprint(s));
        await Body(await customer.GetAsync("/api/cart/en")); // Contract1 becomes usable again only after explicit removal.
        var again=await Body(await customer.GetAsync(Offer(s)+"/purchase"));Assert.False(again["canConvert"]!.GetValue<bool>());Assert.NotNull(again["conversion"]);
    }

    [Fact]public async Task ConversionRejectsUnknownMembersStaleVersionsForeignOwnerAndConflictingCommandBody()
    {
        var s=await Create();using var customer=s.Customer;var c=await Allocate(s);var input=ConvertInput(c);
        var injected=JsonSerializer.SerializeToNode(input,Json)!.AsObject();injected["unitPriceRial"]="1";
        await Body(await customer.PostAsJsonAsync(Offer(s)+"/convert",injected),HttpStatusCode.BadRequest);
        await Body(await customer.PostAsJsonAsync(Offer(s)+"/convert",input with{CartVersion=Convert.ToBase64String(new byte[8])}),HttpStatusCode.Conflict);
        var strangerPerson=await Customer();using var stranger=strangerPerson.Client;
        await Body(await stranger.PostAsJsonAsync(Offer(s)+"/convert",input),HttpStatusCode.NotFound);
        await Body(await customer.PostAsJsonAsync(Offer(s)+"/convert",input));
        await Body(await stranger.GetAsync(Offer(s)+"/commands/convert/"+input.RequestId),HttpStatusCode.NotFound);
        await Body(await customer.PostAsJsonAsync(Offer(s)+"/convert",input with{AllocationId=Id()}),HttpStatusCode.Conflict);
        var fresh=ConvertInput(await Body(await customer.GetAsync(Offer(s)+"/purchase")));
        await Body(await customer.PostAsJsonAsync(Offer(s)+"/convert",fresh),HttpStatusCode.Conflict);
        await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();Assert.Equal(1,await db.SourcingConversions.CountAsync(x=>x.AcceptanceId==s.Acceptance));Assert.Equal(1,await db.CartOfferLines.CountAsync(x=>x.AcceptanceId==s.Acceptance));return true;});
    }

    [Fact]public async Task MarketEventFailureRollsBackCartConversionCommandAndVersionsThenSameCommandRetries()
    {
        var s=await Create();using var customer=s.Customer;var input=ConvertInput(await Allocate(s));var before=await ReadFacts(s);var stock=await StockFingerprint(s);
        var cart=await Body(await customer.GetAsync("/api/cart/en/v2"));var constraint="CK_Cart2Event_"+Id();Assert.Matches("^CK_Cart2Event_[a-f0-9]{32}$",constraint);Assert.Matches("^[a-f0-9]{32}$",s.Task);
        var add="ALTER TABLE [market].[SourcingSupplyEvents] WITH NOCHECK ADD CONSTRAINT ["+constraint+"] CHECK ([TaskId]<>N'"+s.Task+"' OR [ReasonCode]<>N'cart_converted')";
        var drop="ALTER TABLE [market].[SourcingSupplyEvents] DROP CONSTRAINT ["+constraint+"]";
        await Scope(async sp=>{await sp.GetRequiredService<MarketDbContext>().Database.ExecuteSqlRawAsync(add);return true;});
        try{await Body(await customer.PostAsJsonAsync(Offer(s)+"/convert",input),HttpStatusCode.Conflict);}
        finally{await Scope(async sp=>{await sp.GetRequiredService<MarketDbContext>().Database.ExecuteSqlRawAsync(drop);return true;});}
        Assert.Equal(before,await ReadFacts(s));Assert.Equal(stock,await StockFingerprint(s));
        Assert.Equal(cart.ToJsonString(),(await Body(await customer.GetAsync("/api/cart/en/v2"))).ToJsonString());
        await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();Assert.False(await db.SourcingConversions.AnyAsync(x=>x.AcceptanceId==s.Acceptance));Assert.False(await db.CartOfferCommandReceipts.AnyAsync(x=>x.CommandId==input.RequestId));return true;});
        await Body(await customer.GetAsync(Offer(s)+"/commands/convert/"+input.RequestId),HttpStatusCode.NotFound);
        await Body(await customer.PostAsJsonAsync(Offer(s)+"/convert",input));Assert.Equal(stock,await StockFingerprint(s));
    }
}
