using System.Data;
using System.Data.Common;
using System.Diagnostics;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Inventory;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;

// Internal price-free Inventory guard only. The composition-root HTTP tests
// separately establish genuine owner consent, Catalog and Sales/cart authority.
public sealed class ConversionInventorySqlTests(SqlFixture fixture):IClassFixture<SqlFixture>
{
    private const string V="AAAAAAAAAAE=";
    private static readonly string Hash=new('A',64);
    private static string Id()=>Guid.NewGuid().ToString("N");
    private sealed class Clock:TimeProvider
    {
        private long ticks=DateTimeOffset.UtcNow.UtcTicks;
        public override DateTimeOffset GetUtcNow()=>new(Interlocked.Read(ref ticks),TimeSpan.Zero);
        public void Advance(TimeSpan value)=>Interlocked.Add(ref ticks,value.Ticks);
    }
    private readonly Clock clock=new();
    private async Task<T> Scope<T>(Func<InventoryDbContext,Task<T>> action)
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<InventoryDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);return await action(db);
    }
    private SourcingAllocationService Allocations(InventoryDbContext db)=>new(db,new(db,clock),clock,true);
    private SourcingConversionGuard Guard(InventoryDbContext db,bool demo=true)=>new(db,new(db,clock),clock,demo);
    private async Task<T> Tx<T>(Func<InventoryDbContext,Task<T>> action)=>await Scope(async db=>{await using var tx=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);var result=await action(db);await tx.CommitAsync();return result;});
    private async Task<(SourcingStockAllocationPlan Plan,SourcingAllocationMutation Allocation)> Create(bool demo=false,bool tracked=false)
    {
        var variant="conversion-"+Id();await Scope(async db=>{db.Stock.Add(new(){VariantId=variant,OnHand=tracked?0:3});await db.SaveChangesAsync();return true;});SerialUnitData[] units=[];
        if(tracked){await Tx(async db=>{var stock=await db.Stock.SingleAsync(s=>s.VariantId==variant);return await new SerialInventoryService(db,new(db,clock),clock).ConfigureAsync(variant,false,new("serial",Convert.ToBase64String(stock.Version),Id()),"qa-conversion",default);});var receipt=await Tx(async db=>{var stock=await db.Stock.SingleAsync(s=>s.VariantId==variant);return await new SerialInventoryService(db,new(db,clock),clock).ReceiveAsync(variant,false,new([new("QA-"+variant+"-1"),new("QA-"+variant+"-2"),new("QA-"+variant+"-3")],"Synthetic physical receipt",Convert.ToBase64String(stock.Version),Id()),"qa-conversion",default);});units=receipt.Units.Take(2).ToArray();}
        var plan=new SourcingStockAllocationPlan(Id(),Id(),Id(),Id(),"owner-"+Id(),Hash,clock.GetUtcNow().AddHours(2),demo,[new(Id(),variant,"catalog-model_1",2,Hash)]);
        var allocation=await Tx(async db=>{var stock=await db.Stock.SingleAsync(s=>s.VariantId==variant);var input=new SourcingAllocationInput(Id(),V,V,V,plan.AcceptanceId,Hash,clock.GetUtcNow().AddMinutes(1),"Explicit synthetic conversion hold",[new(plan.Lines[0].OfferLineId,Convert.ToBase64String(stock.Version),stock.TrackingMode,units.Select(u=>new SourcingAllocationUnitInput(u.Id,u.Version)).ToArray())]);return await Allocations(db).AllocateAsync("inventory-qa",Id(),plan,input,default);});return(plan,allocation);
    }
    private Task<SourcingStockConversionProof> AssertOwned(SourcingStockAllocationPlan plan,SourcingAllocationMutation allocation,string? owner=null)=>Tx(db=>Guard(db).AssertAsync(owner??plan.OwnerId,plan,allocation.AllocationId,allocation.Version,default));
    private async Task<string> Snapshot(string variant)=>await Scope(async db=>JsonSerializer.Serialize(new{Stock=await db.Stock.AsNoTracking().Where(s=>s.VariantId==variant).Select(s=>new{s.OnHand,s.Reserved,s.SourcingReserved,s.Version}).SingleAsync(),Units=await db.SerialUnits.AsNoTracking().Where(u=>u.VariantId==variant).OrderBy(u=>u.Id).Select(u=>new{u.Id,u.State,u.Version,u.OrderId,u.ReservationId}).ToArrayAsync(),Claims=await db.Set<SerialUnitClaim>().AsNoTracking().Where(c=>c.VariantId==variant).OrderBy(c=>c.Id).Select(c=>new{c.Id,c.State,c.IsActive,c.Version,c.OrderId,c.OrderLineId,c.ReservationId,c.OriginAllocationId}).ToArrayAsync(),Allocation=await db.Set<SourcingStockAllocation>().AsNoTracking().Where(a=>a.Lines.Any(l=>l.VariantId==variant)).OrderBy(a=>a.Id).Select(a=>new{a.Id,a.State,a.IsActive,a.ExpiresAt,a.Version}).ToArrayAsync(),Commands=await db.Set<SourcingAllocationCommand>().CountAsync(c=>db.Set<SourcingStockAllocation>().Any(a=>a.Id==c.AllocationId&&a.Lines.Any(l=>l.VariantId==variant))),Events=await db.Set<SourcingAllocationEvent>().CountAsync(e=>db.Set<SourcingStockAllocation>().Any(a=>a.Id==e.AllocationId&&a.Lines.Any(l=>l.VariantId==variant)))}));

    [Theory][InlineData(false)][InlineData(true)]
    public async Task ReadAndOwnedGuardReturnOnlyExactPriceFreeLinesWithoutChangingAnyStockOrPhysicalHistory(bool tracked)
    {
        var (plan,allocation)=await Create(tracked:tracked);var before=await Snapshot(plan.Lines[0].VariantId);var read=await Scope(db=>Guard(db).ReadActiveAsync(plan.OwnerId,plan.AcceptanceId,default));Assert.NotNull(read);var proof=await AssertOwned(plan,allocation);Assert.Equal(allocation.AllocationId,proof.AllocationId);Assert.Equal(allocation.ExpiresAt,proof.ExpiresAt);Assert.Equal(2,Assert.Single(proof.Lines).Quantity);Assert.Equal(plan.Lines[0].OfferLineId,proof.Lines[0].OfferLineId);Assert.Equal(read!.Version,proof.Version);Assert.Equal(before,await Snapshot(plan.Lines[0].VariantId));var json=JsonSerializer.Serialize(proof,new JsonSerializerOptions(JsonSerializerDefaults.Web));foreach(var field in new[]{"unitIds","unitId","serial","imei1","ownerId","actorId","unitPriceRial","sourceKey","internalNote"})Assert.DoesNotContain("\""+field+"\":",json,StringComparison.OrdinalIgnoreCase);
    }
    [Fact] public async Task ForeignOwnerAndDemoDisabledNeverRevealAnExistingPrivateHold()
    {
        var (plan,allocation)=await Create(demo:true);Assert.Null(await Scope(db=>Guard(db).ReadActiveAsync("other-owner",plan.AcceptanceId,default)));Assert.Equal("not_found",(await Assert.ThrowsAsync<BusinessException>(()=>AssertOwned(plan,allocation,"other-owner"))).Code);Assert.Null(await Scope(db=>Guard(db,false).ReadActiveAsync(plan.OwnerId,plan.AcceptanceId,default)));Assert.Equal("not_found",(await Assert.ThrowsAsync<BusinessException>(()=>Tx(db=>Guard(db,false).AssertAsync(plan.OwnerId,plan,allocation.AllocationId,allocation.Version,default)))).Code);Assert.Equal(allocation.AllocationId,(await AssertOwned(plan,allocation,plan.OwnerId.ToUpperInvariant())).AllocationId);
    }
    [Fact] public async Task StaleVersionWrongTermsTargetAndLineQuantityCannotUseAnotherHold()
    {
        var (plan,allocation)=await Create();var bytes=Convert.FromBase64String(allocation.Version);bytes[^1]^=1;Assert.Equal("version_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>AssertOwned(plan,allocation with{Version=Convert.ToBase64String(bytes)}))).Code);
        foreach(var bad in new[]{plan with{TermsHash=new string('B',64)},plan with{RequestId=Id()},plan with{TaskId=Id()},plan with{OfferId=Id()},plan with{AcceptanceId=Id()},plan with{Lines=[plan.Lines[0] with{Quantity=1}]},plan with{Lines=[plan.Lines[0] with{OfferLineId=Id()}]},plan with{Lines=[plan.Lines[0] with{VariantId="other-sku"}]}})Assert.Equal("sourcing_allocation_conversion_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>AssertOwned(bad,allocation))).Code);
    }
    [Fact] public async Task ReleasedAllocationCannotBeSilentlySubstitutedByLaterAllocationForSameAcceptance()
    {
        var (plan,allocation)=await Create();var released=await Tx(db=>Allocations(db).ReleaseAsync("inventory-qa",allocation.AllocationId,new(Id(),plan.AcceptanceId,allocation.Version,"Explicit synthetic release"),default));Assert.Null(await Scope(db=>Guard(db).ReadActiveAsync(plan.OwnerId,plan.AcceptanceId,default)));Assert.Equal("sourcing_allocation_conversion_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>AssertOwned(plan,released))).Code);
        var next=await Tx(async db=>{var stock=await db.Stock.SingleAsync(s=>s.VariantId==plan.Lines[0].VariantId);return await Allocations(db).AllocateAsync("inventory-qa",Id(),plan,new(Id(),V,V,V,plan.AcceptanceId,Hash,clock.GetUtcNow().AddMinutes(1),"New explicit allocation, same accepted quantity",[new(plan.Lines[0].OfferLineId,Convert.ToBase64String(stock.Version),"none",[])]),default);});Assert.NotEqual(allocation.AllocationId,next.AllocationId);Assert.Equal(next.AllocationId,(await Scope(db=>Guard(db).ReadActiveAsync(plan.OwnerId,plan.AcceptanceId,default)))!.AllocationId);Assert.Equal("sourcing_allocation_conversion_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>AssertOwned(plan,released))).Code);
    }
    [Fact] public async Task ExpiredButUnreleasedHoldIsReadableWithoutGrantingConversionOrExtendingDeadline()
    {
        var (plan,allocation)=await Create();var before=await Snapshot(plan.Lines[0].VariantId);clock.Advance(TimeSpan.FromMinutes(1));var read=await Scope(db=>Guard(db).ReadActiveAsync(plan.OwnerId,plan.AcceptanceId,default));Assert.NotNull(read);Assert.Equal(allocation.ExpiresAt,read!.ExpiresAt);Assert.Equal("sourcing_allocation_deadline_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>AssertOwned(plan,allocation))).Code);Assert.Equal(before,await Snapshot(plan.Lines[0].VariantId));
    }
    private sealed class BeforeVersionRead(Func<Task> change):DbCommandInterceptor
    {
        private int triggered;
        public bool Triggered=>Volatile.Read(ref triggered)==1;
        public override async ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command,CommandEventData eventData,InterceptionResult<DbDataReader> result,CancellationToken ct=default)
        {
            var sql=command.CommandText;if(sql.Contains("[inventory].[SourcingAllocations]",StringComparison.Ordinal)&&sql.Contains("[Version]",StringComparison.Ordinal)&&sql.Contains("[IsActive]",StringComparison.Ordinal)&&!sql.Contains("[OfferId]",StringComparison.Ordinal)&&!sql.Contains("[Quantity]",StringComparison.Ordinal)&&Interlocked.CompareExchange(ref triggered,1,0)==0)await change();return result;
        }
    }
    [Fact] public async Task SplitReadVersionDriftIsRejectedInsteadOfReturningAMixedProof()
    {
        var (plan,_)=await Create();var hook=new BeforeVersionRead(()=>Scope(async db=>{var row=await db.Set<SourcingStockAllocation>().SingleAsync(a=>a.AcceptanceId==plan.AcceptanceId&&a.IsActive);row.ChangedAt=row.ChangedAt.AddTicks(1);await db.SaveChangesAsync();return true;}));var options=new DbContextOptionsBuilder<InventoryDbContext>().UseSqlServer(fixture.Connection).AddInterceptors(hook).Options;await using var reading=new InventoryDbContext(options);Assert.Equal("version_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Guard(reading).ReadActiveAsync(plan.OwnerId,plan.AcceptanceId,default))).Code);Assert.True(hook.Triggered);
    }
    private static async Task<int> Session(InventoryDbContext db)
    {
        await using var command=db.Database.GetDbConnection().CreateCommand();command.Transaction=db.Database.CurrentTransaction!.GetDbTransaction();command.CommandText="SELECT @@SPID";return Convert.ToInt32(await command.ExecuteScalarAsync());
    }
    private static async Task<bool> ObserveWait(InventoryDbContext blocker,int waiting,int holding)
    {
        var elapsed=Stopwatch.StartNew();while(elapsed.Elapsed<TimeSpan.FromSeconds(8)){await using var command=blocker.Database.GetDbConnection().CreateCommand();command.Transaction=blocker.Database.CurrentTransaction!.GetDbTransaction();command.CommandTimeout=3;command.CommandText="SELECT COUNT(*) FROM sys.dm_exec_requests WHERE session_id=@waiting AND blocking_session_id=@holding AND database_id=DB_ID() AND wait_type LIKE 'LCK_M_%'";var w=command.CreateParameter();w.ParameterName="@waiting";w.Value=waiting;command.Parameters.Add(w);var h=command.CreateParameter();h.ParameterName="@holding";h.Value=holding;command.Parameters.Add(h);if(Convert.ToInt32(await command.ExecuteScalarAsync())>0)return true;await Task.Delay(25);}return false;
    }
    [Fact] public async Task AllocationRowLockWaitCannotCarryAnExpiredHoldThroughConversion()
    {
        var (plan,allocation)=await Create();var before=await Snapshot(plan.Lines[0].VariantId);await using var blockerScope=fixture.Factory.Services.CreateAsyncScope();var blocker=blockerScope.ServiceProvider.GetRequiredService<InventoryDbContext>();await using var blockerTx=await blocker.Database.BeginTransactionAsync(IsolationLevel.Serializable);await blocker.Set<SourcingStockAllocation>().FromSqlInterpolated($"SELECT * FROM [inventory].[SourcingAllocations] WITH (UPDLOCK,HOLDLOCK) WHERE [Id]={allocation.AllocationId}").SingleAsync();var holding=await Session(blocker);var started=new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously);
        async Task<SourcingStockConversionProof> Attempt(){return await Tx(async db=>{started.SetResult(await Session(db));return await Guard(db).AssertAsync(plan.OwnerId,plan,allocation.AllocationId,allocation.Version,default);});}
        var pending=Attempt();var waiting=await started.Task.WaitAsync(TimeSpan.FromSeconds(10));bool observed;try{observed=await ObserveWait(blocker,waiting,holding);clock.Advance(TimeSpan.FromMinutes(1));}finally{await blockerTx.CommitAsync();}Assert.True(observed,"The clock may advance only after SQL proves the guard is waiting for this allocation row.");Assert.Equal("sourcing_allocation_deadline_conflict",(await Assert.ThrowsAsync<BusinessException>(async()=>await pending)).Code);Assert.Equal(before,await Snapshot(plan.Lines[0].VariantId));
    }
}
