using System.Data;
using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Inventory;
using Shop.Modules.Market;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;

// These are actual concurrent composition-root HTTP requests, rather than
// sequential state changes. An external transaction briefly owns the exact
// application lock used by the product. SQL must report BOTH requests blocked
// behind that transaction before it is released; neither winner is assumed.
public sealed partial class SourcingConversionHttpSqlTests
{
    private static string RaceHash(string value)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    private static string RaceCartResource(string owner)=>"sayman:sales:cart:"+RaceHash("member:"+owner.ToUpperInvariant());
    private static string RaceRequestResource(string request)=>"sayman:market:sourcing:"+RaceHash("request:"+request);
    private static string RaceAcceptanceResource(string acceptance)=>"sayman:inventory:sourcing-allocation-acceptance:"+RaceHash(acceptance);

    private sealed class SqlRaceBarrier(SqlConnection connection,SqlTransaction transaction):IAsyncDisposable
    {
        private bool released;
        public static async Task<SqlRaceBarrier> Acquire(string connectionString,string resource)
        {
            Assert.StartsWith("SaymanTest_",new SqlConnectionStringBuilder(connectionString).InitialCatalog);
            var connection=new SqlConnection(connectionString);await connection.OpenAsync();
            var transaction=(SqlTransaction)await connection.BeginTransactionAsync(IsolationLevel.Serializable);
            try{
                await using var command=new SqlCommand("DECLARE @r int; EXEC @r=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=1000; SELECT @r;",connection,transaction){CommandTimeout=3};
                command.Parameters.Add(new SqlParameter("@resource",SqlDbType.NVarChar,255){Value=resource});
                Assert.True(Convert.ToInt32(await command.ExecuteScalarAsync())>=0,"The test barrier must acquire the product's exact application lock.");
                return new(connection,transaction);
            }catch{await transaction.DisposeAsync();await connection.DisposeAsync();throw;}
        }
        public async Task<bool> ObserveTwoWaiters(CancellationToken ct)
        {
            var elapsed=Stopwatch.StartNew();
            while(elapsed.Elapsed<TimeSpan.FromSeconds(6)){
                // SQL can report a later exclusive waiter behind the first
                // queued waiter, so follow the bounded blocking chain too.
                const string sql="WITH waiting AS (SELECT session_id FROM sys.dm_exec_requests WHERE blocking_session_id=@@SPID AND database_id=DB_ID() AND wait_type LIKE 'LCK_M_%' UNION ALL SELECT r.session_id FROM sys.dm_exec_requests r JOIN waiting w ON r.blocking_session_id=w.session_id WHERE r.database_id=DB_ID() AND r.wait_type LIKE 'LCK_M_%') SELECT COUNT(DISTINCT session_id) FROM waiting OPTION(MAXRECURSION 8);";
                await using var command=new SqlCommand(sql,connection,transaction){CommandTimeout=2};
                if(Convert.ToInt32(await command.ExecuteScalarAsync(ct))>=2)return true;
                await Task.Delay(25,ct); // Poll an observed SQL condition, never a timing barrier.
            }
            return false;
        }
        public async Task Release(){if(!released){await transaction.CommitAsync();released=true;}}
        public async ValueTask DisposeAsync(){if(!released)await transaction.RollbackAsync();await transaction.DisposeAsync();await connection.DisposeAsync();}
    }

