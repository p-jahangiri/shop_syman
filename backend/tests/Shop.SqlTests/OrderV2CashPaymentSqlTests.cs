using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Inventory;
using Shop.Modules.Payments;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;
namespace Shop.SqlTests;
public sealed partial class OrderV2HttpSqlTests
{
    private sealed class Order2PaymentGateway:ICashPaymentGateway
    {
        public string ProviderKey=>"synthetic-order2";public string AccountKey=>"qa";public bool IsConfigured=>true;public bool SupportsIdempotentInitiation=>true;public IReadOnlySet<string> AllowedRedirectHosts=>new HashSet<string>{"gateway.example.test"};
        public Task<CashGatewayStarted> StartAsync(CashGatewayStart r,CancellationToken ct)=>throw new NotSupportedException("This SQL fixture must never call a gateway network API.");public Task<CashGatewayVerified> VerifyAsync(CashGatewayVerify r,CancellationToken ct)=>throw new NotSupportedException("Synthetic verified fact belongs only to SQL QA.");
    }
    [Fact]public async Task VerifiedCashSettlementPreservesSnapshot2EntitlementsAndCanThenShipWithoutSyntheticPaidAssignment()
    {
        await using var policy=await Order2Policies();var data=await Quote4Cart(3,true,false);var s=data.Scenario;using var customer=s.Customer;var quote=await Order2Quote(s,data.Cart);var order=(await Body(await customer.PostAsJsonAsync("/api/orders/v2",Order2Input(Text(quote,"quoteId"))),HttpStatusCode.Created))["order"]!;var id=Text(order["summary"]!,"id");var prices=order["lines"]!.ToJsonString();
        using var admin=await ShipmentAdministrator();var shipmentRead=$"/api/admin/orders/{s.Owner}/{id}/shipment";var before=(await admin.GetFromJsonAsync<AdminShipmentData>(shipmentRead))!;Assert.False(before.CanPack);Assert.Contains("payment_not_confirmed",before.Blockers);
        var registry=new CashGatewayRegistry([new Order2PaymentGateway()]);var prepared=await Scope(sp=>sp.GetRequiredService<CashPaymentTransactionCoordinator>().RunAsync(()=>new CashPaymentPreparationService(sp.GetRequiredService<PaymentsDbContext>(),sp.GetRequiredService<ICashPaymentOrders>(),new CashPaymentBindings([new("online","synthetic-order2","qa")]),registry,TimeProvider.System,true).PrepareAsync(s.Owner,id,new(Id(),Text(order["summary"]!,"version")),default)));
        var authority="synthetic-order2-authority-"+Id();var reference="synthetic-order2-reference-"+Id();
        await Scope(async sp=>{var db=sp.GetRequiredService<PaymentsDbContext>();var row=await db.CashAttempts.SingleAsync(a=>a.Id==prepared.Attempt.Id);row.AuthorityHash=CashGatewayRules.EvidenceHash(authority,512);row.ProtectedAuthority=sp.GetRequiredService<IPaymentAuthorityProtection>().Protect(row.Id,authority);row.RedirectUri="https://gateway.example.test/pay";row.State="pending";row.ChangedAt=DateTimeOffset.UtcNow;await db.SaveChangesAsync();return true;});
        Task<CashOrderSettlement> Settle()=>Scope(sp=>sp.GetRequiredService<CashPaymentTransactionCoordinator>().RunAsync(()=>new CashPaymentSettlementService(sp.GetRequiredService<PaymentsDbContext>(),sp.GetRequiredService<ICashPaymentOrders>(),registry,TimeProvider.System,true).ApplyServerVerificationAsync(s.Owner,prepared.Attempt.Id,new("succeeded",authority,long.Parse(prepared.Attempt.AmountRial,System.Globalization.CultureInfo.InvariantCulture),"IRR",reference),default)));
        var result=await Settle();Assert.Equal("applied",result.Disposition);
        await Scope(async sp=>{var inv=sp.GetRequiredService<InventoryDbContext>();var sales=sp.GetRequiredService<SalesDbContext>();var stock=await inv.Stock.AsNoTracking().SingleAsync(x=>x.VariantId==s.Variant);Assert.Equal(3,stock.OnHand);Assert.Equal(3,stock.Reserved);Assert.Equal(0,stock.SourcingReserved);var row=await sales.Orders.AsNoTracking().SingleAsync(o=>o.Id==id);Assert.Equal(OrderState.Paid,row.State);Assert.Equal(StockReservationState.Allocated,(await inv.Reservations.AsNoTracking().SingleAsync(r=>r.Id==row.ReservationId)).State);Assert.Equal(2,await inv.ReservationLineEntitlements.CountAsync(e=>e.ReservationId==row.ReservationId));Assert.Equal("Transferred",(await inv.SourcingAllocations.AsNoTracking().SingleAsync(a=>a.AcceptanceId==s.Acceptance)).State);Assert.Equal(1,await sales.OrderCashPayments.CountAsync(p=>p.OrderId==id));return true;});
        var ready=(await admin.GetFromJsonAsync<AdminShipmentData>(shipmentRead))!;Assert.True(ready.CanPack);var write="/api/admin/orders/"+id+"/shipment/commands";await Body(await admin.PostAsJsonAsync(write,new ShipmentCommandInput(s.Owner,Id(),"pack",ready.OrderVersion,null,ready.InventoryFingerprint,"Synthetic verified Order2 payment QA",true,null,null,null,null)));ready=(await admin.GetFromJsonAsync<AdminShipmentData>(shipmentRead))!;await Body(await admin.PostAsJsonAsync(write,new ShipmentCommandInput(s.Owner,Id(),"dispatch",ready.OrderVersion,ready.Shipment!.Version,ready.InventoryFingerprint,"Synthetic warehouse hand-off",true,"حمل نمونه","Sample carrier",null,DateTimeOffset.UtcNow)));ready=(await admin.GetFromJsonAsync<AdminShipmentData>(shipmentRead))!;await Body(await admin.PostAsJsonAsync(write,new ShipmentCommandInput(s.Owner,Id(),"deliver",ready.OrderVersion,ready.Shipment!.Version,ready.InventoryFingerprint,"Synthetic delivery",true,null,null,null,DateTimeOffset.UtcNow)));
        var historical=await Body(await customer.GetAsync("/api/orders/v2/"+id));Assert.Equal("Fulfilled",Text(historical["summary"]!,"state"));Assert.Equal(prices,historical["lines"]!.ToJsonString());Assert.Equal(result with{Replayed=true},await Settle());
        var history=await Body(await customer.GetAsync("/api/payments/orders/"+id));Assert.Equal("verified",Text(Assert.Single(history["items"]!.AsArray())!,"state"));
    }
}
