using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Market;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;

// Actual SQL Market graph/version/lifecycle tests. Catalog and purchasing are
// explicit test contracts here; composition-root HTTP tests prove the actual
// cross-module inventory/financial boundary separately.
public sealed class AllocationMarketSqlTests(SqlFixture fixture):IClassFixture<SqlFixture>
{
    private const string V="AAAAAAAAAAE=";
    private static readonly string Material=new('A',64);
    private static readonly DateTimeOffset At=new(2030,1,1,0,0,0,TimeSpan.Zero);
    private static string Id()=>Guid.NewGuid().ToString("N");
    private sealed class Clock(DateTimeOffset now):TimeProvider{public DateTimeOffset Now=now;public override DateTimeOffset GetUtcNow()=>Now;}
    private sealed record Scenario(string Request,string Task,string Offer,string Acceptance,string Line,string Listing,string Owner,OfferSkuSnapshot Sku);
    private async Task<T> Scope<T>(Func<MarketDbContext,Task<T>> action)
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<MarketDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);return await action(db);
    }
    private static OfferSkuSnapshot Sku()
    {
        var product="model"+Id();return new("variant"+Id(),product,"seller", "QA-ALLOCATION-"+Id(),new(product,"synthetic-phone","phones","گوشی","Phones","brand","QA brand","نام اصلی","Original accepted name","شرح اصلی","Original accepted description",["/products/phone-green.svg"],[]),"نسخه اصلی","Original variant","green","سبز","Green","گارانتی اصلی","Original warranty",[],["online"],null,[],"123",V,new string('B',64),Material);
    }
    private async Task<Scenario> Create()=>await Scope(async db=>{
        var request=Id();var offerId=Id();var taskId=Id();var acceptance=Id();var listing=Id();var lineId=Id();var owner="allocation-owner-"+Id();var sku=Sku();
        var parent=new SourcingRequest{Id=request,OwnerId=owner,SubmitRequestId=Id(),PayloadHash=Material,CartId=Id(),SubmittedCartVersion=V,Locale="fa",State="Reviewing",ProtectedNote="Synthetic QA protected note",ContainsDemo=true,CreatedAt=At.AddMinutes(-10),ChangedAt=At.AddMinutes(-5)};
        var offer=new SourcingOffer{Id=offerId,RequestId=request,Revision=1,State="Accepted",IsActive=true,ContainsDemo=true,TermsFa="شرایط اصلی و دقیق آزمون",TermsEn="Exact original QA terms",AcceptUntil=At.AddMinutes(-1),PurchaseUntil=At.AddHours(2),CreatedAt=At.AddMinutes(-10),ChangedAt=At.AddMinutes(-5),PublishedAt=At.AddMinutes(-8),AcceptedAt=At.AddMinutes(-5),AcceptanceId=acceptance};
        offer.Lines=[SourcingOfferSnapshots.Store(offerId,new(lineId,listing,sku.VariantId,2,"9007199254740993",sku.MaterialFingerprint,sku.CurrentFingerprint),sku)];offer.TotalRial=18014398509481986;offer.TermsHash=SourcingOfferSnapshots.TermsHash(offer);
        var consent=new SourcingOfferAcceptance{OfferId=offerId,Id=acceptance,OwnerId=owner,TermsHash=offer.TermsHash,OfferVersion=V,At=offer.AcceptedAt.Value};
        var task=new SourcingSupplyTask{Id=taskId,RequestId=request,OfferId=offerId,AcceptanceId=acceptance,OwnerId=owner,TermsHash=offer.TermsHash,ContainsDemo=true,CreatedAt=At.AddMinutes(-4),ChangedAt=At.AddMinutes(-4),ProtectedNote="Synthetic private supplier note",Lines=[new(){TaskId=taskId,OfferLineId=lineId,VariantId=sku.VariantId,ProductId=sku.ProductId,Sku=sku.Sku,NameFa=sku.Model.NameFa,NameEn=sku.Model.NameEn,LabelFa=sku.LabelFa,LabelEn=sku.LabelEn,RequiredQuantity=2,ReceivedQuantity=2,MaterialFingerprint=Material}]};
        db.SourcingRequests.Add(parent);db.SourcingOffers.Add(offer);db.SourcingOfferAcceptances.Add(consent);db.SourcingSupplyTasks.Add(task);await db.SaveChangesAsync();return new Scenario(request,taskId,offerId,acceptance,lineId,listing,owner,sku);
    });
    private static async Task<SourcingAllocationInput> Input(MarketDbContext db,Scenario s)
    {
        var parent=await db.SourcingRequests.SingleAsync(r=>r.Id==s.Request);var task=await db.SourcingSupplyTasks.SingleAsync(t=>t.Id==s.Task);var offer=await db.SourcingOffers.SingleAsync(o=>o.Id==s.Offer);
        return new(Id(),Convert.ToBase64String(parent.Version),Convert.ToBase64String(task.Version),Convert.ToBase64String(offer.Version),s.Acceptance,offer.TermsHash,At.AddMinutes(30),"Explicit synthetic stock allocation",[new(s.Line,V,"None",[])]);
    }
    private sealed class Catalog(OfferSkuSnapshot sku):ICatalogOfferReader
    {
        public OfferSkuSnapshot Current=sku;public bool Missing;public string? Failure;public int Reads;
        public Task<IReadOnlyDictionary<string,OfferSkuSnapshot>> ReadAsync(string[] ids,CancellationToken ct)
        {
            Reads++;if(Failure is not null)throw new BusinessException(Failure,"Explicit synthetic Catalog failure");
            return Task.FromResult<IReadOnlyDictionary<string,OfferSkuSnapshot>>(Missing?new Dictionary<string,OfferSkuSnapshot>():new Dictionary<string,OfferSkuSnapshot>{{Current.VariantId,Current}});
        }
        public Task<OfferSkuPage> LookupAsync(string modelId,string? query,string? cursor,CancellationToken ct)=>throw new NotSupportedException();
    }
    private sealed class Purchasing:IPurchaseConfiguration
    {
        public PurchaseMethodData[] Methods=[new("online","online","پرداخت","QA configuration only",true,false,[],null,null)];public CreditPlanData[] Plans=[];public Action? OnRead;
        public Task<IReadOnlyList<PurchaseMethodData>> MethodsAsync(string locale,CancellationToken ct){OnRead?.Invoke();return Task.FromResult<IReadOnlyList<PurchaseMethodData>>(Methods);}
        public Task<IReadOnlyList<CreditPlanData>> PlansAsync(string locale,CancellationToken ct)=>Task.FromResult<IReadOnlyList<CreditPlanData>>(Plans);
    }
    private static SourcingAllocationMutation Result(Scenario s,SourcingAllocationInput input)=>new(1,Id(),s.Request,s.Task,s.Offer,s.Acceptance,"allocate","Active",V,input.RequestId,At,input.ExpiresAt,false);

    [Fact] public async Task AcceptedSnapshotRetainsExactBigMoneyOriginalMetadataAndVersionedPublicHistory()
    {
        var s=await Create();await Scope(async db=>{await using var transaction=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);var input=await Input(db,s);var current=s.Sku with{PublicPriceRial="999999",Version="AAAAAAAAAAI=",CurrentFingerprint=new string('C',64)};var service=new SourcingAllocationPlanService(db,new Catalog(current),new Purchasing(),new Clock(At),true);await service.AcquireLocksAsync("inventory-actor",s.Request,s.Task,input.RequestId,default);var plan=await service.PrepareAsync(s.Request,s.Task,input,default);
            Assert.Equal("9007199254740993",Assert.Single(plan.Lines).UnitPriceRial);Assert.Equal("123",plan.Lines[0].Sku.PublicPriceRial);Assert.Equal(V,plan.Lines[0].Sku.Version);Assert.Equal("گارانتی اصلی",plan.Lines[0].Sku.WarrantyFa);Assert.Equal("Exact original QA terms",plan.TermsEn);Assert.Equal(s.Owner,plan.OwnerId);Assert.True(plan.ContainsDemo);Assert.Equal(0,await db.SourcingSupplyEvents.CountAsync(e=>e.TaskId==s.Task));
            await service.CompleteAsync("inventory-actor",plan,Result(s,input),default);var task=await db.SourcingSupplyTasks.SingleAsync(t=>t.Id==s.Task);var parent=await db.SourcingRequests.SingleAsync(r=>r.Id==s.Request);var offer=await db.SourcingOffers.SingleAsync(o=>o.Id==s.Offer);Assert.NotEqual(input.RequestVersion,Convert.ToBase64String(parent.Version));Assert.NotEqual(input.TaskVersion,Convert.ToBase64String(task.Version));Assert.Equal(input.OfferVersion,Convert.ToBase64String(offer.Version));Assert.True(task.IsOpen);Assert.Equal("PendingSupply",task.State);var ev=await db.SourcingSupplyEvents.SingleAsync(e=>e.TaskId==s.Task);Assert.Equal("stock_allocated",ev.ReasonCode);Assert.Equal("Complete",ev.ReceiptProgress);Assert.Contains("UTC",ev.PublicMessageEn);Assert.DoesNotContain("9007199254740993",ev.PublicMessageEn);Assert.Equal(0,await db.SourcingRequestEvents.CountAsync(e=>e.RequestId==s.Request));return true;});
    }
    [Theory][InlineData("expired")][InlineData("inactive")][InlineData("owner")][InlineData("acceptance")][InlineData("closed-task")][InlineData("closed-parent")]
    public async Task AllocationRequiresCurrentExactOpenConsentEvenWithReceivedStock(string invalid)
    {
        var s=await Create();await Scope(async db=>{var offer=await db.SourcingOffers.SingleAsync(o=>o.Id==s.Offer);var task=await db.SourcingSupplyTasks.SingleAsync(t=>t.Id==s.Task);var parent=await db.SourcingRequests.SingleAsync(r=>r.Id==s.Request);var consent=await db.SourcingOfferAcceptances.SingleAsync(a=>a.OfferId==s.Offer);
            switch(invalid){case "expired":offer.PurchaseUntil=At;break;case "inactive":offer.IsActive=false;break;case "owner":consent.OwnerId="different-owner";break;case "acceptance":task.AcceptanceId=Id();break;case "closed-task":task.State="Cancelled";task.IsOpen=false;break;case "closed-parent":parent.State="Cancelled";break;}await db.SaveChangesAsync();await using var transaction=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);var input=await Input(db,s);var catalog=new Catalog(s.Sku);var service=new SourcingAllocationPlanService(db,catalog,new Purchasing(),new Clock(At),true);await service.AcquireLocksAsync("actor",s.Request,s.Task,input.RequestId,default);var error=await Assert.ThrowsAsync<BusinessException>(()=>service.PrepareAsync(s.Request,s.Task,input,default));Assert.Equal("sourcing_supply_reoffer_conflict",error.Code);Assert.Equal(0,catalog.Reads);Assert.Equal(0,await db.SourcingSupplyEvents.CountAsync(e=>e.TaskId==s.Task));return true;});
    }
    [Theory][InlineData("now")][InlineData("beyond-purchase")][InlineData("offset")][InlineData("elapsed-during-read")]
    public async Task ExplicitHoldDeadlineHasAnExactServerClockBoundary(string invalid)
    {
        var s=await Create();await Scope(async db=>{await using var transaction=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);var input=await Input(db,s);var clock=new Clock(At);var purchasing=new Purchasing();input=invalid switch{"now"=>input with{ExpiresAt=At},"beyond-purchase"=>input with{ExpiresAt=At.AddHours(2).AddTicks(1)},"offset"=>input with{ExpiresAt=input.ExpiresAt.ToOffset(TimeSpan.FromHours(1))},_=>input};if(invalid=="elapsed-during-read")purchasing.OnRead=()=>clock.Now=At.AddMinutes(30);var service=new SourcingAllocationPlanService(db,new Catalog(s.Sku),purchasing,clock,true);await service.AcquireLocksAsync("actor",s.Request,s.Task,input.RequestId,default);var error=await Assert.ThrowsAsync<BusinessException>(()=>service.PrepareAsync(s.Request,s.Task,input,default));Assert.Equal(invalid=="offset"?"invalid_sourcing_allocation":"sourcing_allocation_deadline_conflict",error.Code);return true;});
    }
    [Theory][InlineData("missing")][InlineData("material")][InlineData("capacity")][InlineData("transport")]
    public async Task HistoricalReceivingExceptionsNeverGrantFreshPurchaseRights(string invalid)
    {
        var s=await Create();await Scope(async db=>{await using var transaction=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);var input=await Input(db,s);var catalog=new Catalog(s.Sku);if(invalid=="missing")catalog.Missing=true;if(invalid=="material")catalog.Current=s.Sku with{MaterialFingerprint=new string('C',64)};if(invalid=="capacity")catalog.Failure="catalog_unavailable";if(invalid=="transport")catalog.Failure="catalog_transport_unavailable";var service=new SourcingAllocationPlanService(db,catalog,new Purchasing(),new Clock(At),true);await service.AcquireLocksAsync("actor",s.Request,s.Task,input.RequestId,default);var error=await Assert.ThrowsAsync<BusinessException>(()=>service.PrepareAsync(s.Request,s.Task,input,default));Assert.Equal(invalid=="transport"?"catalog_transport_unavailable":"sourcing_offer_catalog_conflict",error.Code);Assert.Equal(0,await db.SourcingSupplyEvents.CountAsync(e=>e.TaskId==s.Task));return true;});
    }
    [Theory][InlineData("disabled")][InlineData("amount")][InlineData("category")][InlineData("cheque-without-plan")]
    public async Task FreshAllocationRequiresEligibleCurrentPurchaseConfiguration(string invalid)
    {
        var s=await Create();await Scope(async db=>{await using var transaction=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);var input=await Input(db,s);var method=new Purchasing().Methods[0];var purchasing=new Purchasing{Methods=[invalid switch{"disabled"=>method with{Enabled=false},"amount"=>method with{MaxAmountRial=1},"category"=>method with{CategoryIds=["unrelated"]},_=>method with{Kind="cheque"}}]};var service=new SourcingAllocationPlanService(db,new Catalog(s.Sku),purchasing,new Clock(At),true);await service.AcquireLocksAsync("actor",s.Request,s.Task,input.RequestId,default);var error=await Assert.ThrowsAsync<BusinessException>(()=>service.PrepareAsync(s.Request,s.Task,input,default));Assert.Equal("sourcing_offer_purchase_conflict",error.Code);return true;});
    }
    [Theory][InlineData("request")][InlineData("task")][InlineData("offer")][InlineData("terms")][InlineData("line")][InlineData("duplicate-line")]
    public async Task ClientVersionsTermsAndAllAcceptedLineIdentitiesRemainBound(string invalid)
    {
        var s=await Create();await Scope(async db=>{await using var transaction=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);var input=await Input(db,s);input=invalid switch{"request"=>input with{RequestVersion=V},"task"=>input with{TaskVersion=V},"offer"=>input with{OfferVersion=V},"terms"=>input with{TermsHash=new string('D',64)},"line"=>input with{Lines=[new(Id(),V,"None",[])]},_=>input with{Lines=[input.Lines[0],input.Lines[0]]}};var service=new SourcingAllocationPlanService(db,new Catalog(s.Sku),new Purchasing(),new Clock(At),true);await service.AcquireLocksAsync("actor",s.Request,s.Task,input.RequestId,default);var error=await Assert.ThrowsAsync<BusinessException>(()=>service.PrepareAsync(s.Request,s.Task,input,default));Assert.Equal(invalid switch{"request" or "task" or "offer"=>"version_conflict","terms"=>"sourcing_supply_reoffer_conflict","line"=>"sourcing_allocation_line_conflict",_=>"invalid_sourcing_allocation"},error.Code);return true;});
    }
    [Fact] public async Task ScopedPlanCannotBeForgedReplayedOrCompletedForAnotherActorCommandOrDeadline()
    {
        var s=await Create();await Scope(async db=>{await using var transaction=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);var input=await Input(db,s);var catalog=new Catalog(s.Sku);var service=new SourcingAllocationPlanService(db,catalog,new Purchasing(),new Clock(At),true);await Assert.ThrowsAsync<InvalidOperationException>(()=>service.PrepareAsync(s.Request,s.Task,input,default));Assert.Equal(0,catalog.Reads);await service.AcquireLocksAsync("actor",s.Request,s.Task,input.RequestId,default);var plan=await service.PrepareAsync(s.Request,s.Task,input,default);var result=Result(s,input);
            foreach(var action in new Func<Task>[] {()=>service.CompleteAsync("other-actor",plan,result,default),()=>service.CompleteAsync("actor",plan with{},result,default),()=>service.CompleteAsync("actor",plan,result with{Replayed=true},default),()=>service.CompleteAsync("actor",plan,result with{CommandId=Id()},default),()=>service.CompleteAsync("actor",plan,result with{ExpiresAt=result.ExpiresAt.AddTicks(1)},default)})await Assert.ThrowsAsync<InvalidOperationException>(action);
            Assert.Equal(0,await db.SourcingSupplyEvents.CountAsync(e=>e.TaskId==s.Task));await service.CompleteAsync("actor",plan,result,default);await Assert.ThrowsAsync<InvalidOperationException>(()=>service.CompleteAsync("actor",plan,result,default));Assert.Equal(1,await db.SourcingSupplyEvents.CountAsync(e=>e.TaskId==s.Task));return true;});
    }
    [Fact] public async Task PreparedPlanAndHeldMarketLocksCannotCrossATransactionBoundary()
    {
        var s=await Create();await Scope(async db=>{var input=await Input(db,s);var service=new SourcingAllocationPlanService(db,new Catalog(s.Sku),new Purchasing(),new Clock(At),true);AcceptedSourcingPurchasePlan plan;
            await using(var first=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable)){await service.AcquireLocksAsync("actor",s.Request,s.Task,input.RequestId,default);plan=await service.PrepareAsync(s.Request,s.Task,input,default);await first.RollbackAsync();}
            await using var second=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);await Assert.ThrowsAsync<InvalidOperationException>(()=>service.PrepareAsync(s.Request,s.Task,input,default));await Assert.ThrowsAsync<InvalidOperationException>(()=>service.CompleteAsync("actor",plan,Result(s,input),default));Assert.Equal(0,await db.SourcingSupplyEvents.CountAsync(e=>e.TaskId==s.Task));return true;});
    }
    private sealed class Notes:ISourcingSupplyNoteProtection
    {
        public string Protect(string owner,string task,string note)=>"Synthetic protected note";
        public string Unprotect(string owner,string task,string value)=>"Synthetic note";
    }
    private sealed class DenyClose(MarketDbContext db,Scenario s):ISourcingPurchaseLifecycle
    {
        public int Calls;
        public async Task BeforeCloseAsync(string actor,string requestId,string taskId,string acceptanceId,string reason,CancellationToken ct)
        {
            Calls++;Assert.Equal(s.Request,requestId);Assert.Equal(s.Task,taskId);Assert.Equal(s.Acceptance,acceptanceId);var task=await db.SourcingSupplyTasks.SingleAsync(t=>t.Id==taskId,ct);Assert.True(task.IsOpen);Assert.Equal("PendingSupply",task.State);throw new BusinessException("sourcing_order_consumed_conflict","Synthetic authoritative Sales consumption guard.");
        }
    }
    [Theory][InlineData("cancel")][InlineData("fail")]
    public async Task SupplyCloseConsultsAuthoritativePurchaseLifecycleEvenAfterExpiredInactiveOffer(string operation)
    {
        var s=await Create();await Scope(async db=>{var offer=await db.SourcingOffers.SingleAsync(o=>o.Id==s.Offer);offer.IsActive=false;offer.PurchaseUntil=At;await db.SaveChangesAsync();await using var transaction=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);var input=await Input(db,s);var guard=new DenyClose(db,s);var service=new SourcingSupplyService(db,new Catalog(s.Sku),new Notes(),new Clock(At),true,guard);var close=new SourcingSupplyCloseInput(Id(),input.RequestVersion,input.TaskVersion,"supplier_unavailable","پیگیری بسته شود","Close supply");var error=await Assert.ThrowsAsync<BusinessException>(()=>operation=="cancel"?service.CancelAsync("actor",s.Request,s.Task,close,default):service.FailAsync("actor",s.Request,s.Task,close,default));Assert.Equal("sourcing_order_consumed_conflict",error.Code);Assert.Equal(1,guard.Calls);Assert.True((await db.SourcingSupplyTasks.SingleAsync(t=>t.Id==s.Task)).IsOpen);Assert.Equal(0,await db.SourcingSupplyEvents.CountAsync(e=>e.TaskId==s.Task));return true;});
    }
    private sealed class NoRequestDependencies:IMarketSourcingReader,ISourcingCart,ISourcingNoteProtection
    {
        public Task<IReadOnlyDictionary<string,SourcingCandidate>> ReadAsync(string locale,string[] listingIds,CancellationToken ct)=>throw new InvalidOperationException("Parent closure must not read live listings.");
        public Task<SourcingCartContents> ReadForSubmissionAsync(string ownerId,CancellationToken ct)=>throw new InvalidOperationException("Parent closure must not read a cart.");
        public Task ConsumeSourcingAsync(string ownerId,string version,CancellationToken ct)=>throw new InvalidOperationException("Parent closure must not consume cart selections.");
        public string Protect(string ownerId,string requestId,string note)=>throw new InvalidOperationException("Parent closure does not change the customer's note.");
        public string Unprotect(string ownerId,string requestId,string protectedNote)=>throw new NotSupportedException();
    }
    [Theory][InlineData("customer")][InlineData("staff")]
    public async Task ExpiredConsentDoesNotLetParentCloseBypassAuthoritativePurchaseLifecycle(string kind)
    {
        var s=await Create();await Scope(async db=>{var offer=await db.SourcingOffers.SingleAsync(o=>o.Id==s.Offer);offer.PurchaseUntil=At;await db.SaveChangesAsync();await using var transaction=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);var input=await Input(db,s);var guard=new DenyClose(db,s);var dependencies=new NoRequestDependencies();var service=new SourcingRequestService(db,dependencies,dependencies,dependencies,new Clock(At),new SourcingRequestOptions(),true,guard);
            var error=await Assert.ThrowsAsync<BusinessException>(()=>kind=="customer"?service.CancelAsync(s.Owner,s.Request,new(Id(),input.RequestVersion),default):service.UnavailableAsync("staff-actor",s.Request,new(Id(),input.RequestVersion,"supplier_unavailable","Supply unavailable"),default));Assert.Equal("sourcing_order_consumed_conflict",error.Code);Assert.Equal(1,guard.Calls);Assert.True((await db.SourcingSupplyTasks.AsNoTracking().SingleAsync(t=>t.Id==s.Task)).IsOpen);Assert.Equal("Reviewing",(await db.SourcingRequests.AsNoTracking().SingleAsync(r=>r.Id==s.Request)).State);Assert.True((await db.SourcingOffers.AsNoTracking().SingleAsync(o=>o.Id==s.Offer)).IsActive);Assert.Equal(0,await db.SourcingSupplyEvents.CountAsync(e=>e.TaskId==s.Task));Assert.Equal(0,await db.SourcingRequestEvents.CountAsync(e=>e.RequestId==s.Request));return true;});
    }
}
