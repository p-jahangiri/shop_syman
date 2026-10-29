using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;

// Sales persistence/concurrency tests on actual SQL. Catalog, Market and the
// owner-checked Inventory proof are explicit synthetic contracts in this file;
// the composition-root HTTP suite proves the actual cross-module guard.
public sealed class CartV2SalesSqlTests(SqlFixture fixture):IClassFixture<SqlFixture>
{
    private const string V="AAAAAAAAAAE=";
    private static readonly string H=new('A',64);
    private static readonly DateTimeOffset At=new(2030,1,1,0,0,0,TimeSpan.Zero);
    private static string Id()=>Guid.NewGuid().ToString("N");
    private sealed class Clock(DateTimeOffset now):TimeProvider{public DateTimeOffset Now=now;public override DateTimeOffset GetUtcNow()=>Now;}
    private sealed record Scenario(AcceptedSourcingPurchasePlan Plan,string Allocation,string Cart,string CartVersion,string AgreementVersion);
    private static OfferSkuSnapshot Sku()=>new("v1-"+Id(),"model-"+Id(),"seller","QA-CART2",new("model","qa-phone","phones","گوشی","Phone","brand","Brand","نام پذیرفته‌شده","Accepted name","شرح","Description",[],[]),"نسخه اصلی","Original variant","silver","نقره‌ای","Silver","گارانتی اصلی","Original warranty",[],["online"],null,[],"100",V,H,H);
    private static AcceptedSourcingPurchasePlan Plan(string owner,OfferSkuSnapshot? sku=null,int quantity=2,string price="9007199254740993")=>new(Id(),Id(),Id(),1,Id(),owner,H,V,V,V,At.AddHours(2),"شرایط اصلی","Original terms",false,[new(Id(),Id(),quantity,price,sku??Sku())]);
    private static SourcingStockConversionProof Proof(Scenario s)=>Proof(s.Plan,s.Allocation);
    private static SourcingStockConversionProof Proof(AcceptedSourcingPurchasePlan p,string allocation)=>new(allocation,p.RequestId,p.TaskId,p.OfferId,p.AcceptanceId,p.TermsHash,V,At.AddMinutes(30),p.ContainsDemo,p.Lines.Select(l=>new SourcingAllocationSummaryLine(l.OfferLineId,l.Sku.VariantId,l.Quantity)).ToArray());
    private static SourcingConversionInput Input(Scenario s,string? cartVersion=null)=>new(Id(),s.Plan.TaskId,V,V,V,s.Plan.AcceptanceId,s.Plan.AcceptanceId,s.AgreementVersion,s.Allocation,V,H,cartVersion??s.CartVersion);
    private sealed class Catalog(OfferSkuSnapshot sku):ICartCatalogReader,ICatalogOfferReader
    {
        public string? Failure;public long PublicPrice=100;public OfferSkuSnapshot Current=sku;
        public Task<IReadOnlyDictionary<string,CartCatalogVariant>> ReadCartVariantsAsync(string locale,IReadOnlyCollection<string> ids,CancellationToken ct)=>Task.FromResult<IReadOnlyDictionary<string,CartCatalogVariant>>(ids.ToDictionary(id=>id,id=>new CartCatalogVariant(id,"ordinary-model","phones","ordinary-phone",locale=="en"?"Ordinary current name":"نام جاری عادی","Current variant",PublicPrice,false),StringComparer.OrdinalIgnoreCase));
        public Task<IReadOnlyDictionary<string,OfferSkuSnapshot>> ReadAsync(string[] ids,CancellationToken ct){if(Failure is not null)throw new BusinessException(Failure,"Explicit synthetic current Catalog failure");return Task.FromResult<IReadOnlyDictionary<string,OfferSkuSnapshot>>(ids.Where(id=>id.Equals(Current.VariantId,StringComparison.OrdinalIgnoreCase)).ToDictionary(id=>id,_=>Current,StringComparer.OrdinalIgnoreCase));}
        public Task<OfferSkuPage> LookupAsync(string model,string? query,string? cursor,CancellationToken ct)=>throw new NotSupportedException();
    }
    private sealed class PublicStock:IInventoryReader
    {
        public Task<IReadOnlyDictionary<string,int>> AvailableAsync(IEnumerable<string> ids,CancellationToken ct)=>Task.FromResult<IReadOnlyDictionary<string,int>>(ids.ToDictionary(id=>id,_=>1000000,StringComparer.OrdinalIgnoreCase));
    }
    private sealed class Market:IMarketSourcingReader
    {
        public Task<IReadOnlyDictionary<string,SourcingCandidate>> ReadAsync(string locale,string[] ids,CancellationToken ct)=>Task.FromResult<IReadOnlyDictionary<string,SourcingCandidate>>(ids.ToDictionary(id=>id,id=>new SourcingCandidate(id,null,null,null,null,null,null,null,null,null,false,false,"unavailable"),StringComparer.OrdinalIgnoreCase));
    }
    private sealed class Allocations(string owner,SourcingStockConversionProof[] proofs):IInventorySourcingAllocations
    {
        public SourcingStockConversionProof[] Proofs=proofs;public List<int> Batches=[];
        public Task<SourcingAllocationSummaryData[]> ReadSummariesAsync(string[] ids,string? ownerId,CancellationToken ct){Assert.Equal(owner,ownerId,ignoreCase:true);Assert.InRange(ids.Length,0,50);Batches.Add(ids.Length);return Task.FromResult(Proofs.Where(p=>ids.Contains(p.AcceptanceId)).Select(p=>new SourcingAllocationSummaryData(1,p.AllocationId,p.RequestId,p.TaskId,p.OfferId,p.AcceptanceId,"Active","Active",p.Version,p.ExpiresAt,p.IsDemo,p.Lines.Sum(l=>l.Quantity),p.Lines)).ToArray());}
        public Task<SourcingAllocationMutation?> ReplayAsync(string a,string r,string t,string id,SourcingAllocationInput i,CancellationToken ct)=>throw new NotSupportedException();
        public Task<SourcingAllocationMutation?> ReplayReleaseAsync(string a,string r,string t,string id,SourcingAllocationReleaseInput i,CancellationToken ct)=>throw new NotSupportedException();
        public Task<SourcingAllocationMutation> AllocateAsync(string a,string id,SourcingStockAllocationPlan p,SourcingAllocationInput i,CancellationToken ct)=>throw new NotSupportedException();
        public Task<SourcingAllocationMutation> ReleaseAsync(string a,string id,SourcingAllocationReleaseInput i,CancellationToken ct)=>throw new NotSupportedException();
        public Task ReleaseForAcceptanceAsync(string a,string id,string reason,CancellationToken ct)=>throw new NotSupportedException();
        public Task<SourcingAllocationData> ReadAsync(string id,string? o,CancellationToken ct)=>throw new NotSupportedException();
        public Task<SourcingAllocationData?> ReadActiveAsync(string id,string? o,CancellationToken ct)=>throw new NotSupportedException();
        public Task<SourcingAllocationMutation> ReadCommandAsync(string a,string id,string op,string c,CancellationToken ct)=>throw new NotSupportedException();
        public Task<SourcingAllocationEventPage> EventsAsync(string id,string? o,string? c,CancellationToken ct)=>throw new NotSupportedException();
        public Task<int> ExpireBatchAsync(int max,CancellationToken ct)=>throw new NotSupportedException();
    }
    private sealed class Env(SalesDbContext db,Scenario scenario,Clock clock,SourcingStockConversionProof[] proofs)
    {
        public SalesDbContext Db=db;public Clock Clock=clock;public Catalog Catalog=new(scenario.Plan.Lines[0].Sku);public Allocations Allocations=new(scenario.Plan.OwnerId,proofs);
        public CartService Carts=>new(Db,Catalog,new PublicStock(),Clock);
        public CartV2Service V2=>new(Db,Carts,new CartSourcingService(Db,Carts,new Market()),Allocations,Catalog,Clock,true);
        public CartOfferService Offers=>new(Db,Carts,Clock,true);
        public SourcingPriceAgreementService Agreements=>new(Db,Clock,true);
        public SourcingConversionService Conversion=>new(Db,Carts,Agreements,Catalog,Clock,true);
    }
    private async Task<T> Scope<T>(Scenario s,Func<Env,Task<T>> action,bool parent=true,Clock? clock=null,SourcingStockConversionProof[]? proofs=null)
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<SalesDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);await using var transaction=parent?await db.Database.BeginTransactionAsync(IsolationLevel.Serializable):null;var result=await action(new(db,s,clock??new(At),proofs??[Proof(s)]));if(transaction is not null)await transaction.CommitAsync();return result;
    }
    private async Task<Scenario> Seed(int ordinary=1,int quantity=2,string price="9007199254740993")
    {
        var plan=Plan("cart2-owner-"+Id(),quantity:quantity,price:price);var seed=new Scenario(plan,Id(),Id(),V,V);
        return await Scope(seed,async env=>{await env.Agreements.EnsureForAllocationAsync(plan,seed.Allocation,default);var cart=new ShoppingCart{Id=seed.Cart,OwnerId=plan.OwnerId,Revision=1,UpdatedAt=At};for(var i=0;i<ordinary;i++)cart.Lines.Add(new(){CartId=cart.Id,VariantId=i==0?plan.Lines[0].Sku.VariantId:"other-"+i,Quantity=1});cart.SourcingLines.Add(new(){CartId=cart.Id,ListingId=Id(),Quantity=3});env.Db.Carts.Add(cart);await env.Db.SaveChangesAsync();var agreement=await env.Db.SourcingPriceAgreements.SingleAsync(a=>a.Id==plan.AcceptanceId);return seed with{CartVersion=Convert.ToBase64String(cart.Version),AgreementVersion=Convert.ToBase64String(agreement.Version)};});
    }
    private static async Task<SourcingConversionMutation> ConvertOfferAsync(Env env,AcceptedSourcingPurchasePlan plan,SourcingConversionInput input,SourcingStockConversionProof proof)
    {
        var service=env.Conversion;await service.AcquireCommandLockAsync(plan.OwnerId,input.RequestId,default);var replay=await service.ReplayAsync(plan.OwnerId,plan.RequestId,plan.OfferId,input,default);if(replay is not null)return replay;var token=await service.PrepareAsync(plan.OwnerId,plan,input,default);return await service.CompleteAsync(token,proof,default);
    }
    [Fact] public async Task TwoAgreementsAndOrdinarySameSkuRetainThreePricesAndInquiryWithoutFinancialWrites()
    {
        var s=await Seed();var before=await Scope(s,async env=>new{Orders=await env.Db.Orders.CountAsync(),Quotes=await env.Db.Quotes.CountAsync(),Settings=await env.Db.OrderSettings.CountAsync()});var first=await Scope(s,env=>ConvertOfferAsync(env,s.Plan,Input(s),Proof(s)));var second=Plan(s.Plan.OwnerId,s.Plan.Lines[0].Sku,1,"777");var secondAllocation=Id();var agreementVersion=await Scope(s,async env=>{await env.Agreements.EnsureForAllocationAsync(second,secondAllocation,default);return Convert.ToBase64String((await env.Db.SourcingPriceAgreements.SingleAsync(a=>a.Id==second.AcceptanceId)).Version);});
        var input=new SourcingConversionInput(Id(),second.TaskId,V,V,V,second.AcceptanceId,second.AcceptanceId,agreementVersion,secondAllocation,V,H,first.CartVersion);await Scope(s,env=>ConvertOfferAsync(env,second,input,Proof(second,secondAllocation)));
        await Scope(s,async env=>{env.Catalog.PublicPrice=123;env.Catalog.Current=env.Catalog.Current with{PublicPriceRial="123"};var cart=await env.V2.ReadAsync(new(s.Plan.OwnerId,null),"en",default);Assert.Equal(2,cart.OfferLines.Length);Assert.Equal("123",Assert.Single(cart.OrdinaryLines).UnitPriceRial);Assert.Contains(cart.OfferLines,l=>l.UnitPriceRial=="9007199254740993"&&l.LineTotalRial=="18014398509481986");Assert.Contains(cart.OfferLines,l=>l.UnitPriceRial=="777");Assert.Equal("18014398509482763",cart.OfferSubtotalRial);Assert.Equal("18014398509482886",cart.BuySubtotalRial);Assert.Single(cart.Inquiry.Lines);Assert.Equal(3,cart.Inquiry.Lines[0].Quantity);Assert.Equal(cart.Version,cart.Inquiry.Version);Assert.Equal(3,cart.OrdinaryLines.Select(l=>l.LineId).Concat(cart.OfferLines.Select(l=>l.LineId)).Distinct().Count());Assert.All(cart.OfferLines,l=>Assert.Equal("Accepted name",l.Name));Assert.False(cart.CanCheckout);Assert.False(cart.CanPay);Assert.Equal(before.Orders,await env.Db.Orders.CountAsync());Assert.Equal(before.Quotes,await env.Db.Quotes.CountAsync());Assert.Equal(before.Settings,await env.Db.OrderSettings.CountAsync());Assert.Equal(2,await env.Db.SourcingPriceAgreements.CountAsync(a=>a.OwnerId==s.Plan.OwnerId&&a.State=="Active"&&a.ConsumedOrderId==null));return true;},proofs:[Proof(s),Proof(second,secondAllocation)]);
    }
    [Fact] public async Task RemovalAndOldConversionReplayDoNotResurrectRowsOrRevokeAgreement()
    {
        var s=await Seed();var input=Input(s);var original=await Scope(s,env=>ConvertOfferAsync(env,s.Plan,input,Proof(s)));var remove=new CartOfferRemoveInput(Guid.NewGuid().ToString("D"),original.CartVersion);var removed=await Scope(s,env=>env.Offers.RemoveAsync(s.Plan.OwnerId,"en",s.Plan.AcceptanceId,remove,default));
        await Scope(s,async env=>{var replay=await ConvertOfferAsync(env,s.Plan,input,Proof(s));Assert.True(replay.Replayed);Assert.Equal(original.CartVersion,replay.CartVersion);var retry=await env.Offers.RemoveAsync(s.Plan.OwnerId,"fa",s.Plan.AcceptanceId,remove,default);Assert.True(retry.Replayed);Assert.Equal(removed.CartVersion,retry.CartVersion);var cart=await env.V2.ReadAsync(new(s.Plan.OwnerId,null),"en",default);Assert.Empty(cart.OfferLines);Assert.Single(cart.OrdinaryLines);Assert.Single(cart.Inquiry.Lines);Assert.True(cart.HasIssues);Assert.True(cart.CanCheckout);Assert.False(cart.CanPay);Assert.Equal("Active",(await env.Db.SourcingPriceAgreements.SingleAsync(a=>a.Id==s.Plan.AcceptanceId)).State);Assert.Equal(1,await env.Db.SourcingConversions.CountAsync(c=>c.AcceptanceId==s.Plan.AcceptanceId));Assert.Equal(2,await env.Db.CartOfferCommandReceipts.CountAsync(r=>r.ActorId==s.Plan.OwnerId.ToUpperInvariant()));return true;});
    }
    [Fact] public async Task MergePreservesOfferLaneAndLegacyNoOpAndTombstoneAreExplicitlyGated()
    {
        var s=await Seed();var converted=await Scope(s,env=>ConvertOfferAsync(env,s.Plan,Input(s),Proof(s)));var token=CartService.CreateGuestToken();var guestId=Id();
        await Scope(s,async env=>{env.Db.Carts.Add(new(){Id=guestId,GuestTokenHash=Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))),GuestExpiresAt=At.AddDays(5),UpdatedAt=At,Lines=[new(){CartId=guestId,VariantId=s.Plan.Lines[0].Sku.VariantId,Quantity=2}]});await env.Db.SaveChangesAsync();var result=await env.V2.MergeAsync(s.Plan.OwnerId,token,"en",default);Assert.Equal(3,Assert.Single(result.OrdinaryLines).Quantity);Assert.Equal(converted.Lines[0].LineId,Assert.Single(result.OfferLines).LineId);return true;});
        await Scope(s,async env=>{Assert.Equal("cart_contract_upgrade_required",(await Assert.ThrowsAsync<BusinessException>(()=>env.Carts.ReadAsync(new(s.Plan.OwnerId,null),"en",default))).Code);Assert.Equal("cart_contract_upgrade_required",(await Assert.ThrowsAsync<BusinessException>(()=>env.Carts.ReplaceAsync(new(s.Plan.OwnerId,null),"en",new([new(s.Plan.Lines[0].Sku.VariantId,3)],s.CartVersion),default))).Code);Assert.Equal("cart_contract_upgrade_required",(await Assert.ThrowsAsync<BusinessException>(()=>env.Carts.MergeAsync(s.Plan.OwnerId,token,"en",default))).Code);return true;},parent:false);
        await Scope(s,async env=>{var replay=await env.V2.MergeAsync(s.Plan.OwnerId,token,"en",default);Assert.Equal(3,Assert.Single(replay.OrdinaryLines).Quantity);Assert.Single(replay.OfferLines);return true;});
    }
    [Fact] public async Task ExpiredAndReallocatedHoldsKeepOriginalProvenanceAndPriceWithoutFollowingNewHold()
    {
        var s=await Seed();var result=await Scope(s,env=>ConvertOfferAsync(env,s.Plan,Input(s),Proof(s)));await Scope(s,async env=>{var cart=await env.V2.ReadAsync(new(s.Plan.OwnerId,null),"en",default);Assert.Equal("allocation_expired",Assert.Single(cart.OfferLines).Issue);Assert.Equal(result.CartVersion,cart.Version);return true;},clock:new(At.AddMinutes(31)));
        var later=Id();await Scope(s,async env=>{await env.Agreements.EnsureForAllocationAsync(s.Plan,later,default);return true;});
        await Scope(s,async env=>{var cart=await env.V2.ReadAsync(new(s.Plan.OwnerId,null),"en",default);var line=Assert.Single(cart.OfferLines);Assert.Equal("allocation_changed",line.Issue);Assert.Equal(s.Allocation,line.AllocationId);Assert.Equal(At.AddMinutes(30),line.AllocationExpiresAt);Assert.Equal("9007199254740993",line.UnitPriceRial);var historical=await env.Conversion.ReadExistingAsync(s.Plan.OwnerId,s.Plan.AcceptanceId,default);Assert.Equal(result.CartVersion,historical!.CartVersion);Assert.Equal(s.Allocation,(await env.Db.SourcingConversions.SingleAsync(c=>c.AcceptanceId==s.Plan.AcceptanceId)).AllocationId);return true;},proofs:[Proof(s.Plan,later)]);
    }
    [Fact] public async Task OversizedCurrentCatalogRemainsReadableAndRemovableButTransportErrorsPropagate()
    {
        var s=await Seed();var converted=await Scope(s,env=>ConvertOfferAsync(env,s.Plan,Input(s),Proof(s)));
        await Scope(s,async env=>{env.Catalog.Failure="catalog_unavailable";var cart=await env.V2.ReadAsync(new(s.Plan.OwnerId,null),"en",default);Assert.Equal("material_changed",Assert.Single(cart.OfferLines).Issue);Assert.Equal("9007199254740993",cart.OfferLines[0].UnitPriceRial);Assert.Equal(converted.CartVersion,cart.Version);Assert.False(cart.CanCheckout);await env.Offers.RemoveAsync(s.Plan.OwnerId,"en",s.Plan.AcceptanceId,new(Id(),cart.Version!),default);return true;});
        var s2=await Seed();await Scope(s2,env=>ConvertOfferAsync(env,s2.Plan,Input(s2),Proof(s2)));await Assert.ThrowsAsync<BusinessException>(()=>Scope(s2,async env=>{env.Catalog.Failure="transport_unavailable";return await env.V2.ReadAsync(new(s2.Plan.OwnerId,null),"en",default);}));
    }
    [Fact] public async Task ConcurrentSameCommandHasOneCartEffectAndNewUuidCannotConvertAcceptanceTwice()
    {
        var s=await Seed();var input=Input(s);var results=await Task.WhenAll(Scope(s,env=>ConvertOfferAsync(env,s.Plan,input,Proof(s))),Scope(s,env=>ConvertOfferAsync(env,s.Plan,input with{RequestId=Guid.ParseExact(input.RequestId,"N").ToString("D")},Proof(s))));Assert.Single(results,r=>r.Replayed);Assert.Equal(results[0].ConversionId,results[1].ConversionId);
        await Scope(s,async env=>{Assert.Single((await env.V2.ReadAsync(new(s.Plan.OwnerId,null),"en",default)).OfferLines);Assert.Equal(1,await env.Db.SourcingConversions.CountAsync(c=>c.AcceptanceId==s.Plan.AcceptanceId));return true;});
        var fresh=input with{RequestId=Id(),CartVersion=results[0].CartVersion};Assert.Equal("sourcing_conversion_exists_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Scope(s,env=>ConvertOfferAsync(env,s.Plan,fresh,Proof(s))))).Code);
    }
    [Theory]
    [InlineData("lines")][InlineData("amount")][InlineData("deadline")]
    public async Task CapacityAmountAndFinalDeadlineFailuresLeaveAllCartAndReceiptRowsUnchanged(string kind)
    {
        var s=kind=="lines"?await Seed(64):kind=="amount"?await Seed(price:long.MaxValue.ToString(),quantity:1):await Seed();var input=Input(s);
        var failure=await Assert.ThrowsAsync<BusinessException>(()=>Scope(s,async env=>{if(kind!="deadline")return await ConvertOfferAsync(env,s.Plan,input,Proof(s));var service=env.Conversion;await service.AcquireCommandLockAsync(s.Plan.OwnerId,input.RequestId,default);Assert.Null(await service.ReplayAsync(s.Plan.OwnerId,s.Plan.RequestId,s.Plan.OfferId,input,default));var prepared=await service.PrepareAsync(s.Plan.OwnerId,s.Plan,input,default);env.Clock.Now=At.AddMinutes(30);return await service.CompleteAsync(prepared,Proof(s),default);}));Assert.Equal(kind=="lines"?"cart_limit":kind=="amount"?"cart_amount_limit":"sourcing_conversion_expired_conflict",failure.Code);
        await Scope(s,async env=>{Assert.Equal(s.CartVersion,Convert.ToBase64String((await env.Db.Carts.SingleAsync(c=>c.Id==s.Cart)).Version));Assert.Equal(0,await env.Db.CartOfferLines.CountAsync(l=>l.CartId==s.Cart));Assert.Equal(0,await env.Db.SourcingConversions.CountAsync(c=>c.AcceptanceId==s.Plan.AcceptanceId));Assert.Equal(0,await env.Db.CartOfferCommandReceipts.CountAsync(c=>c.ActorId==s.Plan.OwnerId.ToUpperInvariant()));return true;});
    }
    [Fact] public async Task ReceiptConstraintFailureRollsBackTheEarlierCartAndConversionWrites()
    {
        var s=await Seed();await Scope(s,async env=>{await env.Db.Database.ExecuteSqlRawAsync("ALTER TABLE [sales].[CartOfferCommandReceipts] WITH NOCHECK ADD CONSTRAINT [CK_Cart2Receipt_QA] CHECK ([Operation]<>'convert')");return true;},parent:false);
        try{await Assert.ThrowsAsync<DbUpdateException>(()=>Scope(s,env=>ConvertOfferAsync(env,s.Plan,Input(s),Proof(s))));}finally{await Scope(s,async env=>{await env.Db.Database.ExecuteSqlRawAsync("ALTER TABLE [sales].[CartOfferCommandReceipts] DROP CONSTRAINT [CK_Cart2Receipt_QA]");return true;},parent:false);}
        await Scope(s,async env=>{Assert.Equal(s.CartVersion,Convert.ToBase64String((await env.Db.Carts.SingleAsync(c=>c.Id==s.Cart)).Version));Assert.Empty(await env.Db.CartOfferLines.Where(l=>l.CartId==s.Cart).ToArrayAsync());Assert.Empty(await env.Db.SourcingConversions.Where(c=>c.AcceptanceId==s.Plan.AcceptanceId).ToArrayAsync());return true;});
    }
    [Fact] public async Task ExistingHistoricalCancelledOrderReplayRemainsAvailableBesideNewOfferLines()
    {
        var s=await Seed();await Scope(s,env=>ConvertOfferAsync(env,s.Plan,Input(s),Proof(s)));var quoteId=Id();var supplied=OrderInputRules.Normalize(new(quoteId,Id(),"QA history","09121234567",null,"",true));var orderId=Id();var hash=Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(supplied with{RequestId=""}))));
        await Scope(s,async env=>{env.Db.Quotes.Add(new(){Id=quoteId,ActorKey=H,RequestId=Id(),PayloadHash=H,CartId=s.Cart,CartVersion=s.CartVersion,PricingFingerprint=H,CreatedAt=At,ExpiresAt=At.AddMinutes(5),ItemsSubtotalRial=10,GoodsTotalRial=10,ResponseJson="{}"});env.Db.Orders.Add(new(){Id=orderId,OwnerId=s.Plan.OwnerId,RequestId=supplied.RequestId,PayloadHash=hash,QuoteId=quoteId,PricingFingerprint=H,Locale="en",State=OrderState.Cancelled,ReservationId=Id(),CreatedAt=At,ChangedAt=At,ExpiresAt=At.AddMinutes(5),ContactName=supplied.ContactName,ContactPhone=supplied.ContactPhone,Note="",MethodId="online",MethodName="Historical method",ShippingName="",ItemsSubtotalRial=10,GoodsTotalRial=10,PayableTotalRial=10,QuoteSnapshotJson="{}",Lines=[new(){OrderId=orderId,VariantId="historic-v1",ProductId="historic-model",SellerId="seller",Sku="HISTORIC",Name="Historical item",Label="Original",Warranty="Original warranty",PriceVersion=V,IsDigital=true,Quantity=1,UnitPriceRial=10,LineTotalRial=10}]});await env.Db.SaveChangesAsync();return true;});
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<SalesDbContext>();await using var transaction=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);var result=await scope.ServiceProvider.GetRequiredService<OrderService>().CreateAsync(s.Plan.OwnerId,supplied,default);Assert.True(result.Replayed);Assert.Equal(orderId,result.Order.Summary.Id);Assert.Equal("Cancelled",result.Order.Summary.State);Assert.Equal("historic-v1",Assert.Single(result.Order.Lines).VariantId);Assert.Single(await db.CartOfferLines.Where(l=>l.CartId==s.Cart).ToArrayAsync());await transaction.CommitAsync();
    }
}
