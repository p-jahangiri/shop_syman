using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Inventory;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;
public sealed partial class OrderV2HttpSqlTests
{
    [Theory][InlineData(true)][InlineData(false)]
    public async Task AcceptedPhysicalAndOrdinaryDigitalSnapshot2CompleteInEitherOrderWithoutChangingHistoricalPrices(bool digitalFirst)
    {
        await using var policy=await Order2Policies();var data=await Quote4Cart(2,false,false);var s=data.Scenario;using var customer=s.Customer;
        var digital=await Scope(async sp=>{var catalog=sp.GetRequiredService<CatalogDbContext>();var physical=await catalog.Products.SingleAsync(p=>p.Variants.Any(v=>v.Id==s.Variant));var product=new Product{Slug="digital-v2-"+Id(),CategoryId=physical.CategoryId,BrandId=physical.BrandId,Status="Published",IsDigital=true,PurchaseMethods=[new(){MethodId="online"}],Translations=[new(){Locale="fa",Name="مجوز دیجیتال ساختگی",SearchName="مجوز دیجیتال ساختگی"},new(){Locale="en",Name="Synthetic digital license",SearchName="synthetic digital license"}]};var variant=new ProductVariant{Sku="DIGITAL-V2-"+Id(),IsActive=true,PriceRial=100003,LabelFa="مجوز",LabelEn="License"};product.Variants.Add(variant);catalog.Products.Add(product);await catalog.SaveChangesAsync();var inventory=sp.GetRequiredService<InventoryDbContext>();inventory.Stock.Add(new(){VariantId=variant.Id,OnHand=2});await inventory.SaveChangesAsync();return variant.Id;});
        var cart=await Body(await customer.PutAsJsonAsync("/api/cart/en/v2",new CartV2Input([new(digital,2)],Text(data.Cart,"version"))));var quote=await Order2Quote(s,cart);var order=(await Body(await customer.PostAsJsonAsync("/api/orders/v2",Order2Input(Text(quote,"quoteId"))),HttpStatusCode.Created))["order"]!;var id=Text(order["summary"]!,"id");var originalLines=order["lines"]!.ToJsonString();Assert.Equal(2,order["schemaVersion"]!.GetValue<int>());
        await Scope(async sp=>await sp.GetRequiredService<SalesTransactionCoordinator>().RunAsync(async()=>{var db=sp.GetRequiredService<SalesDbContext>();var row=await db.Orders.SingleAsync(x=>x.Id==id);Assert.Equal(StockReservationState.Allocated,(await sp.GetRequiredService<IStockOrderReservationsV2>().AllocateAsync(s.Owner,row.ReservationId,"synthetic-v2-digital-fixture",default)).State);row.State=OrderState.Paid;row.ChangedAt=DateTimeOffset.UtcNow;await db.SaveChangesAsync();return true;},inventoryOnly:true));
        var movementsBefore=await Scope(async sp=>{var inventory=sp.GetRequiredService<InventoryDbContext>();return await inventory.Movements.Where(x=>x.VariantId==s.Variant||x.VariantId==digital).GroupBy(x=>x.VariantId).ToDictionaryAsync(x=>x.Key,x=>x.Count());});
        using var admin=await ShipmentAdministrator();var path=$"/api/admin/orders/{s.Owner}/{id}/fulfillment";var digitalPath=path+"/digital";
        async Task<T> Get<T>(string uri){using var response=await admin.GetAsync(uri);var node=await Body(response);return JsonSerializer.Deserialize<T>(node.ToJsonString(),Json)!;}
        async Task<DigitalDeliveryResult> Digital(){var p=await Get<AdminDigitalDeliveryPage>(digitalPath);Assert.True(p.CanDeliver);var line=Assert.Single(p.Lines);Assert.Equal(digital,line.VariantId);Assert.Equal(2,line.Remaining);var input=new DigitalDeliveryInput(s.Owner,Id(),p.OrderVersion,p.InventoryFingerprint!,"Synthetic mixed V2 entitlement",true,[new(line.LineKey,["SYNTHETIC-V2-CODE-1","SYNTHETIC-V2-CODE-2"])]);return JsonSerializer.Deserialize<DigitalDeliveryResult>((await Body(await admin.PostAsJsonAsync(digitalPath+"/commands/"+input.CommandId,input))).ToJsonString(),Json)!;}
        async Task<ParcelPage> Physical()=>await Get<ParcelPage>(path);
        async Task<ParcelCommandResult> Parcel(string action,ParcelSummary? previous=null){var p=await Physical();var input=new ParcelCommandInput(s.Owner,Id(),action,p.OrderVersion,previous?.Id,previous?.Version,p.InventoryFingerprint,"Synthetic mixed physical fulfillment",true,action=="pack"?"SYNTHETIC-MIXED":null,action=="pack"?p.Lines.Where(x=>x.Remaining>0&&!(p.DigitalLineKeys??[]).Contains(x.LineKey)).Select(x=>new PartialDispatchSelection(x.LineKey,x.Remaining,[])).ToArray():[],action=="dispatch"?"حمل ساختگی":null,action=="dispatch"?"Synthetic carrier":null,null,action is"dispatch"or"deliver"?DateTimeOffset.UtcNow:null);return JsonSerializer.Deserialize<ParcelCommandResult>((await Body(await admin.PostAsJsonAsync(path+"/commands/"+input.CommandId,input))).ToJsonString(),Json)!;}
        DigitalDeliveryResult? delivered=null;
        if(digitalFirst){delivered=await Digital();Assert.Equal("Paid",(await Physical()).OrderState);}
        var packed=await Parcel("pack");Assert.Single(packed.Detail.Lines);Assert.Equal(s.Variant,packed.Detail.Lines[0].VariantId);Assert.Equal(2,packed.Detail.Lines[0].Quantity);await Parcel("dispatch",packed.Detail.Parcel);
        var sent=(await Physical()).Parcels.Single();await Parcel("deliver",sent);var middle=await Physical();Assert.Equal(digitalFirst?"Fulfilled":"Paid",middle.OrderState);
        if(!digitalFirst)delivered=await Digital();Assert.Equal("Fulfilled",(await Physical()).OrderState);
        var own=await Body(await customer.GetAsync($"/api/orders/v2/{id}/fulfillment/digital/{delivered!.Delivery.Id}/content"));Assert.Equal(new[]{"SYNTHETIC-V2-CODE-1","SYNTHETIC-V2-CODE-2"},own["items"]!.AsArray().Select(x=>Text(x!,"content")).ToArray());var historical=await Body(await customer.GetAsync("/api/orders/v2/"+id));Assert.Equal(originalLines,historical["lines"]!.ToJsonString());
        if(Environment.GetEnvironmentVariable("SHOP_DIGITAL_WIRE_DIR")is{Length:>0} dir){Directory.CreateDirectory(dir);await File.WriteAllTextAsync(System.IO.Path.Combine(dir,$"digital-mixed-v2-{digitalFirst.ToString().ToLowerInvariant()}-parcels.json"),JsonSerializer.Serialize(await Physical(),Json));}
        await Scope(async sp=>{var inventory=sp.GetRequiredService<InventoryDbContext>();foreach(var sku in new[]{s.Variant,digital}){var stock=await inventory.Stock.SingleAsync(x=>x.VariantId==sku);Assert.Equal((0,0,0),(stock.OnHand,stock.Reserved,stock.SourcingReserved));Assert.Equal(movementsBefore.GetValueOrDefault(sku)+1,await inventory.Movements.CountAsync(x=>x.VariantId==sku));}Assert.Equal(2,await inventory.PartialDispatches.CountAsync(x=>x.OrderId==id));Assert.Equal("Transferred",(await inventory.SourcingAllocations.SingleAsync(x=>x.AcceptanceId==s.Acceptance)).State);var db=sp.GetRequiredService<SalesDbContext>();Assert.Empty(await db.OrderShipments.Where(x=>x.OrderId==id).ToArrayAsync());Assert.Equal(2,await db.DigitalItems.CountAsync(x=>db.DigitalDeliveries.Any(d=>d.OrderId==id&&d.Id==x.DeliveryId)));return true;});
    }
}

