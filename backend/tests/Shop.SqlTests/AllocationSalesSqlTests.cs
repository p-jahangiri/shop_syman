using System.Data;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Inventory;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;

// Direct accepted-price authority only. These trusted internal plans do not
// claim HTTP consent, payment, conversion, Order2 or physical Stock allocation.
public sealed class AllocationSalesSqlTests(SqlFixture fixture):IClassFixture<SqlFixture>
{
    private static string Id()=>Guid.NewGuid().ToString("N");
    private const string V="AAAAAAAAAAA=";
    private static readonly string Hash=new('A',64);
    private sealed class Clock:TimeProvider
    {
        private long ticks=DateTimeOffset.UtcNow.UtcTicks;
        public override DateTimeOffset GetUtcNow()=>new(Interlocked.Read(ref ticks),TimeSpan.Zero);
        public void Advance(TimeSpan by)=>Interlocked.Add(ref ticks,by.Ticks);
    }
    private readonly Clock clock=new();
    private sealed record Core(SalesDbContext Db,SourcingPriceAgreementService Service);
    private Core Services(IServiceProvider sp,bool allowDemo=true){var db=sp.GetRequiredService<SalesDbContext>();return new(db,new(db,clock,allowDemo));}
    private async Task<T> Scope<T>(Func<IServiceProvider,Task<T>> action){await using var scope=fixture.Factory.Services.CreateAsyncScope();return await action(scope.ServiceProvider);}
    private async Task<T> Tx<T>(Func<Core,Task<T>> action){await using var scope=fixture.Factory.Services.CreateAsyncScope();var c=Services(scope.ServiceProvider);Assert.StartsWith("SaymanTest_",c.Db.Database.GetDbConnection().Database);await using var transaction=await c.Db.Database.BeginTransactionAsync(IsolationLevel.Serializable);var result=await action(c);await transaction.CommitAsync();return result;}
    private Task<bool> Ensure(AcceptedSourcingPurchasePlan plan,string? allocation=null)=>Tx(async c=>{await c.Service.EnsureForAllocationAsync(plan,allocation??Id(),default);return true;});
    private Task<bool> Close(AcceptedSourcingPurchasePlan plan)=>Tx(async c=>{await c.Service.BeforeCloseAsync(plan.AcceptanceId,plan.RequestId,plan.TaskId,default);return true;});
    private Task<SourcingPriceAgreementData> Read(AcceptedSourcingPurchasePlan plan,string? owner=null,bool allowDemo=true)=>Scope(sp=>Services(sp,allowDemo).Service.ReadAsync(plan.AcceptanceId,plan.RequestId,owner,default));
    private static OfferSkuSnapshot SyntheticSku()=>new("sku","model","sayman","QA-AGREEMENT",new("model","qa-model","phones","گوشی","Phones","brand","Brand","مدل نمونه","Synthetic model","شرح","Description",[],[]),"پیکربندی","Configuration","#123456","رنگ","Colour","گارانتی پذیرفته‌شده","Accepted warranty",[],["online"],null,[],"101",V,Hash,Hash);
    private AcceptedSourcingPurchasePlan Plan(OfferSkuSnapshot? sku=null)=>new(Id(),Id(),Id(),1,Id(),"owner-"+Id(),Hash,V,V,V,clock.GetUtcNow().AddHours(2),"شرایط مصنوعی پذیرفته‌شده SQL","Synthetic accepted SQL terms",false,[new(Id(),Id(),2,"9007199254740993",sku??SyntheticSku())]);
    private Task<(int Orders,int Quotes,int Reservations,long OnHand,long Reserved,long Sourcing)> Counters()=>Scope(async sp=>{var sales=sp.GetRequiredService<SalesDbContext>();var inventory=sp.GetRequiredService<InventoryDbContext>();return(await sales.Orders.CountAsync(),await sales.Quotes.CountAsync(),await inventory.Reservations.CountAsync(),await inventory.Stock.SumAsync(s=>(long)s.OnHand),await inventory.Stock.SumAsync(s=>(long)s.Reserved),await inventory.Stock.SumAsync(s=>(long)s.SourcingReserved));});
    private Task<int> AgreementCount(string acceptance)=>Scope(sp=>sp.GetRequiredService<SalesDbContext>().Set<SourcingPriceAgreement>().CountAsync(a=>a.AcceptanceId==acceptance));
    private Task<OfferSkuSnapshot> ActualCatalogSku()=>Scope(async sp=>{var db=sp.GetRequiredService<CatalogDbContext>();var product=await db.Products.Where(p=>p.Status=="Published"&&!p.IsDigital&&p.PurchaseMethods.Any()).OrderBy(p=>p.Id).Select(p=>p.Id).FirstAsync();var id=Id();db.Variants.Add(new ProductVariant{Id=id,ProductId=product,Sku="QA-AGREEMENT-"+id,PriceRial=101,LabelFa="پیکربندی آزمون",LabelEn="Synthetic configuration",ColorNameFa="رنگ نمونه",ColorNameEn="Synthetic colour",WarrantyFa="گارانتی پذیرفته‌شده",WarrantyEn="Accepted warranty"});await db.SaveChangesAsync();return(await sp.GetRequiredService<ICatalogOfferReader>().ReadAsync([id],default))[id];});

