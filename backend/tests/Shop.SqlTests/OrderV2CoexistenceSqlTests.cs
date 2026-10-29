using System.Data;
using System.Net;
using System.Net.Http.Json;
using System.Diagnostics;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Inventory;
using Shop.Modules.Sales;
using Xunit;

namespace Shop.SqlTests;

public sealed partial class OrderV2HttpSqlTests
{
    [Theory][InlineData(1)][InlineData(2)]
    public async Task OrdinaryStockLostAfterQuoteReturnsReviewConflictBeforeAnyOrderWrite(int contract)
    {
        await using var policy=await Order2Policies();var data=await Quote4Cart(3,true);var scenario=data.Scenario;using var customer=scenario.Customer;System.Text.Json.Nodes.JsonNode quote;
        if(contract==1){
            using(var remove=new HttpRequestMessage(HttpMethod.Delete,"/api/cart/en/v2/offers/"+scenario.Acceptance){Content=JsonContent.Create(new CartOfferRemoveInput(Id(),Text(data.Cart,"version")))})await Body(await customer.SendAsync(remove));
            var cart=await Body(await customer.GetAsync("/api/cart/en"));quote=await Body(await customer.PostAsJsonAsync("/api/cart/en/quote",new CheckoutQuoteInput(Text(cart,"version"),"online",null,Id())));
        }else quote=await Order2Quote(scenario,data.Cart);
        var version=await Scope(async sp=>Convert.ToBase64String((await sp.GetRequiredService<InventoryDbContext>().Stock.AsNoTracking().SingleAsync(s=>s.VariantId==scenario.Variant)).Version));
        using(var inventory=await fixture.ReuseStaff("InventoryManager"))await Body(await inventory.PostAsJsonAsync($"/api/admin/inventory/{scenario.Variant}/adjust",new StockAdjustment(-1,"Synthetic QA physical correction after quote",Id(),version)));
        var before=await Order2Effects(scenario);var route=contract==1?"/api/orders":"/api/orders/v2";
        Assert.Equal("cart_review_conflict",Text(await Body(await customer.PostAsJsonAsync(route,Order2Input(Text(quote,"quoteId"))),HttpStatusCode.Conflict),"title"));Assert.Equal(before,await Order2Effects(scenario));
        await Scope(async sp=>{Assert.False(await sp.GetRequiredService<SalesDbContext>().Orders.AnyAsync(o=>o.OwnerId==scenario.Owner));Assert.False(await sp.GetRequiredService<InventoryDbContext>().Reservations.AnyAsync(r=>r.OwnerId==scenario.Owner));return true;});
    }
    [Fact]public async Task LegacyOrderAndOrder2ObserveStockContentionWithoutSharedToUpdateConversionDeadlock()
    {
        await using var policy=await Order2Policies();var data=await Quote4Cart(3,false);var accepted=data.Scenario;using var acceptedCustomer=accepted.Customer;
        var acceptedQuote=await Order2Quote(accepted,data.Cart);var ordinary=await Customer();using var ordinaryCustomer=ordinary.Client;
        var cart=await Body(await ordinaryCustomer.GetAsync("/api/cart/en"));cart=await Body(await ordinaryCustomer.PutAsJsonAsync("/api/cart/en",new CartInput([new(accepted.Variant,1)],cart["version"]?.GetValue<string>())));
        var ordinaryQuote=await Body(await ordinaryCustomer.PostAsJsonAsync("/api/cart/en/quote",new CheckoutQuoteInput(Text(cart,"version"),"online",null,Id())));
        var database=new SqlConnectionStringBuilder(fixture.Sql.Connection).InitialCatalog;Assert.StartsWith("SaymanTest_",database);
        await using var blocker=new SqlConnection(fixture.Sql.Connection);await blocker.OpenAsync();
        await using var observer=new SqlConnection(fixture.Sql.Connection);await observer.OpenAsync();
        await using var transaction=await blocker.BeginTransactionAsync(IsolationLevel.ReadCommitted);
        await using(var lockStock=blocker.CreateCommand()){
            lockStock.Transaction=(SqlTransaction)transaction;lockStock.CommandText="SELECT [VariantId] FROM [inventory].[Stock] WITH (UPDLOCK,HOLDLOCK) WHERE [VariantId]=@variant";lockStock.Parameters.Add(new SqlParameter("@variant",SqlDbType.NVarChar,64){Value=accepted.Variant});Assert.Equal(accepted.Variant,(string)(await lockStock.ExecuteScalarAsync())!);
        }
        int spid;await using(var identity=blocker.CreateCommand()){identity.Transaction=(SqlTransaction)transaction;identity.CommandText="SELECT @@SPID";spid=Convert.ToInt32(await identity.ExecuteScalarAsync());}
        using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(35));
        Task<HttpResponseMessage>? acceptedCommand=null;Task<HttpResponseMessage>? ordinaryCommand=null;var released=false;
        try{
            // Queue Order2 U first, then legacy U. If legacy validation held S,
            // releasing the blocker would grant Order2 U, whose X waits for S,
            // while legacy U waits for Order2: a real conversion deadlock.
            acceptedCommand=acceptedCustomer.PostAsJsonAsync("/api/orders/v2",Order2Input(Text(acceptedQuote,"quoteId")),timeout.Token);
            await ObserveStockWaiters(observer,spid,1,timeout.Token);
            ordinaryCommand=ordinaryCustomer.PostAsJsonAsync("/api/orders",Order2Input(Text(ordinaryQuote,"quoteId")),timeout.Token);
            await ObserveStockWaiters(observer,spid,2,timeout.Token);
            Assert.False(acceptedCommand.IsCompleted);Assert.False(ordinaryCommand.IsCompleted);
            await transaction.CommitAsync(timeout.Token);released=true;
            await Body(await acceptedCommand,HttpStatusCode.Created);await Body(await ordinaryCommand,HttpStatusCode.Created);
        }
        finally{
            if(!released)await transaction.RollbackAsync(CancellationToken.None);
            timeout.Cancel();
            if(acceptedCommand is not null)try{using var response=await acceptedCommand;}catch(OperationCanceledException){}catch(HttpRequestException){}
            if(ordinaryCommand is not null)try{using var response=await ordinaryCommand;}catch(OperationCanceledException){}catch(HttpRequestException){}
        }
        await Scope(async sp=>{
            var sales=sp.GetRequiredService<SalesDbContext>();var inventory=sp.GetRequiredService<InventoryDbContext>();
            var stock=await inventory.Stock.AsNoTracking().SingleAsync(s=>s.VariantId==accepted.Variant);Assert.Equal(3,stock.OnHand);Assert.Equal(3,stock.Reserved);Assert.Equal(0,stock.SourcingReserved);
            Assert.Single(await sales.Orders.Where(o=>o.OwnerId==accepted.Owner&&o.SnapshotVersion==2).ToArrayAsync());Assert.Single(await sales.Orders.Where(o=>o.OwnerId==ordinary.Owner&&o.SnapshotVersion==null).ToArrayAsync());return true;
        });
    }
    private static async Task ObserveStockWaiters(SqlConnection observer,int blocker,int required,CancellationToken ct)
    {
        var elapsed=Stopwatch.StartNew();var seen=0;
        while(elapsed.Elapsed<TimeSpan.FromSeconds(15)){
            await using var command=observer.CreateCommand();command.CommandTimeout=3;command.CommandText="""
                WITH blocked AS (
                    SELECT session_id,0 AS depth FROM sys.dm_exec_requests
                    WHERE blocking_session_id=@blocker AND database_id=DB_ID()
                    UNION ALL
                    SELECT r.session_id,b.depth+1 FROM sys.dm_exec_requests r
                    INNER JOIN blocked b ON r.blocking_session_id=b.session_id
                    WHERE r.database_id=DB_ID() AND b.depth<12
                )
                SELECT COUNT(DISTINCT b.session_id) FROM blocked b
                INNER JOIN sys.dm_exec_requests r ON r.session_id=b.session_id
                CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) sqltext
                WHERE r.wait_type LIKE 'LCK_M%' AND CHARINDEX('[inventory].[Stock]',sqltext.text)>0
                    AND CHARINDEX('UPDLOCK',sqltext.text)>0
                OPTION(MAXRECURSION 12)
                """;command.Parameters.Add(new SqlParameter("@blocker",SqlDbType.Int){Value=blocker});seen=Convert.ToInt32(await command.ExecuteScalarAsync(ct));
            if(seen>=required)return;await Task.Delay(20,ct);
        }
        Assert.Fail($"Expected {required} real Stock U waiters in the fixture database; observed {seen}.");
    }
}