    private async Task<(HttpResponseMessage First,HttpResponseMessage Second)> ContendedHttp(
        string resource,Func<CancellationToken,Task<HttpResponseMessage>> first,Func<CancellationToken,Task<HttpResponseMessage>> second)
    {
        using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(30));
        await using var barrier=await SqlRaceBarrier.Acquire(fixture.Sql.Connection,resource);
        var a=first(timeout.Token);var b=second(timeout.Token);bool observed;
        try{observed=await barrier.ObserveTwoWaiters(timeout.Token);}
        finally{await barrier.Release();}
        var results=await Task.WhenAll(a,b).WaitAsync(TimeSpan.FromSeconds(25));
        if(!observed){foreach(var response in results)response.Dispose();Assert.Fail("SQL did not prove both competing requests were waiting before release.");}
        return(results[0],results[1]);
    }
    private async Task<JsonNode> RaceOrdinary(Scenario s,int quantity=1)
    {
        var cart=await Body(await s.Customer.GetAsync("/api/cart/en/v2"));
        return await Body(await s.Customer.PutAsJsonAsync("/api/cart/en/v2",new CartV2Input([new(s.Variant,quantity)],cart["version"]?.GetValue<string>())));
    }
    private Task AssertRaceCounts(Scenario s,int conversions,int offers,int convertedEvents)=>Scope(async sp=>{
        var sales=sp.GetRequiredService<SalesDbContext>();var market=sp.GetRequiredService<MarketDbContext>();
        Assert.Equal(conversions,await sales.SourcingConversions.CountAsync(c=>c.AcceptanceId==s.Acceptance));
        Assert.Equal(conversions,await sales.CartOfferCommandReceipts.CountAsync(c=>c.RequestId==s.Request&&c.Operation=="convert"));
        Assert.Equal(offers,await sales.CartOfferLines.CountAsync(c=>c.AcceptanceId==s.Acceptance));
        Assert.Equal(convertedEvents,await market.SourcingSupplyEvents.CountAsync(e=>e.TaskId==s.Task&&e.ReasonCode=="cart_converted"));
        Assert.Equal(0,await sales.Orders.CountAsync());Assert.Equal(0,await sales.OrderSettings.CountAsync());
        Assert.Equal(0,await sp.GetRequiredService<InventoryDbContext>().Reservations.CountAsync());return true;
    });

    [Fact]public async Task ConversionAndOwnerMergeContendOnActualCartWithoutLosingEitherPurchaseLane()
    {
        var s=await Create(4);using var customer=s.Customer;await RaceOrdinary(s);
        using var guest=fixture.Sql.Factory.CreateClient(new(){HandleCookies=false});guest.DefaultRequestHeaders.Add("Origin","http://127.0.0.1:3000");
        using(var response=await guest.PutAsJsonAsync("/api/cart/en/v2",new CartV2Input([new(s.Variant,1)],null))){
            Assert.Equal(HttpStatusCode.OK,response.StatusCode);var cookie=Assert.Single(response.Headers.GetValues("Set-Cookie"));
            customer.DefaultRequestHeaders.Add("Cookie",cookie.Split(';',2)[0]);
        }
        var input=ConvertInput(await Allocate(s));var before=await StockFingerprint(s);
        var pair=await ContendedHttp(RaceCartResource(s.Owner),ct=>customer.PostAsJsonAsync(Offer(s)+"/convert",input,ct),ct=>customer.PostAsync("/api/cart/en/v2/merge",null,ct));
        var merge=await Body(pair.Second);Assert.Equal(2,merge["ordinaryLines"]![0]!["quantity"]!.GetValue<int>());
        Assert.Contains(pair.First.StatusCode,new[]{HttpStatusCode.OK,HttpStatusCode.Conflict});
        var converted=pair.First.StatusCode==HttpStatusCode.OK;
        var result=await Body(pair.First,converted?HttpStatusCode.OK:HttpStatusCode.Conflict);
        if(!converted){
            Assert.Equal("cart_version_conflict",Text(result,"title"));await AssertRaceCounts(s,0,0,0);
            var fresh=ConvertInput(await Body(await customer.GetAsync(Offer(s)+"/purchase")));
            await Body(await customer.PostAsJsonAsync(Offer(s)+"/convert",fresh));
        }
        var cart=await Body(await customer.GetAsync("/api/cart/en/v2"));
        Assert.Equal(2,cart["ordinaryLines"]![0]!["quantity"]!.GetValue<int>());Assert.Single(cart["ordinaryLines"]!.AsArray());
        Assert.Single(cart["offerLines"]!.AsArray());Assert.Equal(2,cart["offerLines"]![0]!["quantity"]!.GetValue<int>());
        Assert.Equal("9007199254740993",Text(cart["offerLines"]![0]!,"unitPriceRial"));Assert.Equal("246",Text(cart,"ordinarySubtotalRial"));
        Assert.False(cart["canCheckout"]!.GetValue<bool>());Assert.False(cart["canPay"]!.GetValue<bool>());
        Assert.Equal(before,await StockFingerprint(s));await AssertRaceCounts(s,1,1,1);
    }

    [Fact]public async Task ConversionAndStaffCloseSerializeOnRequestAndStaleLoserCannotPublishAnotherEffect()
    {
        var s=await Create(3);using var customer=s.Customer;await RaceOrdinary(s);var input=ConvertInput(await Allocate(s));
        using var staff=await fixture.ReuseStaff("SalesManager");
        var close=new SourcingSupplyCloseInput(Id(),input.RequestVersion,input.TaskVersion,"qa_race_close","بستن همزمان مصنوعی","Synthetic concurrent close");
        var closeRoute=$"/api/admin/sourcing/requests/{s.Request}/supply/{s.Task}/cancel";
        var pair=await ContendedHttp(RaceRequestResource(s.Request),ct=>customer.PostAsJsonAsync(Offer(s)+"/convert",input,ct),ct=>staff.PostAsJsonAsync(closeRoute,close,ct));
        Assert.Contains(pair.First.StatusCode,new[]{HttpStatusCode.OK,HttpStatusCode.Conflict});
        Assert.Contains(pair.Second.StatusCode,new[]{HttpStatusCode.OK,HttpStatusCode.Conflict});
        var converted=pair.First.StatusCode==HttpStatusCode.OK;
        Assert.NotEqual(converted,pair.Second.StatusCode==HttpStatusCode.OK);
        var conversion=await Body(pair.First,converted?HttpStatusCode.OK:HttpStatusCode.Conflict);
        var closure=await Body(pair.Second,converted?HttpStatusCode.Conflict:HttpStatusCode.OK);
        Assert.Equal("version_conflict",Text(converted?closure:conversion,"title"));
        if(converted){
            var current=await Body(await staff.GetAsync(SupplyRoute(s,true)));
            var fresh=close with{RequestId=Id(),RequestVersion=Text(current,"requestVersion"),TaskVersion=Text(current["task"]!,"version")};
            await Body(await staff.PostAsJsonAsync(closeRoute,fresh));
            var replay=await Body(await customer.PostAsJsonAsync(Offer(s)+"/convert",input));Assert.True(replay["replayed"]!.GetValue<bool>());
            Assert.Equal(Text(conversion,"conversionId"),Text(replay,"conversionId"));
        }
        var cart=await Body(await customer.GetAsync("/api/cart/en/v2"));Assert.Single(cart["ordinaryLines"]!.AsArray());
        if(converted)Assert.Equal("agreement_revoked",Text(Assert.Single(cart["offerLines"]!.AsArray())!,"issue"));else Assert.Empty(cart["offerLines"]!.AsArray());
        await Scope(async sp=>{
            var inventory=sp.GetRequiredService<InventoryDbContext>();var market=sp.GetRequiredService<MarketDbContext>();var sales=sp.GetRequiredService<SalesDbContext>();
            var stock=await inventory.Stock.SingleAsync(x=>x.VariantId==s.Variant);Assert.Equal(3,stock.OnHand);Assert.Equal(0,stock.Reserved);Assert.Equal(0,stock.SourcingReserved);
            var task=await market.SourcingSupplyTasks.SingleAsync(t=>t.Id==s.Task);Assert.Equal("Cancelled",task.State);Assert.False(task.IsOpen);
            Assert.Equal("Revoked",(await sales.SourcingPriceAgreements.SingleAsync(a=>a.Id==s.Acceptance)).State);
            Assert.Equal(1,await market.SourcingSupplyCommandReceipts.CountAsync(c=>c.TaskId==s.Task&&c.Operation=="cancel"));return true;
        });
        await AssertRaceCounts(s,converted?1:0,converted?1:0,converted?1:0);
    }

    [Fact]public async Task ConversionAndActualExpiryWriterContendAtDeadlineWithoutCreatingCartOrFinancialEffects()
    {
        var s=await Create(3);using var customer=s.Customer;var original=await RaceOrdinary(s);var candidate=await Allocate(s);var input=ConvertInput(candidate);
        var agreement=await Body(await customer.GetAsync(AgreementRoute(s)));
        var deadline=candidate["allocation"]!["expiresAt"]!.GetValue<DateTimeOffset>();
        // Both genuine product paths see the same explicit test clock at the
        // retained deadline. This tests the actual batch writer and coordinator;
        // it does not pretend ten minutes of wall-clock time have elapsed.
        await using var shifted=new SqlFactory(fixture.Sql.Connection,fixture.Sql.Password,await Keys(),new FixedClock(deadline));
        using var late=CopyClient(shifted,customer);
        await using var expiryScope=shifted.Services.CreateAsyncScope();
        var expiry=expiryScope.ServiceProvider.GetRequiredService<IInventorySourcingAllocations>();
        using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(30));
        await using var barrier=await SqlRaceBarrier.Acquire(fixture.Sql.Connection,RaceAcceptanceResource(s.Acceptance));
        var conversion=late.PostAsJsonAsync(Offer(s)+"/convert",input,timeout.Token);
        var expiration=expiry.ExpireBatchAsync(100,timeout.Token);bool observed;
        try{observed=await barrier.ObserveTwoWaiters(timeout.Token);}
        finally{await barrier.Release();}
        using var response=await conversion.WaitAsync(TimeSpan.FromSeconds(25));
        var expired=await expiration.WaitAsync(TimeSpan.FromSeconds(25));
        Assert.True(observed,"SQL must show the actual coordinator and expiry writer contending on this acceptance.");Assert.True(expired>=1);
        var failure=await Body(response,HttpStatusCode.Conflict);
        Assert.Contains(Text(failure,"title"),new[]{"version_conflict","sourcing_allocation_deadline_conflict"});
        Assert.Equal(agreement.ToJsonString(),(await Body(await customer.GetAsync(AgreementRoute(s)))).ToJsonString());
        var cart=await Body(await customer.GetAsync("/api/cart/en/v2"));Assert.Equal(Text(original,"version"),Text(cart,"version"));
        Assert.Single(cart["ordinaryLines"]!.AsArray());Assert.Empty(cart["offerLines"]!.AsArray());
        await Scope(async sp=>{
            var inventory=sp.GetRequiredService<InventoryDbContext>();var stock=await inventory.Stock.SingleAsync(x=>x.VariantId==s.Variant);
            Assert.Equal(3,stock.OnHand);Assert.Equal(0,stock.Reserved);Assert.Equal(0,stock.SourcingReserved);
            var allocation=await inventory.SourcingAllocations.SingleAsync(a=>a.AcceptanceId==s.Acceptance);Assert.Equal("Expired",allocation.State);Assert.False(allocation.IsActive);Assert.Equal(deadline,allocation.ExpiresAt);
            Assert.Equal(1,await inventory.SourcingAllocationEvents.CountAsync(e=>e.AllocationId==allocation.Id&&e.State=="Expired"));
            return true;
        });
        await AssertRaceCounts(s,0,0,0);
    }
}
