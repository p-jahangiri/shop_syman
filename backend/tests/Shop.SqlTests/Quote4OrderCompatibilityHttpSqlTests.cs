using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Inventory;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;

public sealed partial class SourcingConversionHttpSqlTests
{
    private sealed record CompatibilityOrder(string Id,string QuoteId,string ReservationId,DateTimeOffset ExpiresAt,CreateOrderInput Input);
    private Task<CompatibilityOrder> SeedCompatibilityOrder(Scenario s)=>Scope(async sp=>
    {
        var sales=sp.GetRequiredService<SalesDbContext>();var orderId=Id();var quoteId=Id();
        var input=OrderInputRules.Normalize(new(quoteId,Id(),"QA compatibility buyer","09121234567",new("IR","تهران","تهران","نشانی مصنوعی آزمون سازگاری سفارش","1234567890"),"Trusted synthetic ordinary order history",true));
        // An actual one-minute ordinary hold provides the Stock side of the
        // regression. No charge/order setting is created or enabled. The order
        // itself is trusted old history, not a successful new checkout.
        var hold=await sp.GetRequiredService<IStockReservations>().HoldAsync(new(s.Owner,orderId,Id(),[new(s.Variant,1)],TimeSpan.FromMinutes(1)),default);
        var cart=await sales.Carts.AsNoTracking().SingleAsync(c=>c.OwnerId==s.Owner);var cartVersion=Convert.ToBase64String(cart.Version);
        var quote=new CheckoutQuoteData(3,"en",quoteId,cartVersion,new string('A',64),hold.CreatedAt.AddMinutes(-1),hold.ExpiresAt,[new(s.Variant,"synthetic-legacy-model","synthetic-seller","phones","QA-OLD-ORDER","Synthetic old ordinary order","Synthetic variant","Synthetic warranty",false,1,"123","123","AAAAAAAAAAE=")],"123","0","0","123",true,"0","0","123",[],[],null,null,[],false,false,["synthetic_old_order_history"],null,new(false,1,true,["synthetic_old_order_history"]));
        var json=JsonSerializer.Serialize(quote,Json);
        sales.Quotes.Add(new(){Id=quoteId,ContractVersion=null,ActorKey=RaceHash("member:"+s.Owner.ToUpperInvariant()),RequestId=Id(),PayloadHash=new string('A',64),CartId=cart.Id,CartVersion=cartVersion,PricingFingerprint=new string('A',64),CreatedAt=quote.CreatedAt,ExpiresAt=hold.ExpiresAt,ItemsSubtotalRial=123,GoodsTotalRial=123,ShippingMode="unconfigured",TaxMode="unconfigured",ResponseJson=json,
            Lines=[new(){VariantId=s.Variant,ProductId="synthetic-legacy-model",SellerId="synthetic-seller",CategoryId="phones",Sku="QA-OLD-ORDER",Name="Synthetic old ordinary order",Label="Synthetic variant",Warranty="Synthetic warranty",PriceVersion="AAAAAAAAAAE=",Quantity=1,UnitPriceRial=123,LineTotalRial=123}]});
        sales.Orders.Add(new(){Id=orderId,OwnerId=s.Owner,RequestId=input.RequestId,PayloadHash=RaceHash(JsonSerializer.Serialize(input with{RequestId=""})),QuoteId=quoteId,PricingFingerprint=new string('A',64),Locale="en",State=OrderState.AwaitingPayment,ReservationId=hold.Id,CreatedAt=hold.CreatedAt,ChangedAt=hold.CreatedAt,ExpiresAt=hold.ExpiresAt,ContactName=input.ContactName,ContactPhone=input.ContactPhone,ShippingRequired=true,CountryCode=input.Delivery!.CountryCode,Province=input.Delivery.Province,City=input.Delivery.City,Address=input.Delivery.Address,PostalCode=input.Delivery.PostalCode,Note=input.Note!,MethodId="online",MethodName="Synthetic old method",ShippingName="Synthetic old shipping",ItemsSubtotalRial=123,GoodsTotalRial=123,PayableTotalRial=123,QuoteSnapshotJson=json,
            Lines=[new(){VariantId=s.Variant,ProductId="synthetic-legacy-model",SellerId="synthetic-seller",Sku="QA-OLD-ORDER",Name="Synthetic old ordinary order",Label="Synthetic variant",Warranty="Synthetic warranty",PriceVersion="AAAAAAAAAAE=",Quantity=1,UnitPriceRial=123,LineTotalRial=123}],
            Events=[new(){State=OrderState.AwaitingPayment,ActorId="synthetic-order-history",Reason="synthetic_order_history",At=hold.CreatedAt}]});
        await sales.SaveChangesAsync();Assert.Equal(0,await sales.OrderSettings.CountAsync());Assert.Equal(0,await sales.ChargePolicies.CountAsync());
        return new CompatibilityOrder(orderId,quoteId,hold.Id,hold.ExpiresAt,input);
    });
    private Task<string> CompatibilitySnapshot(Scenario s,CompatibilityOrder old)=>Scope(async sp=>
    {
        var sales=sp.GetRequiredService<SalesDbContext>();var inventory=sp.GetRequiredService<InventoryDbContext>();
        return JsonSerializer.Serialize(new
        {
            Order=await sales.Orders.AsNoTracking().AsSingleQuery().Include(o=>o.Lines).Include(o=>o.Events).SingleAsync(o=>o.Id==old.Id),
            Quote=await sales.Quotes.AsNoTracking().Include(q=>q.Lines).Include(q=>q.Installments).SingleAsync(q=>q.Id==old.QuoteId),
            Reservation=await inventory.Reservations.AsNoTracking().Include(r=>r.Items).SingleAsync(r=>r.Id==old.ReservationId),
            ReservationEvents=await inventory.ReservationEvents.AsNoTracking().Where(e=>e.ReservationId==old.ReservationId).OrderBy(e=>e.Id).ToArrayAsync(),
            Stock=await inventory.Stock.AsNoTracking().SingleAsync(st=>st.VariantId==s.Variant),
            Cart=await sales.Carts.AsNoTracking().Include(c=>c.Lines).Include(c=>c.OfferLines).SingleAsync(c=>c.OwnerId==s.Owner),
            Orders=await sales.Orders.CountAsync(),Reservations=await inventory.Reservations.CountAsync(),Settings=await sales.OrderSettings.CountAsync(),Policies=await sales.ChargePolicies.CountAsync()
        },Json);
    });
    private Task<string> CompatibilityAccepted(Scenario s)=>Scope(async sp=>
    {
        var sales=sp.GetRequiredService<SalesDbContext>();var inventory=sp.GetRequiredService<InventoryDbContext>();
        return JsonSerializer.Serialize(new
        {
            Agreement=await sales.SourcingPriceAgreements.AsNoTracking().Include(a=>a.Lines).SingleAsync(a=>a.AcceptanceId==s.Acceptance),
            Allocation=await inventory.SourcingAllocations.AsNoTracking().Include(a=>a.Lines).SingleAsync(a=>a.AcceptanceId==s.Acceptance),
            Claims=await inventory.SerialUnitClaims.AsNoTracking().Where(c=>c.VariantId==s.Variant).OrderBy(c=>c.Id).ToArrayAsync()
        },Json);
    });
    private Task CleanupCompatibilityOrder(Scenario s,CompatibilityOrder old)=>Scope(async sp=>
    {
        var sales=sp.GetRequiredService<SalesDbContext>();var inventory=sp.GetRequiredService<InventoryDbContext>();
        var reservation=await inventory.Reservations.AsNoTracking().SingleOrDefaultAsync(r=>r.Id==old.ReservationId);
        if(reservation?.State==StockReservationState.Active)await sp.GetRequiredService<IStockReservations>().ReleaseAsync(s.Owner,old.ReservationId,"synthetic-compatibility-cleanup",default);
        // Only this case's exact synthetic old history is removed, so the
        // shared HTTP fixture's other cases retain their zero-order baseline.
        await sales.SmsSignals.Where(signal => signal.OrderEvent!.OrderId == old.Id &&
            sales.Orders.Any(order => order.Id == old.Id && order.OwnerId == s.Owner)).ExecuteDeleteAsync();
        await sales.Orders.Where(o=>o.Id==old.Id&&o.OwnerId==s.Owner).ExecuteDeleteAsync();await sales.Quotes.Where(q=>q.Id==old.QuoteId).ExecuteDeleteAsync();
        await inventory.ReservationEvents.Where(e=>e.ReservationId==old.ReservationId).ExecuteDeleteAsync();await inventory.ReservationItems.Where(i=>i.ReservationId==old.ReservationId).ExecuteDeleteAsync();await inventory.Reservations.Where(r=>r.Id==old.ReservationId&&r.OwnerId==s.Owner).ExecuteDeleteAsync();return true;
    });