public sealed partial class OrderV2HttpSqlTests
{
    [Theory][InlineData(false)][InlineData(true)]
    public async Task NewMixedAcceptedQuotesRejectUnsafeDigitalCapacityAndMetadata(bool metadata)
    {
        await using var policy=await Order2Policies();var data=await Quote4Cart(2,false,false);var s=data.Scenario;using var customer=s.Customer;var quantity=metadata?1:1009;
        var digital=await Scope(async sp=>{var catalog=sp.GetRequiredService<CatalogDbContext>();var physical=await catalog.Products.SingleAsync(p=>p.Variants.Any(v=>v.Id==s.Variant));var product=new Product{Slug="digital-capacity-v2-"+Id(),CategoryId=physical.CategoryId,BrandId=physical.BrandId,Status="Published",IsDigital=true,PurchaseMethods=[new(){MethodId="online"}],Translations=[new(){Locale="fa",Name="مجوز دیجیتال آزمون ظرفیت",SearchName="مجوز دیجیتال آزمون ظرفیت"},new(){Locale="en",Name="Synthetic capacity license",SearchName="synthetic capacity license"}]};var variant=new ProductVariant{Sku="DIGITAL-CAPACITY-"+Id(),IsActive=true,PriceRial=100003,LabelFa="مجوز",LabelEn=metadata?new string('آ',700):"License"};product.Variants.Add(variant);catalog.Products.Add(product);await catalog.SaveChangesAsync();var inventory=sp.GetRequiredService<InventoryDbContext>();inventory.Stock.Add(new(){VariantId=variant.Id,OnHand=quantity});await inventory.SaveChangesAsync();return variant.Id;});
        var cart=await Body(await customer.PutAsJsonAsync("/api/cart/en/v2",new CartV2Input([new(digital,quantity)],Text(data.Cart,"version"))));
        var before=await Scope(async sp=>{var inventory=sp.GetRequiredService<InventoryDbContext>();var rows=await inventory.Stock.AsNoTracking().Where(x=>x.VariantId==s.Variant||x.VariantId==digital).OrderBy(x=>x.VariantId).Select(x=>new{x.VariantId,x.OnHand,x.Reserved,x.SourcingReserved,x.Version}).ToArrayAsync();return JsonSerializer.Serialize(rows,Json);});
        foreach(var route in new[]{Quote4Route(),Quote5Route()}){using var response=await customer.PostAsJsonAsync(route,new CheckoutQuoteInput(Text(cart,"version"),"online",null,Id()));var raw=await response.Content.ReadAsStringAsync();Assert.True(response.StatusCode==HttpStatusCode.Conflict,$"{route}: {(int)response.StatusCode}: {raw}");Assert.Contains(metadata?"digital_delivery_metadata_capacity_conflict":"digital_delivery_order_capacity_conflict",raw);}
        await Scope(async sp=>{var sales=sp.GetRequiredService<SalesDbContext>();var inventory=sp.GetRequiredService<InventoryDbContext>();var rows=await inventory.Stock.AsNoTracking().Where(x=>x.VariantId==s.Variant||x.VariantId==digital).OrderBy(x=>x.VariantId).Select(x=>new{x.VariantId,x.OnHand,x.Reserved,x.SourcingReserved,x.Version}).ToArrayAsync();Assert.Equal(before,JsonSerializer.Serialize(rows,Json));var cartId=await sales.Carts.Where(x=>x.OwnerId==s.Owner).Select(x=>x.Id).SingleAsync();Assert.False(await sales.Quotes.AnyAsync(x=>x.CartId==cartId));Assert.False(await sales.Orders.AnyAsync(x=>x.OwnerId==s.Owner));Assert.False(await inventory.Reservations.AnyAsync(x=>x.OwnerId==s.Owner));Assert.False(await inventory.Movements.AnyAsync(x=>x.VariantId==digital));Assert.Equal("Active",(await inventory.SourcingAllocations.SingleAsync(x=>x.AcceptanceId==s.Acceptance)).State);return true;});
    }
}
