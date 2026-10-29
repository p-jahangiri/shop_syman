using System.Data;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Market;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;
public sealed partial class SourcingOfferSqlTests
{
    private sealed class AdvancingClock(DateTimeOffset now):TimeProvider{public DateTimeOffset Now=now;public override DateTimeOffset GetUtcNow()=>Now;}
    private sealed class AdvancingCatalog(ICatalogOfferReader inner,Action advance):ICatalogOfferReader
    {
        public async Task<IReadOnlyDictionary<string,OfferSkuSnapshot>> ReadAsync(string[] ids,CancellationToken ct){var result=await inner.ReadAsync(ids,ct);advance();return result;}
        public Task<OfferSkuPage> LookupAsync(string model,string? query,string? cursor,CancellationToken ct)=>inner.LookupAsync(model,query,cursor,ct);
    }
    private sealed class AdvanceAfterSave(Action advance):SaveChangesInterceptor
    {
        public override ValueTask<int> SavedChangesAsync(SaveChangesCompletedEventData data,int result,CancellationToken ct=default){advance();return ValueTask.FromResult(result);}
    }
    [Theory][InlineData("publish")][InlineData("accept")][InlineData("start")][InlineData("publish-save")][InlineData("accept-save")][InlineData("start-save")][InlineData("read")]
    public async Task DeadlineThatElapsesDuringAwaitedCatalogReadPreventsPublicationAcceptanceAndNewSupply(string operation)
    {
        var afterSave=operation.EndsWith("-save",StringComparison.Ordinal);var action=operation.Split('-')[0];var scenario=await Create();using var customer=scenario.Customer;using var finance=await fixture.ReuseStaff("FinanceManager");string offer;System.Text.Json.Nodes.JsonNode detail;
        if(action=="publish"){offer=Id();await Body(await finance.PutAsJsonAsync(Route(scenario,offer),await Input(scenario,finance)));detail=await Body(await finance.GetAsync(Route(scenario,offer)));}
        else{var published=await Publish(scenario,finance);offer=published.Offer;detail=published.Detail;if(action=="start"){await Body(await customer.PostAsJsonAsync(Route(scenario,offer,false)+"/accept",Action(detail)));detail=await Body(await customer.GetAsync(Route(scenario,offer,false)));}}
        var summary=detail["offer"]!["summary"]!;var deadline=summary[action=="start"?"purchaseUntil":"acceptUntil"]!.GetValue<DateTimeOffset>();var clock=new AdvancingClock(deadline.AddMinutes(-1));await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();var options=new DbContextOptionsBuilder<MarketDbContext>().UseSqlServer(fixture.Sql.Connection);if(afterSave)options.AddInterceptors(new AdvanceAfterSave(()=>clock.Now=deadline));await using var db=new MarketDbContext(options.Options);var catalog=new AdvancingCatalog(scope.ServiceProvider.GetRequiredService<ICatalogOfferReader>(),()=>{if(!afterSave)clock.Now=deadline;});await using var transaction=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
        if(action=="read"){var service=new SourcingOfferService(db,catalog,scope.ServiceProvider.GetRequiredService<IPurchaseConfiguration>(),clock,true);var value=await service.ReadAsync(scenario.Owner,scenario.Request,offer,default);Assert.False(value.CanAccept);Assert.Contains("sourcing_offer_expired_conflict",value.Blockers);return;}
        var error=await Assert.ThrowsAsync<BusinessException>(async()=>{
            if(action=="start"){var service=new SourcingSupplyService(db,catalog,scope.ServiceProvider.GetRequiredService<ISourcingSupplyNoteProtection>(),clock,true);await service.StartAsync("deadline-staff",scenario.Request,offer,Id(),new(Id(),ReadString(detail,"requestVersion"),ReadString(summary,"version"),ReadString(summary,"termsHash")),default);}
            else{var service=new SourcingOfferService(db,catalog,scope.ServiceProvider.GetRequiredService<IPurchaseConfiguration>(),clock,true);if(action=="publish")await service.PublishAsync("deadline-staff",scenario.Request,offer,PublishInput(detail),default);else await service.AcceptAsync(scenario.Owner,scenario.Request,offer,Action(detail),default);}
        });Assert.Equal(action=="start"?"sourcing_supply_reoffer_conflict":"sourcing_offer_expired_conflict",error.Code);await transaction.RollbackAsync();
        await using var check=fixture.Sql.Factory.Services.CreateAsyncScope();var current=check.ServiceProvider.GetRequiredService<MarketDbContext>();Assert.Equal(action switch{"publish"=>"Draft","accept"=>"Published",_=>"Accepted"},(await current.SourcingOffers.AsNoTracking().SingleAsync(row=>row.Id==offer)).State);Assert.False(await current.SourcingSupplyTasks.AnyAsync(row=>row.OfferId==offer));if(action=="accept")Assert.False(await current.SourcingOfferAcceptances.AnyAsync(row=>row.OfferId==offer));
    }
}
