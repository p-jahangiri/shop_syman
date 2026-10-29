using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Payments;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;
namespace Shop.SqlTests;
public sealed partial class CashOrderPaymentSqlTests
{
    private sealed class PreparationOnlyGateway:ICashPaymentGateway
    {
        public string ProviderKey=>"synthetic-test-only";public string AccountKey=>"qa";public bool IsConfigured=>true;public bool SupportsIdempotentInitiation=>true;public IReadOnlySet<string> AllowedRedirectHosts=>new HashSet<string>{"gateway.example.test"};
        public Task<CashGatewayStarted> StartAsync(CashGatewayStart r,CancellationToken ct)=>throw new InvalidOperationException("Preparation must not call any network adapter inside SQL.");public Task<CashGatewayVerified> VerifyAsync(CashGatewayVerify r,CancellationToken ct)=>throw new InvalidOperationException("Preparation must never verify or fabricate payment.");
    }
    private Task<CashPaymentPrepared> Prepare(Scenario s,CashPaymentPrepareInput input,bool configured=true,TimeProvider? clock=null)=>Scope(sp=>sp.GetRequiredService<CashPaymentTransactionCoordinator>().RunAsync(()=>new CashPaymentPreparationService(sp.GetRequiredService<PaymentsDbContext>(),sp.GetRequiredService<ICashPaymentOrders>(),new CashPaymentBindings(configured?[new(s.Method,"synthetic-test-only","qa")]:[]),new CashGatewayRegistry(configured?[new PreparationOnlyGateway()]:[]),clock??TimeProvider.System,true).PrepareAsync(s.Owner,s.Order,input,default)));
    private Task<(int Attempts,int Events)> Attempts()=>Scope(async sp=>{var db=sp.GetRequiredService<PaymentsDbContext>();return(await db.CashAttempts.CountAsync(),await db.CashEvents.CountAsync());});
    [Fact]public async Task EmptyProductRegistryRejectsPreparationWithoutWritingAnAttemptOrChangingAnyOrderStockFact()
    {
        var s=await Create();using var customer=s.Client;var before=await Read(s);var counts=await Attempts();var input=new CashPaymentPrepareInput(Id(),before.OrderVersion);var error=await Assert.ThrowsAsync<BusinessException>(()=>Prepare(s,input,configured:false));Assert.Equal("gateway_unconfigured",error.Code);Assert.Equal(before,await Read(s));Assert.Equal(counts,await Attempts());
    }
    [Fact]public async Task PersistentPreparationUsesOnlyServerMoneyAndConcurrentRetryHasOneAttemptWithoutCallingGatewayOrRecordingPayment()
    {
        var s=await Create(9007199254740993);using var customer=s.Client;var before=await Read(s);var counts=await Attempts();var input=new CashPaymentPrepareInput(Id(),before.OrderVersion);var results=await Task.WhenAll(Prepare(s,input),Prepare(s,input));Assert.Single(results,r=>r.Replayed);Assert.Single(results,r=>!r.Replayed);Assert.Equal(results[0].Attempt,results[1].Attempt);var attempt=results[0].Attempt;Assert.Equal("9007199254741000",attempt.AmountRial);Assert.Equal("created",attempt.State);Assert.Equal(before,await Read(s));Assert.Equal((counts.Attempts+1,counts.Events+1),await Attempts());
        Assert.Equal("payment_attempt_pending_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Prepare(s,input with{CommandId=Id()}))).Code);Assert.Equal("idempotency_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Prepare(s,input with{OrderVersion="AAAAAAAAAAA="}))).Code);
        var raw=JsonSerializer.Serialize(attempt,new JsonSerializerOptions(JsonSerializerDefaults.Web));foreach(var forbidden in new[]{"authority","reference","ownerId","providerKey","protectedAuthority"})Assert.DoesNotContain("\""+forbidden+"\"",raw);
        await Scope(async sp=>{var own=await sp.GetRequiredService<CashPaymentPreparationService>().ReadAsync(s.Owner,attempt.Id,default);Assert.Equal(attempt,own);Assert.Equal("not_found",(await Assert.ThrowsAsync<BusinessException>(()=>sp.GetRequiredService<CashPaymentPreparationService>().ReadAsync("another-owner",attempt.Id,default))).Code);return true;});
    }
    [Fact]public async Task PreparationReceiptReplaysOriginalAttemptAfterCancelAndNoLongerConfiguredGateway()
    {
        var s=await Create();using var customer=s.Client;var before=await Read(s);var input=new CashPaymentPrepareInput(Id(),before.OrderVersion);var prepared=await Prepare(s,input);await OrderFixture.Json(await customer.PostAsJsonAsync("/api/orders/"+s.Order+"/cancel",new{Version=before.OrderVersion}));var cancelled=await Read(s);var replay=await Prepare(s,input,configured:false);Assert.True(replay.Replayed);Assert.Equal(prepared.Attempt,replay.Attempt);Assert.Equal(cancelled,await Read(s));
    }
    [Fact]public async Task DeadlineCrossingAfterAttemptSaveRollsBackAttemptAndItsEvent()
    {
        var s=await Create();using var customer=s.Client;var before=await Read(s);var counts=await Attempts();var error=await Assert.ThrowsAsync<BusinessException>(()=>Prepare(s,new(Id(),before.OrderVersion),clock:new CrossingClock(DateTimeOffset.UtcNow,DateTimeOffset.UtcNow.AddHours(2))));Assert.Equal("payment_deadline_retry",error.Code);Assert.Equal(counts,await Attempts());Assert.Equal(before,await Read(s));
    }
}
