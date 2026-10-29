using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Credit;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;
namespace Shop.Tests;
public sealed class CreditOrderTests
{
    private static string Id()=>Guid.NewGuid().ToString("N");
    [Fact]public void ExplicitQuoteAndDeadlineAcknowledgementsAreRequiredAndInputsExcludeClientMoneyAndNestedAuthority()
    {
        var c=Id();var x=new CreditOrderInput(Id(),new string('a',64)," Synthetic QA ","۰۹۱۲۱۲۳۴۵۶۷",new("IR","تهران","تهران","نشانی کاملاً ساختگی برای آزمون نرم‌افزار","۱۲۳۴۵۶۷۸۹۰"),"ساختگی",true,true);var normalized=CreditOrderRules.Validate(x,c);Assert.Equal("09121234567",normalized.ContactPhone);Assert.Equal("Synthetic QA",normalized.ContactName);Assert.Equal("1234567890",normalized.Delivery!.PostalCode);
        foreach(var bad in new[]{x with{QuoteAccepted=false},x with{AcknowledgeTemporary=false},x with{Fingerprint="1"},x with{CreditQuoteId="bad"},x with{ContactPhone="123"}})Assert.Throws<BusinessException>(()=>CreditOrderRules.Validate(bad,c));
        var json=new JsonSerializerOptions(JsonSerializerDefaults.Web);var raw=JsonSerializer.Serialize(x,json);foreach(var extra in new[]{"amountRial","ownerId","scopeId"})Assert.Throws<JsonException>(()=>JsonSerializer.Deserialize<CreditOrderInput>(raw[..^1]+",\""+extra+"\":\"1\"}",json));Assert.Throws<JsonException>(()=>JsonSerializer.Deserialize<CreditOrderInput>(raw.Replace("\"countryCode\":\"IR\"","\"countryCode\":\"IR\",\"approved\":true"),json));
    }
    [Fact]public void OnlyConfiguredChequeOrderingWithKnownPositiveFinalAmountsCanUseTheNewConsumer()
    {
        var settings=new CheckoutOrderSettings{TemporaryOrdersEnabled=false,ChequeOrdersEnabled=true,ReservationMinutes=60,MaxOpenOrdersPerCustomer=2,Version=new byte[8]};var method=new PurchaseMethodData("qa","cheque","ساختگی","Synthetic",true,true,[],null,null);var plan=new CreditPlanData("qa","Synthetic",2,0,0,1,true,[],null,null,1);CreditOrderEligibility.Require(settings,method,plan,"9007199254740993",["credit_approval_required"]);
        foreach(var total in new string?[]{null,"0","1.2","9223372036854775808"})Assert.Throws<BusinessException>(()=>CreditOrderEligibility.Require(settings,method,plan,total,["credit_approval_required"]));Assert.Throws<BusinessException>(()=>CreditOrderEligibility.Require(settings,method with{Kind="online"},plan,"1",["credit_approval_required"]));Assert.Throws<BusinessException>(()=>CreditOrderEligibility.Require(settings,method,plan with{Enabled=false},"1",["credit_approval_required"]));Assert.Throws<BusinessException>(()=>CreditOrderEligibility.Require(settings,method,plan,"1",["shipping_unconfigured","credit_approval_required"]));settings.ChequeOrdersEnabled=false;Assert.Throws<BusinessException>(()=>CreditOrderEligibility.Require(settings,method,plan,"1",["credit_approval_required"]));
    }
    [Fact]public async Task OnePurchaseUseAndOrderReceiptCannotBeRemovedOrModifiedThroughAnySaveEntryPoint()
    {
        await using var credit=new CreditDbContext(new DbContextOptionsBuilder<CreditDbContext>().UseSqlServer("Server=invalid;Database=NeverConnect;Integrated Security=true").Options);var use=new CreditPurchaseScopeUse{ScopeId=Id(),ApplicationId=Id(),OrderId=Id(),CreditQuoteId=Id()};credit.Attach(use);use.AssessedAmountRial=1;Assert.Throws<BusinessException>(()=>credit.SaveChanges());Assert.Throws<BusinessException>(()=>credit.SaveChanges(false));await Assert.ThrowsAsync<BusinessException>(()=>credit.SaveChangesAsync());await Assert.ThrowsAsync<BusinessException>(()=>credit.SaveChangesAsync(false));credit.ChangeTracker.Clear();credit.Attach(use);credit.Remove(use);Assert.Throws<BusinessException>(()=>credit.SaveChanges());credit.ChangeTracker.Clear();credit.Attach(use);use.OrderId=Id();var keyMutation=Assert.Throws<InvalidOperationException>(()=>credit.SaveChanges());Assert.Contains("key",keyMutation.Message,StringComparison.OrdinalIgnoreCase);
        await using var sales=new SalesDbContext(new DbContextOptionsBuilder<SalesDbContext>().UseSqlServer("Server=invalid;Database=NeverConnect;Integrated Security=true").Options);var link=new CreditOrderLink{OrderId=Id()};sales.Attach(link);sales.Remove(link);Assert.Throws<InvalidOperationException>(()=>sales.SaveChanges());Assert.Throws<InvalidOperationException>(()=>sales.SaveChanges(false));await Assert.ThrowsAsync<InvalidOperationException>(()=>sales.SaveChangesAsync());await Assert.ThrowsAsync<InvalidOperationException>(()=>sales.SaveChangesAsync(false));
    }
    [Fact]public void OrderReceiptEncryptionCannotBeReadAsAnotherOwnerOrderOrQuotePurpose()
    {
        var provider=new EphemeralDataProtectionProvider();var p=new DataProtectionCreditOrderProtection(provider);var id=Id();var bytes=p.Protect("qa-owner",id,"Synthetic private order only");Assert.Equal("Synthetic private order only",p.Unprotect("qa-owner",id,bytes));Assert.Throws<BusinessException>(()=>p.Unprotect("other",id,bytes));Assert.Throws<BusinessException>(()=>p.Unprotect("qa-owner",Id(),bytes));Assert.Throws<BusinessException>(()=>new DataProtectionCreditCheckoutQuoteProtection(provider).Unprotect("qa-owner",id,bytes));bytes[^1]^=1;Assert.Throws<BusinessException>(()=>p.Unprotect("qa-owner",id,bytes));
    }
}
