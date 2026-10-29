using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Identity;
using Shop.Modules.Inventory;
using Shop.Modules.Market;
using Shop.Modules.Payments;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;
public sealed partial class SourcingOfferSqlTests(MarketFixture fixture):IClassFixture<MarketFixture>
{
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web);
    private static string Id()=>Guid.NewGuid().ToString("N");
    private sealed record Scenario(HttpClient Customer,string Owner,string Request,string Listing,string Model,string Variant);
    private static string Route(Scenario s,string offer,bool admin=true)=>$"/api/{(admin?"admin/":"")}sourcing/requests/{s.Request}/offers/{offer}";
    private static string ReadString(JsonNode node,string key)=>node[key]!.GetValue<string>();
    private static async Task<JsonNode> Body(HttpResponseMessage response,HttpStatusCode expected=HttpStatusCode.OK,string? capture=null)
    {
        using(response){var raw=await response.Content.ReadAsStringAsync();Assert.True(response.StatusCode==expected,$"HTTP {(int)response.StatusCode}, expected {(int)expected}: {raw}");
            if(capture is not null&&Environment.GetEnvironmentVariable("SHOP_OFFER_WIRE_DIR") is {Length:>0} directory){Directory.CreateDirectory(directory);await File.WriteAllTextAsync(Path.Combine(directory,capture+".json"),raw);}
            return JsonNode.Parse(raw)!;
        }
    }
    private async Task<(HttpClient Client,string Owner)> Customer()
    {
        await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();var users=scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>();var name="offer"+Id();var user=new ShopUser{UserName=name,Email=name+"@example.test",EmailConfirmed=true,DisplayName="Synthetic offer SQL customer"};Assert.True((await users.CreateAsync(user,fixture.Sql.Password)).Succeeded);
        var session=await scope.ServiceProvider.GetRequiredService<AuthService>().PasswordAsync(new(name,fixture.Sql.Password),true,true,false,CancellationToken.None);var client=fixture.Sql.Factory.CreateClient(new(){HandleCookies=false});client.DefaultRequestHeaders.Add("Origin","http://127.0.0.1:3000");client.DefaultRequestHeaders.Authorization=new("Bearer",session.AccessToken);return(client,user.Id);
    }
    private async Task<Scenario> Create()
    {
        var key=Id();var number=Id();var flag=Id();var select=Id();var multi=Id();var option=Id();var usb=Id();var typec=Id();
        await using(var attributes=fixture.Sql.Factory.Services.CreateAsyncScope()){
            var db=attributes.ServiceProvider.GetRequiredService<CatalogDbContext>();
            AttributeDefinition Definition(string id,AttributeDataType type)=>new(){Id=id,Key="offer-"+id,DataType=type,Unit=type==AttributeDataType.Number?"GB":null,Translations=[new(){Locale="fa",Name="ویژگی نمونه "+type,Unit=type==AttributeDataType.Number?"گیگابایت":null},new(){Locale="en",Name="Sample attribute "+type,Unit=type==AttributeDataType.Number?"Gigabytes":null}]};
            var definitions=new[]{Definition(number,AttributeDataType.Number),Definition(flag,AttributeDataType.Bool),Definition(select,AttributeDataType.Select),Definition(multi,AttributeDataType.MultiSelect)};definitions[2].Options.Add(new(){Id=option,Value="black",LabelFa="مشکی",LabelEn="Black"});definitions[3].Options.AddRange([new(){Id=usb,Value="usb",LabelFa="یو‌اس‌بی",LabelEn="USB"},new(){Id=typec,Value="typec",LabelFa="تایپ‌سی",LabelEn="Type C"}]);db.AttributeDefinitions.AddRange(definitions);db.CategoryAttributes.AddRange(definitions.Select(d=>new CategoryAttribute{CategoryId="phones",AttributeId=d.Id,ShowInSpecs=true,IsComparable=true}));await db.SaveChangesAsync();
        }
        var model=new CatalogModelInput("phones","samsung","offer-"+key,[new("fa","گوشی پیشنهاد نمونه "+key,"فقط دادهٔ مصنوعی SQL"),new("en","Synthetic offer phone "+key,"Synthetic SQL offer data")],[new("battery",TextFa:"باتری نمونه",TextEn:"Sample battery"),new(number,Number:0),new(flag,Bool:false),new(select,OptionId:option),new(multi,OptionIds:[usb,typec])],["/products/phone-green.svg"],null);
        var created=await Body(await fixture.Writer.PostAsJsonAsync("/api/admin/market/models",new CreateMarketModelInput(model,new("Published","qa-offer",key,"منبع نمونه","Synthetic source",null,"unknown",null,null,null,true))));var listing=ReadString(created,"id");
        var person=await Customer();var before=await Body(await person.Client.GetAsync("/api/cart/en/sourcing"));var cart=await Body(await person.Client.PutAsJsonAsync("/api/cart/en/sourcing",new CartSourcingInput([new(listing,2)],before["version"]?.GetValue<string>())));var candidate=cart["lines"]![0]!["candidate"]!;var modelId=ReadString(candidate["model"]!,"id");
        var submit=await Body(await person.Client.PostAsJsonAsync("/api/cart/en/sourcing/submit",new SourcingSubmitInput(Id(),ReadString(cart,"version"),[new(listing,ReadString(candidate,"fingerprint"))])),HttpStatusCode.Created);
        var variant=Id();await using(var setup=fixture.Sql.Factory.Services.CreateAsyncScope()){
            var db=setup.ServiceProvider.GetRequiredService<CatalogDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);var product=await db.Products.Include(p=>p.PurchaseMethods).SingleAsync(p=>p.Id==modelId);product.Status="Published";product.PurchaseMethods.Add(new(){ProductId=modelId,MethodId="online"});
            db.Variants.Add(new(){Id=variant,ProductId=modelId,Sku="QA-OFFER-"+key,PriceRial=123,LabelFa="پیکربندی نمونه",LabelEn="Synthetic configuration",Color="#123456",ColorNameFa="رنگ نمونه",ColorNameEn="Synthetic colour",WarrantyFa="گارانتی مصنوعی آزمون",WarrantyEn="Synthetic QA warranty",Attributes=[new(){AttributeId=select,ValueOptionId=option}]});
            // Offer is a new snapshot contract: existing request-v1 keeps its
            // short labels, while current Catalog may legitimately grow them.
            var numeric=await db.AttributeDefinitions.Include(a=>a.Translations).SingleAsync(a=>a.Id==number);numeric.Translations.Single(t=>t.Locale=="fa").Name=new string('ف',201);numeric.Translations.Single(t=>t.Locale=="fa").Unit=new string('و',2000);numeric.Translations.Single(t=>t.Locale=="en").Unit=new string('u',201);(await db.AttributeOptions.SingleAsync(o=>o.Id==option)).LabelEn=new string('b',201);await db.SaveChangesAsync();
        }
        return new(person.Client,person.Owner,ReadString(submit,"id"),listing,modelId,variant);
    }
    private async Task<SourcingOfferSaveInput> Input(Scenario s,HttpClient finance,string? version=null,string price="9007199254740993")
    {
        var request=await Body(await finance.GetAsync($"/api/admin/sourcing/requests/{s.Request}"));var sku=await Body(await finance.GetAsync($"/api/admin/sourcing/requests/{s.Request}/offer-skus/{s.Variant}?listingId={s.Listing}"));var now=DateTimeOffset.UtcNow;
        return new(Id(),ReadString(request["summary"]!,"version"),version,[new(Id(),s.Listing,s.Variant,2,price,ReadString(sku,"materialFingerprint"),ReadString(sku,"currentFingerprint"))],"شرایط مصنوعی پیشنهاد؛ صرفاً رضایت پیگیری تأمین، بدون پرداخت.","Synthetic terms: consent to follow up procurement only; no payment.",now.AddMinutes(20),now.AddHours(2));
    }
    private static SourcingOfferActionInput Action(JsonNode detail,string? command=null)=>new(command??Id(),ReadString(detail,"requestVersion"),ReadString(detail["offer"]!["summary"]!,"version"),ReadString(detail["offer"]!["summary"]!,"termsHash"));
    private static SourcingOfferPublishInput PublishInput(JsonNode detail,string? supersedes=null,string? supersedesVersion=null){var action=Action(detail);return new(action.RequestId,action.RequestVersion,action.Version,action.TermsHash,supersedes,supersedesVersion);}
    private async Task<(string Offer,JsonNode Detail)> Publish(Scenario s,HttpClient finance,string price="9007199254740993")
    {
        var offer=Id();await Body(await finance.PutAsJsonAsync(Route(s,offer),await Input(s,finance,price:price)));var draft=await Body(await finance.GetAsync(Route(s,offer)));await Body(await finance.PostAsJsonAsync(Route(s,offer)+"/publish",PublishInput(draft)));return(offer,await Body(await s.Customer.GetAsync(Route(s,offer,false))));
    }
    private async Task<(int Variants,int Stock,long OnHand,long Reserved,int Orders,int Reservations,int Quotes,int PurchaseLines)> FinancialCounters()
    {
        await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();var services=scope.ServiceProvider;var stock=services.GetRequiredService<InventoryDbContext>();var sales=services.GetRequiredService<SalesDbContext>();return(await services.GetRequiredService<CatalogDbContext>().Variants.CountAsync(),await stock.Stock.CountAsync(),await stock.Stock.SumAsync(s=>(long)s.OnHand),await stock.Stock.SumAsync(s=>(long)s.Reserved),await sales.Orders.CountAsync(),await stock.Reservations.CountAsync(),await sales.Quotes.CountAsync(),await sales.CartLines.CountAsync());
    }

    [Fact] public async Task RealRequestPublishesImmutableNegotiatedRialAndAcceptsWithoutFinancialEffects()
    {
        var s=await Create();using var customer=s.Customer;using var finance=await fixture.ReuseStaff("FinanceManager");var before=await FinancialCounters();var offer=Id();var input=await Input(s,finance);var saved=await Body(await finance.PutAsJsonAsync(Route(s,offer),input),capture:"save");
        Assert.Empty((await Body(await customer.GetAsync($"/api/sourcing/requests/{s.Request}/offers")))["items"]!.AsArray());Assert.Equal(HttpStatusCode.NotFound,(await customer.GetAsync(Route(s,offer,false))).StatusCode);
        var draft=await Body(await finance.GetAsync(Route(s,offer)),capture:"admin-draft");var publish=await Body(await finance.PostAsJsonAsync(Route(s,offer)+"/publish",PublishInput(draft)),capture:"publish");var published=await Body(await customer.GetAsync(Route(s,offer,false)),capture:"customer-published");
        Assert.Equal("18014398509481986",ReadString(published["offer"]!["summary"]!,"totalRial"));Assert.Equal("9007199254740993",ReadString(published["offer"]!["lines"]![0]!,"unitPriceRial"));Assert.True(published["canAccept"]!.GetValue<bool>());Assert.True(published["consentOnly"]!.GetValue<bool>());Assert.False(published["canPay"]!.GetValue<bool>());
        var sku=published["offer"]!["lines"]![0]!["sku"]!;var typed=sku["model"]!["attributes"]!.AsArray();Assert.Equal(5,typed.Count);Assert.Equal(0m,decimal.Parse(ReadString(typed.Single(a=>ReadString(a!,"dataType")=="Number")!,"number"),System.Globalization.CultureInfo.InvariantCulture));Assert.False(typed.Single(a=>ReadString(a!,"dataType")=="Bool")!["bool"]!.GetValue<bool>());Assert.Equal(2000,ReadString(typed.Single(a=>ReadString(a!,"dataType")=="Number")!,"unitFa").Length);Assert.Equal(2,typed.Single(a=>ReadString(a!,"dataType")=="MultiSelect")!["options"]!.AsArray().Count);Assert.Equal(201,ReadString(sku["attributes"]![0]!["options"]![0]!,"labelEn").Length);
        await using(var edit=fixture.Sql.Factory.Services.CreateAsyncScope()){var db=edit.ServiceProvider.GetRequiredService<CatalogDbContext>();(await db.Variants.SingleAsync(v=>v.Id==s.Variant)).PriceRial=456;await db.SaveChangesAsync();}
        var unchanged=await Body(await customer.GetAsync(Route(s,offer,false)));Assert.Equal(published["offer"]!.ToJsonString(),unchanged["offer"]!.ToJsonString());Assert.True(unchanged["canAccept"]!.GetValue<bool>());
        var accept=Action(unchanged);var accepted=await Body(await customer.PostAsJsonAsync(Route(s,offer,false)+"/accept",accept),capture:"accept");var repeated=await Body(await customer.PostAsJsonAsync(Route(s,offer,false)+"/accept",accept),capture:"accept-replay");Assert.Equal("Accepted",ReadString(accepted,"state"));Assert.True(repeated["replayed"]!.GetValue<bool>());Assert.Equal(ReadString(accepted,"acceptanceId"),ReadString(repeated,"acceptanceId"));
        var detail=await Body(await customer.GetAsync(Route(s,offer,false)),capture:"customer-accepted");Assert.False(detail["canAccept"]!.GetValue<bool>());Assert.False(detail["canCancelRequest"]!.GetValue<bool>());Assert.Equal(before,await FinancialCounters());
        Assert.Equal(HttpStatusCode.Conflict,(await customer.PostAsJsonAsync($"/api/sourcing/requests/{s.Request}/cancel",new SourcingActionInput(Id(),ReadString(detail,"requestVersion")))).StatusCode);
        using var sales=await fixture.ReuseStaff("SalesManager");Assert.Equal(HttpStatusCode.Conflict,(await sales.PostAsJsonAsync($"/api/admin/sourcing/requests/{s.Request}/unavailable",new SourcingUnavailableInput(Id(),ReadString(detail,"requestVersion"),"supplier_unavailable","Synthetic SQL reason"))).StatusCode);
        await Body(await customer.GetAsync($"/api/sourcing/requests/{s.Request}/offers"),capture:"customer-page");var events=await Body(await customer.GetAsync(Route(s,offer,false)+"/events"),capture:"customer-events");Assert.DoesNotContain("actorId",events.ToJsonString());
        await Body(await customer.GetAsync(Route(s,offer,false)+"/commands/accept/"+accept.RequestId),capture:"customer-receipt");await Body(await finance.GetAsync(Route(s,offer)),capture:"admin-accepted");
        var parentEvents=await Body(await customer.GetAsync($"/api/sourcing/requests/{s.Request}/events"),capture:"request-events");Assert.Equal(2,parentEvents["items"]!.AsArray().Count);Assert.All(parentEvents["items"]!.AsArray(),e=>Assert.True(e!["stateBefore"] is null||ReadString(e,"stateBefore")!=ReadString(e,"stateAfter")));
        await using var check=fixture.Sql.Factory.Services.CreateAsyncScope();var market=check.ServiceProvider.GetRequiredService<MarketDbContext>();Assert.Single(await market.SourcingOfferAcceptances.Where(a=>a.OfferId==offer).ToArrayAsync());Assert.Equal("Reviewing",(await market.SourcingRequests.SingleAsync(r=>r.Id==s.Request)).State);
    }

    [Fact] public async Task FinancialWritesRequireFinancePermissionAndPrivateReadsEnforceOwnerAndTarget()
    {
        var s=await Create();using var customer=s.Customer;using var finance=await fixture.ReuseStaff("FinanceManager");using var sales=await fixture.ReuseStaff("SalesManager");var outsider=await Customer();using var other=outsider.Client;using var anonymous=fixture.Sql.Factory.CreateClient();var offer=Id();var input=await Input(s,finance);
        Assert.Equal(HttpStatusCode.Forbidden,(await sales.PutAsJsonAsync(Route(s,offer),input)).StatusCode);Assert.Equal(HttpStatusCode.Forbidden,(await fixture.Writer.PutAsJsonAsync(Route(s,offer),input)).StatusCode);Assert.Equal(HttpStatusCode.Forbidden,(await customer.PutAsJsonAsync(Route(s,offer),input)).StatusCode);
        await Body(await finance.PutAsJsonAsync(Route(s,offer),input));var draft=await Body(await sales.GetAsync(Route(s,offer)));Assert.Equal(HttpStatusCode.Unauthorized,(await anonymous.GetAsync(Route(s,offer,false))).StatusCode);Assert.Equal(HttpStatusCode.NotFound,(await other.GetAsync($"/api/sourcing/requests/{s.Request}/offers")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,(await finance.GetAsync($"/api/admin/sourcing/requests/{s.Request}/offer-skus/{s.Variant}?listingId={Id()}")).StatusCode);Assert.Equal(HttpStatusCode.NotFound,(await finance.GetAsync($"/api/admin/sourcing/requests/{s.Request}/offer-skus/v1?listingId={s.Listing}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,(await sales.PostAsJsonAsync(Route(s,offer)+"/publish",PublishInput(draft))).StatusCode);await Body(await finance.PostAsJsonAsync(Route(s,offer)+"/withdraw",Action(draft)));Assert.Empty((await Body(await customer.GetAsync($"/api/sourcing/requests/{s.Request}/offers")))["items"]!.AsArray());Assert.Equal(HttpStatusCode.NotFound,(await customer.GetAsync(Route(s,offer,false))).StatusCode);
    }

    [Fact] public async Task SameCommandSerializesAndReceiptIsBoundToActorOperationRequestOfferAndPayload()
    {
        var s=await Create();using var customer=s.Customer;using var finance=await fixture.ReuseStaff("FinanceManager");var offer=Id();var input=await Input(s,finance);var responses=await Task.WhenAll(finance.PutAsJsonAsync(Route(s,offer),input),finance.PutAsJsonAsync(Route(s,offer),input));var results=new List<JsonNode>();foreach(var response in responses)results.Add(await Body(response));Assert.Single(results,r=>r["replayed"]!.GetValue<bool>());Assert.Single(results,r=>!r["replayed"]!.GetValue<bool>());
        Assert.Equal(HttpStatusCode.Conflict,(await finance.PutAsJsonAsync(Route(s,offer),input with{TermsEn="different"})).StatusCode);Assert.Equal(HttpStatusCode.Conflict,(await finance.PutAsJsonAsync(Route(s,Id()),input)).StatusCode);
        var receipt=Route(s,offer)+"/commands/save/"+input.RequestId;Assert.True((await Body(await finance.GetAsync(receipt)))["replayed"]!.GetValue<bool>());Assert.Equal(HttpStatusCode.NotFound,(await finance.GetAsync(Route(s,Id())+"/commands/save/"+input.RequestId)).StatusCode);using var otherFinance=await fixture.Staff("FinanceManager");Assert.Equal(HttpStatusCode.NotFound,(await otherFinance.GetAsync(receipt)).StatusCode);Assert.Equal(HttpStatusCode.Forbidden,(await customer.GetAsync(Route(s,offer,false)+"/commands/save/"+input.RequestId)).StatusCode);
        await using var check=fixture.Sql.Factory.Services.CreateAsyncScope();var db=check.ServiceProvider.GetRequiredService<MarketDbContext>();Assert.Single(await db.SourcingOffers.Where(o=>o.Id==offer).ToArrayAsync());Assert.Single(await db.SourcingOfferCommandReceipts.Where(r=>r.OfferId==offer).ToArrayAsync());
    }

    [Fact] public async Task MaterialChangeBlocksAcceptanceButDeclineStillWorksAndHistoryKeepsOldWarranty()
    {
        var s=await Create();using var customer=s.Customer;using var finance=await fixture.ReuseStaff("FinanceManager");var offer=await Publish(s,finance);
        await using(var edit=fixture.Sql.Factory.Services.CreateAsyncScope()){var db=edit.ServiceProvider.GetRequiredService<CatalogDbContext>();(await db.Variants.SingleAsync(v=>v.Id==s.Variant)).WarrantyEn="Changed actual warranty";await db.SaveChangesAsync();}
        var detail=await Body(await customer.GetAsync(Route(s,offer.Offer,false)));Assert.False(detail["canAccept"]!.GetValue<bool>());Assert.True(detail["canDecline"]!.GetValue<bool>());Assert.Equal("Synthetic QA warranty",ReadString(detail["offer"]!["lines"]![0]!["sku"]!,"warrantyEn"));Assert.Equal(HttpStatusCode.Conflict,(await customer.PostAsJsonAsync(Route(s,offer.Offer,false)+"/accept",Action(detail))).StatusCode);
        Assert.Equal("Declined",ReadString(await Body(await customer.PostAsJsonAsync(Route(s,offer.Offer,false)+"/decline",Action(detail))),"state"));
    }

    [Fact] public async Task ConcurrentAcceptanceAndCancellationHaveOneWinnerAndNoContradictoryActiveConsent()
    {
        var s=await Create();using var customer=s.Customer;using var finance=await fixture.ReuseStaff("FinanceManager");var offer=await Publish(s,finance);var action=Action(offer.Detail);var cancel=new SourcingActionInput(Id(),action.RequestVersion);
        var results=await Task.WhenAll(customer.PostAsJsonAsync(Route(s,offer.Offer,false)+"/accept",action),customer.PostAsJsonAsync($"/api/sourcing/requests/{s.Request}/cancel",cancel));try{Assert.Single(results,r=>r.StatusCode==HttpStatusCode.OK);Assert.Single(results,r=>r.StatusCode==HttpStatusCode.Conflict);}finally{foreach(var response in results)response.Dispose();}
        await using var check=fixture.Sql.Factory.Services.CreateAsyncScope();var db=check.ServiceProvider.GetRequiredService<MarketDbContext>();var row=await db.SourcingOffers.SingleAsync(o=>o.Id==offer.Offer);var parent=await db.SourcingRequests.SingleAsync(r=>r.Id==s.Request);Assert.True(row.State=="Accepted"&&row.IsActive&&parent.State=="Reviewing"||row.State=="Withdrawn"&&!row.IsActive&&parent.State=="Cancelled");
    }

    [Fact] public async Task ConcurrentWithdrawalAndAcceptanceHaveOneWinnerAndAcceptedConsentFencesParentActions()
    {
        var s=await Create();using var customer=s.Customer;using var finance=await fixture.ReuseStaff("FinanceManager");using var sales=await fixture.ReuseStaff("SalesManager");var offer=await Publish(s,finance);var action=Action(offer.Detail);
        var results=await Task.WhenAll(customer.PostAsJsonAsync(Route(s,offer.Offer,false)+"/accept",action),finance.PostAsJsonAsync(Route(s,offer.Offer)+"/withdraw",action with{RequestId=Id()}));try{Assert.Single(results,r=>r.StatusCode==HttpStatusCode.OK);Assert.Single(results,r=>r.StatusCode==HttpStatusCode.Conflict);}finally{foreach(var response in results)response.Dispose();}
        var detail=await Body(await customer.GetAsync(Route(s,offer.Offer,false)));if(ReadString(detail["offer"]!["summary"]!,"state")=="Accepted"){
            Assert.Equal(HttpStatusCode.Conflict,(await customer.PostAsJsonAsync($"/api/sourcing/requests/{s.Request}/cancel",new SourcingActionInput(Id(),ReadString(detail,"requestVersion")))).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict,(await sales.PostAsJsonAsync($"/api/admin/sourcing/requests/{s.Request}/unavailable",new SourcingUnavailableInput(Id(),ReadString(detail,"requestVersion"),"supplier_unavailable","Synthetic SQL reason"))).StatusCode);
        }
    }

    [Fact] public async Task ReplacementRequiresExplicitCurrentOfferAndCannotSupersedeActiveAcceptance()
    {
        var s=await Create();using var customer=s.Customer;using var finance=await fixture.ReuseStaff("FinanceManager");var first=await Publish(s,finance);var second=Id();await Body(await finance.PutAsJsonAsync(Route(s,second),await Input(s,finance,price:"321")));var draft=await Body(await finance.GetAsync(Route(s,second)));Assert.Equal(HttpStatusCode.Conflict,(await finance.PostAsJsonAsync(Route(s,second)+"/publish",PublishInput(draft))).StatusCode);
        await Body(await finance.PostAsJsonAsync(Route(s,second)+"/publish",PublishInput(draft,first.Offer,ReadString(first.Detail["offer"]!["summary"]!,"version"))));Assert.Equal("Superseded",ReadString((await Body(await customer.GetAsync(Route(s,first.Offer,false))))["offer"]!["summary"]!,"state"));
        var current=await Body(await customer.GetAsync(Route(s,second,false)));await Body(await customer.PostAsJsonAsync(Route(s,second,false)+"/accept",Action(current)));var third=Id();await Body(await finance.PutAsJsonAsync(Route(s,third),await Input(s,finance,price:"111")));var thirdDraft=await Body(await finance.GetAsync(Route(s,third)));var accepted=await Body(await finance.GetAsync(Route(s,second)));Assert.Equal(HttpStatusCode.Conflict,(await finance.PostAsJsonAsync(Route(s,third)+"/publish",PublishInput(thirdDraft,second,ReadString(accepted["offer"]!["summary"]!,"version")))).StatusCode);
    }

    [Fact] public async Task ReceiptInsertFailureRollsBackOfferSnapshotEventsAndVersionThenSameCommandCanRetry()
    {
        var s=await Create();using var customer=s.Customer;using var finance=await fixture.ReuseStaff("FinanceManager");var offer=Id();var input=await Input(s,finance);
        await using(var setup=fixture.Sql.Factory.Services.CreateAsyncScope()){var db=setup.ServiceProvider.GetRequiredService<MarketDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);await db.Database.ExecuteSqlRawAsync("CREATE TRIGGER [market].[RejectOfferReceiptQa] ON [market].[SourcingOfferCommandReceipts] INSTEAD OF INSERT AS THROW 51000,'Synthetic QA offer receipt failure',1;");}
        try{Assert.Equal(HttpStatusCode.InternalServerError,(await finance.PutAsJsonAsync(Route(s,offer),input)).StatusCode);}finally{await using var cleanup=fixture.Sql.Factory.Services.CreateAsyncScope();await cleanup.ServiceProvider.GetRequiredService<MarketDbContext>().Database.ExecuteSqlRawAsync("DROP TRIGGER [market].[RejectOfferReceiptQa];");}
        await using(var check=fixture.Sql.Factory.Services.CreateAsyncScope()){var db=check.ServiceProvider.GetRequiredService<MarketDbContext>();Assert.False(await db.SourcingOffers.AnyAsync(o=>o.Id==offer));Assert.False(await db.SourcingOfferEvents.AnyAsync(e=>e.OfferId==offer));Assert.False(await db.SourcingOfferCommandReceipts.AnyAsync(r=>r.OfferId==offer));}await Body(await finance.PutAsJsonAsync(Route(s,offer),input));
    }

    [Fact] public async Task WrongModelQuantityOverflowAndStaleFingerprintsCannotCreateAnOffer()
    {
        var s=await Create();using var customer=s.Customer;using var finance=await fixture.ReuseStaff("FinanceManager");var offer=Id();var input=await Input(s,finance);var line=input.Lines[0];
        foreach(var invalid in new[]{input with{Lines=[line with{VariantId="v1"}]},input with{Lines=[line with{Quantity=1}]},input with{Lines=[line with{MaterialFingerprint=new string('A',64)}]},input with{Lines=[line with{CurrentFingerprint=new string('B',64)}]}})Assert.Equal(HttpStatusCode.Conflict,(await finance.PutAsJsonAsync(Route(s,offer),invalid)).StatusCode);
        foreach(var invalid in new[]{input with{Lines=[line with{UnitPriceRial="9223372036854775807"}]},input with{TermsFa=""},input with{AcceptUntil=input.AcceptUntil.ToOffset(TimeSpan.FromHours(1))}})Assert.Equal(HttpStatusCode.BadRequest,(await finance.PutAsJsonAsync(Route(s,offer),invalid)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,(await finance.GetAsync(Route(s,offer))).StatusCode);
    }

    [Fact] public async Task AdministrativeAuditFailureRollsBackPublishedStateParentEventsAndReceipt()
    {
        var s=await Create();using var customer=s.Customer;using var finance=await fixture.ReuseStaff("FinanceManager");var offer=Id();await Body(await finance.PutAsJsonAsync(Route(s,offer),await Input(s,finance)));var before=await Body(await finance.GetAsync(Route(s,offer)));var input=PublishInput(before);var route=Route(s,offer)+"/publish";
        var sql="ALTER TABLE [identity].[Audit] WITH NOCHECK ADD CONSTRAINT [CK_OfferAuditFailure] CHECK ([Resource]<>N'"+route+"')";
        await using(var setup=fixture.Sql.Factory.Services.CreateAsyncScope()){var db=setup.ServiceProvider.GetRequiredService<IdentityDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);await db.Database.ExecuteSqlRawAsync(sql);}
        try{Assert.Equal(HttpStatusCode.Conflict,(await finance.PostAsJsonAsync(route,input)).StatusCode);}finally{await using var cleanup=fixture.Sql.Factory.Services.CreateAsyncScope();await cleanup.ServiceProvider.GetRequiredService<IdentityDbContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] DROP CONSTRAINT [CK_OfferAuditFailure]");}
        var after=await Body(await finance.GetAsync(Route(s,offer)));Assert.Equal(ReadString(before,"requestVersion"),ReadString(after,"requestVersion"));Assert.Equal(before["offer"]!.ToJsonString(),after["offer"]!.ToJsonString());
        await using(var check=fixture.Sql.Factory.Services.CreateAsyncScope()){var db=check.ServiceProvider.GetRequiredService<MarketDbContext>();Assert.Single(await db.SourcingOfferEvents.Where(e=>e.OfferId==offer).ToArrayAsync());Assert.Single(await db.SourcingOfferCommandReceipts.Where(r=>r.OfferId==offer).ToArrayAsync());Assert.False(await db.SourcingRequestEvents.AnyAsync(e=>e.RequestId==s.Request&&e.ReasonCode=="offer_published"));}
        await Body(await finance.PostAsJsonAsync(route,input));
    }

    private sealed class OfferClock(DateTimeOffset instant):TimeProvider{public override DateTimeOffset GetUtcNow()=>instant;}
    private SourcingOfferService At(IServiceProvider services,DateTimeOffset instant)=>new(services.GetRequiredService<MarketDbContext>(),services.GetRequiredService<ICatalogOfferReader>(),services.GetRequiredService<IPurchaseConfiguration>(),new OfferClock(instant),true);
    [Fact] public async Task ExpiryUsesServerTimeWithoutWorkerAndPreservesHistoricalAcceptance()
    {
        var s=await Create();using var customer=s.Customer;using var finance=await fixture.ReuseStaff("FinanceManager");var published=await Publish(s,finance);var summary=published.Detail["offer"]!["summary"]!;var acceptUntil=summary["acceptUntil"]!.GetValue<DateTimeOffset>();
        await using(var expiry=fixture.Sql.Factory.Services.CreateAsyncScope()){
            var service=At(expiry.ServiceProvider,acceptUntil);var detail=await service.ReadAsync(s.Owner,s.Request,published.Offer,CancellationToken.None);Assert.Equal("Published",detail.Offer.Summary.State);Assert.Equal("Expired",detail.Offer.Summary.EffectiveState);Assert.False(detail.CanAccept);
            var error=await Assert.ThrowsAsync<BusinessException>(()=>expiry.ServiceProvider.GetRequiredService<SourcingTransactionCoordinator>().RunAsync(()=>service.AcceptAsync(s.Owner,s.Request,published.Offer,Action(published.Detail),CancellationToken.None),ct:CancellationToken.None,includePurchaseConfiguration:true));Assert.Equal("sourcing_offer_expired_conflict",error.Code);
        }
        await Body(await customer.PostAsJsonAsync(Route(s,published.Offer,false)+"/accept",Action(published.Detail)));var accepted=await Body(await customer.GetAsync(Route(s,published.Offer,false)));var purchaseUntil=accepted["offer"]!["summary"]!["purchaseUntil"]!.GetValue<DateTimeOffset>();
        await using(var expiry=fixture.Sql.Factory.Services.CreateAsyncScope()){
            var detail=await At(expiry.ServiceProvider,purchaseUntil).ReadAsync(s.Owner,s.Request,published.Offer,CancellationToken.None);Assert.Equal("Accepted",detail.Offer.Summary.State);Assert.Equal("Expired",detail.Offer.Summary.EffectiveState);Assert.True(detail.CanCancelRequest);Assert.False(detail.CanPay);
            var db=expiry.ServiceProvider.GetRequiredService<MarketDbContext>();Assert.Single(await db.SourcingOfferAcceptances.Where(a=>a.OfferId==published.Offer).ToArrayAsync());Assert.Equal("Accepted",(await db.SourcingOffers.SingleAsync(o=>o.Id==published.Offer)).State);
        }
    }

    [Fact] public async Task DraftEditReplacesTypedChildrenAndExplicitZeroPriceDoesNotInventACommercialFloor()
    {
        var s=await Create();using var customer=s.Customer;using var finance=await fixture.ReuseStaff("FinanceManager");var offer=Id();var first=await Input(s,finance);var saved=await Body(await finance.PutAsJsonAsync(Route(s,offer),first));var edit=await Input(s,finance,ReadString(saved,"version"),"0");var revised=await Body(await finance.PutAsJsonAsync(Route(s,offer),edit with{TermsEn="Explicit synthetic zero price; procurement consent only."}));Assert.Equal(2,revised["revision"]!.GetValue<int>());
        Assert.Equal(HttpStatusCode.Conflict,(await finance.PutAsJsonAsync(Route(s,offer),first with{RequestId=Id(),Version=ReadString(saved,"version")})).StatusCode);
        var draft=await Body(await finance.GetAsync(Route(s,offer)));Assert.Equal("0",ReadString(draft["offer"]!["summary"]!,"totalRial"));await Body(await finance.PostAsJsonAsync(Route(s,offer)+"/publish",PublishInput(draft)));var published=await Body(await customer.GetAsync(Route(s,offer,false)));await Body(await customer.PostAsJsonAsync(Route(s,offer,false)+"/accept",Action(published)));
        var replay=await Body(await finance.PutAsJsonAsync(Route(s,offer),first));Assert.True(replay["replayed"]!.GetValue<bool>());Assert.Equal(1,replay["revision"]!.GetValue<int>());Assert.Equal("Draft",ReadString(replay,"state"));
        var accepted=await Body(await finance.GetAsync(Route(s,offer)));Assert.Equal("Accepted",ReadString(accepted["offer"]!["summary"]!,"state"));Assert.Equal(HttpStatusCode.Conflict,(await finance.PutAsJsonAsync(Route(s,offer),await Input(s,finance,ReadString(accepted["offer"]!["summary"]!,"version"),"0"))).StatusCode);
        await using var check=fixture.Sql.Factory.Services.CreateAsyncScope();var db=check.ServiceProvider.GetRequiredService<MarketDbContext>();Assert.Equal(6,await db.Set<SourcingOfferAttribute>().CountAsync(a=>a.OfferId==offer));Assert.Equal(4,await db.Set<SourcingOfferOption>().CountAsync(o=>o.OfferId==offer));Assert.Single(await db.Set<SourcingOfferLine>().Where(l=>l.OfferId==offer).ToArrayAsync());
    }

    [Fact] public async Task DisabledCurrentPurchaseConfigurationBlocksConsentEvenWhenCatalogMaterialIsUnchanged()
    {
        var s=await Create();using var customer=s.Customer;using var finance=await fixture.ReuseStaff("FinanceManager");var method=Id();await using(var setup=fixture.Sql.Factory.Services.CreateAsyncScope()){
            var catalog=setup.ServiceProvider.GetRequiredService<CatalogDbContext>();var product=await catalog.Products.Include(p=>p.PurchaseMethods).SingleAsync(p=>p.Id==s.Model);catalog.RemoveRange(product.PurchaseMethods);product.PurchaseMethods=[new(){ProductId=s.Model,MethodId=method}];await catalog.SaveChangesAsync();var payments=setup.ServiceProvider.GetRequiredService<PaymentsDbContext>();payments.Methods.Add(new(){Id=method,Kind="online",NameFa="روش آزمون پیشنهاد",NameEn="Synthetic offer method",Enabled=true});await payments.SaveChangesAsync();
        }
        var published=await Publish(s,finance);await using(var edit=fixture.Sql.Factory.Services.CreateAsyncScope()){var payments=edit.ServiceProvider.GetRequiredService<PaymentsDbContext>();(await payments.Methods.SingleAsync(m=>m.Id==method)).Enabled=false;await payments.SaveChangesAsync();}
        var detail=await Body(await customer.GetAsync(Route(s,published.Offer,false)));Assert.False(detail["canAccept"]!.GetValue<bool>());Assert.True(detail["canDecline"]!.GetValue<bool>());Assert.Contains(detail["blockers"]!.AsArray(),v=>v!.GetValue<string>()=="sourcing_offer_purchase_conflict");Assert.Equal(HttpStatusCode.Conflict,(await customer.PostAsJsonAsync(Route(s,published.Offer,false)+"/accept",Action(detail))).StatusCode);await Body(await customer.PostAsJsonAsync(Route(s,published.Offer,false)+"/decline",Action(detail)));
    }

    [Fact] public async Task NewPublicationAfterPurchaseDeadlineDeactivatesOnlyTheExpiredPointerAndKeepsAcceptedHistory()
    {
        var s=await Create();using var customer=s.Customer;using var finance=await fixture.ReuseStaff("FinanceManager");var first=await Publish(s,finance);await Body(await customer.PostAsJsonAsync(Route(s,first.Offer,false)+"/accept",Action(first.Detail)));var accepted=await Body(await finance.GetAsync(Route(s,first.Offer)));var at=accepted["offer"]!["summary"]!["purchaseUntil"]!.GetValue<DateTimeOffset>();var second=Id();var input=await Input(s,finance,price:"999");await Body(await finance.PutAsJsonAsync(Route(s,second),input with{AcceptUntil=at.AddMinutes(20),PurchaseUntil=at.AddHours(1)}));var draft=await Body(await finance.GetAsync(Route(s,second)));
        await using(var publish=fixture.Sql.Factory.Services.CreateAsyncScope()){var service=At(publish.ServiceProvider,at);await publish.ServiceProvider.GetRequiredService<SourcingTransactionCoordinator>().RunAsync(()=>service.PublishAsync("synthetic-expiry-finance",s.Request,second,PublishInput(draft),CancellationToken.None),ct:CancellationToken.None,includePurchaseConfiguration:true);}
        await using var check=fixture.Sql.Factory.Services.CreateAsyncScope();var db=check.ServiceProvider.GetRequiredService<MarketDbContext>();var old=await db.SourcingOffers.SingleAsync(o=>o.Id==first.Offer);Assert.Equal("Accepted",old.State);Assert.False(old.IsActive);Assert.Single(await db.SourcingOfferAcceptances.Where(a=>a.OfferId==first.Offer).ToArrayAsync());Assert.Equal(second,(await db.SourcingOffers.SingleAsync(o=>o.RequestId==s.Request&&o.IsActive)).Id);
    }
}
