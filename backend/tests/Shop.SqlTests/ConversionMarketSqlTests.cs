using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Market;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;

// Real GUID-owned SQL Market graph and customer event tests. Explicit internal
// Catalog/purchasing contracts are used here; root HTTP tests cover authority
// across the actual Market, Cart2, Agreement and Inventory modules.
public sealed class ConversionMarketSqlTests(SqlFixture fixture):IClassFixture<SqlFixture>
{
    private const string V="AAAAAAAAAAE=";
    private static readonly string Material=new('A',64);
    private static readonly DateTimeOffset At=new(2030,1,1,0,0,0,TimeSpan.Zero);
    private static string Id()=>Guid.NewGuid().ToString("N");
    private sealed class Clock:TimeProvider{public DateTimeOffset Now=At;public override DateTimeOffset GetUtcNow()=>Now;}
    private sealed record Scenario(string Request,string Task,string Offer,string Acceptance,string Line,string Owner,OfferSkuSnapshot Sku);
    private async Task<T> Scope<T>(Func<MarketDbContext,Task<T>> action)
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<MarketDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);return await action(db);
    }
    private async Task<T> Tx<T>(Func<MarketDbContext,Task<T>> action)=>await Scope(async db=>{await using var transaction=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);var result=await action(db);await transaction.CommitAsync();return result;});
    private static OfferSkuSnapshot Sku()
    {
        var product="model"+Id();return new("variant"+Id(),product,"seller","QA-CONVERSION-"+Id(),new(product,"synthetic-phone","phones","گوشی","Phones","brand","QA brand","نام اصلی","Original accepted name","شرح اصلی","Original accepted description",["/products/phone-green.svg"],[]),"نسخه اصلی","Original variant","green","سبز","Green","گارانتی اصلی","Original warranty",[],["online"],null,[],"123",V,new string('B',64),Material);
    }
    private async Task<Scenario> Create(bool demo=false)=>await Scope(async db=>{
        var request=Id();var offerId=Id();var taskId=Id();var acceptance=Id();var listing=Id();var lineId=Id();var owner="conversion-owner-"+Id();var sku=Sku();
        var parent=new SourcingRequest{Id=request,OwnerId=owner,SubmitRequestId=Id(),PayloadHash=Material,CartId=Id(),SubmittedCartVersion=V,Locale="fa",State="Reviewing",ProtectedNote="Synthetic private customer note",ContainsDemo=demo,CreatedAt=At.AddMinutes(-10),ChangedAt=At.AddMinutes(-5)};
        var offer=new SourcingOffer{Id=offerId,RequestId=request,Revision=1,State="Accepted",IsActive=true,ContainsDemo=demo,TermsFa="شرایط اصلی و دقیق آزمون",TermsEn="Exact original QA terms",AcceptUntil=At.AddMinutes(-1),PurchaseUntil=At.AddHours(2),CreatedAt=At.AddMinutes(-10),ChangedAt=At.AddMinutes(-5),PublishedAt=At.AddMinutes(-8),AcceptedAt=At.AddMinutes(-5),AcceptanceId=acceptance};
        offer.Lines=[SourcingOfferSnapshots.Store(offerId,new(lineId,listing,sku.VariantId,2,"9007199254740993",sku.MaterialFingerprint,sku.CurrentFingerprint),sku)];offer.TotalRial=18014398509481986;offer.TermsHash=SourcingOfferSnapshots.TermsHash(offer);
        var consent=new SourcingOfferAcceptance{OfferId=offerId,Id=acceptance,OwnerId=owner,TermsHash=offer.TermsHash,OfferVersion=V,At=offer.AcceptedAt.Value};
        var task=new SourcingSupplyTask{Id=taskId,RequestId=request,OfferId=offerId,AcceptanceId=acceptance,OwnerId=owner,TermsHash=offer.TermsHash,ContainsDemo=demo,CreatedAt=At.AddMinutes(-4),ChangedAt=At.AddMinutes(-4),ProtectedNote="PRIVATE synthetic supplier note",Lines=[new(){TaskId=taskId,OfferLineId=lineId,VariantId=sku.VariantId,ProductId=sku.ProductId,Sku=sku.Sku,NameFa=sku.Model.NameFa,NameEn=sku.Model.NameEn,LabelFa=sku.LabelFa,LabelEn=sku.LabelEn,RequiredQuantity=2,ReceivedQuantity=2,MaterialFingerprint=Material}]};
        db.SourcingRequests.Add(parent);db.SourcingOffers.Add(offer);db.SourcingOfferAcceptances.Add(consent);db.SourcingSupplyTasks.Add(task);await db.SaveChangesAsync();return new Scenario(request,taskId,offerId,acceptance,lineId,owner,sku);
    });
    private static async Task<SourcingConversionInput> Input(MarketDbContext db,Scenario s)
    {
        var parent=await db.SourcingRequests.AsNoTracking().SingleAsync(r=>r.Id==s.Request);var task=await db.SourcingSupplyTasks.AsNoTracking().SingleAsync(t=>t.Id==s.Task);var offer=await db.SourcingOffers.AsNoTracking().SingleAsync(o=>o.Id==s.Offer);return new(Id(),s.Task,Convert.ToBase64String(parent.Version),Convert.ToBase64String(task.Version),Convert.ToBase64String(offer.Version),s.Acceptance,Id(),V,Id(),V,offer.TermsHash!,null);
    }
    private sealed class Catalog(OfferSkuSnapshot sku):ICatalogOfferReader
    {
        public OfferSkuSnapshot Current=sku;public string? Failure;public int Reads;
        public Task<IReadOnlyDictionary<string,OfferSkuSnapshot>> ReadAsync(string[] ids,CancellationToken ct){Reads++;if(Failure is not null)throw new BusinessException(Failure,"Explicit synthetic Catalog failure");return Task.FromResult<IReadOnlyDictionary<string,OfferSkuSnapshot>>(new Dictionary<string,OfferSkuSnapshot>{{Current.VariantId,Current}});}
        public Task<OfferSkuPage> LookupAsync(string modelId,string? query,string? cursor,CancellationToken ct)=>throw new NotSupportedException();
    }
    private sealed class Purchasing:IPurchaseConfiguration
    {
        public bool Enabled=true;public Action? OnRead;
        public Task<IReadOnlyList<PurchaseMethodData>> MethodsAsync(string locale,CancellationToken ct){OnRead?.Invoke();return Task.FromResult<IReadOnlyList<PurchaseMethodData>>([new("online","online","پرداخت","Synthetic configuration only",Enabled,false,[],null,null)]);}
        public Task<IReadOnlyList<CreditPlanData>> PlansAsync(string locale,CancellationToken ct)=>Task.FromResult<IReadOnlyList<CreditPlanData>>([]);
    }
    private static SourcingConversionMutation Result(Scenario s,SourcingConversionInput input)=>new(1,Id(),s.Request,s.Task,s.Offer,s.Acceptance,input.AgreementId,input.AllocationId,Id(),V,[new(Id(),Id(),s.Line)],input.RequestId,At,false);
    private static async Task PrepareLocks(SourcingConversionPlanService service,Scenario s,SourcingConversionInput input)
    {
        await service.AcquireOwnerAsync(s.Owner,default);await service.AcquireRequestTaskAsync(s.Owner,s.Request,s.Offer,s.Task,input.RequestId,default);
    }
    [Fact] public async Task LockedOwnerCandidateKeepsImmutableAcceptedPriceAndPhysicalSnapshotWhenPublicPriceChanges()
    {
        var s=await Create();await Tx(async db=>{var catalog=new Catalog(s.Sku with{PublicPriceRial="999999",Version="AAAAAAAAAAI=",CurrentFingerprint=new string('C',64)});var service=new SourcingConversionPlanService(db,catalog,new Purchasing(),new Clock(),true);await Assert.ThrowsAsync<InvalidOperationException>(()=>service.CandidateAsync(s.Owner,s.Request,s.Offer,default));Assert.Equal(0,catalog.Reads);await service.AcquireCandidateLocksAsync(s.Owner,s.Request,s.Offer,default);var plan=await service.CandidateAsync(s.Owner,s.Request,s.Offer,default);Assert.Equal("9007199254740993",Assert.Single(plan.Lines).UnitPriceRial);Assert.Equal("123",plan.Lines[0].Sku.PublicPriceRial);Assert.Equal("Original warranty",plan.Lines[0].Sku.WarrantyEn);Assert.Equal(s.Owner,plan.OwnerId);Assert.Equal(s.Task,plan.TaskId);Assert.Equal(0,await db.SourcingSupplyEvents.CountAsync(e=>e.TaskId==s.Task));return true;});
    }
    [Fact] public async Task ForeignOwnerDemoAndTargetDoNotRevealCandidateOrReadCatalog()
    {
        var s=await Create(demo:true);await Tx(async db=>{var catalog=new Catalog(s.Sku);var service=new SourcingConversionPlanService(db,catalog,new Purchasing(),new Clock(),true);Assert.Equal("not_found",(await Assert.ThrowsAsync<BusinessException>(()=>service.AcquireCandidateLocksAsync("other-owner",s.Request,s.Offer,default))).Code);Assert.Equal(0,catalog.Reads);var noDemo=new SourcingConversionPlanService(db,catalog,new Purchasing(),new Clock(),false);Assert.Equal("not_found",(await Assert.ThrowsAsync<BusinessException>(()=>noDemo.AcquireCandidateLocksAsync(s.Owner,s.Request,s.Offer,default))).Code);Assert.Equal("not_found",(await Assert.ThrowsAsync<BusinessException>(()=>service.AcquireCandidateLocksAsync(s.Owner,s.Request,Id(),default))).Code);Assert.Equal(0,catalog.Reads);return true;});
    }
    [Theory][InlineData("expired")][InlineData("closed-parent")][InlineData("closed-task")][InlineData("inactive")][InlineData("consent-owner")]
    public async Task ReceivedStockDoesNotBypassCurrentOpenOwnedConsent(string invalid)
    {
        var s=await Create();await Scope(async db=>{var parent=await db.SourcingRequests.SingleAsync(r=>r.Id==s.Request);var task=await db.SourcingSupplyTasks.SingleAsync(t=>t.Id==s.Task);var offer=await db.SourcingOffers.SingleAsync(o=>o.Id==s.Offer);switch(invalid){case "expired":offer.PurchaseUntil=At;break;case "closed-parent":parent.State="Cancelled";break;case "closed-task":task.State="Cancelled";task.IsOpen=false;break;case "inactive":offer.IsActive=false;break;default:(await db.SourcingOfferAcceptances.SingleAsync(a=>a.OfferId==s.Offer)).OwnerId="other-owner";break;}await db.SaveChangesAsync();return true;});
        await Tx(async db=>{var input=await Input(db,s);var catalog=new Catalog(s.Sku);var service=new SourcingConversionPlanService(db,catalog,new Purchasing(),new Clock(),true);await PrepareLocks(service,s,input);Assert.Equal("sourcing_supply_reoffer_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>service.PrepareAsync(s.Owner,s.Request,s.Offer,input,default))).Code);Assert.Equal(0,catalog.Reads);return true;});
    }
    [Theory][InlineData("request")][InlineData("task")][InlineData("offer")][InlineData("terms")]
    public async Task ConversionBindsEveryMarketVersionAndExactTerms(string invalid)
    {
        var s=await Create();await Tx(async db=>{var input=await Input(db,s);input=invalid switch{"request"=>input with{RequestVersion=V},"task"=>input with{TaskVersion=V},"offer"=>input with{OfferVersion=V},_=>input with{TermsHash=new string('D',64)}};var service=new SourcingConversionPlanService(db,new Catalog(s.Sku),new Purchasing(),new Clock(),true);await PrepareLocks(service,s,input);Assert.Equal(invalid=="terms"?"sourcing_supply_reoffer_conflict":"version_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>service.PrepareAsync(s.Owner,s.Request,s.Offer,input,default))).Code);return true;});
    }
    [Theory][InlineData("material")][InlineData("capacity")][InlineData("transport")][InlineData("purchasing")][InlineData("elapsed-during-read")]
    public async Task CurrentCatalogPurchasingAndExactServerDeadlineRemainRequired(string invalid)
    {
        var s=await Create();await Tx(async db=>{var input=await Input(db,s);var catalog=new Catalog(s.Sku);var purchasing=new Purchasing();var clock=new Clock();if(invalid=="material")catalog.Current=s.Sku with{MaterialFingerprint=new string('D',64)};if(invalid=="capacity")catalog.Failure="catalog_unavailable";if(invalid=="transport")catalog.Failure="catalog_transport_unavailable";if(invalid=="purchasing")purchasing.Enabled=false;if(invalid=="elapsed-during-read")purchasing.OnRead=()=>clock.Now=At.AddHours(2);var service=new SourcingConversionPlanService(db,catalog,purchasing,clock,true);await PrepareLocks(service,s,input);Assert.Equal(invalid switch{"transport"=>"catalog_transport_unavailable","purchasing"=>"sourcing_offer_purchase_conflict","elapsed-during-read"=>"sourcing_conversion_expired_conflict",_=>"sourcing_offer_catalog_conflict"},(await Assert.ThrowsAsync<BusinessException>(()=>service.PrepareAsync(s.Owner,s.Request,s.Offer,input,default))).Code);return true;});
    }
    [Fact] public async Task PreparedTupleCannotChangeActorPlanCommandTargetsLinksOrCrossTransactionBoundary()
    {
        var s=await Create();await Tx(async db=>{var input=await Input(db,s);var service=new SourcingConversionPlanService(db,new Catalog(s.Sku),new Purchasing(),new Clock(),true);await Assert.ThrowsAsync<InvalidOperationException>(()=>service.AcquireRequestTaskAsync(s.Owner,s.Request,s.Offer,s.Task,input.RequestId,default));await PrepareLocks(service,s,input);var plan=await service.PrepareAsync(s.Owner,s.Request,s.Offer,input,default);var result=Result(s,input);
            foreach(var action in new Func<Task>[] {()=>service.CompleteAsync("other-owner",plan,result,default),()=>service.CompleteAsync(s.Owner,plan with{},result,default),()=>service.CompleteAsync(s.Owner,plan,result with{CommandId=Id()},default),()=>service.CompleteAsync(s.Owner,plan,result with{Replayed=true},default),()=>service.CompleteAsync(s.Owner,plan,result with{CanCheckout=true},default),()=>service.CompleteAsync(s.Owner,plan,result with{AllocationId=Id()},default),()=>service.CompleteAsync(s.Owner,plan,result with{AgreementId=Id()},default),()=>service.CompleteAsync(s.Owner,plan,result with{Lines=[new(Id(),Id(),Id())]},default)})await Assert.ThrowsAsync<InvalidOperationException>(action);
            Assert.Equal(0,await db.SourcingSupplyEvents.CountAsync(e=>e.TaskId==s.Task));await service.CompleteAsync(s.Owner,plan,result,default);await Assert.ThrowsAsync<InvalidOperationException>(()=>service.CompleteAsync(s.Owner,plan,result,default));return true;});
        await Scope(async db=>{var service=new SourcingConversionPlanService(db,new Catalog(s.Sku),new Purchasing(),new Clock(),true);SourcingConversionInput input;AcceptedSourcingPurchasePlan plan;await using(var one=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable)){input=await Input(db,s);await PrepareLocks(service,s,input);plan=await service.PrepareAsync(s.Owner,s.Request,s.Offer,input,default);await one.RollbackAsync();}await using var two=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);await Assert.ThrowsAsync<InvalidOperationException>(()=>service.PrepareAsync(s.Owner,s.Request,s.Offer,input,default));await Assert.ThrowsAsync<InvalidOperationException>(()=>service.CompleteAsync(s.Owner,plan,Result(s,input),default));return true;});
    }
    [Fact] public async Task CompletionAddsCompatiblePublicCustomerEventAndTouchesOnlyParentTaskVersions()
    {
        var s=await Create();await Tx(async db=>{var input=await Input(db,s);var service=new SourcingConversionPlanService(db,new Catalog(s.Sku),new Purchasing(),new Clock(),true);await PrepareLocks(service,s,input);var plan=await service.PrepareAsync(s.Owner,s.Request,s.Offer,input,default);await service.CompleteAsync(s.Owner,plan,Result(s,input),default);var parent=await db.SourcingRequests.AsNoTracking().SingleAsync(r=>r.Id==s.Request);var task=await db.SourcingSupplyTasks.AsNoTracking().SingleAsync(t=>t.Id==s.Task);var offer=await db.SourcingOffers.AsNoTracking().SingleAsync(o=>o.Id==s.Offer);Assert.NotEqual(input.RequestVersion,Convert.ToBase64String(parent.Version));Assert.NotEqual(input.TaskVersion,Convert.ToBase64String(task.Version));Assert.Equal(input.OfferVersion,Convert.ToBase64String(offer.Version));Assert.Equal("Reviewing",parent.State);Assert.Equal("PendingSupply",task.State);Assert.True(task.IsOpen);Assert.True(offer.IsActive);Assert.Equal("Accepted",offer.State);Assert.Equal(At.AddHours(2),offer.PurchaseUntil);Assert.Equal(18014398509481986,offer.TotalRial);Assert.Equal(0,await db.SourcingRequestEvents.CountAsync(e=>e.RequestId==s.Request));var ev=await db.SourcingSupplyEvents.AsNoTracking().SingleAsync(e=>e.TaskId==s.Task);Assert.Equal("customer",ev.ActorKind);Assert.Equal("cart_converted",ev.ReasonCode);Assert.Equal(ev.StateBefore,ev.StateAfter);Assert.Equal("Complete",ev.ReceiptProgress);Assert.DoesNotContain("9007199254740993",ev.PublicMessageEn);Assert.DoesNotContain("PRIVATE",ev.PublicMessageEn);return true;});
    }
    [Fact] public async Task DeadlineCrossedAfterPreparationRejectsFinalEventWithoutChangingMarket()
    {
        var s=await Create();await Tx(async db=>{var input=await Input(db,s);var clock=new Clock();var service=new SourcingConversionPlanService(db,new Catalog(s.Sku),new Purchasing(),clock,true);await PrepareLocks(service,s,input);var plan=await service.PrepareAsync(s.Owner,s.Request,s.Offer,input,default);clock.Now=plan.PurchaseUntil;Assert.Equal("sourcing_conversion_expired_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>service.CompleteAsync(s.Owner,plan,Result(s,input),default))).Code);Assert.Equal(input.RequestVersion,Convert.ToBase64String((await db.SourcingRequests.AsNoTracking().SingleAsync(r=>r.Id==s.Request)).Version));Assert.Equal(input.TaskVersion,Convert.ToBase64String((await db.SourcingSupplyTasks.AsNoTracking().SingleAsync(t=>t.Id==s.Task)).Version));Assert.Equal(0,await db.SourcingSupplyEvents.CountAsync(e=>e.TaskId==s.Task));return true;});
    }
    [Fact] public async Task EventWriteFailureRollsBackBothParentAndTaskVersions()
    {
        var s=await Create();var input=await Scope(db=>Input(db,s));await Scope(async db=>{await db.Database.ExecuteSqlRawAsync("ALTER TABLE [market].[SourcingSupplyEvents] WITH NOCHECK ADD CONSTRAINT [CK_ConversionAtomicFailure] CHECK ([ReasonCode]<>N'cart_converted')");return true;});
        try{await Assert.ThrowsAsync<DbUpdateException>(()=>Tx(async db=>{var service=new SourcingConversionPlanService(db,new Catalog(s.Sku),new Purchasing(),new Clock(),true);await PrepareLocks(service,s,input);var plan=await service.PrepareAsync(s.Owner,s.Request,s.Offer,input,default);await service.CompleteAsync(s.Owner,plan,Result(s,input),default);return true;}));}finally{await Scope(async db=>{await db.Database.ExecuteSqlRawAsync("ALTER TABLE [market].[SourcingSupplyEvents] DROP CONSTRAINT [CK_ConversionAtomicFailure]");return true;});}
        await Scope(async db=>{Assert.Equal(input.RequestVersion,Convert.ToBase64String((await db.SourcingRequests.AsNoTracking().SingleAsync(r=>r.Id==s.Request)).Version));Assert.Equal(input.TaskVersion,Convert.ToBase64String((await db.SourcingSupplyTasks.AsNoTracking().SingleAsync(t=>t.Id==s.Task)).Version));Assert.Equal(0,await db.SourcingSupplyEvents.CountAsync(e=>e.TaskId==s.Task));return true;});
    }
}
