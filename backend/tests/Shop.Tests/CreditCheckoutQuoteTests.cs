using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;
namespace Shop.Tests;
public sealed class CreditCheckoutQuoteTests
{
    private static string Id()=>Guid.NewGuid().ToString("N");
    private static CreditPurchaseAuthority Authority(string basis="PayableTotalRial",long limit=9007199254740993)=>new(Id(),"AAAAAAAAAAE=",Id(),"AAAAAAAAAAI=",Id(),Id(),basis,limit,DateTimeOffset.Parse("2026-10-28T10:00:00Z"),"qa","AAAAAAAAAAM=",new string('a',64));
    private static PurchaseMethodData Method()=>new("cheque","cheque","ساختگی","Synthetic",true,true,[],null,null);
    private static CreditPlanData Plan()=>new("qa","Synthetic",2,0,0,1,true,[],null,null,1);
    private static ChequeAmount[] Cheques()=>[new(1,1,"4503599627370496"),new(2,2,"4503599627370497")];
    [Fact]public void ExactRialLimitChecksTheSelectedServerBasisAndNeverEnablesOrders()
    {
        var auth=Authority();var result=CreditQuoteAssessment.Assess(auth,Method(),Plan(),"9007199254740993","0","9007199254741003",Cheques(),["credit_approval_required"]);
        Assert.Equal("9007199254740993",result.LimitAmountRial);Assert.Equal("9007199254741003",result.AssessedAmountRial);Assert.False(result.WithinLimit);Assert.Contains("credit_scope_limit_exceeded",result.Blockers);Assert.DoesNotContain("credit_approval_required",result.Blockers);Assert.Contains("credit_order_not_configured",result.Blockers);
        var financed=CreditQuoteAssessment.Assess(auth with{LimitBasis="InstallmentsTotalRial"},Method(),Plan(),"9007199254740993","0","9007199254741003",Cheques(),[]);Assert.True(financed.WithinLimit);Assert.Equal("9007199254740993",financed.AssessedAmountRial);
    }
    [Fact]public void MissingFinalChargesRemainBlockersEvenWhenInstallmentSumFitsAndZeroFinancingIsExplicit()
    {
        var unknown=CreditQuoteAssessment.Assess(Authority(),Method(),Plan(),"9007199254740993","0",null,Cheques(),["shipping_unconfigured","tax_unconfigured","credit_approval_required"]);Assert.Null(unknown.AssessedAmountRial);Assert.Null(unknown.WithinLimit);Assert.Contains("credit_quote_amount_unavailable",unknown.Blockers);Assert.Contains("credit_quote_final_charges_unavailable",unknown.Blockers);
        var financed=CreditQuoteAssessment.Assess(Authority("InstallmentsTotalRial"),Method(),Plan(),"9007199254740993","0",null,Cheques(),["shipping_unconfigured"]);Assert.True(financed.WithinLimit);Assert.Contains("credit_quote_final_charges_unavailable",financed.Blockers);Assert.Contains("shipping_unconfigured",financed.Blockers);
        var noCheques=CreditQuoteAssessment.Assess(Authority("InstallmentsTotalRial"),Method(),Plan()with{DownPaymentBasisPoints=10000},"100","100","100",[],[]);Assert.Equal("0",noCheques.AssessedAmountRial);Assert.True(noCheques.WithinLimit);
    }
    [Fact]public void InvalidPlanSequenceAmountsAndOverflowCannotCreateAFalseBudgetPass()
    {
        var a=Authority();Assert.Throws<BusinessException>(()=>CreditQuoteAssessment.Assess(a,Method(),Plan()with{IntervalMonths=0},"1","0","1",[],[]));Assert.Throws<BusinessException>(()=>CreditQuoteAssessment.Assess(a,Method(),Plan()with{Id="other"},"1","0","1",[],[]));Assert.Throws<BusinessException>(()=>CreditQuoteAssessment.Assess(a,Method()with{Kind="online"},Plan(),"1","0","1",[],[]));
        foreach(var cheques in new[]{new[]{new ChequeAmount(1,1,"9223372036854775807"),new ChequeAmount(2,2,"1")},new[]{new ChequeAmount(2,1,"1"),new ChequeAmount(1,2,"1")},new[]{new ChequeAmount(1,1,"1.1"),new ChequeAmount(2,2,"1")},new[]{new ChequeAmount(1,1,"0"),new ChequeAmount(2,2,"2")}})Assert.Throws<BusinessException>(()=>CreditQuoteAssessment.Assess(a,Method(),Plan(),"2","0","2",cheques,[]));
    }
    [Fact]public void StrictInputHasNoClientPriceAndBaseUuidIsDomainSeparatedByOwnerAndCommand()
    {
        var input=new CreditCheckoutQuoteInput("AAAAAAAAAAE=","cheque","qa",Id(),Id(),"AAAAAAAAAAI=","AAAAAAAAAAM=");Assert.Equal(input,CreditCheckoutQuoteRules.Validate(input));Assert.Throws<BusinessException>(()=>CreditCheckoutQuoteRules.Validate(input with{MethodId="Cash"}));var id=Id();var derived=CreditCheckoutQuoteService.BaseRequestId("owner",id);Assert.NotEqual(id,derived);Assert.Equal(derived,CreditCheckoutQuoteService.BaseRequestId("owner",id));Assert.NotEqual(derived,CreditCheckoutQuoteService.BaseRequestId("other",id));Assert.NotEqual(derived,CreditCheckoutQuoteService.BaseRequestId("owner",Id()));
        var json=JsonSerializer.Serialize(input,new JsonSerializerOptions(JsonSerializerDefaults.Web)).Replace("}",",\"payableTotalRial\":\"1\"}");Assert.Throws<JsonException>(()=>JsonSerializer.Deserialize<CreditCheckoutQuoteInput>(json,new JsonSerializerOptions(JsonSerializerDefaults.Web)));
    }
    [Fact]public async Task PrivateQuoteSnapshotCannotBeModifiedOrDeletedAtAnySaveEntryPoint()
    {
        await using var db=new SalesDbContext(new DbContextOptionsBuilder<SalesDbContext>().UseSqlServer("Server=invalid;Database=NeverConnect;Integrated Security=true").Options);var row=new CreditCheckoutQuote{Id=Id()};db.Attach(row);db.Remove(row);Assert.Throws<InvalidOperationException>(()=>db.SaveChanges());Assert.Throws<InvalidOperationException>(()=>db.SaveChanges(false));await Assert.ThrowsAsync<InvalidOperationException>(()=>db.SaveChangesAsync());await Assert.ThrowsAsync<InvalidOperationException>(()=>db.SaveChangesAsync(false));
    }
    [Fact]public void PrivateQuoteProtectionIsBoundToOwnerAndQuoteAndRejectsTampering()
    {
        var protection=new DataProtectionCreditCheckoutQuoteProtection(new EphemeralDataProtectionProvider());var id=Id();var bytes=protection.Protect("qa-owner",id,"Synthetic snapshot only");Assert.Equal("Synthetic snapshot only",protection.Unprotect("qa-owner",id,bytes));Assert.Throws<BusinessException>(()=>protection.Unprotect("other-owner",id,bytes));Assert.Throws<BusinessException>(()=>protection.Unprotect("qa-owner",Id(),bytes));bytes[^1]^=1;Assert.Throws<BusinessException>(()=>protection.Unprotect("qa-owner",id,bytes));
    }
}