    [Fact] public async Task AcceptedRialAndWarrantyStayImmutableWhenActualPublicCatalogPriceChanges()
    {
        var sku=await ActualCatalogSku();var plan=Plan(sku);var before=await Counters();await Ensure(plan);var accepted=await Read(plan,plan.OwnerId);Assert.Equal("9007199254740993",accepted.Lines[0].UnitPriceRial);Assert.Equal("18014398509481986",accepted.Lines[0].LineTotalRial);Assert.Equal("101",accepted.Lines[0].Sku.PublicPriceRial);
        await Scope(async sp=>{var db=sp.GetRequiredService<CatalogDbContext>();var variant=await db.Variants.SingleAsync(v=>v.Id==sku.VariantId);variant.PriceRial=777;variant.WarrantyEn="Current public warranty changed";await db.SaveChangesAsync();return true;});var unchanged=await Read(plan,plan.OwnerId);Assert.Equal(JsonSerializer.Serialize(accepted),JsonSerializer.Serialize(unchanged));Assert.False(unchanged.CanPay);Assert.Equal(before,await Counters());Assert.Equal(777,await Scope(sp=>sp.GetRequiredService<CatalogDbContext>().Variants.Where(v=>v.Id==sku.VariantId).Select(v=>v.PriceRial).SingleAsync()));
    }

    [Fact] public async Task ExplicitNewAllocationRetainsSameAgreementLineIdentityPriceAndAcceptedSku()
    {
        var plan=Plan();var first=Id();await Ensure(plan,first);var before=await Read(plan);var next=Id();await Ensure(plan with{RequestVersion="AQAAAAAAAAA=",TaskVersion="AgAAAAAAAAA=",OfferVersion="AwAAAAAAAAA="},next);var after=await Read(plan);Assert.Equal(1,await AgreementCount(plan.AcceptanceId));Assert.Equal(before.Id,after.Id);Assert.NotEqual(before.Version,after.Version);Assert.Equal(next,after.AllocationId);Assert.Equal(JsonSerializer.Serialize(before.Lines),JsonSerializer.Serialize(after.Lines));Assert.Equal(before.TermsHash,after.TermsHash);Assert.Equal(before.PurchaseUntil,after.PurchaseUntil);
    }

