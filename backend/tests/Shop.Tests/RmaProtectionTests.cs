using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;
public sealed class RmaProtectionTests
{
    private const string Id="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    [Theory][InlineData("request")][InlineData("receipt")][InlineData("policyNote")][InlineData("policyReceipt")][InlineData("line")][InlineData("event")]
    public void PrivateRmaCiphertextBindsPurposePrincipalAndStableRecord(string purpose)
    {
        var p=new DataProtectionRmaProtection(new EphemeralDataProtectionProvider());var id=purpose=="line"?Id+":"+new string('F',64):purpose=="event"?Id+":submitted":Id;
        var value=p.Protect(purpose,"owner_A",id,"Private synthetic RMA text");Assert.Equal("Private synthetic RMA text",p.Unprotect(purpose,"OWNER_A",id,value));
        Assert.Equal("rma_unavailable",Assert.Throws<BusinessException>(()=>p.Unprotect(purpose,"OWNER_B",id,value)).Code);
        var otherId=id.Replace('a','b');Assert.Throws<BusinessException>(()=>p.Unprotect(purpose,"owner_A",otherId,value));
        var otherPurpose=purpose=="receipt"?"policyReceipt":"receipt";Assert.Throws<BusinessException>(()=>p.Unprotect(otherPurpose,"owner_A",id,value));
        Assert.Throws<BusinessException>(()=>p.Unprotect(purpose,"owner_A",id,[1,2,3]));
    }
    [Fact]public void InvalidPurposeRecordBindingOrOversizedNoteFailsClosed()
    {
        var p=new DataProtectionRmaProtection(new EphemeralDataProtectionProvider());
        Assert.Throws<BusinessException>(()=>p.Protect("refund","OWNER",Id,"text"));
        Assert.Throws<BusinessException>(()=>p.Protect("event","OWNER",Id+":Refunded","text"));
        Assert.Throws<BusinessException>(()=>p.Protect("line","OWNER",Id+":not-a-digest","text"));
        Assert.Throws<BusinessException>(()=>p.Protect("request","OWNER","not-an-id","text"));
        Assert.Throws<BusinessException>(()=>p.Protect("policyNote","OWNER",Id,new string('x',16384)));
        Assert.Throws<BusinessException>(()=>p.Protect("request","OWNER",Id,"\ud800"));
    }
    [Fact]public void FullUnicodeReviewNoteAndCustomerMessageFitAnImmutableEventEnvelope()
    {
        var p=new DataProtectionRmaProtection(new EphemeralDataProtectionProvider());
        var raw=RmaRules.Serialize(new{CaseId=Id,ActorId="OWNER",Author="staff",Action="completeReview",State="reviewed",Outcome="followUp",
            At=DateTimeOffset.UtcNow,Message=new string('ش',2000),StaffNote=new string('ش',4000)});
        Assert.True(System.Text.Encoding.UTF8.GetByteCount(raw)>32768);
        var value=p.Protect("event","OWNER",Id+":completeReview",raw);
        Assert.Equal(raw,p.Unprotect("event","OWNER",Id+":completeReview",value));
    }
    [Theory][InlineData("/api/returns",false)][InlineData("/api/returns/commands/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",false)]
    [InlineData("/api/admin/returns/policy",false)][InlineData("/api/orders/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/returns/context",false)]
    [InlineData("/api/returns/policy",true)]
    public void RmaHeadersExistBeforeAuthenticationWithOnlyPublicPolicyExempt(string path,bool publicPolicy)
    {
        var h=new DefaultHttpContext();h.Request.Method="GET";h.Request.Path=path;RmaEndpoints.Headers(h);
        Assert.Equal("rma-v1",h.Response.Headers["X-Sayman-Returns-Contract"].ToString());Assert.Contains("no-store",h.Response.Headers.CacheControl.ToString());
        Assert.Equal(!publicPolicy,RmaEndpoints.IsPrivateScope(h.Request));Assert.Contains(publicPolicy?"public":"private",h.Response.Headers.CacheControl.ToString());
        if(!publicPolicy)Assert.Equal("Cookie, Authorization",h.Response.Headers.Vary.ToString());
    }
    [Fact]public void PublicTermsWireContainsNoPrivateConfigOrInternalIdentities()
    {
        var value=new RmaPublicPolicyData(1,true,true,true,true,"سه روز پس از تحویل","Three days after delivery","deliveryDays",3);
        using var json=System.Text.Json.JsonDocument.Parse(RmaRules.Serialize(value));var root=json.RootElement;
        Assert.Equal(3,root.GetProperty("windowDays").GetInt32());Assert.False(root.GetProperty("canRefund").GetBoolean());
        foreach(var name in new[]{"id","version","maxOpenPerOwner","note","actorId","current"})Assert.False(root.TryGetProperty(name,out _));
        var disabled=RmaRules.Serialize(new RmaPublicPolicyData(1,false,false,false,false,null,null,null,null));Assert.Contains("\"windowDays\":null",disabled);
    }
    [Theory][InlineData("{\"version\":1,\"Version\":2}")][InlineData("{\"lines\":[{\"quantity\":1,\"quantity\":2}]}")]
    public async Task DuplicateJsonCannotProduceAnAmbiguousCommandReceipt(string body)
    {
        var h=new DefaultHttpContext();h.Request.Method="PUT";h.Request.Path="/api/returns/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/withdrawals/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        h.Request.Body=new MemoryStream(System.Text.Encoding.UTF8.GetBytes(body));var called=false;
        var error=await Assert.ThrowsAsync<BadHttpRequestException>(()=>RmaEndpoints.LimitBodyAsync(h,_=>{called=true;return Task.CompletedTask;}));
        Assert.Equal(400,error.StatusCode);Assert.False(called);
    }
}
