using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Payments;
using Xunit;
namespace Shop.SqlTests;
public sealed class CashPaymentLedgerSqlTests(SqlFixture fixture):IClassFixture<SqlFixture>
{
    private static string Id()=>Guid.NewGuid().ToString("N");
    private static CashPaymentAttempt Attempt(){var now=DateTimeOffset.UtcNow;return new(){Id=Id(),RequestId=Id(),OwnerId="synthetic-ledger-only",PayloadHash=new string('A',64),OrderId=Id(),MethodId="online",ProviderKey="synthetic",AccountKey="qa",AmountRial=9007199254740993,SnapshotFingerprint=new string('B',64),OriginalOrderVersion="AAAAAAAAAAE=",OrderExpiresAt=now.AddHours(1),ContainsDemo=true,CreatedAt=now,ChangedAt=now};}
    [Theory][InlineData(0)][InlineData(1)][InlineData(2)][InlineData(3)]
    public async Task AttemptMoneySnapshotAndEvidenceCannotBeEditedThroughAnySaveChangesOverload(int overload)
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<PaymentsDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);var row=Attempt();db.CashAttempts.Add(row);await db.SaveChangesAsync();Assert.Equal(9007199254740993,(await db.CashAttempts.AsNoTracking().SingleAsync(x=>x.Id==row.Id)).AmountRial);row.AmountRial++;
        if(overload==0)Assert.Throws<InvalidOperationException>(()=>db.SaveChanges());else if(overload==1)Assert.Throws<InvalidOperationException>(()=>db.SaveChanges(false));else if(overload==2)await Assert.ThrowsAsync<InvalidOperationException>(()=>db.SaveChangesAsync());else await Assert.ThrowsAsync<InvalidOperationException>(()=>db.SaveChangesAsync(false));
    }
    [Fact]public async Task EstablishedAuthorityAndAppendOnlyEventsCannotBeReplacedOrDeleted()
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<PaymentsDbContext>();var row=Attempt();row.AuthorityHash=new string('C',64);row.ProtectedAuthority=[1,2,3];row.RedirectUri="https://gateway.example.test/pay";row.State="pending";db.CashAttempts.Add(row);db.CashEvents.Add(new(){AttemptId=row.Id,At=row.CreatedAt,State="pending",Reason="synthetic_ledger_fixture"});await db.SaveChangesAsync();var eventRow=await db.CashEvents.SingleAsync(e=>e.AttemptId==row.Id);eventRow.Reason="changed";await Assert.ThrowsAsync<InvalidOperationException>(()=>db.SaveChangesAsync());db.ChangeTracker.Clear();row=await db.CashAttempts.SingleAsync(x=>x.Id==row.Id);row.ProtectedAuthority=[4,5];await Assert.ThrowsAsync<InvalidOperationException>(()=>db.SaveChangesAsync());
    }
    [Fact]public async Task RecordedAttemptHistoryPreventsDowngradeBeforeAnyDdl()
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<PaymentsDbContext>();var row=Attempt();db.CashAttempts.Add(row);await db.SaveChangesAsync();var applied=(await db.Database.GetAppliedMigrationsAsync()).ToArray();var previous=applied.Reverse().Skip(1).First();var error=await Assert.ThrowsAsync<SqlException>(()=>db.GetService<IMigrator>().MigrateAsync(previous));Assert.Equal(51000,error.Number);Assert.Equal(applied,await db.Database.GetAppliedMigrationsAsync());Assert.True(await db.CashAttempts.AnyAsync(x=>x.Id==row.Id));Assert.False(db.Database.HasPendingModelChanges());
    }
    [Theory][InlineData("authority-without-hash")][InlineData("hash-without-payload")][InlineData("lease-without-id")][InlineData("pending-without-authority")]
    public async Task SqlRejectsIncompleteNullableAuthorityLeaseAndPendingStateFacts(string kind)
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<PaymentsDbContext>();var row=Attempt();
        if(kind=="authority-without-hash"){row.ProtectedAuthority=[1];row.RedirectUri="https://gateway.example.test/pay";}
        else if(kind=="hash-without-payload"){row.AuthorityHash=Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(Id())));row.RedirectUri="https://gateway.example.test/pay";}
        else if(kind=="lease-without-id")row.LeaseUntil=DateTimeOffset.UtcNow.AddMinutes(1);
        else row.State="pending";
        db.CashAttempts.Add(row);var error=await Assert.ThrowsAsync<DbUpdateException>(()=>db.SaveChangesAsync());Assert.Equal(547,Assert.IsType<SqlException>(error.InnerException).Number);
    }

}