    [Fact]
    public async Task NewLegacyOrderAndQuote4QueueBeforeStockWhileHistoricalReplayStillExpiresOnlyItsOwnOrdinaryHold()
    {
        var(s,cart)=await Quote4Cart(onHand:4);using var customer=s.Customer;var old=await SeedCompatibilityOrder(s);
        try
        {
            var saved=await Quote4(s,Quote4Input(cart));FencedQuote4(saved);
            var newOrder=old.Input with{QuoteId=Text(saved,"quoteId"),RequestId=Id(),Note="New command must not expire old history before the accepted-cart gate"};
            // A deliberate QA clock, two minutes after the old hold began,
            // leaves the genuine ten-minute accepted allocation unexpired.
            var instant=old.ExpiresAt.AddMinutes(1);
            await using var shifted=new SqlFactory(fixture.Sql.Connection,fixture.Sql.Password,await Keys(),new FixedClock(instant));using var late=CopyClient(shifted,customer);
            var before=await CompatibilitySnapshot(s,old);var accepted=await CompatibilityAccepted(s);var input=Quote4Input(cart);
            var pair=await ContendedHttp(RaceCartResource(s.Owner),ct=>late.PostAsJsonAsync(Quote4Route(),input,ct),ct=>late.PostAsJsonAsync("/api/orders",newOrder,ct));
            var quote=await Body(pair.First);FencedQuote4(quote);
            var rejected=await Body(pair.Second,HttpStatusCode.Conflict);Assert.Equal("cart_contract_upgrade_required",Text(rejected,"title"));
            Assert.Equal(before,await CompatibilitySnapshot(s,old));Assert.Equal(accepted,await CompatibilityAccepted(s));
            await Scope(async sp=>
            {
                var sales=sp.GetRequiredService<SalesDbContext>();var inventory=sp.GetRequiredService<InventoryDbContext>();
                Assert.Equal(OrderState.AwaitingPayment,(await sales.Orders.AsNoTracking().SingleAsync(o=>o.Id==old.Id)).State);
                Assert.Equal(StockReservationState.Active,(await inventory.Reservations.AsNoTracking().SingleAsync(r=>r.Id==old.ReservationId)).State);
                Assert.Equal(1,await sales.Orders.CountAsync());Assert.Equal(1,await inventory.Reservations.CountAsync());Assert.Equal(1,(await inventory.Stock.AsNoTracking().SingleAsync(st=>st.VariantId==s.Variant)).Reserved);
                Assert.False(await sales.Orders.AnyAsync(o=>o.OwnerId==s.Owner&&o.RequestId==newOrder.RequestId));Assert.Equal(1,await sales.Quotes.CountAsync(q=>q.RequestId==Guid.Parse(input.RequestId!).ToString("N")));return true;
            });

            // Replay deliberately stays above the new cart gate. It is the
            // actual historical order lifecycle, not a new accepted order.
            var replay=await Body(await late.PostAsJsonAsync("/api/orders",old.Input));Assert.True(replay["replayed"]!.GetValue<bool>());Assert.Equal(old.Id,Text(replay["order"]!["summary"]!,"id"));Assert.Equal("Expired",Text(replay["order"]!["summary"]!,"state"));Assert.False(replay["order"]!["canPay"]!.GetValue<bool>());
            await Scope(async sp=>
            {
                var sales=sp.GetRequiredService<SalesDbContext>();var inventory=sp.GetRequiredService<InventoryDbContext>();var order=await sales.Orders.AsNoTracking().SingleAsync(o=>o.Id==old.Id);var hold=await inventory.Reservations.AsNoTracking().SingleAsync(r=>r.Id==old.ReservationId);var stock=await inventory.Stock.AsNoTracking().SingleAsync(st=>st.VariantId==s.Variant);
                Assert.Equal(OrderState.Expired,order.State);Assert.Equal(StockReservationState.Expired,hold.State);Assert.Equal(old.ExpiresAt,order.ExpiresAt);Assert.Equal(old.ExpiresAt,hold.ExpiresAt);Assert.Equal(0,stock.Reserved);Assert.Equal(2,stock.SourcingReserved);Assert.Equal(4,stock.OnHand);
                Assert.Equal(1,await sales.Set<SalesOrderEvent>().CountAsync(e=>e.OrderId==old.Id&&e.State==OrderState.Expired));Assert.Equal(1,await inventory.ReservationEvents.CountAsync(e=>e.ReservationId==old.ReservationId&&e.State==StockReservationState.Expired));Assert.Equal(1,await sales.Orders.CountAsync());Assert.Equal(1,await inventory.Reservations.CountAsync());Assert.Equal(0,await sales.OrderSettings.CountAsync());Assert.Equal(0,await sales.ChargePolicies.CountAsync());return true;
            });
            Assert.Equal(accepted,await CompatibilityAccepted(s));var afterReplay=await CompatibilitySnapshot(s,old);
            replay=await Body(await late.PostAsJsonAsync("/api/orders",old.Input));Assert.True(replay["replayed"]!.GetValue<bool>());Assert.Equal("Expired",Text(replay["order"]!["summary"]!,"state"));Assert.Equal(afterReplay,await CompatibilitySnapshot(s,old));
        }
        finally{await CleanupCompatibilityOrder(s,old);}
    }
}
