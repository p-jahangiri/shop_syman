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
// Only this test executable, fresh explicit disposable Development SQL database.
// Paid is a synthetic prerequisite. Product HTTP routes never record fake payment.
internal static class ShipmentHarnessSeed
{
    private static string Id()=>Guid.NewGuid().ToString("N");
    private static async Task<JsonNode> Read(HttpResponseMessage response,HttpStatusCode status=HttpStatusCode.OK){using(response){if(response.StatusCode!=status)throw new InvalidOperationException("Synthetic shipment prerequisite HTTP "+(int)response.StatusCode);return await response.Content.ReadFromJsonAsync<JsonNode>()??throw new InvalidOperationException("Empty QA response.");}}
    internal static async Task RunAsync(Func<HttpClient> createClient,IServiceProvider services,string database,string directory,AllocationHarnessSeed.QaIdentity customer,AllocationHarnessSeed.QaIdentity staff)
    {
        if(Environment.GetEnvironmentVariable("SHOP_UI_SHIPMENT_QA")!="1"||!services.GetRequiredService<IWebHostEnvironment>().IsDevelopment()||!Regex.IsMatch(database,"^SaymanTest_Ui_[a-f0-9]{32}$")||Path.GetFileName(directory)!=database||File.Exists(Path.Combine(directory,"shipment.json")))throw new InvalidOperationException("Fresh explicit shipment GUID QA required.");
        var sales=services.GetRequiredService<SalesDbContext>();var inventory=services.GetRequiredService<InventoryDbContext>();var catalog=services.GetRequiredService<CatalogDbContext>();
        foreach(var db in new DbContext[]{sales,inventory,catalog})if(db.Database.GetDbConnection().Database!=database||db.Database.GetDbConnection().DataSource!="127.0.0.1,11433")throw new InvalidOperationException("Own loopback QA boundary required.");
        if(await sales.Orders.AnyAsync()||await sales.Quotes.AnyAsync()||await sales.OrderSettings.AnyAsync()||await sales.ChargePolicies.AnyAsync()||await inventory.Reservations.AnyAsync())throw new InvalidOperationException("Shipment fixtures cannot overwrite existing purchases or financial policies.");
        await using(var tx=await sales.Database.BeginTransactionAsync(IsolationLevel.Serializable)){await services.GetRequiredService<CheckoutOrderSettingsService>().SaveAsync(new(true,60,2,null),default);await services.GetRequiredService<CheckoutChargePolicyService>().SaveAsync(new("flat","ارسال مصنوعی QA","Synthetic QA shipping","فقط آزمون موقت","Disposable QA only","12345",null,"exempt",null,"goods","half_up",null),default);await tx.CommitAsync();}
        var template=await catalog.Products.AsNoTracking().SingleAsync(p=>p.Id=="p1");var product=new Product{Id=Id(),Slug="shipment-qa-"+Id(),CategoryId=template.CategoryId,BrandId=template.BrandId,Status="Published",PurchaseMethods=[new(){MethodId="online"}],Translations=[new(){Locale="fa",Name="گوشی آزمایشی ارسال؛ فروش واقعی نیست",SearchName="گوشی آزمایشی ارسال"},new(){Locale="en",Name="Synthetic shipment phone; not a real sale",SearchName="synthetic shipment phone"}]};var tracked=new ProductVariant{Id=Id(),Sku="SHIP-QA-"+Id(),IsActive=true,PriceRial=769000001,LabelFa="دستگاه IMEI نمونه",LabelEn="Synthetic IMEI unit",WarrantyFa="گارانتی نامعلوم؛ نمونه",WarrantyEn="Warranty unknown; synthetic"};var ordinary=new ProductVariant{Id=Id(),Sku="SHIP-PLAIN-QA-"+Id(),IsActive=true,PriceRial=100003,LabelFa="لوازم نمونه",LabelEn="Synthetic accessory"};product.Variants.AddRange([tracked,ordinary]);catalog.Products.Add(product);await catalog.SaveChangesAsync();inventory.Stock.AddRange(new StockItem{VariantId=tracked.Id,OnHand=0},new StockItem{VariantId=ordinary.Id,OnHand=3});await inventory.SaveChangesAsync();
        using var admin=await AllocationHarnessSeed.SignInAsync(createClient,services,staff,"financeui","Administrator",default);using var person=await AllocationHarnessSeed.SignInAsync(createClient,services,customer,"cartui",null,default);
        var serialPath="/api/admin/inventory/variants/"+tracked.Id;var page=await Read(await admin.GetAsync(serialPath+"/serials?state=all"));await Read(await admin.PutAsJsonAsync(serialPath+"/serial-mode",new SerialModeInput("imei",page["stock"]!["version"]?.GetValue<string>(),Id())));page=await Read(await admin.GetAsync(serialPath+"/serials?state=all"));var receipt=await Read(await admin.PostAsJsonAsync(serialPath+"/serials",new SerialReceiptInput([new(null,"990000000000002")],"Synthetic physical QA device",page["stock"]!["version"]!.GetValue<string>(),Id())));var unit=receipt["units"]![0]!;
        var cart=await Read(await person.GetAsync("/api/cart/fa"));cart=await Read(await person.PutAsJsonAsync("/api/cart/fa",new CartInput([new(tracked.Id,1),new(ordinary.Id,2)],cart["version"]?.GetValue<string>())));var quote=await Read(await person.PostAsJsonAsync("/api/cart/fa/quote",new CheckoutQuoteInput(cart["version"]!.GetValue<string>(),"online",null,Id())));var order=(await Read(await person.PostAsJsonAsync("/api/orders",new CreateOrderInput(quote["quoteId"]!.GetValue<string>(),Id(),"مشتری مصنوعی ارسال","09121234567",new("IR","تهران","تهران","نشانی مصنوعی آزمون؛ ارسال واقعی نیست","1234567890"),"Synthetic QA only",true)),HttpStatusCode.Created))["order"]!;var orderId=order["summary"]!["id"]!.GetValue<string>();
        await using(var scope=services.CreateAsyncScope()){var sp=scope.ServiceProvider;await sp.GetRequiredService<SalesTransactionCoordinator>().RunAsync(async()=>{var db=sp.GetRequiredService<SalesDbContext>();if(db.Database.GetDbConnection().Database!=database)throw new InvalidOperationException("Own GUID only.");var row=await db.Orders.SingleAsync(o=>o.Id==orderId);var hold=await sp.GetRequiredService<IStockReservations>().AllocateAsync(customer.Id,row.ReservationId,"synthetic-shipment-fixture",default);if(hold.State!=StockReservationState.Allocated)throw new InvalidOperationException("Real allocation required.");row.State=OrderState.Paid;row.ContainsDemo=true;row.ChangedAt=DateTimeOffset.UtcNow;await db.SaveChangesAsync();await sp.GetRequiredService<IStockSerialAssignments>().AssignAsync(new(customer.Id,row.ReservationId,"synthetic-shipment-fixture",Id(),[new(unit["id"]!.GetValue<string>(),unit["version"]!.GetValue<string>(),null)]),default);return true;},inventoryOnly:true);}
        await UiHarnessProgram.WritePrivate(Path.Combine(directory,"shipment.json"),new{SchemaVersion=1,Database=database,SyntheticQaOnly=true,SyntheticPaidFixture=true,ProductPaymentAdapter=false,MainPromoted=false,CustomerId=customer.Id,OrderId=orderId,TrackedVariantId=tracked.Id,OrdinaryVariantId=ordinary.Id,UnitId=unit["id"]!.GetValue<string>(),Imei="990000000000002",Policy=new{ShippingRial="12345",TemporaryMinutes=60,MaximumOpenOrders=2},BrowserAccepted=false});
        Console.WriteLine("Shipment QA prepared an explicitly synthetic Paid/Allocated two-line order and one actual QA IMEI unit. No product payment adapter, shipment, carrier event or real transaction was created.");
    }
}
