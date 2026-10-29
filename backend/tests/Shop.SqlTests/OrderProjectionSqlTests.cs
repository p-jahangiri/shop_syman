using System.Data;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Market;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;

// These are native Market identity fixtures, explicitly separate from the
// genuine authenticated Order2 pipeline in OrderV2HttpSqlTests. Minimal closed
// historical parents exercise projection identity, retention and seek paging;
// no Sales order, price authority, stock or customer consent is fabricated.
public sealed class OrderProjectionSqlTests(MarketFixture fixture):IClassFixture<MarketFixture>
{
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web);
    private static readonly string H=new('A',64);private const string V="AAAAAAAAAAA=";
    private static string Id()=>Guid.NewGuid().ToString("N");
    private sealed record Native(string Owner,string Request,SourcingAgreementOrderedEvent[] Messages);
    private async Task<T> Scope<T>(Func<IServiceProvider,Task<T>> action)
    {
        await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();Assert.StartsWith("SaymanTest_",scope.ServiceProvider.GetRequiredService<MarketDbContext>().Database.GetDbConnection().Database);return await action(scope.ServiceProvider);
    }
    private async Task<Native> Seed(int count=1,string? owner=null,bool demo=false)
    {
        var actor=owner??"native-projection-"+Id();var request=Id();var at=DateTimeOffset.UtcNow.AddDays(-3);var messages=new List<SourcingAgreementOrderedEvent>();
        await Scope(async sp=>{
            var db=sp.GetRequiredService<MarketDbContext>();
            db.SourcingRequests.Add(new(){Id=request,OwnerId=actor,SubmitRequestId=Id(),PayloadHash=H,CartId=Id(),SubmittedCartVersion=V,Locale="en",State="Cancelled",ProtectedNote="native-projection-fixture-not-a-customer-note",ContainsDemo=demo,CreatedAt=at.AddHours(-5),ChangedAt=at.AddHours(2)});await db.SaveChangesAsync();
            for(var i=0;i<count;i++){
                var offer=Id();var acceptance=Id();var task=Id();
                db.SourcingOffers.Add(new(){Id=offer,RequestId=request,Revision=i+1,State="Accepted",IsActive=false,ContainsDemo=demo,TermsFa="شرایط مصنوعی تاریخچهٔ SQL",TermsEn="Synthetic native SQL history",TermsHash=H,TotalRial=1,AcceptUntil=at.AddHours(-1),PurchaseUntil=at.AddHours(1),CreatedAt=at.AddHours(-4),ChangedAt=at.AddHours(2),PublishedAt=at.AddHours(-3),AcceptedAt=at.AddHours(-2),AcceptanceId=acceptance});
                db.SourcingOfferAcceptances.Add(new(){Id=acceptance,OfferId=offer,OwnerId=actor,TermsHash=H,OfferVersion=V,At=at.AddHours(-2)});
                db.SourcingSupplyTasks.Add(new(){Id=task,RequestId=request,OfferId=offer,AcceptanceId=acceptance,OwnerId=actor,TermsHash=H,State="Cancelled",IsOpen=false,ContainsDemo=demo,ProtectedNote="",CreatedAt=at.AddMinutes(-30),ChangedAt=at.AddHours(2)});
                messages.Add(new(1,Id(),Id(),actor,acceptance,request,task,offer,acceptance,Id(),demo,at));
            }
            await db.SaveChangesAsync();return true;
        });return new(actor,request,messages.ToArray());
    }
    private Task Apply(SourcingAgreementOrderedEvent message)=>Scope(async sp=>{await sp.GetRequiredService<IMarketOrderProjection>().ApplyAsync(message,default);return true;});
    private Task<SourcingOrderLinksData> Read(Native native,string? cursor=null,string? owner=null)=>Scope(sp=>sp.GetRequiredService<IMarketOrderProjection>().ReadAsync(owner??native.Owner,native.Request,cursor,default));
    private Task<string> BusinessFingerprint(Native native)=>Scope(async sp=>{
        var db=sp.GetRequiredService<MarketDbContext>();return JsonSerializer.Serialize(new{
            Request=await db.SourcingRequests.AsNoTracking().SingleAsync(r=>r.Id==native.Request),
            Offers=await db.SourcingOffers.AsNoTracking().Where(o=>o.RequestId==native.Request).OrderBy(o=>o.Id).ToArrayAsync(),
            Acceptances=await db.SourcingOfferAcceptances.AsNoTracking().Where(a=>db.SourcingOffers.Any(o=>o.Id==a.OfferId&&o.RequestId==native.Request)).OrderBy(a=>a.Id).ToArrayAsync(),
            Tasks=await db.SourcingSupplyTasks.AsNoTracking().Where(t=>t.RequestId==native.Request).OrderBy(t=>t.Id).ToArrayAsync(),
            RequestEvents=await db.SourcingRequestEvents.AsNoTracking().Where(e=>e.RequestId==native.Request).OrderBy(e=>e.Id).ToArrayAsync(),
            OfferEvents=await db.SourcingOfferEvents.AsNoTracking().Where(e=>db.SourcingOffers.Any(o=>o.Id==e.OfferId&&o.RequestId==native.Request)).OrderBy(e=>e.Id).ToArrayAsync(),
            SupplyEvents=await db.SourcingSupplyEvents.AsNoTracking().Where(e=>db.SourcingSupplyTasks.Any(t=>t.Id==e.TaskId&&t.RequestId==native.Request)).OrderBy(e=>e.Id).ToArrayAsync()
        },Json);
    });
    [Fact]public async Task ExactDuplicateMessageRetainsOneImmutableLinkWithoutChangingAnyMarketBusinessState()
    {
        var native=await Seed();var message=Assert.Single(native.Messages);var before=await BusinessFingerprint(native);await Apply(message);
        var original=await Scope(async sp=>await sp.GetRequiredService<MarketDbContext>().SourcingOrderLinks.AsNoTracking().SingleAsync(l=>l.AgreementId==message.AgreementId));
        await Task.WhenAll(Apply(message),Apply(message));
        var current=await Scope(async sp=>await sp.GetRequiredService<MarketDbContext>().SourcingOrderLinks.AsNoTracking().SingleAsync(l=>l.AgreementId==message.AgreementId));
        Assert.Equal(JsonSerializer.Serialize(original,Json),JsonSerializer.Serialize(current,Json));Assert.Equal(before,await BusinessFingerprint(native));Assert.Equal(message.OrderId,Assert.Single((await Read(native)).Items).OrderId);
    }
    [Theory][InlineData("event")][InlineData("order")][InlineData("allocation")][InlineData("at")]
    public async Task ConflictingDuplicateCannotReplaceHistoricalOrderProvenance(string field)
    {
        var native=await Seed();var message=Assert.Single(native.Messages);await Apply(message);var before=JsonSerializer.Serialize(await Read(native),Json);
        var changed=field switch{"event"=>message with{EventId=Id()},"order"=>message with{OrderId=Id()},"allocation"=>message with{AllocationId=Id()},_=>message with{At=message.At.AddSeconds(1)}};
        Assert.Equal("sourcing_projection_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Apply(changed))).Code);Assert.Equal(before,JsonSerializer.Serialize(await Read(native),Json));
    }
    [Theory][InlineData("owner")][InlineData("request")][InlineData("task")][InlineData("offer")][InlineData("acceptance")][InlineData("demo")]
    public async Task ForeignOrInconsistentNativeIdentityCannotCreateAnOrderLink(string field)
    {
        var native=await Seed();var message=Assert.Single(native.Messages);var before=await BusinessFingerprint(native);
        var changed=field switch{"owner"=>message with{OwnerId="foreign-"+Id()},"request"=>message with{RequestId=Id()},"task"=>message with{TaskId=Id()},"offer"=>message with{OfferId=Id()},"acceptance"=>message with{AcceptanceId=Id()},_=>message with{ContainsDemo=true}};
        await Assert.ThrowsAsync<BusinessException>(()=>Apply(changed));Assert.Empty((await Read(native)).Items);Assert.Equal(before,await BusinessFingerprint(native));
    }
    [Fact]public async Task ClosedExpiredParentsRemainHistoricalButOwnerAndProductionDemoBoundariesRemainStrict()
    {
        var native=await Seed();await Apply(native.Messages[0]);Assert.Single((await Read(native)).Items);
        Assert.Equal("not_found",(await Assert.ThrowsAsync<BusinessException>(()=>Read(native,owner:"other-"+Id()))).Code);
        var demo=await Seed(demo:true);await Apply(demo.Messages[0]);Assert.Single((await Read(demo)).Items);
        await Scope(async sp=>{
            var production=ActivatorUtilities.CreateInstance<SourcingOrderProjection>(sp,false);
            Assert.Single((await production.ReadAsync(native.Owner,native.Request,null,default)).Items);
            Assert.Equal("not_found",(await Assert.ThrowsAsync<BusinessException>(()=>production.ReadAsync(demo.Owner,demo.Request,null,default))).Code);
            Assert.Equal("not_found",(await Assert.ThrowsAsync<BusinessException>(()=>production.ApplyAsync(demo.Messages[0],default))).Code);return true;
        });
    }
    [Fact]public async Task TwentyOneHistoricalLinksUseBoundedOwnerAndRequestBoundCursorWithoutDuplicates()
    {
        var native=await Seed(21);foreach(var message in native.Messages)await Apply(message);
        var first=await Read(native);Assert.Equal(20,first.Items.Length);var cursor=Assert.IsType<string>(first.NextCursor);Assert.InRange(cursor.Length,201,512);
        var second=await Read(native,cursor);Assert.Single(second.Items);Assert.Null(second.NextCursor);
        var all=first.Items.Concat(second.Items).Select(l=>l.AcceptanceId).ToArray();Assert.Equal(21,all.Distinct(StringComparer.Ordinal).Count());Assert.True(native.Messages.Select(m=>m.AcceptanceId).ToHashSet(StringComparer.Ordinal).SetEquals(all));
        Assert.Equal(JsonSerializer.Serialize(second,Json),JsonSerializer.Serialize(await Read(native,cursor),Json));
        var otherRequest=await Seed(owner:native.Owner);Assert.Equal("invalid_sourcing_order_cursor",(await Assert.ThrowsAsync<BusinessException>(()=>Read(otherRequest,cursor))).Code);
        var otherOwner=await Seed();Assert.Equal("invalid_sourcing_order_cursor",(await Assert.ThrowsAsync<BusinessException>(()=>Read(otherOwner,cursor))).Code);
        Assert.Equal("invalid_sourcing_order_cursor",(await Assert.ThrowsAsync<BusinessException>(()=>Read(native,new string('a',513)))).Code);
        Assert.Equal("invalid_sourcing_order_cursor",(await Assert.ThrowsAsync<BusinessException>(()=>Read(native,"e30"))).Code);
    }
    [Fact]public async Task ProjectionRejectsAnExistingParentTransactionBeforeAnyLinkWrite()
    {
        var native=await Seed();await Scope(async sp=>{
            var db=sp.GetRequiredService<MarketDbContext>();await using var tx=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            await Assert.ThrowsAsync<InvalidOperationException>(()=>sp.GetRequiredService<IMarketOrderProjection>().ApplyAsync(native.Messages[0],default));Assert.False(await db.SourcingOrderLinks.AnyAsync(l=>l.RequestId==native.Request));return true;
        });Assert.Empty((await Read(native)).Items);
    }
    [Fact]public async Task SameEventIdCannotBeReusedByAnotherAgreement()
    {
        var native=await Seed(2);await Apply(native.Messages[0]);var second=native.Messages[1] with{EventId=native.Messages[0].EventId};
        await Assert.ThrowsAsync<DbUpdateException>(()=>Apply(second));Assert.Equal(native.Messages[0].OrderId,Assert.Single((await Read(native)).Items).OrderId);
    }
    [Fact]public async Task ProjectionClockBeforeCommittedEventCannotCreateHistoricalLink()
    {
        var native=await Seed();var message=native.Messages[0];await Scope(async sp=>{
            var service=new SourcingOrderProjection(sp.GetRequiredService<MarketDbContext>(),new BeforeEventClock(message.At.AddTicks(-1)),true);
            Assert.Equal("sourcing_projection_clock_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>service.ApplyAsync(message,default))).Code);return true;
        });Assert.Empty((await Read(native)).Items);
    }
    private sealed class BeforeEventClock(DateTimeOffset at):TimeProvider{public override DateTimeOffset GetUtcNow()=>at;}
}