    [Fact] public async Task ChangedAcceptedPriceQuantityOwnerOrWarrantyCannotRewriteAnExistingAuthority()
    {
        var plan=Plan();await Ensure(plan);var before=await Read(plan);foreach(var changed in new[]{plan with{OwnerId="other-owner"},plan with{TermsEn="Other commercial terms"},plan with{Lines=[plan.Lines[0] with{Quantity=1}]},plan with{Lines=[plan.Lines[0] with{UnitPriceRial="1"}]},plan with{Lines=[plan.Lines[0] with{Sku=plan.Lines[0].Sku with{WarrantyEn="Replacement warranty"}}]}})Assert.Equal("sourcing_agreement_terms_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Ensure(changed))).Code);Assert.Equal(JsonSerializer.Serialize(before),JsonSerializer.Serialize(await Read(plan)));
    }

    [Fact] public async Task SameSkuAtTwoAcceptedPricesRetainsTwoDistinctCommercialLines()
    {
        var plan=Plan();plan=plan with{Lines=[plan.Lines[0],plan.Lines[0] with{OfferLineId=Id(),ListingId=Id(),Quantity=1,UnitPriceRial="7"}]};var before=await Counters();await Ensure(plan);var data=await Read(plan,plan.OwnerId);Assert.Equal(2,data.Lines.Length);Assert.Equal(2,data.Lines.Select(l=>l.Id).Distinct().Count());Assert.Single(data.Lines,l=>l.UnitPriceRial=="7"&&l.LineTotalRial=="7"&&l.Quantity==1);Assert.Single(data.Lines,l=>l.UnitPriceRial=="9007199254740993"&&l.LineTotalRial=="18014398509481986"&&l.Quantity==2);Assert.Equal(before,await Counters());
    }

    [Fact] public async Task ConcurrentIdenticalPlansHaveOneImmutableAuthorityAndConcurrentChangedTermsHaveOneWinner()
    {
        var plan=Plan();var allocations=new[]{Id(),Id()};await Task.WhenAll(Ensure(plan,allocations[0]),Ensure(plan,allocations[1]));Assert.Equal(1,await AgreementCount(plan.AcceptanceId));Assert.Contains((await Read(plan)).AllocationId,allocations);var race=Plan();var changed=race with{Lines=[race.Lines[0] with{UnitPriceRial="1"}]};async Task<string?> Attempt(AcceptedSourcingPurchasePlan p){try{await Ensure(p);return null;}catch(BusinessException e){return e.Code;}}var results=await Task.WhenAll(Attempt(race),Attempt(changed));Assert.Single(results,r=>r is null);Assert.Single(results,r=>r=="sourcing_agreement_terms_conflict");Assert.Equal(1,await AgreementCount(race.AcceptanceId));Assert.Contains((await Read(race)).Lines[0].UnitPriceRial,new[]{"1","9007199254740993"});
    }

    [Fact] public async Task RevokeIsIdempotentAndPermanentlyFencesExplicitReallocation()
    {
        var plan=Plan();await Ensure(plan);await Close(plan);var revoked=await Read(plan);Assert.Equal("Revoked",revoked.State);Assert.False(revoked.CanPay);await Close(plan);Assert.Equal(revoked.Version,(await Read(plan)).Version);Assert.Equal("sourcing_agreement_consumed_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Ensure(plan))).Code);Assert.Equal("Revoked",(await Read(plan)).State);
    }

    [Fact] public async Task ConsumedStateFencesClosureAndReallocationWithoutInventingAnOrder()
    {
        var plan=Plan();await Ensure(plan);var before=await Counters();var futureOrder=Id();
        // Simulate the future atomic Order2 transition, without asserting that
        // conversion/order creation exists in this foundation slice.
        await Tx(async c=>{var row=await c.Db.Set<SourcingPriceAgreement>().SingleAsync(a=>a.AcceptanceId==plan.AcceptanceId);row.State="Consumed";row.ConsumedOrderId=futureOrder;await c.Db.SaveChangesAsync();return true;});Assert.Equal("sourcing_agreement_consumed_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Close(plan))).Code);Assert.Equal("sourcing_agreement_consumed_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Ensure(plan))).Code);var consumed=await Read(plan,plan.OwnerId);Assert.Equal("Consumed",consumed.State);Assert.Equal("Consumed",consumed.EffectiveState);Assert.False(consumed.CanPay);Assert.Equal(before,await Counters());Assert.Equal(futureOrder,await Scope(sp=>sp.GetRequiredService<SalesDbContext>().Set<SourcingPriceAgreement>().Where(a=>a.AcceptanceId==plan.AcceptanceId).Select(a=>a.ConsumedOrderId).SingleAsync()));
    }

