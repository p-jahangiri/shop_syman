using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Inventory;
using Shop.Modules.Market;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;

// These exercise the actual authenticated route and root transaction against
// the fixture's generated SQL database, including the existing supply flow.
public sealed partial class SourcingConversionHttpSqlTests
{
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
    private static CheckoutQuoteInput Quote4Input(JsonNode cart,string? method="online",string? command=null)=>new(Text(cart,"version"),method,null,command??Id());
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
    private async Task<JsonNode> Quote4(Scenario s,CheckoutQuoteInput input,string locale="en",string? capture=null,HttpClient? client=null)
    {
        using var response=await (client??s.Customer).PostAsJsonAsync(Quote4Route(locale),input);
        var raw=await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode==HttpStatusCode.OK,$"Quote4 HTTP {(int)response.StatusCode}: {raw}");
        Assert.Contains("no-store",response.Headers.CacheControl!.ToString());
        if(capture is not null&&Environment.GetEnvironmentVariable("SHOP_QUOTE4_WIRE_DIR") is {Length:>0} directory){Directory.CreateDirectory(directory);await File.WriteAllTextAsync(Path.Combine(directory,capture+".json"),raw);}
        return JsonNode.Parse(raw)!;
    }
    private static void FencedQuote4(JsonNode q)
    {
        Assert.Equal(4,q["schemaVersion"]!.GetValue<int>());Assert.False(q["canPay"]!.GetValue<bool>());Assert.False(q["canPlaceOrder"]!.GetValue<bool>());
        Assert.False(q["temporaryOrder"]!["canCreate"]!.GetValue<bool>());
        Assert.Contains("accepted_offer_order_unavailable",q["temporaryOrder"]!["blockers"]!.AsArray().Select(n=>n!.GetValue<string>()));
        Assert.NotNull(q["expiresAt"]);
    }
    [Fact]public async Task Quote4MixedActualCartPreservesIndependentPricesAndExcludesInquiryWithoutFinancialEffects()
    {
        var(s,cart)=await Quote4Cart(inquiry:true);using var customer=s.Customer;var before=await StockFingerprint(s);
        var preview=await Quote4(s,Quote4Input(cart,method:null),capture:"quote4-mixed-preview-en");FencedQuote4(preview);Assert.Null(preview["quoteId"]);
        var q=await Quote4(s,Quote4Input(cart),capture:"quote4-mixed-saved-en");FencedQuote4(q);
        Assert.Equal("18014398509482109",Text(q,"itemsSubtotalRial"));Assert.Equal(2,q["lines"]!.AsArray().Count);
        var ordinary=q["lines"]!.AsArray().Single(l=>Text(l!,"lineKind")=="ordinary")!;var accepted=q["lines"]!.AsArray().Single(l=>Text(l!,"lineKind")=="acceptedOffer")!;
        Assert.Equal(s.Variant,Text(ordinary,"variantId"));Assert.Equal(s.Variant,Text(accepted,"variantId"));Assert.NotEqual(Text(ordinary,"lineId"),Text(accepted,"lineId"));
        Assert.Equal("123",Text(ordinary,"unitPriceRial"));Assert.Equal("9007199254740993",Text(accepted,"unitPriceRial"));Assert.Equal("18014398509481986",Text(accepted,"lineTotalRial"));
        Assert.True(ordinary.AsObject().ContainsKey("accepted"));Assert.Null(ordinary["accepted"]);Assert.NotNull(ordinary["priceVersion"]);
        Assert.True(accepted.AsObject().ContainsKey("priceVersion"));Assert.Null(accepted["priceVersion"]);Assert.Equal(s.Acceptance,Text(accepted["accepted"]!,"acceptanceId"));
        Assert.Null(q["shippingRial"]);Assert.Null(q["taxRial"]);Assert.Null(q["payableTotalRial"]);Assert.Equal(before,await StockFingerprint(s));
        var fa=await Quote4(s,Quote4Input(cart),"fa","quote4-mixed-saved-fa");FencedQuote4(fa);Assert.Equal(Text(q,"itemsSubtotalRial"),Text(fa,"itemsSubtotalRial"));Assert.NotEqual(Text(accepted,"name"),Text(fa["lines"]!.AsArray().Single(l=>Text(l!,"lineKind")=="acceptedOffer")!,"name"));
        await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();var header=await db.Quotes.Include(q=>q.Lines).Include(q=>q.LinesV4).SingleAsync(x=>x.Id==Text(q,"quoteId"));Assert.Equal(4,header.ContractVersion);Assert.Empty(header.Lines);Assert.Equal(2,header.LinesV4.Count);Assert.Single(await db.CartSourcingLines.Where(l=>l.CartId==header.CartId).ToArrayAsync());return true;});
    }
    [Fact]public async Task Quote4AcceptedOnlyUsesItsOwnHoldAtZeroPublicAvailabilityAndReplayDoesNotRepriceOrExtend()
    {
        var(s,cart)=await Quote4Cart(2,false);using var customer=s.Customer;Assert.Equal(0,(await ReadFacts(s)).PublicAvailable);var before=await StockFingerprint(s);var input=Quote4Input(cart);
        var q=await Quote4(s,input,capture:"quote4-accepted-only");FencedQuote4(q);Assert.Single(q["lines"]!.AsArray());
        await Scope(async sp=>{await sp.GetRequiredService<CatalogDbContext>().Variants.Where(v=>v.Id==s.Variant).ExecuteUpdateAsync(x=>x.SetProperty(v=>v.PriceRial,999));return true;});
        var replay=await Quote4(s,input,capture:"quote4-replay");Assert.Equal(q.ToJsonString(),replay.ToJsonString());
        var current=await Quote4(s,input with{RequestId=Id()});Assert.Equal("9007199254740993",Text(current["lines"]![0]!,"unitPriceRial"));Assert.Equal(before,await StockFingerprint(s));
        Assert.True(q["expiresAt"]!.GetValue<DateTimeOffset>()<=q["createdAt"]!.GetValue<DateTimeOffset>().AddMinutes(5));
        Assert.True(q["expiresAt"]!.GetValue<DateTimeOffset>()<=q["lines"]![0]!["accepted"]!["allocationExpiresAt"]!.GetValue<DateTimeOffset>());
        await Body(await customer.PostAsJsonAsync(Quote4Route("fa"),input),HttpStatusCode.Conflict);
    }
    [Fact]public async Task Quote4TwoRealAgreementsAndOrdinarySameSkuKeepThreeIndependentSnapshotKeysAndAmounts()
    {
        // Both genuine sourcing requests precede physical availability. An
        // in-stock model correctly rejects a new sourcing request.
        var s=await Create(4,openingStock:false);using var customer=s.Customer;var second=await Quote4SecondAgreement(s,finishConversion:false);
        using(var inventory=await fixture.ReuseStaff("InventoryManager"))await Body(await inventory.PostAsJsonAsync($"/api/admin/inventory/{s.Variant}/adjust",new StockAdjustment(4,"Synthetic stock received after both accepted requests",Id(),null)));
        var cart=await Body(await customer.GetAsync("/api/cart/en/v2"));cart=await Body(await customer.PutAsJsonAsync("/api/cart/en/v2",new CartV2Input([new(s.Variant,1)],Text(cart,"version"))));
        foreach(var scenario in new[]{s,second}){var purchase=await Allocate(scenario);await Body(await customer.PostAsJsonAsync(Offer(scenario)+"/convert",ConvertInput(purchase)));}
        cart=await Body(await customer.GetAsync("/api/cart/en/v2"));
        var before=await StockFingerprint(s);var secondBefore=await StockFingerprint(second);var q=await Quote4(s,Quote4Input(cart),capture:"quote4-three-prices-same-sku");FencedQuote4(q);
        Assert.Equal(3,q["lines"]!.AsArray().Count);Assert.Equal(3,q["lines"]!.AsArray().Select(l=>Text(l!,"lineId")).Distinct().Count());Assert.All(q["lines"]!.AsArray(),l=>Assert.Equal(s.Variant,Text(l!,"variantId")));
        Assert.Equal(new[]{"123","777","9007199254740993"},q["lines"]!.AsArray().Select(l=>Text(l!,"unitPriceRial")).OrderBy(x=>long.Parse(x)).ToArray());
        Assert.Equal("18014398509482886",Text(q,"itemsSubtotalRial"));Assert.Equal(before,await StockFingerprint(s));Assert.Equal(secondBefore,await StockFingerprint(second));
        await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();var lines=await db.QuoteLinesV4.Where(l=>l.QuoteId==Text(q,"quoteId")).ToArrayAsync();Assert.Equal(3,lines.Length);Assert.Equal(2,lines.Select(l=>l.AgreementId).Where(id=>id is not null).Distinct().Count());return true;});
    }
    [Fact]public async Task Quote4ConcurrentSameAndDifferentCommandsSerializeWithoutDuplicateSnapshotsOrStockEffects()
    {
        var(s,cart)=await Quote4Cart();using var customer=s.Customer;var before=await StockFingerprint(s);var same=Quote4Input(cart);
        var pair=await ContendedHttp(RaceCartResource(s.Owner),ct=>customer.PostAsJsonAsync(Quote4Route(),same,ct),ct=>customer.PostAsJsonAsync(Quote4Route(),same,ct));
        var first=await Body(pair.First);var replay=await Body(pair.Second);Assert.Equal(first.ToJsonString(),replay.ToJsonString());
        var a=Quote4Input(cart);var b=Quote4Input(cart);pair=await ContendedHttp(RaceCartResource(s.Owner),ct=>customer.PostAsJsonAsync(Quote4Route(),a,ct),ct=>customer.PostAsJsonAsync(Quote4Route(),b,ct));
        var left=await Body(pair.First);var right=await Body(pair.Second);Assert.NotEqual(Text(left,"quoteId"),Text(right,"quoteId"));Assert.Equal(before,await StockFingerprint(s));
        await Scope(async sp=>{var commands=new[]{same.RequestId,a.RequestId,b.RequestId}.Select(x=>Guid.Parse(x!).ToString("N")).ToArray();Assert.Equal(3,await sp.GetRequiredService<SalesDbContext>().Quotes.CountAsync(q=>commands.Contains(q.RequestId)));return true;});
    }
    [Fact]public async Task Quote4AndLegacyQuoteCommandsCannotDeserializeEachOthersRetainedSnapshots()
    {
        var s=await Create(3);using var customer=s.Customer;var cart=await Body(await customer.GetAsync("/api/cart/en/v2"));
        cart=await Body(await customer.PutAsJsonAsync("/api/cart/en/v2",new CartV2Input([new(s.Variant,1)],Text(cart,"version"))));
        var legacy=Quote4Input(cart);await Body(await customer.PostAsJsonAsync("/api/cart/en/quote",legacy));
        var candidate=await Allocate(s);await Body(await customer.PostAsJsonAsync(Offer(s)+"/convert",ConvertInput(candidate)));cart=await Body(await customer.GetAsync("/api/cart/en/v2"));
        var wrong=await Body(await customer.PostAsJsonAsync(Quote4Route(),Quote4Input(cart,command:legacy.RequestId)),HttpStatusCode.Conflict);Assert.Equal("quote_contract_conflict",Text(wrong,"title"));
        var v4=Quote4Input(cart);var q=await Quote4(s,v4);await Delete(customer,s.Acceptance,new CartOfferRemoveInput(Id(),Text(cart,"version")));cart=await Body(await customer.GetAsync("/api/cart/en/v2"));
        wrong=await Body(await customer.PostAsJsonAsync("/api/cart/en/quote",Quote4Input(cart,command:v4.RequestId)),HttpStatusCode.Conflict);Assert.Equal("quote_contract_conflict",Text(wrong,"title"));
        var historic=await Quote4(s,v4);Assert.Equal(Text(q,"quoteId"),Text(historic,"quoteId"));FencedQuote4(historic);
    }
    [Fact]public async Task Quote4RejectsUnknownInputGuestStaleCartAndAnotherOwnersEmptyCart()
    {
        var(s,cart)=await Quote4Cart();using var customer=s.Customer;var input=Quote4Input(cart);
        using var guest=fixture.Sql.Factory.CreateClient(new(){HandleCookies=false});guest.DefaultRequestHeaders.Add("Origin","http://127.0.0.1:3000");await Body(await guest.PostAsJsonAsync(Quote4Route(),input),HttpStatusCode.Unauthorized);
        var injected=System.Text.Json.JsonSerializer.SerializeToNode(input,Json)!.AsObject();injected["unitPriceRial"]="1";await Body(await customer.PostAsJsonAsync(Quote4Route(),injected),HttpStatusCode.BadRequest);
        await Body(await customer.PostAsJsonAsync(Quote4Route(),input with{CartVersion=Convert.ToBase64String(new byte[8])}),HttpStatusCode.Conflict);
        var person=await Customer();using var stranger=person.Client;using var denied=await stranger.PostAsJsonAsync(Quote4Route(),input);Assert.False(denied.IsSuccessStatusCode);
        await Scope(async sp=>{Assert.False(await sp.GetRequiredService<SalesDbContext>().Quotes.AnyAsync(q=>q.RequestId==Guid.Parse(input.RequestId!).ToString("N")));return true;});
    }
    [Fact]public async Task Quote4ProductionModeCannotReplayADevelopmentAgreementSnapshot()
    {
        var(s,cart)=await Quote4Cart();using var customer=s.Customer;var input=Quote4Input(cart);await Quote4(s,input);var before=await StockFingerprint(s);
        await Scope(async sp=>{
            Assert.True((await sp.GetRequiredService<SalesDbContext>().SourcingPriceAgreements.SingleAsync(a=>a.Id==s.Acceptance)).ContainsDemo);
            var service=ActivatorUtilities.CreateInstance<CheckoutQuoteV4Service>(sp,false);
            var error=await Assert.ThrowsAsync<BusinessException>(()=>sp.GetRequiredService<SalesTransactionCoordinator>().RunAsync(()=>service.CreateAsync(new(s.Owner,null),"en",input,default)));
            Assert.Equal("not_found",error.Code);return true;
        });Assert.Equal(before,await StockFingerprint(s));
    }
    [Fact]public async Task Quote4CurrentMaterialAndPublicationAreAuthoritativeForNewCalculations()
    {
        var(s,cart)=await Quote4Cart();using var customer=s.Customer;await Quote4(s,Quote4Input(cart));
        await Scope(async sp=>{await sp.GetRequiredService<CatalogDbContext>().Variants.Where(v=>v.Id==s.Variant).ExecuteUpdateAsync(x=>x.SetProperty(v=>v.WarrantyEn,"Changed material warranty"));return true;});
        using var changed=await customer.PostAsJsonAsync(Quote4Route(),Quote4Input(cart));Assert.False(changed.IsSuccessStatusCode);
        await Scope(async sp=>{var db=sp.GetRequiredService<CatalogDbContext>();var product=await db.Variants.Where(v=>v.Id==s.Variant).Select(v=>v.ProductId).SingleAsync();await db.Products.Where(p=>p.Id==product).ExecuteUpdateAsync(x=>x.SetProperty(p=>p.Status,"Draft"));return true;});
        using var hidden=await customer.PostAsJsonAsync(Quote4Route(),Quote4Input(cart));Assert.False(hidden.IsSuccessStatusCode);
    }
    [Fact]public async Task Quote4ExactDeadlineRejectsNewCalculationAndExpiredReplayCannotExtendItsHold()
    {
        var(s,cart)=await Quote4Cart(2,false);using var customer=s.Customer;
        var original=Quote4Input(cart);var first=await Quote4(s,original,capture:"quote4-expiry-original");var input=Quote4Input(cart);var deadline=first["lines"]![0]!["accepted"]!["allocationExpiresAt"]!.GetValue<DateTimeOffset>();
        await using var shifted=new SqlFactory(fixture.Sql.Connection,fixture.Sql.Password,await Keys(),new FixedClock(deadline));using var late=CopyClient(shifted,customer);
        var before=await StockFingerprint(s);using var response=await late.PostAsJsonAsync(Quote4Route(),input);Assert.False(response.IsSuccessStatusCode);Assert.Equal(before,await StockFingerprint(s));
        var replay=await Quote4(s,original,capture:"quote4-expired-replay",client:late);
        FencedQuote4(replay);Assert.Equal(Text(first,"quoteId"),Text(replay,"quoteId"));Assert.Equal(Text(first,"expiresAt"),Text(replay,"expiresAt"));Assert.Contains("quote_expired",replay["blockers"]!.AsArray().Select(x=>x!.GetValue<string>()));
        await Scope(async sp=>{Assert.False(await sp.GetRequiredService<SalesDbContext>().Quotes.AnyAsync(q=>q.RequestId==Guid.Parse(input.RequestId!).ToString("N")));return true;});
    }
    [Fact]public async Task Quote4ChildConstraintFailureRollsBackHeaderAndRetryUsesOneSnapshot()
    {
        var(s,cart)=await Quote4Cart();using var customer=s.Customer;var input=Quote4Input(cart);var before=await StockFingerprint(s);
        await Scope(async sp=>{await sp.GetRequiredService<SalesDbContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [sales].[CheckoutQuoteLinesV4] WITH NOCHECK ADD CONSTRAINT [CK_Quote4_QA_Failure] CHECK ([LineKind]<>'acceptedOffer')");return true;});
        try{await Body(await customer.PostAsJsonAsync(Quote4Route(),input),HttpStatusCode.Conflict);}finally{await Scope(async sp=>{await sp.GetRequiredService<SalesDbContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [sales].[CheckoutQuoteLinesV4] DROP CONSTRAINT [CK_Quote4_QA_Failure]");return true;});}
        await Scope(async sp=>{Assert.False(await sp.GetRequiredService<SalesDbContext>().Quotes.AnyAsync(q=>q.RequestId==Guid.Parse(input.RequestId!).ToString("N")));return true;});Assert.Equal(before,await StockFingerprint(s));
        await Quote4(s,input);await Quote4(s,input);await Scope(async sp=>{Assert.Equal(1,await sp.GetRequiredService<SalesDbContext>().Quotes.CountAsync(q=>q.RequestId==Guid.Parse(input.RequestId!).ToString("N")));return true;});
    }
}
