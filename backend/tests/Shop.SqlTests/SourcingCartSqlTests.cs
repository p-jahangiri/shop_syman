using System.Data;
using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Inventory;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;
public sealed class SourcingCartSqlTests(SqlFixture fixture):IClassFixture<SqlFixture>
{
    private static readonly CancellationToken Ct=CancellationToken.None;
    private static string Id()=>Guid.NewGuid().ToString("N");
    private static CartIdentity Guest()=>new(null,CartService.CreateGuestToken());
    private sealed class Reader:IMarketSourcingReader
    {
        public Dictionary<string,SourcingCandidate> Items {get;}=new(StringComparer.OrdinalIgnoreCase);
        public Task<IReadOnlyDictionary<string,SourcingCandidate>> ReadAsync(string locale,string[] ids,CancellationToken ct)=>Task.FromResult<IReadOnlyDictionary<string,SourcingCandidate>>(ids.Where(Items.ContainsKey).ToDictionary(id=>id,id=>Items[id],StringComparer.OrdinalIgnoreCase));
        public string Add(string availability="unknown"){
            var id=Id();var model=new SourcingModelSnapshot(Id(),"synthetic-sourcing","phones","گوشی","Phones","samsung","Samsung","مدل مصنوعی","Synthetic model","شرح مصنوعی","Synthetic description",["/products/phone-green.svg"],"AAAAAAAAAAE=",new string('A',64),false,[]);
            Items[id]=new(id,model,new string('B',64),"منبع مصنوعی","Synthetic source",null,availability,null,null,null,false,true,null);return id;
        }
    }
    private async Task<T> Source<T>(Reader reader,Func<CartSourcingService,Task<T>> action){
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<SalesDbContext>();
        await using var transaction=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable,Ct);
        var result=await action(new(db,scope.ServiceProvider.GetRequiredService<CartService>(),reader));await transaction.CommitAsync(Ct);return result;
    }
    private async Task<T> Purchase<T>(Func<CartService,Task<T>> action){await using var scope=fixture.Factory.Services.CreateAsyncScope();return await action(scope.ServiceProvider.GetRequiredService<CartService>());}
    private Task<CartSourcingSnapshot> Read(Reader reader,CartIdentity identity)=>Source(reader,service=>service.ReadAsync(identity,"en",Ct));
    private async Task<CartSourcingSnapshot> Set(Reader reader,CartIdentity identity,params CartSourcingLineInput[] lines){var current=await Read(reader,identity);return await Source(reader,service=>service.ReplaceAsync(identity,"en",new(lines,current.Version),Ct));}
    private async Task<string> Product(){
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();
        var product=new Product{Slug="sourcing-purchase-"+Id(),CategoryId="phones",BrandId="samsung",Status="Published",Translations=[new(){Locale="fa",Name="خرید مصنوعی",SearchName="خرید مصنوعی"},new(){Locale="en",Name="Synthetic purchase",SearchName="synthetic purchase"}]};
        var variant=new ProductVariant{Sku="SOURCE-PURCHASE-"+Id(),SearchSku="source purchase",PriceRial=9007199254740993,IsActive=true,LabelFa="تنوع",LabelEn="Variant"};product.Variants.Add(variant);db.Products.Add(product);await db.SaveChangesAsync(Ct);
        var inventory=scope.ServiceProvider.GetRequiredService<InventoryDbContext>();inventory.Stock.Add(new(){VariantId=variant.Id,OnHand=20});await inventory.SaveChangesAsync(Ct);return variant.Id;
    }
    [Fact] public async Task PurchaseAndSourcingUseTheSameCartAndVersionWithoutStockChanges(){
        var reader=new Reader();var listing=reader.Add();var identity=Guest();var item=await Product();
        var selected=await Set(reader,identity,new CartSourcingLineInput(listing,2));
        var purchase=await Purchase(service=>service.ReadAsync(identity,"en",Ct));Assert.Empty(purchase.Lines);Assert.Equal(selected.Version,purchase.Version);
        var bought=await Purchase(service=>service.ReplaceAsync(identity,"en",new([new(item,1)],purchase.Version),Ct));
        var retained=await Read(reader,identity);Assert.Equal(bought.Version,retained.Version);Assert.Equal(2,Assert.Single(retained.Lines).Quantity);
        Assert.Equal("cart_version_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Source(reader,service=>service.ReplaceAsync(identity,"en",new([new CartSourcingLineInput(listing,3)],selected.Version),Ct)))).Code);
        var changed=await Source(reader,service=>service.ReplaceAsync(identity,"en",new([new CartSourcingLineInput(listing,3)],retained.Version),Ct));Assert.NotEqual(retained.Version,changed.Version);
        Assert.Equal(item,Assert.Single((await Purchase(service=>service.ReadAsync(identity,"en",Ct))).Lines).VariantId);
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<SalesDbContext>();
        Assert.Equal(1,await db.Carts.CountAsync(cart=>cart.SourcingLines.Any(line=>line.ListingId==listing)));Assert.Equal(0,(await scope.ServiceProvider.GetRequiredService<InventoryDbContext>().Stock.SingleAsync(stock=>stock.VariantId==item)).Reserved);
        Assert.Equal(1,changed.SchemaVersion);Assert.Equal(24,changed.Capacity);Assert.True(changed.RequestOnly);Assert.False(changed.CanPay);
    }
    [Theory][InlineData("unknown")][InlineData("stale")][InlineData("unavailable")]
    public async Task SourceAvailabilityIsAnEstimateAndDoesNotBlockAnInquiry(string availability){
        var reader=new Reader();var listing=reader.Add(availability);var result=await Set(reader,Guest(),new CartSourcingLineInput(listing,1));
        Assert.Equal(availability,Assert.Single(result.Lines).Candidate.Availability);Assert.False(result.HasIssues);Assert.Null(result.Lines[0].Candidate.ReferencePriceRial);
    }
    [Theory][InlineData("unavailable")][InlineData("now_in_store")]
    public async Task InvalidOldSelectionsRemainVisibleAndRemovableButCannotIncrease(string issue){
        var reader=new Reader();var listing=reader.Add();var identity=Guest();var first=await Set(reader,identity,new CartSourcingLineInput(listing,3));
        reader.Items[listing]=issue=="unavailable"?new(listing,null,null,null,null,null,null,null,null,null,false,false,"unavailable"):reader.Items[listing] with{Issue="now_in_store",Model=reader.Items[listing].Model! with{HasAvailableStoreOffer=true}};
        var current=await Read(reader,identity);Assert.True(current.HasIssues);if(issue=="unavailable")Assert.Null(Assert.Single(current.Lines).Candidate.Model);
        var replay=await Source(reader,service=>service.ReplaceAsync(identity,"en",new([new CartSourcingLineInput(listing,3)],null),Ct));Assert.Equal(first.Version,replay.Version);Assert.True(replay.HasIssues);
        Assert.Equal(issue=="now_in_store"?"now_in_store":"sourcing_unavailable",(await Assert.ThrowsAsync<BusinessException>(()=>Source(reader,service=>service.ReplaceAsync(identity,"en",new([new CartSourcingLineInput(listing,4)],current.Version),Ct)))).Code);
        var decreased=await Source(reader,service=>service.ReplaceAsync(identity,"en",new([new CartSourcingLineInput(listing,2)],current.Version),Ct));Assert.Equal(2,Assert.Single(decreased.Lines).Quantity);
        Assert.Empty((await Source(reader,service=>service.ReplaceAsync(identity,"en",new([],decreased.Version),Ct))).Lines);
        Assert.Equal(issue=="now_in_store"?"now_in_store":"sourcing_unavailable",(await Assert.ThrowsAsync<BusinessException>(()=>Set(reader,Guest(),new CartSourcingLineInput(listing,1)))).Code);
    }
    [Fact] public async Task MissingReaderRowsNeverExposeAFormerPrivateModel(){
        var reader=new Reader();var listing=reader.Add();var identity=Guest();await Set(reader,identity,new CartSourcingLineInput(listing,2));reader.Items.Clear();
        var current=await Read(reader,identity);var line=Assert.Single(current.Lines);Assert.Equal(listing,line.ListingId);Assert.Null(line.Candidate.Model);Assert.Null(line.Candidate.Fingerprint);Assert.Null(line.Candidate.SourceNameFa);Assert.Equal("unavailable",line.Candidate.Issue);
        Assert.Single((await Set(reader,identity,new CartSourcingLineInput(listing,1))).Lines);Assert.Empty((await Set(reader,identity)).Lines);
    }
    [Fact] public async Task ConcurrentMergeTransfersBothCollectionsExactlyOnceAndTombstonesBoth(){
        var reader=new Reader();var listing=reader.Add();var guest=Guest();var member=new CartIdentity(Id(),null);var item=await Product();
        await Purchase(service=>service.ReplaceAsync(guest,"en",new([new(item,3)],null),Ct));await Purchase(service=>service.ReplaceAsync(member,"en",new([new(item,2)],null),Ct));
        await Set(reader,guest,new CartSourcingLineInput(listing,3));await Set(reader,member,new CartSourcingLineInput(listing,2));
        var results=await Task.WhenAll(Purchase(service=>service.MergeAsync(member.OwnerId!,guest.GuestToken,"en",Ct)),Purchase(service=>service.MergeAsync(member.OwnerId!,guest.GuestToken,"en",Ct)));
        Assert.All(results,result=>Assert.Equal(5,Assert.Single(result.Lines).Quantity));var current=await Read(reader,member);Assert.Equal(5,Assert.Single(current.Lines).Quantity);Assert.Equal(results[0].Version,current.Version);
        Assert.Equal("cart_session_expired",(await Assert.ThrowsAsync<BusinessException>(()=>Read(reader,guest))).Code);Assert.Equal("cart_session_expired",(await Assert.ThrowsAsync<BusinessException>(()=>Set(reader,guest))).Code);
        Assert.Equal("cart_session_expired",(await Assert.ThrowsAsync<BusinessException>(()=>Purchase(service=>service.MergeAsync(Id(),guest.GuestToken,"en",Ct)))).Code);
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<SalesDbContext>();var tombstone=await db.Carts.Include(cart=>cart.Lines).Include(cart=>cart.SourcingLines).AsSplitQuery().SingleAsync(cart=>cart.MergedIntoCartId!=null&&cart.MergedIntoCartId==db.Carts.Where(memberCart=>memberCart.OwnerId==member.OwnerId).Select(memberCart=>memberCart.Id).First());Assert.Empty(tombstone.Lines);Assert.Empty(tombstone.SourcingLines);
    }
    [Theory][InlineData("quantity")][InlineData("capacity")]
    public async Task MergeSourcingLimitsRollBackBothCartsWithoutClipping(string failure){
        var reader=new Reader();var guest=Guest();var member=new CartIdentity(Id(),null);var item=await Product();
        await Purchase(service=>service.ReplaceAsync(guest,"en",new([new(item,3)],null),Ct));await Purchase(service=>service.ReplaceAsync(member,"en",new([new(item,2)],null),Ct));
        if(failure=="quantity"){var listing=reader.Add();await Set(reader,guest,new CartSourcingLineInput(listing,1000000));await Set(reader,member,new CartSourcingLineInput(listing,1));}
        else {await Set(reader,guest,Enumerable.Range(0,13).Select(_=>new CartSourcingLineInput(reader.Add(),1)).ToArray());await Set(reader,member,Enumerable.Range(0,12).Select(_=>new CartSourcingLineInput(reader.Add(),1)).ToArray());}
        var beforeGuest=await Read(reader,guest);var beforeMember=await Read(reader,member);
        Assert.Equal("cart_limit",(await Assert.ThrowsAsync<BusinessException>(()=>Purchase(service=>service.MergeAsync(member.OwnerId!,guest.GuestToken,"en",Ct)))).Code);
        Assert.Equal(beforeGuest.Version,(await Read(reader,guest)).Version);Assert.Equal(beforeMember.Version,(await Read(reader,member)).Version);
        Assert.Equal(3,Assert.Single((await Purchase(service=>service.ReadAsync(guest,"en",Ct))).Lines).Quantity);Assert.Equal(2,Assert.Single((await Purchase(service=>service.ReadAsync(member,"en",Ct))).Lines).Quantity);
    }
    [Fact] public async Task EachConsumptionBoundaryRetainsTheOtherCollectionAndBumpsVersion(){
        var reader=new Reader();var listing=reader.Add();var member=new CartIdentity(Id(),null);var item=await Product();
        await Purchase(service=>service.ReplaceAsync(member,"en",new([new(item,2)],null),Ct));var selected=await Set(reader,member,new CartSourcingLineInput(listing,3));
        var contents=await Source(reader,service=>service.ReadForSubmissionAsync(member.OwnerId!,Ct));Assert.NotNull(contents.CartId);Assert.Equal(selected.Version,contents.Version);Assert.Equal(3,Assert.Single(contents.Lines).Quantity);
        Assert.Empty((await Source(reader,service=>service.ReadForSubmissionAsync(Id(),Ct))).Lines);
        await Source(reader,async service=>{await service.ConsumeSourcingAsync(member.OwnerId!,contents.Version!,Ct);return true;});
        var purchase=await Purchase(service=>service.ReadAsync(member,"en",Ct));Assert.Equal(2,Assert.Single(purchase.Lines).Quantity);Assert.NotEqual(selected.Version,purchase.Version);Assert.Empty((await Read(reader,member)).Lines);
        var again=await Set(reader,member,new CartSourcingLineInput(listing,1));
        await using(var scope=fixture.Factory.Services.CreateAsyncScope()){
            var db=scope.ServiceProvider.GetRequiredService<SalesDbContext>();await using var transaction=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable,Ct);
            // This is the actual internal boundary OrderService invokes after a
            // successful reservation; avoid manufacturing financial policy here.
            var consume=typeof(CartService).GetMethod("ConsumeAsync",BindingFlags.Instance|BindingFlags.NonPublic)!;
            await (Task)consume.Invoke(scope.ServiceProvider.GetRequiredService<CartService>(),[member.OwnerId!,again.Version!,Ct])!;await transaction.CommitAsync(Ct);
        }
        Assert.Empty((await Purchase(service=>service.ReadAsync(member,"en",Ct))).Lines);var retained=await Read(reader,member);Assert.Equal(1,Assert.Single(retained.Lines).Quantity);Assert.NotEqual(again.Version,retained.Version);
    }
    [Theory][InlineData("replace")][InlineData("consume")]
    public async Task ParentFailureRollsBackSourcingMutationAndSharedVersion(string operation){
        var reader=new Reader();var listing=reader.Add();var member=new CartIdentity(Id(),null);var first=await Set(reader,member,new CartSourcingLineInput(listing,2));
        await Assert.ThrowsAsync<InvalidOperationException>(()=>Source<bool>(reader,async service=>{if(operation=="consume")await service.ConsumeSourcingAsync(member.OwnerId!,first.Version!,Ct);else await service.ReplaceAsync(member,"en",new([new CartSourcingLineInput(listing,3)],first.Version),Ct);throw new InvalidOperationException("Synthetic parent rollback.");}));
        var current=await Read(reader,member);Assert.Equal(first.Version,current.Version);Assert.Equal(2,Assert.Single(current.Lines).Quantity);
    }
    [Fact] public async Task ConcurrentPurchaseAndSourcingWritersSerializeOnOneCartLock(){
        var reader=new Reader();var listing=reader.Add();var identity=Guest();var item=await Product();await Purchase(service=>service.ReplaceAsync(identity,"en",new([new(item,1)],null),Ct));var first=await Set(reader,identity,new CartSourcingLineInput(listing,1));
        async Task<string?> SourceEdit(){try{await Source(reader,service=>service.ReplaceAsync(identity,"en",new([new CartSourcingLineInput(listing,2)],first.Version),Ct));return null;}catch(BusinessException exception){return exception.Code;}}
        async Task<string?> PurchaseEdit(){try{await Purchase(service=>service.ReplaceAsync(identity,"en",new([new(item,2)],first.Version),Ct));return null;}catch(BusinessException exception){return exception.Code;}}
        var results=await Task.WhenAll(SourceEdit(),PurchaseEdit());Assert.Single(results,result=>result is null);Assert.Single(results,result=>result=="cart_version_conflict");
        var source=await Read(reader,identity);var purchase=await Purchase(service=>service.ReadAsync(identity,"en",Ct));Assert.Equal(source.Version,purchase.Version);Assert.Equal(3,Assert.Single(source.Lines).Quantity+Assert.Single(purchase.Lines).Quantity);
    }
    [Fact] public async Task OversizedUtf8CandidateFailsReadsAndRollsBackSavedQuantityAndRevision(){
        var reader=new Reader();var listing=reader.Add();var identity=Guest();var first=await Set(reader,identity,new CartSourcingLineInput(listing,1));var original=reader.Items[listing];
        // Each field and the attribute count remain individually bounded. The
        // total character count is below 2 MiB, but the UTF-8 CJK text is larger.
        var text=new string('\u6f22',8000);
        var attributes=Enumerable.Range(0,64).Select(index=>new SourcingAttributeSnapshot("attribute"+index,"attribute"+index,"Text","ویژگی","Attribute",null,null,null,text,text,null,null,[])).ToArray();
        reader.Items[listing]=original with{Model=original.Model! with{Attributes=attributes}};
        Assert.Equal("sourcing_capacity_unavailable",(await Assert.ThrowsAsync<BusinessException>(()=>Read(reader,identity))).Code);
        Assert.Equal("sourcing_capacity_unavailable",(await Assert.ThrowsAsync<BusinessException>(()=>Source(reader,service=>service.ReplaceAsync(identity,"en",new([new(listing,2)],first.Version),Ct)))).Code);
        await using(var scope=fixture.Factory.Services.CreateAsyncScope()){
            var db=scope.ServiceProvider.GetRequiredService<SalesDbContext>();var cart=await db.Carts.Include(row=>row.SourcingLines).SingleAsync(row=>row.SourcingLines.Any(line=>line.ListingId==listing));
            Assert.Equal(first.Version,Convert.ToBase64String(cart.Version));Assert.Equal(1,Assert.Single(cart.SourcingLines).Quantity);
        }
        reader.Items[listing]=original;var restored=await Read(reader,identity);Assert.Equal(first.Version,restored.Version);Assert.Equal(1,Assert.Single(restored.Lines).Quantity);
    }
    [Fact] public async Task ExpiredGuestAndMissingSerializableTransactionAreRejected(){
        var reader=new Reader();var listing=reader.Add();var identity=Guest();var first=await Set(reader,identity,new CartSourcingLineInput(listing,1));
        await using(var scope=fixture.Factory.Services.CreateAsyncScope()){
            var db=scope.ServiceProvider.GetRequiredService<SalesDbContext>();await db.Carts.Where(cart=>cart.SourcingLines.Any(line=>line.ListingId==listing)).ExecuteUpdateAsync(update=>update.SetProperty(cart=>cart.GuestExpiresAt,DateTimeOffset.UtcNow.AddDays(-1)),Ct);
            var service=new CartSourcingService(db,scope.ServiceProvider.GetRequiredService<CartService>(),reader);await Assert.ThrowsAsync<InvalidOperationException>(()=>service.ReadAsync(identity,"en",Ct));
            await using var transaction=await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted,Ct);await Assert.ThrowsAsync<InvalidOperationException>(()=>service.ReadForSubmissionAsync("owner",Ct));
        }
        Assert.Equal("cart_session_expired",(await Assert.ThrowsAsync<BusinessException>(()=>Read(reader,identity))).Code);Assert.Equal("cart_session_expired",(await Assert.ThrowsAsync<BusinessException>(()=>Source(reader,service=>service.ReplaceAsync(identity,"en",new([new(listing,2)],first.Version),Ct)))).Code);
    }
}