    [Fact] public async Task ServerDeadlineClosesCapabilityAtExactBoundaryWithoutWorkerAndCannotExtendPrice()
    {
        var plan=Plan();await Ensure(plan);clock.Advance(plan.PurchaseUntil-clock.GetUtcNow());var due=await Read(plan);Assert.Equal("Active",due.State);Assert.Equal("Expired",due.EffectiveState);Assert.False(due.CanPay);Assert.Equal("sourcing_agreement_expired_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Ensure(plan))).Code);Assert.Equal("sourcing_agreement_terms_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Ensure(plan with{PurchaseUntil=plan.PurchaseUntil.AddHours(1)}))).Code);Assert.Equal(due.Version,(await Read(plan)).Version);await Close(plan);Assert.Equal("Revoked",(await Read(plan)).State);
    }

    [Fact] public async Task PrivateReadRequiresExactOwnerRequestAndDemoVisibilityAndDoesNotRevealOwnerOrConsumptionPointer()
    {
        var plan=Plan();await Ensure(plan);var own=await Read(plan,plan.OwnerId);Assert.Equal("not_found",(await Assert.ThrowsAsync<BusinessException>(()=>Read(plan,"another-owner"))).Code);Assert.Equal("not_found",(await Assert.ThrowsAsync<BusinessException>(()=>Scope(sp=>Services(sp).Service.ReadAsync(plan.AcceptanceId,Id(),plan.OwnerId,default)))).Code);var json=JsonSerializer.Serialize(own,new JsonSerializerOptions(JsonSerializerDefaults.Web));foreach(var field in new[]{"ownerId","consumedOrderId","snapshotHash","supplierReference","actorId"})Assert.DoesNotContain("\""+field+"\":",json);var demo=Plan() with{ContainsDemo=true};await Ensure(demo);Assert.Equal("not_found",(await Assert.ThrowsAsync<BusinessException>(()=>Read(demo,demo.OwnerId,false))).Code);Assert.True((await Read(demo,demo.OwnerId)).IsDemo);
    }

    [Fact] public async Task ParentRollbackAndLineInsertFailureCannotLeavePartialPriceAuthority()
    {
        var plan=Plan();await using(var scope=fixture.Factory.Services.CreateAsyncScope()){var c=Services(scope.ServiceProvider);await using var parent=await c.Db.Database.BeginTransactionAsync(IsolationLevel.Serializable);await c.Service.EnsureForAllocationAsync(plan,Id(),default);Assert.Same(parent,c.Db.Database.CurrentTransaction);await parent.RollbackAsync();}Assert.Equal(0,await AgreementCount(plan.AcceptanceId));
        await Scope(async sp=>{await sp.GetRequiredService<SalesDbContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [sales].[SourcingPriceAgreementLines] WITH NOCHECK ADD CONSTRAINT [CK_AgreementInsertFailure] CHECK (1=0)");return true;});try{await Assert.ThrowsAsync<DbUpdateException>(()=>Ensure(plan));}finally{await Scope(async sp=>{await sp.GetRequiredService<SalesDbContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [sales].[SourcingPriceAgreementLines] DROP CONSTRAINT [CK_AgreementInsertFailure]");return true;});}Assert.Equal(0,await AgreementCount(plan.AcceptanceId));Assert.Equal(0,await Scope(sp=>sp.GetRequiredService<SalesDbContext>().Set<SourcingPriceAgreementLine>().CountAsync(l=>l.AgreementId==plan.AcceptanceId)));await Ensure(plan);Assert.Equal(1,await AgreementCount(plan.AcceptanceId));
    }

    [Fact] public async Task AggregateOverflowAndCloseTargetMismatchAreAtomicFailures()
    {
        var plan=Plan();var maximum=plan.Lines[0] with{Quantity=1,UnitPriceRial=long.MaxValue.ToString(System.Globalization.CultureInfo.InvariantCulture)};foreach(var over in new[]{plan with{Lines=[maximum with{Quantity=2}]},plan with{Lines=[maximum,maximum with{OfferLineId=Id(),ListingId=Id(),UnitPriceRial="1"}]}})Assert.Equal("sourcing_agreement_amount_limit",(await Assert.ThrowsAsync<BusinessException>(()=>Ensure(over))).Code);Assert.Equal(0,await AgreementCount(plan.AcceptanceId));await Ensure(plan);var before=await Read(plan);await Assert.ThrowsAsync<InvalidOperationException>(()=>Tx(async c=>{await c.Service.BeforeCloseAsync(plan.AcceptanceId,Id(),plan.TaskId,default);return true;}));Assert.Equal(JsonSerializer.Serialize(before),JsonSerializer.Serialize(await Read(plan)));
    }
}
