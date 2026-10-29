using System.Net;
using System.Net.Http.Json;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;
namespace Shop.SqlTests;
public sealed partial class CashOrderPaymentSqlTests
{
    [Fact]public async Task FailedHistoricalLinkAfterAllocateRollsBackOrderReservationEventsAndRetryUsesSameProof()
    {
        var s=await Create();using var customer=s.Client;var before=await Read(s);var proof=Proof(s);
        await Scope(async sp=>{await sp.GetRequiredService<SalesDbContext>().Database.ExecuteSqlRawAsync("ALTER TABLE sales.OrderCashPayments WITH NOCHECK ADD CONSTRAINT CK_QA_CashLinkRollback CHECK (1=0)");return true;});
        try{await Assert.ThrowsAsync<DbUpdateException>(()=>Confirm(proof));Assert.Equal(before,await Read(s));}
        finally{await Scope(async sp=>{await sp.GetRequiredService<SalesDbContext>().Database.ExecuteSqlRawAsync("ALTER TABLE sales.OrderCashPayments DROP CONSTRAINT CK_QA_CashLinkRollback");return true;});}
        Assert.Equal("applied",(await Confirm(proof)).Disposition);Assert.Equal(1,(await Read(s)).Links);
    }
    [Fact]public async Task ChangedOriginalSnapshotRequiresReviewAndPrivateReceiptRemainsHistoricalEvenAfterCurrentSnapshotCorruption()
    {
        var s=await Create();using var customer=s.Client;var before=await Read(s);var wrong=Proof(s) with{SnapshotFingerprint=new string('D',64)};var rejected=await Confirm(wrong);Assert.Equal("requires_review",rejected.Disposition);Assert.Equal("payment_original_snapshot_changed",rejected.Reason);Assert.Equal(before,await Read(s));
        var proof=Proof(s);var first=await Confirm(proof);
        await Scope(async sp=>{await sp.GetRequiredService<SalesDbContext>().Database.ExecuteSqlInterpolatedAsync($"UPDATE sales.Orders SET QuoteSnapshotJson=N'{{}}' WHERE Id={s.Order}");return true;});
        Assert.Equal(first with{Replayed=true},await Confirm(proof));
        await Scope(async sp=>{await sp.GetRequiredService<SalesDbContext>().Database.ExecuteSqlInterpolatedAsync($"UPDATE sales.OrderCashPayments SET ResponseJson=N'{{}}' WHERE OrderId={s.Order}");return true;});
        Assert.Equal("payment_order_unavailable",(await Assert.ThrowsAsync<BusinessException>(()=>Confirm(proof))).Code);
    }
    [Fact]public async Task ConcurrentCustomerCancelAndVerificationCannotLeavePaidReleasedOrCancelledAllocated()
    {
        var s=await Create();using var customer=s.Client;var before=await Read(s);var proof=Proof(s);var verify=Confirm(proof);var cancel=customer.PostAsJsonAsync("/api/orders/"+s.Order+"/cancel",new{Version=before.OrderVersion});await Task.WhenAll(verify,cancel);using var cancelled=await cancel;var after=await Read(s);
        if((await verify).Disposition=="applied"){Assert.Equal(HttpStatusCode.Conflict,cancelled.StatusCode);Assert.Equal("Paid",after.State);Assert.Equal("Allocated",after.ReservationState);Assert.Equal(1,after.Reserved);Assert.Equal(1,after.Links);}
        else{Assert.Equal(HttpStatusCode.OK,cancelled.StatusCode);Assert.Equal("Cancelled",after.State);Assert.Equal("Released",after.ReservationState);Assert.Equal(0,after.Reserved);Assert.Equal(0,after.Links);}Assert.Equal(before.OnHand,after.OnHand);Assert.Equal(before.Movements,after.Movements);
    }
    [Theory][InlineData(0)][InlineData(1)][InlineData(2)][InlineData(3)]
    public async Task EverySaveChangesOverloadRejectsMutationOfTheVerifiedPaymentLink(int overload)
    {
        var s=await Create();using var customer=s.Client;await Confirm(Proof(s));await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();var row=await db.OrderCashPayments.SingleAsync(p=>p.OrderId==s.Order);row.AmountRial++;
            if(overload==0)Assert.Throws<InvalidOperationException>(()=>db.SaveChanges());else if(overload==1)Assert.Throws<InvalidOperationException>(()=>db.SaveChanges(false));else if(overload==2)await Assert.ThrowsAsync<InvalidOperationException>(()=>db.SaveChangesAsync());else await Assert.ThrowsAsync<InvalidOperationException>(()=>db.SaveChangesAsync(false));return true;});
    }
    [Fact]public async Task ProductionCannotReadOrReplayADevelopmentPaymentLinkAndItsHistoryBlocksDowngrade()
    {
        var s=await Create();using var customer=s.Client;await Scope(async sp=>{await sp.GetRequiredService<SalesDbContext>().Database.ExecuteSqlInterpolatedAsync($"UPDATE sales.Orders SET ContainsDemo=1 WHERE Id={s.Order}");return true;});var proof=Proof(s);Assert.Equal("applied",(await Confirm(proof)).Disposition);Assert.Equal("not_found",(await Assert.ThrowsAsync<BusinessException>(()=>Confirm(proof,allowDemo:false))).Code);
        await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();var source=(await db.Database.GetAppliedMigrationsAsync()).ToArray();
            // Exercise the cash-link guard at its own migration. Later empty
            // additive tables may lawfully roll back in earlier transactions.
            await db.GetService<IMigrator>().MigrateAsync("20261025231229_CashOrderPaymentLinks");
            var applied=(await db.Database.GetAppliedMigrationsAsync()).ToArray();var error=await Assert.ThrowsAsync<SqlException>(()=>db.GetService<IMigrator>().MigrateAsync("20261025223205_OrderShipments"));Assert.Equal(51000,error.Number);Assert.Equal(applied,await db.Database.GetAppliedMigrationsAsync());Assert.Equal(1,await db.OrderCashPayments.CountAsync(p=>p.OrderId==s.Order));
            await db.Database.MigrateAsync();Assert.Equal(source,await db.Database.GetAppliedMigrationsAsync());Assert.False(db.Database.HasPendingModelChanges());Assert.Equal(1,await db.OrderCashPayments.CountAsync(p=>p.OrderId==s.Order));return true;});
    }
}
public sealed class CashPaymentEmptyMigrationSqlTests(SqlFixture fixture):IClassFixture<SqlFixture>
{
    [Fact]public async Task EmptyPaymentLinkMigrationCanRollBackAndReapplyWithoutPendingModelChanges()
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<SalesDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);var migrator=db.GetService<IMigrator>();var applied=(await db.Database.GetAppliedMigrationsAsync()).ToArray();var current=applied.Last();Assert.Contains(applied,id=>id.EndsWith("_CashOrderPaymentLinks",StringComparison.Ordinal));Assert.Empty(await db.CreditCheckoutQuotes.ToArrayAsync());await migrator.MigrateAsync("20261025223205_OrderShipments");await migrator.MigrateAsync(current);Assert.False(db.Database.HasPendingModelChanges());Assert.Equal(applied,(await db.Database.GetAppliedMigrationsAsync()).ToArray());Assert.Empty(await db.OrderCashPayments.ToArrayAsync());Assert.Empty(await db.CreditCheckoutQuotes.ToArrayAsync());
    }
}
