using System.Data;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Market;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;

public sealed partial class OrderV2HttpSqlTests
{
    private Task<string> ProjectionBusinessFingerprint(Scenario s)=>Scope(async sp=>{
        var db=sp.GetRequiredService<MarketDbContext>();return JsonSerializer.Serialize(new{
            Request=await db.SourcingRequests.AsNoTracking().SingleAsync(r=>r.Id==s.Request),
            Task=await db.SourcingSupplyTasks.AsNoTracking().SingleAsync(t=>t.Id==s.Task),
            Offer=await db.SourcingOffers.AsNoTracking().SingleAsync(o=>o.Id==s.Offer),
            Acceptance=await db.SourcingOfferAcceptances.AsNoTracking().SingleAsync(a=>a.Id==s.Acceptance),
            RequestLines=await db.SourcingRequestLines.AsNoTracking().Where(l=>l.RequestId==s.Request).OrderBy(l=>l.ListingId).ToArrayAsync(),
            OfferLines=await db.Set<SourcingOfferLine>().AsNoTracking().Where(l=>l.OfferId==s.Offer).OrderBy(l=>l.LineId).ToArrayAsync(),
            TaskLines=await db.Set<SourcingSupplyTaskLine>().AsNoTracking().Where(l=>l.TaskId==s.Task).OrderBy(l=>l.OfferLineId).ToArrayAsync(),
            RequestEvents=await db.SourcingRequestEvents.AsNoTracking().Where(e=>e.RequestId==s.Request).OrderBy(e=>e.Id).ToArrayAsync(),
            OfferEvents=await db.SourcingOfferEvents.AsNoTracking().Where(e=>e.OfferId==s.Offer).OrderBy(e=>e.Id).ToArrayAsync(),
            SupplyEvents=await db.SourcingSupplyEvents.AsNoTracking().Where(e=>e.TaskId==s.Task).OrderBy(e=>e.Id).ToArrayAsync(),
            RequestCommands=await db.SourcingCommandReceipts.AsNoTracking().Where(c=>c.TargetId==s.Request).OrderBy(c=>c.Operation).ThenBy(c=>c.RequestId).ToArrayAsync(),
            OfferCommands=await db.SourcingOfferCommandReceipts.AsNoTracking().Where(c=>c.RequestId==s.Request).OrderBy(c=>c.Operation).ThenBy(c=>c.CommandId).ToArrayAsync(),
            SupplyCommands=await db.SourcingSupplyCommandReceipts.AsNoTracking().Where(c=>c.TaskId==s.Task).OrderBy(c=>c.Operation).ThenBy(c=>c.CommandId).ToArrayAsync()
        },Json);
    });
    private async Task<(Scenario Scenario,string Order)> ActualProjectionOrder()
    {
        var data=await Quote4Cart();var s=data.Scenario;var quote=await Order2Quote(s,data.Cart);var order=(await Body(await s.Customer.PostAsJsonAsync("/api/orders/v2",Order2Input(Text(quote,"quoteId"))),HttpStatusCode.Created))["order"]!;return(s,Text(order["summary"]!,"id"));
    }
    [Fact]public async Task ActualOrder2OutboxProjectsHistoricalLinkAndAcknowledgesOnceWithoutChangingBusinessState()
    {
        await using var policy=await Order2Policies();var actual=await ActualProjectionOrder();var s=actual.Scenario;using var customer=s.Customer;
        var marketBefore=await ProjectionBusinessFingerprint(s);var effectsBefore=await Order2Effects(s);
        var before=await Body(await customer.GetAsync($"/api/sourcing/requests/{s.Request}/orders"));Assert.Empty(before["items"]!.AsArray());
        var delivered=await fixture.Sql.Factory.Services.GetRequiredService<OrderProjectionRunner>().RunAsync(default);Assert.True(delivered.Delivered>=1);Assert.Equal(0,delivered.Failed);
        var links=await Order2Body(await customer.GetAsync($"/api/sourcing/requests/{s.Request}/orders"),kind:"sourcing-order-links",name:"actual-projected-link");var link=Assert.Single(links["items"]!.AsArray())!;Assert.Equal(actual.Order,Text(link,"orderId"));Assert.Equal(s.Acceptance,Text(link,"acceptanceId"));Assert.Equal(s.Task,Text(link,"taskId"));
        var original=await Scope(async sp=>{
            var sales=sp.GetRequiredService<SalesDbContext>();var market=sp.GetRequiredService<MarketDbContext>();var row=await sales.OrderOutbox.AsNoTracking().SingleAsync(e=>e.OrderId==actual.Order);Assert.NotNull(row.DeliveredAt);Assert.Null(row.NextAttemptAt);Assert.Equal(1,row.Attempts);Assert.Single(await market.SourcingOrderLinks.Where(l=>l.OrderId==actual.Order).ToArrayAsync());return row.PayloadJson;
        });
        var again=await fixture.Sql.Factory.Services.GetRequiredService<OrderProjectionRunner>().RunAsync(default);Assert.Equal(0,again.Delivered);Assert.Equal(0,again.Failed);Assert.Equal(marketBefore,await ProjectionBusinessFingerprint(s));Assert.Equal(effectsBefore,await Order2Effects(s));
        await Scope(async sp=>{var row=await sp.GetRequiredService<SalesDbContext>().OrderOutbox.AsNoTracking().SingleAsync(e=>e.OrderId==actual.Order);Assert.Equal(original,row.PayloadJson);Assert.Equal(1,row.Attempts);return true;});
        var stranger=await Customer();using var other=stranger.Client;await Body(await other.GetAsync($"/api/sourcing/requests/{s.Request}/orders"),HttpStatusCode.NotFound);
        using var anonymous=fixture.Sql.Factory.CreateClient(new(){HandleCookies=false});await Body(await anonymous.GetAsync($"/api/sourcing/requests/{s.Request}/orders"),HttpStatusCode.Unauthorized);
    }
    [Fact]public async Task LostSalesAcknowledgementReplaysCommittedMarketLinkWithoutDuplicateOrDeadlineChanges()
    {
        await using var policy=await Order2Policies();var actual=await ActualProjectionOrder();var s=actual.Scenario;using var customer=s.Customer;var marketBefore=await ProjectionBusinessFingerprint(s);var effectsBefore=await Order2Effects(s);
        await Scope(async sp=>{
            // The order id is a bound parameter; QUOTENAME creates its SQL
            // literal inside a fixed DDL template. The identifier is constant.
            await sp.GetRequiredService<SalesDbContext>().Database.ExecuteSqlInterpolatedAsync($"""
                DECLARE @orderId nvarchar(32)={actual.Order};
                DECLARE @ddl nvarchar(max)=N'ALTER TABLE [sales].[OrderOutbox] WITH NOCHECK ADD CONSTRAINT [CK_OrderProjection_Ack_QA] CHECK ([OrderId]<>'+QUOTENAME(@orderId,'''')+N' OR [DeliveredAt] IS NULL)';
                EXEC sys.sp_executesql @ddl;
                """);return true;
        });
        try{var result=await fixture.Sql.Factory.Services.GetRequiredService<OrderProjectionRunner>().RunAsync(default);Assert.True(result.Failed>=1);}
        finally{await Scope(async sp=>{await sp.GetRequiredService<SalesDbContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [sales].[OrderOutbox] DROP CONSTRAINT [CK_OrderProjection_Ack_QA]");return true;});}
        var failed=await Scope(async sp=>await sp.GetRequiredService<SalesDbContext>().OrderOutbox.AsNoTracking().SingleAsync(e=>e.OrderId==actual.Order));Assert.Null(failed.DeliveredAt);Assert.Equal(1,failed.Attempts);Assert.NotNull(failed.NextAttemptAt);
        var original=await Scope(async sp=>JsonSerializer.Serialize(await sp.GetRequiredService<MarketDbContext>().SourcingOrderLinks.AsNoTracking().SingleAsync(l=>l.OrderId==actual.Order),Json));
        await using var retry=new SqlFactory(fixture.Sql.Connection,fixture.Sql.Password,await Keys(),new FixedClock(failed.NextAttemptAt!.Value.AddTicks(1)));
        var resultAfter=await retry.Services.GetRequiredService<OrderProjectionRunner>().RunAsync(default);Assert.True(resultAfter.Delivered>=1);Assert.Equal(0,resultAfter.Failed);
        await Scope(async sp=>{var sales=sp.GetRequiredService<SalesDbContext>();var row=await sales.OrderOutbox.AsNoTracking().SingleAsync(e=>e.OrderId==actual.Order);Assert.NotNull(row.DeliveredAt);Assert.Null(row.NextAttemptAt);Assert.Equal(2,row.Attempts);Assert.Equal(failed.PayloadJson,row.PayloadJson);Assert.Equal(original,JsonSerializer.Serialize(await sp.GetRequiredService<MarketDbContext>().SourcingOrderLinks.AsNoTracking().SingleAsync(l=>l.OrderId==actual.Order),Json));return true;});
        Assert.Equal(marketBefore,await ProjectionBusinessFingerprint(s));Assert.Equal(effectsBefore,await Order2Effects(s));
    }
    [Fact]public async Task MalformedOldestOutboxPayloadBacksOffWhileFollowingActualOrderStillProjects()
    {
        await using var policy=await Order2Policies();var poisoned=await ActualProjectionOrder();using var badCustomer=poisoned.Scenario.Customer;var valid=await ActualProjectionOrder();using var goodCustomer=valid.Scenario.Customer;
        var original=await Scope(async sp=>await sp.GetRequiredService<SalesDbContext>().OrderOutbox.AsNoTracking().SingleAsync(e=>e.OrderId==poisoned.Order));
        await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();var row=await db.OrderOutbox.SingleAsync(e=>e.Id==original.Id);row.PayloadJson="{}";await db.SaveChangesAsync();return true;});
        SalesOrderOutboxEvent? failed=null;
        try{
            var result=await fixture.Sql.Factory.Services.GetRequiredService<OrderProjectionRunner>().RunAsync(default);Assert.True(result.Delivered>=1);Assert.True(result.Failed>=1);
            failed=await Scope(async sp=>await sp.GetRequiredService<SalesDbContext>().OrderOutbox.AsNoTracking().SingleAsync(e=>e.Id==original.Id));Assert.Null(failed.DeliveredAt);Assert.Equal(1,failed.Attempts);Assert.NotNull(failed.LastAttemptAt);Assert.Equal(failed.LastAttemptAt!.Value.AddSeconds(5),failed.NextAttemptAt);
            var observed=Assert.IsType<SalesOrderOutboxEvent>(failed);
            await Scope(async sp=>{var sales=sp.GetRequiredService<SalesDbContext>();var market=sp.GetRequiredService<MarketDbContext>();Assert.NotNull((await sales.OrderOutbox.AsNoTracking().SingleAsync(e=>e.OrderId==valid.Order)).DeliveredAt);Assert.Single(await market.SourcingOrderLinks.Where(l=>l.OrderId==valid.Order).ToArrayAsync());Assert.Empty(await market.SourcingOrderLinks.Where(l=>l.OrderId==poisoned.Order).ToArrayAsync());
                var beforeDue=new OrderOutboxService(sales,new FixedClock(observed.LastAttemptAt!.Value));Assert.DoesNotContain(original.Id,await beforeDue.PendingEventIdsAsync(100,default));var atDue=new OrderOutboxService(sales,new FixedClock(observed.NextAttemptAt!.Value));Assert.Contains(original.Id,await atDue.PendingEventIdsAsync(100,default));return true;
            });
        }
        finally{await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();var row=await db.OrderOutbox.SingleAsync(e=>e.Id==original.Id);row.PayloadJson=original.PayloadJson;await db.SaveChangesAsync();return true;});}
        // Restore only this injected QA fault, retain its retry history, and
        // prove the unchanged real event is deliverable when its delay ends.
        await using var retry=new SqlFactory(fixture.Sql.Connection,fixture.Sql.Password,await Keys(),new FixedClock(failed!.NextAttemptAt!.Value.AddTicks(1)));
        var recovered=await retry.Services.GetRequiredService<OrderProjectionRunner>().RunAsync(default);Assert.True(recovered.Delivered>=1);Assert.Equal(0,recovered.Failed);
        await Scope(async sp=>{var row=await sp.GetRequiredService<SalesDbContext>().OrderOutbox.AsNoTracking().SingleAsync(e=>e.Id==original.Id);Assert.NotNull(row.DeliveredAt);Assert.Equal(2,row.Attempts);Assert.Equal(original.PayloadJson,row.PayloadJson);return true;});
    }
}
