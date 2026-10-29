using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Payments;
using Shop.SharedKernel;
using Xunit;
namespace Shop.SqlTests;
public sealed partial class CashOrderPaymentSqlTests
{
    private sealed record Pending(Scenario Scenario,string Attempt,string Authority,string Reference);
    private async Task<Pending> PendingAttempt(long price=100003)
    {
        var s=await Create(price);var state=await Read(s);var prepared=await Prepare(s,new(Id(),state.OrderVersion));var authority="synthetic-authority-"+Id();var reference="synthetic-reference-"+Id();
        await Scope(async sp=>{var db=sp.GetRequiredService<PaymentsDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);var row=await db.CashAttempts.SingleAsync(a=>a.Id==prepared.Attempt.Id);row.AuthorityHash=CashGatewayRules.EvidenceHash(authority,512);row.ProtectedAuthority=sp.GetRequiredService<IPaymentAuthorityProtection>().Protect(row.Id,authority);row.RedirectUri="https://gateway.example.test/pay";row.State="pending";row.ChangedAt=DateTimeOffset.UtcNow;db.CashEvents.Add(new(){AttemptId=row.Id,State="pending",Reason="synthetic_gateway_intent_fixture",At=row.ChangedAt});await db.SaveChangesAsync();return true;});return new(s,prepared.Attempt.Id,authority,reference);
    }
    private static CashGatewayVerified Verified(Pending p)=>new("succeeded",p.Authority,p.Scenario.Amount,"IRR",p.Reference);
    private Task<CashOrderSettlement> Settle(Pending p,CashGatewayVerified? fact=null)=>Scope(sp=>sp.GetRequiredService<CashPaymentTransactionCoordinator>().RunAsync(()=>new CashPaymentSettlementService(sp.GetRequiredService<PaymentsDbContext>(),sp.GetRequiredService<ICashPaymentOrders>(),new CashGatewayRegistry([new PreparationOnlyGateway()]),TimeProvider.System,true).ApplyServerVerificationAsync(p.Scenario.Owner,p.Attempt,fact??Verified(p),default)));
    private Task<(string State,int Verifications,int Events)> PaymentFacts(Pending p)=>Scope(async sp=>{var db=sp.GetRequiredService<PaymentsDbContext>();return((await db.CashAttempts.AsNoTracking().SingleAsync(a=>a.Id==p.Attempt)).State,await db.CashVerifications.CountAsync(v=>v.AttemptId==p.Attempt),await db.CashEvents.CountAsync(e=>e.AttemptId==p.Attempt));});
    [Fact]public async Task PaymentsSalesAndInventoryCommitOneVerifiedSettlementTogetherAndKeepHistoricalReceipt()
    {
        var p=await PendingAttempt(9007199254740993);using var customer=p.Scenario.Client;var before=await Read(p.Scenario);var results=await Task.WhenAll(Settle(p),Settle(p));Assert.Single(results,r=>r.Replayed);var first=Assert.Single(results,r=>!r.Replayed);Assert.Equal("applied",first.Disposition);Assert.Equal("9007199254741000",first.AmountRial);var after=await Read(p.Scenario);Assert.Equal("Paid",after.State);Assert.Equal("Allocated",after.ReservationState);Assert.Equal(before.OnHand,after.OnHand);Assert.Equal(before.StockVersion,after.StockVersion);Assert.Equal(before.Movements,after.Movements);Assert.Equal(before.Snapshot,after.Snapshot);Assert.Equal(1,after.Links);Assert.Equal(("verified",1,3),await PaymentFacts(p));Assert.Equal(first with{Replayed=true},await Settle(p));Assert.Equal(after,await Read(p.Scenario));
    }
    [Fact]public async Task FailureWritingPaymentEvidenceRollsBackAlreadySavedSalesLinkOrderAndReservation()
    {
        var p=await PendingAttempt();using var customer=p.Scenario.Client;var before=await Read(p.Scenario);var paymentBefore=await PaymentFacts(p);await Scope(async sp=>{await sp.GetRequiredService<PaymentsDbContext>().Database.ExecuteSqlRawAsync("ALTER TABLE payments.CashPaymentVerifications WITH NOCHECK ADD CONSTRAINT CK_QA_VerifiedEvidenceFailure CHECK (1=0)");return true;});
        try{await Assert.ThrowsAsync<DbUpdateException>(()=>Settle(p));Assert.Equal(before,await Read(p.Scenario));Assert.Equal(paymentBefore,await PaymentFacts(p));}
        finally{await Scope(async sp=>{await sp.GetRequiredService<PaymentsDbContext>().Database.ExecuteSqlRawAsync("ALTER TABLE payments.CashPaymentVerifications DROP CONSTRAINT CK_QA_VerifiedEvidenceFailure");return true;});}
        Assert.Equal("applied",(await Settle(p)).Disposition);Assert.Equal(1,(await PaymentFacts(p)).Verifications);
    }
    [Fact]public async Task VerifiedAmountMismatchIsPersistedForReviewWithoutMarkingOrderPaidAndCannotChangeOnReplay()
    {
        var p=await PendingAttempt();using var customer=p.Scenario.Client;var before=await Read(p.Scenario);var wrong=Verified(p)with{AmountRial=p.Scenario.Amount+1};var result=await Settle(p,wrong);Assert.Equal("requires_review",result.Disposition);Assert.Equal("payment_amount_or_method_mismatch",result.Reason);await PaymentWire(await customer.GetAsync("/api/payments/orders/"+p.Scenario.Order),"review-page","customer-page");Assert.Equal(before,await Read(p.Scenario));Assert.Equal(("review",1,3),await PaymentFacts(p));Assert.Equal(result with{Replayed=true},await Settle(p,wrong));Assert.Equal("payment_proof_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Settle(p))).Code);
    }
    [Fact]public async Task VerificationForAnotherAuthorityOrNonSuccessCannotChangeAnyPaymentOrOrderFact()
    {
        var p=await PendingAttempt();using var customer=p.Scenario.Client;var before=await Read(p.Scenario);var paymentBefore=await PaymentFacts(p);Assert.Equal("payment_authority_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Settle(p,Verified(p)with{Authority="different"}))).Code);Assert.Equal("invalid_payment_verification",(await Assert.ThrowsAsync<BusinessException>(()=>Settle(p,new("unknown",null,null,null,null)))).Code);Assert.Equal(before,await Read(p.Scenario));Assert.Equal(paymentBefore,await PaymentFacts(p));
    }
    [Fact]public async Task SameExternalReferenceCannotPayASecondOrderAndTheSecondReviewReceiptIsRetained()
    {
        var first=await PendingAttempt();using var firstCustomer=first.Scenario.Client;Assert.Equal("applied",(await Settle(first)).Disposition);var second=await PendingAttempt();using var secondCustomer=second.Scenario.Client;var before=await Read(second.Scenario);var duplicate=Verified(second)with{Reference=first.Reference};var review=await Settle(second,duplicate);Assert.Equal("requires_review",review.Disposition);Assert.Equal("payment_reference_already_used",review.Reason);Assert.Equal(before,await Read(second.Scenario));Assert.Equal(("review",1,3),await PaymentFacts(second));Assert.Equal(review with{Replayed=true},await Settle(second,duplicate));
    }
}
