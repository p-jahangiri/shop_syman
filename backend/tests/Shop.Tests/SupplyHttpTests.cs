using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class SupplyHttpTests
{
    [Fact] public void InternalSupplyNotesCannotBeOpenedAsCustomerNotesOrByAnotherOwnerOrTask()
    {
        var provider=new EphemeralDataProtectionProvider();var supply=new SourcingSupplyNoteProtection(provider);var customer=new SourcingNoteProtection(provider);
        const string value="یادداشت داخلی مصنوعی منبع؛ خصوصی برای کارکنان فروش.";
        var encrypted=supply.Protect("owner","task",value);Assert.DoesNotContain(value,encrypted);Assert.Equal(value,supply.Unprotect("owner","task",encrypted));
        foreach(var (owner,task,cipher) in new[]{("other","task",encrypted),("owner","other",encrypted),("owner","task",encrypted[..^4]+"!!!!"),("owner","task",customer.Protect("owner","task",value))})
            Assert.Equal("sourcing_supply_note_unavailable",Assert.Throws<BusinessException>(()=>supply.Unprotect(owner,task,cipher)).Code);
        Assert.Equal("sourcing_note_unavailable",Assert.Throws<BusinessException>(()=>customer.Unprotect("owner","task",encrypted)).Code);
    }
    [Fact] public async Task OnlyExactPhysicalReceivingGets64KiBAndMappingAndProgressKeep16KiB()
    {
        var request=Guid.NewGuid().ToString("N");var task=Guid.NewGuid().ToString("N");var receipt=Guid.NewGuid().ToString("N");var route=$"/api/admin/inventory/sourcing-requests/{request}/tasks/{task}/receipts/{receipt}";
        foreach(var (path,method,limit) in new[]{(route,"POST",65536),(route,"PUT",16384),(route+"/","POST",16384),(route.Replace(task,"bad"),"POST",16384),(route.Replace(receipt,new string('0',32)),"POST",16384),($"/api/admin/inventory/receiving-unit-mappings/{receipt}","PUT",16384),($"/api/admin/sourcing/requests/{request}/supply/{task}/progress","POST",16384)}){
            var http=new DefaultHttpContext();http.Request.Path=path;http.Request.Method=method;var original=new MemoryStream(new byte[limit]);http.Request.Body=original;
            await SourcingEndpoints.LimitBodyAsync(http,context=>{Assert.Equal(limit,context.Request.Body.Length);return Task.CompletedTask;});Assert.Same(original,http.Request.Body);
            http.Request.Body=new MemoryStream(new byte[limit+1]);var error=await Assert.ThrowsAsync<BadHttpRequestException>(()=>SourcingEndpoints.LimitBodyAsync(http,_=>Task.CompletedTask));Assert.Equal(413,error.StatusCode);
        }
    }
    [Fact] public async Task DeclaredOversizeReceivingBodyFailsBeforeReadingIt()
    {
        var id=Guid.NewGuid().ToString("N");var http=new DefaultHttpContext();http.Request.Path=$"/api/admin/inventory/sourcing-requests/{id}/tasks/{id}/receipts/{id}";http.Request.Method="POST";http.Request.ContentLength=65537;http.Request.Body=new MemoryStream();
        var error=await Assert.ThrowsAsync<BadHttpRequestException>(()=>SourcingEndpoints.LimitBodyAsync(http,_=>throw new InvalidOperationException("Oversized body reached the handler.")));Assert.Equal(413,error.StatusCode);
    }
    [Theory]
    [InlineData("/API/ADMIN/INVENTORY/SOURCING-REQUESTS/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/tasks/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/receipts/cccccccccccccccccccccccccccccccc")]
    [InlineData("/API/ADMIN/INVENTORY/RECEIVING-UNIT-MAPPINGS/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")]
    [InlineData("/API/ADMIN/SOURCING/requests/a/supply/b/progress")]
    [InlineData("/API/SOURCING/requests/a/cancel")]
    [InlineData("/API/CART/fa/SOURCING/submit")]
    public async Task CaseInsensitiveRoutingNeverBypassesTheConservative16KiBDefault(string route)
    {
        var http=new DefaultHttpContext();http.Request.Path=route;http.Request.Method="POST";http.Request.Body=new MemoryStream(new byte[16385]);
        var error=await Assert.ThrowsAsync<BadHttpRequestException>(()=>SourcingEndpoints.LimitBodyAsync(http,_=>throw new InvalidOperationException("Unbounded body reached the handler.")));Assert.Equal(413,error.StatusCode);
    }
}
