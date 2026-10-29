using System.Text;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;
public sealed class SourcingHttpTests
{
    [Fact] public void PrivateNotesAreBoundToOwnerAndRequestAndRejectTampering()
    {
        var protector=new SourcingNoteProtection(new EphemeralDataProtectionProvider());
        const string message="خواستهٔ مشتری؛ فقط در جزئیات مجاز.";
        var value=protector.Protect("qa-owner","qa-request",message);Assert.DoesNotContain(message,value);
        Assert.Equal(message,protector.Unprotect("qa-owner","qa-request",value));
        foreach(var item in new[]{("another-owner","qa-request",value),("qa-owner","another-request",value),("qa-owner","qa-request",value[..^5]+"AAAAA")}){
            var error=Assert.Throws<BusinessException>(()=>protector.Unprotect(item.Item1,item.Item2,item.Item3));Assert.Equal("sourcing_note_unavailable",error.Code);
        }
    }
    [Theory][InlineData("/api/cart/fa/sourcing/submit")][InlineData("/api/cart/en/sourcing")][InlineData("/api/cart/fa/v2")][InlineData("/API/CART/EN/V2/OFFERS/00000000000000000000000000000001")][InlineData("/api/sourcing/requests/a/cancel")][InlineData("/api/admin/sourcing/requests/a/review")]
    public async Task SourcingBodiesAreBoundedEvenWithoutAContentLength(string path)
    {
        var context=new DefaultHttpContext();context.Request.Path=path;context.Request.Method="POST";
        var original=new MemoryStream(new byte[16*1024+1]);context.Request.Body=original;var called=false;
        var error=await Assert.ThrowsAsync<BadHttpRequestException>(()=>SourcingEndpoints.LimitBodyAsync(context,_=>{called=true;return Task.CompletedTask;}));
        Assert.Equal(413,error.StatusCode);Assert.False(called);Assert.Same(original,context.Request.Body);
    }
    [Fact] public async Task ExactLimitIsReadableAndOriginalStreamIsRestored()
    {
        var context=new DefaultHttpContext();context.Request.Path="/api/cart/fa/sourcing";context.Request.Method="PUT";
        var bytes=Encoding.UTF8.GetBytes(new string('a',16*1024));var original=new MemoryStream(bytes);context.Request.Body=original;
        await SourcingEndpoints.LimitBodyAsync(context,async http=>{using var reader=new StreamReader(http.Request.Body,leaveOpen:true);Assert.Equal(bytes.Length,(await reader.ReadToEndAsync()).Length);});Assert.Same(original,context.Request.Body);
    }
    [Fact] public async Task TheNewSourcingLimitDoesNotChangeExistingPurchaseRoutes()
    {
        var context=new DefaultHttpContext();context.Request.Path="/api/cart/fa/quote";context.Request.Method="POST";var original=new MemoryStream(new byte[20000]);context.Request.Body=original;
        await SourcingEndpoints.LimitBodyAsync(context,http=>{Assert.Same(original,http.Request.Body);return Task.CompletedTask;});
    }
    [Fact] public async Task OnlyTheExactAdministrativeOfferSaveGetsTheLargerUtf8Limit()
    {
        var id=Guid.NewGuid().ToString("N");var offer=Guid.NewGuid().ToString("N");
        var route=$"/api/admin/sourcing/requests/{id}/offers/{offer}";
        foreach(var (path,method,limit) in new[]{(route,"PUT",65536),(route,"POST",16384),(route+"/publish","POST",16384),(route+"/","PUT",16384),(route.Replace(id,"bad"),"PUT",16384),(route.Replace("/admin",""),"PUT",16384)}){
            var http=new DefaultHttpContext();http.Request.Path=path;http.Request.Method=method;var original=new MemoryStream(new byte[limit]);http.Request.Body=original;
            await SourcingEndpoints.LimitBodyAsync(http,context=>{Assert.Equal(limit,context.Request.Body.Length);return Task.CompletedTask;});Assert.Same(original,http.Request.Body);
            http.Request.Body=new MemoryStream(new byte[limit+1]);var error=await Assert.ThrowsAsync<BadHttpRequestException>(()=>SourcingEndpoints.LimitBodyAsync(http,_=>Task.CompletedTask));Assert.Equal(413,error.StatusCode);
        }
    }
}
