using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Shop.SharedKernel;
using Xunit;
namespace Shop.Tests;
public sealed class PrivateRealtimeTests
{
    private static ClaimsPrincipal User(string owner="OWNER-A",string jti="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",string permission="support.read")=>new(new ClaimsIdentity([new("sub",owner),new("sst","synthetic-test-stamp"),new("jti",jti),new("token_kind","access"),new("role","SupportAgent"),new("permission",permission)],"test"));
    private sealed class Clock:TimeProvider{public DateTimeOffset At=DateTimeOffset.UnixEpoch.AddDays(20000);public override DateTimeOffset GetUtcNow()=>At;}
    [Fact]public void PrivateConnectionLeaseCannotCrossAccountTokenCapabilitiesAudienceOrExpiry()
    {
        var clock=new Clock();var codec=new PrivateRealtimeCodec(new EphemeralDataProtectionProvider(),clock);var token=codec.Wrap(new string('x',43),User(),"customer");Assert.NotEqual(new string('x',43),token);Assert.DoesNotContain("OWNER-A",token);Assert.Equal(new string('x',43),codec.Unwrap(token,User(),"customer"));
        foreach(var user in new[]{User("OWNER-B"),User(jti:new string('b',32)),User(permission:"catalog.read")})Assert.Throws<BusinessException>(()=>codec.Unwrap(token,user,"customer"));Assert.Throws<BusinessException>(()=>codec.Unwrap(token,User(),"support"));Assert.Throws<BusinessException>(()=>codec.Unwrap(token[..^3]+"bad",User(),"customer"));clock.At=clock.At.AddMinutes(16);Assert.Throws<BusinessException>(()=>codec.Unwrap(token,User(),"customer"));
    }
    [Fact]public void BindingRejectsPendingDuplicateOrIncompleteIdentityAndRemainsStableForClaimOrder()
    {
        var value=User();Assert.Equal(PrivateRealtimeCodec.Binding(value),PrivateRealtimeCodec.Binding(new(new ClaimsIdentity(value.Claims.Reverse(),"test"))));foreach(var type in new[]{"sub","sst","jti","token_kind"}){var missing=new ClaimsPrincipal(new ClaimsIdentity(value.Claims.Where(x=>x.Type!=type),"test"));Assert.Throws<BusinessException>(()=>PrivateRealtimeCodec.Binding(missing));var duplicate=new ClaimsPrincipal(new ClaimsIdentity(value.Claims.Append(new(type,value.FindFirst(type)!.Value)),"test"));Assert.Throws<BusinessException>(()=>PrivateRealtimeCodec.Binding(duplicate));}
        Assert.Throws<BusinessException>(()=>PrivateRealtimeCodec.Binding(new(new ClaimsIdentity(value.Claims.Where(x=>x.Type!="token_kind").Append(new("token_kind","mfa_pending")),"test"))));
    }
    [Theory][InlineData("{\"protocol\":\"json\",\"version\":1}\u001e",true)][InlineData("{\"type\":6}\u001e{\"type\":7}\u001e",true)][InlineData("{\"type\":1,\"target\":\"JoinGroup\",\"arguments\":[\"other\"]}\u001e",false)][InlineData("{\"type\":6,\"owner\":\"other\"}\u001e",false)][InlineData("{\"type\":6,\"type\":7}\u001e",false)][InlineData("{\"protocol\":\"messagepack\",\"version\":1}\u001e",false)][InlineData("{\"type\":6}",false)]
    public void ClientTransportCannotInvokeMethodsOrSupplyOtherOwners(string value,bool expected)=>Assert.Equal(expected,PrivateRealtimeTransport.ClientFrames(Encoding.UTF8.GetBytes(value)));
    [Fact]public void BadUtf8OrExcessiveFramesAreRejected()=>Assert.All(new[]{new byte[]{0xff},Encoding.UTF8.GetBytes(string.Concat(Enumerable.Repeat("{\"type\":6}\u001e",17)))},value=>Assert.False(PrivateRealtimeTransport.ClientFrames(value)));
    [Fact]public void QueuedInvalidationsAreBoundedDeduplicatedAndContainNoMessageOrOwnerField()
    {
        var queue=new PrivateRealtimeQueue();queue.SupportChanged("owner-a");queue.SupportChanged("OWNER-A");queue.InboxChanged("OWNER-A");var values=queue.Drain();Assert.Equal(3,values.Length);Assert.All(values,x=>{Assert.DoesNotContain("OWNER-A",x.Group);Assert.Contains(x.Scope,new[]{"support","notifications"});});Assert.Single(values,x=>x.Group==PrivateRealtimeQueue.StaffGroup);Assert.Empty(queue.Drain());for(var n=0;n<16;n++)queue.InboxChanged("OWNER-"+n);Assert.Throws<InvalidOperationException>(()=>queue.InboxChanged("OWNER-17"));
    }
    private sealed class Dispatch(bool fail=false):IPrivateRealtimeDispatcher{public int Count;public Task DispatchAsync(PrivateRealtimeDelivery[] values,CancellationToken ct){Count+=values.Length;Assert.False(ct.IsCancellationRequested);return fail?Task.FromException(new InvalidOperationException("Synthetic dispatch failure")):Task.CompletedTask;}}
    private sealed class Lifetime:IHostApplicationLifetime{public CancellationToken ApplicationStarted=>CancellationToken.None;public CancellationToken ApplicationStopping=>CancellationToken.None;public CancellationToken ApplicationStopped=>CancellationToken.None;public void StopApplication(){}}
    [Theory][InlineData(200,false,2)][InlineData(200,true,2)][InlineData(409,false,0)]
    public async Task DispatchRunsOnlyAfterSuccessfulPipelineAndCannotUndoCommittedWork(int status,bool fail,int count)
    {
        var queue=new PrivateRealtimeQueue();var send=new Dispatch(fail);var services=new ServiceCollection().AddSingleton(queue).AddSingleton<IPrivateRealtimeDispatcher>(send).AddSingleton<IHostApplicationLifetime,Lifetime>().AddLogging().BuildServiceProvider();await using var scope=services.CreateAsyncScope();var context=new DefaultHttpContext{RequestServices=scope.ServiceProvider,RequestAborted=new CancellationToken(true)};var committed=false;await PrivateRealtimeDispatch.Invoke(context,http=>{queue.SupportChanged("OWNER-A");committed=status==200;http.Response.StatusCode=status;return Task.CompletedTask;});Assert.Equal(status==200,committed);Assert.Equal(status,context.Response.StatusCode);Assert.Equal(count,send.Count);
    }
    [Fact]public async Task AThrowingPipelineNeverDispatchesItsUncommittedQueue(){var queue=new PrivateRealtimeQueue();var send=new Dispatch();using var services=new ServiceCollection().AddSingleton(queue).AddSingleton<IPrivateRealtimeDispatcher>(send).BuildServiceProvider();var context=new DefaultHttpContext{RequestServices=services};await Assert.ThrowsAsync<InvalidOperationException>(()=>PrivateRealtimeDispatch.Invoke(context,_=>{queue.SupportChanged("OWNER-A");throw new InvalidOperationException("rollback");}));Assert.Equal(0,send.Count);}
}
