using System.Data;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Inventory;
using Shop.Modules.Payments;
using Shop.Modules.Sales;
using Shop.SharedKernel;
namespace Shop.UiHarness;
// Executable QA fixtures only. No synthetic gateway is registered in product DI.
internal static class PaymentHarnessSeed
{
    private sealed class FixtureGateway:ICashPaymentGateway
    {
        public string ProviderKey=>"synthetic-ui-qa";public string AccountKey=>"qa";public bool IsConfigured=>true;public bool SupportsIdempotentInitiation=>true;public IReadOnlySet<string> AllowedRedirectHosts=>new HashSet<string>{"gateway.example.test"};
        public Task<CashGatewayStarted> StartAsync(CashGatewayStart r,CancellationToken ct)=>throw new InvalidOperationException("QA seed must not initiate a network payment.");public Task<CashGatewayVerified> VerifyAsync(CashGatewayVerify r,CancellationToken ct)=>throw new InvalidOperationException("QA facts are explicit internal synthetic prerequisites, not gateway verification evidence.");
    }
    private static string Id()=>Guid.NewGuid().ToString("N");
    private static async Task<JsonNode> Read(HttpResponseMessage response,HttpStatusCode expected=HttpStatusCode.OK){using(response){if(response.StatusCode!=expected)throw new InvalidOperationException("Synthetic payment prerequisite HTTP "+(int)response.StatusCode);return await response.Content.ReadFromJsonAsync<JsonNode>()??throw new InvalidOperationException("Empty QA response.");}}
    internal static async Task RunAsync(Func<HttpClient> createClient,IServiceProvider services,string database,string directory,AllocationHarnessSeed.QaIdentity customer)
    {
        if(Environment.GetEnvironmentVariable("SHOP_UI_PAYMENT_QA")!="1"||!services.GetRequiredService<IWebHostEnvironment>().IsDevelopment()||!Regex.IsMatch(database,"^SaymanTest_Ui_[a-f0-9]{32}$")||Path.GetFileName(directory)!=database||File.Exists(Path.Combine(directory,"payments.json")))throw new InvalidOperationException("Fresh explicitly enabled own payment GUID QA required.");
        var sales=services.GetRequiredService<SalesDbContext>();var stock=services.GetRequiredService<InventoryDbContext>();var catalog=services.GetRequiredService<CatalogDbContext>();foreach(var db in new DbContext[]{sales,stock,catalog})if(db.Database.GetDbConnection().Database!=database||db.Database.GetDbConnection().DataSource!="127.0.0.1,11433")throw new InvalidOperationException("Own loopback QA database only.");
        if(await sales.Orders.AnyAsync()||await sales.Quotes.AnyAsync()||await sales.ChargePolicies.AnyAsync()||await sales.OrderSettings.AnyAsync()||await services.GetRequiredService<PaymentsDbContext>().CashAttempts.AnyAsync())throw new InvalidOperationException("Payment samples require empty financial prerequisites.");
        await using(var transaction=await sales.Database.BeginTransactionAsync(IsolationLevel.Serializable)){await services.GetRequiredService<CheckoutOrderSettingsService>().SaveAsync(new(true,60,2,null),default);await services.GetRequiredService<CheckoutChargePolicyService>().SaveAsync(new("flat","ارسال مصنوعی QA","Synthetic QA shipping","فقط آزمون موقت","Disposable QA only","12345",null,"exempt",null,"goods","half_up",null),default);await transaction.CommitAsync();}
        var template=await catalog.Products.AsNoTracking().SingleAsync(p=>p.Id=="p1");var product=new Product{Id=Id(),Slug="payment-qa-"+Id(),CategoryId=template.CategoryId,BrandId=template.BrandId,Status="Published",PurchaseMethods=[new(){MethodId="online"}],Translations=[new(){Locale="fa",Name="کالای نمونهٔ آزمون پرداخت؛ فروش واقعی نیست",SearchName="نمونه آزمون پرداخت"},new(){Locale="en",Name="Synthetic payment QA product; not a real sale",SearchName="synthetic payment QA"}]};var variant=new ProductVariant{Id=Id(),Sku="PAYMENT-QA-"+Id(),IsActive=true,PriceRial=9007199254740993,LabelFa="فقط نمونهٔ SQL موقت",LabelEn="Disposable SQL sample only",WarrantyFa="شرایط تجاری واقعی نیست",WarrantyEn="Not real commercial terms"};product.Variants.Add(variant);catalog.Products.Add(product);await catalog.SaveChangesAsync();stock.Stock.Add(new(){VariantId=variant.Id,OnHand=6});await stock.SaveChangesAsync();
        using var client=await AllocationHarnessSeed.SignInAsync(createClient,services,customer,"cartui",null,default);var metadata=new List<object>();var registry=new CashGatewayRegistry([new FixtureGateway()]);
        foreach(var state in new[]{"verified","review","pending"}){
            var cart=await Read(await client.GetAsync("/api/cart/fa"));cart=await Read(await client.PutAsJsonAsync("/api/cart/fa",new CartInput([new(variant.Id,1)],cart["version"]?.GetValue<string>())));var quote=await Read(await client.PostAsJsonAsync("/api/cart/fa/quote",new CheckoutQuoteInput(cart["version"]!.GetValue<string>(),"online",null,Id())));var order=(await Read(await client.PostAsJsonAsync("/api/orders",new CreateOrderInput(quote["quoteId"]!.GetValue<string>(),Id(),"مشتری مصنوعی پرداخت","09121234567",new("IR","تهران","تهران","نشانی مصنوعی QA؛ تراکنش واقعی نیست","1234567890"),"Synthetic payment UI QA only",true)),HttpStatusCode.Created))["order"]!;var orderId=order["summary"]!["id"]!.GetValue<string>();
            string version;await using(var scope=services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<SalesDbContext>();var row=await db.Orders.SingleAsync(o=>o.Id==orderId);row.ContainsDemo=true;row.ChangedAt=DateTimeOffset.UtcNow;await db.SaveChangesAsync();version=Convert.ToBase64String(row.Version);}
            CashPaymentPrepared prepared;await using(var scope=services.CreateAsyncScope()){var sp=scope.ServiceProvider;prepared=await sp.GetRequiredService<CashPaymentTransactionCoordinator>().RunAsync(()=>new CashPaymentPreparationService(sp.GetRequiredService<PaymentsDbContext>(),sp.GetRequiredService<ICashPaymentOrders>(),new CashPaymentBindings([new("online","synthetic-ui-qa","qa")]),registry,TimeProvider.System,true).PrepareAsync(customer.Id,orderId,new(Id(),version),default));}
            var authority="synthetic-ui-authority-"+Id();var reference="synthetic-ui-reference-"+Id();await using(var scope=services.CreateAsyncScope()){var sp=scope.ServiceProvider;var db=sp.GetRequiredService<PaymentsDbContext>();var row=await db.CashAttempts.SingleAsync(a=>a.Id==prepared.Attempt.Id);row.State="pending";row.AuthorityHash=CashGatewayRules.EvidenceHash(authority,512);row.ProtectedAuthority=sp.GetRequiredService<IPaymentAuthorityProtection>().Protect(row.Id,authority);row.RedirectUri="https://gateway.example.test/pay";row.ChangedAt=DateTimeOffset.UtcNow;db.CashEvents.Add(new(){AttemptId=row.Id,State="pending",Reason="synthetic_browser_prerequisite",At=row.ChangedAt});await db.SaveChangesAsync();}
            if(state!="pending")await using(var scope=services.CreateAsyncScope()){var sp=scope.ServiceProvider;var amount=long.Parse(prepared.Attempt.AmountRial,System.Globalization.CultureInfo.InvariantCulture)+(state=="review"?1:0);var result=await sp.GetRequiredService<CashPaymentTransactionCoordinator>().RunAsync(()=>new CashPaymentSettlementService(sp.GetRequiredService<PaymentsDbContext>(),sp.GetRequiredService<ICashPaymentOrders>(),registry,TimeProvider.System,true).ApplyServerVerificationAsync(customer.Id,prepared.Attempt.Id,new("succeeded",authority,amount,"IRR",reference),default));if(result.Disposition!=(state=="verified"?"applied":"requires_review"))throw new InvalidOperationException("Synthetic settlement did not match the expected fixture.");}
            metadata.Add(new{OrderId=orderId,AttemptId=prepared.Attempt.Id,State=state,AmountRial=prepared.Attempt.AmountRial,SyntheticQaOnly=true});
        }
        await UiHarnessProgram.WritePrivate(Path.Combine(directory,"payments.json"),new{SchemaVersion=1,Database=database,SyntheticQaOnly=true,CustomerId=customer.Id,MainPromoted=false,ActualGatewayCalls=0,ProductGatewayRegistryConfigured=false,Policies=new{ShippingRial="12345",TaxMode="exempt",TemporaryMinutes=60,MaximumOpenOrders=2},ProductId=product.Id,VariantId=variant.Id,Orders=metadata});Console.WriteLine("Payment UI QA prepared three clearly synthetic pending/verified/review samples through the actual internal settlement boundary. No gateway network call, product success adapter, raw authority metadata or real transaction was created.");
    }
}
