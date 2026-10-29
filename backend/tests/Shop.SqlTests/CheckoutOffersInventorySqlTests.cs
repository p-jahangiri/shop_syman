using System.Data;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Inventory;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;

// The internal price-free batch only. HTTP checkout tests separately prove
// genuine customer consent, Cart/Agreement locks and current Catalog authority.
public sealed class CheckoutOffersInventorySqlTests(SqlFixture fixture):IClassFixture<SqlFixture>
{
    private const string Version="AAAAAAAAAAE=";
    private static readonly string Hash=new('A',64);
    private static string Id()=>Guid.NewGuid().ToString("N");
    private sealed class Clock:TimeProvider
    {
        private long ticks=DateTimeOffset.UtcNow.UtcTicks;
        public override DateTimeOffset GetUtcNow()=>new(Interlocked.Read(ref ticks),TimeSpan.Zero);
        public void Advance(TimeSpan value)=>Interlocked.Add(ref ticks,value.Ticks);
    }
    private readonly Clock clock=new();
    private sealed record Held(SourcingStockAllocationPlan Plan,SourcingAllocationMutation Allocation)
    {
        public SourcingCheckoutAllocationRequest Request=>new(Plan,Allocation.AllocationId,Allocation.Version);
    }
    private sealed record InventorySnapshot(string Stock,string History,int Movements);
    private async Task<T> Scope<T>(Func<IServiceProvider,InventoryDbContext,Task<T>> action)
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<InventoryDbContext>();
        Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);return await action(scope.ServiceProvider,db);
    }
    private Task<T> Tx<T>(Func<InventoryDbContext,Task<T>> action)=>Scope(async(_,db)=>{await using var tx=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);var result=await action(db);await tx.CommitAsync();return result;});
    private SourcingAllocationService Allocations(InventoryDbContext db)=>new(db,new(db,clock),clock,true);
    private CheckoutOffersGuard Guard(InventoryDbContext db,bool allowDemo=true)=>new(db,new(db,clock),clock,allowDemo);
    private Task<StockItem> Stock(string variant)=>Scope((_,db)=>db.Stock.AsNoTracking().SingleAsync(s=>s.VariantId==variant));
    private async Task<(string Variant,SerialUnitData[] Units)> AddStock(int quantity,int reserved=0,bool tracked=false,string? variant=null)
    {
        variant??="checkout-proof-"+Id();
        await Scope(async(_,db)=>{db.Stock.Add(new(){VariantId=variant,OnHand=tracked?0:quantity,Reserved=tracked?0:reserved});await db.SaveChangesAsync();return true;});
        if(!tracked)return(variant,[]);
        var stock=await Stock(variant);
        await Tx(db=>new SerialInventoryService(db,new(db,clock),clock).ConfigureAsync(variant,false,new("serial",Convert.ToBase64String(stock.Version),Id()),"checkout-qa",default));
        stock=await Stock(variant);
        var received=await Tx(db=>new SerialInventoryService(db,new(db,clock),clock).ReceiveAsync(variant,false,new(Enumerable.Range(0,quantity).Select(i=>new SerialUnitInput("QA-"+variant+"-"+i)).ToArray(),"Explicit synthetic checkout receipt",Convert.ToBase64String(stock.Version),Id()),"checkout-qa",default));
        return(variant,received.Units);
    }
    private SourcingStockAllocationPlan Plan(string variant,int quantity,string owner,bool demo=false)=>new(Id(),Id(),Id(),Id(),owner,Hash,clock.GetUtcNow().AddHours(2),demo,[new(Id(),variant,"catalog-model_1",quantity,Hash)]);
    private async Task<Held> Allocate(SourcingStockAllocationPlan plan,SerialUnitData[]? units=null)
    {
        var lines=new List<SourcingAllocationLineInput>();
        foreach(var line in plan.Lines)
        {
            var stock=await Stock(line.VariantId);
            lines.Add(new(line.OfferLineId,Convert.ToBase64String(stock.Version),stock.TrackingMode,units?.Where(u=>u.VariantId.Equals(line.VariantId,StringComparison.OrdinalIgnoreCase)).Select(u=>new SourcingAllocationUnitInput(u.Id,u.Version)).ToArray()??[]));
        }
        var input=new SourcingAllocationInput(Id(),Version,Version,Version,plan.AcceptanceId,plan.TermsHash,clock.GetUtcNow().AddMinutes(1),"Explicit synthetic checkout hold",lines.ToArray());
        return new(plan,await Tx(db=>Allocations(db).AllocateAsync("checkout-inventory-qa",Id(),plan,input,default)));
    }
    private async Task<(string Variant,Held[] Held)> Pair(int onHand=5,int reserved=0,bool tracked=false,bool demo=false)
    {
        var stock=await AddStock(onHand,reserved,tracked);var owner="owner-"+Id();
        var first=await Allocate(Plan(stock.Variant,2,owner,demo),tracked?stock.Units[..2]:null);
        var second=await Allocate(Plan(stock.Variant,3,owner,demo),tracked?stock.Units[2..5]:null);
        return(stock.Variant,[first,second]);
    }
    private Task<SourcingCheckoutInventoryProof> AssertBatch(Held[] held,SourcingCheckoutOrdinaryLine[]? ordinary=null,string? owner=null,bool allowDemo=true)=>
        Tx(db=>Guard(db,allowDemo).AssertAsync(owner??held[0].Plan.OwnerId,held.Select(h=>h.Request).ToArray(),ordinary??[],default));
    private Task<InventorySnapshot> Snapshot(params string[] variants)=>Scope(async(sp,db)=>
    {
        var allocationIds=await db.Set<SourcingStockAllocationLine>().AsNoTracking().Where(l=>variants.Contains(l.VariantId)).Select(l=>l.AllocationId).Distinct().ToArrayAsync();
        var stock=JsonSerializer.Serialize(await db.Stock.AsNoTracking().Where(s=>variants.Contains(s.VariantId)).OrderBy(s=>s.VariantId).Select(s=>new{s.VariantId,s.OnHand,s.Reserved,s.SourcingReserved,s.TrackingMode,s.Version}).ToArrayAsync());
        var sales=sp.GetRequiredService<SalesDbContext>();
        var history=JsonSerializer.Serialize(new
        {
            Allocations=await db.Set<SourcingStockAllocation>().AsNoTracking().Where(a=>allocationIds.Contains(a.Id)).OrderBy(a=>a.Id).Select(a=>new{a.Id,a.OwnerId,a.RequestId,a.TaskId,a.OfferId,a.AcceptanceId,a.TermsHash,a.State,a.IsActive,a.CreatedAt,a.ChangedAt,a.ExpiresAt,a.Version}).ToArrayAsync(),
            Lines=await db.Set<SourcingStockAllocationLine>().AsNoTracking().Where(l=>allocationIds.Contains(l.AllocationId)).OrderBy(l=>l.AllocationId).ThenBy(l=>l.OfferLineId).ToArrayAsync(),
            Units=await db.SerialUnits.AsNoTracking().Where(u=>variants.Contains(u.VariantId)).OrderBy(u=>u.Id).Select(u=>new{u.Id,u.State,u.Version,u.OrderId,u.ReservationId,u.WarrantyUntil}).ToArrayAsync(),
            Claims=await db.Set<SerialUnitClaim>().AsNoTracking().Where(c=>variants.Contains(c.VariantId)).OrderBy(c=>c.Id).Select(c=>new{c.Id,c.UnitId,c.State,c.IsActive,c.Version,c.ChangedAt,c.OriginAllocationId,c.OfferLineId,c.OrderId,c.ReservationId,c.OrderLineId}).ToArrayAsync(),
            Commands=await db.Set<SourcingAllocationCommand>().AsNoTracking().Where(c=>allocationIds.Contains(c.AllocationId)).OrderBy(c=>c.ActorId).ThenBy(c=>c.Operation).ThenBy(c=>c.CommandId).ToArrayAsync(),
            Events=await db.Set<SourcingAllocationEvent>().AsNoTracking().Where(e=>allocationIds.Contains(e.AllocationId)).OrderBy(e=>e.Id).ToArrayAsync(),
            Reservations=await db.Reservations.CountAsync(),Orders=await sales.Orders.CountAsync(),Quotes=await sales.Quotes.CountAsync(),Agreements=await sales.SourcingPriceAgreements.CountAsync()
        });
        return new InventorySnapshot(stock,history,await db.Movements.CountAsync(m=>variants.Contains(m.VariantId)));
    });

    [Theory][InlineData(false)][InlineData(true)]
    public async Task TwoSameSkuAcceptedGroupsWithZeroPublicStockKeepExactCoverageAndEveryRowVersion(bool tracked)
    {
        var pair=await Pair(tracked:tracked);var before=await Snapshot(pair.Variant);
        var proof=await AssertBatch(pair.Held.Reverse().ToArray());
        Assert.Equal(2,proof.Allocations.Length);Assert.Empty(proof.OrdinaryAvailable);
        Assert.Equal(pair.Held.Select(h=>h.Plan.AcceptanceId).Order(StringComparer.Ordinal),proof.Allocations.Select(p=>p.AcceptanceId));
        foreach(var held in pair.Held)
        {
            var allocation=Assert.Single(proof.Allocations,p=>p.AllocationId==held.Allocation.AllocationId);
            Assert.Equal(held.Allocation.Version,allocation.Version);Assert.Equal(held.Allocation.ExpiresAt,allocation.ExpiresAt);
            Assert.Equal(held.Plan.Lines[0].Quantity,Assert.Single(allocation.Lines).Quantity);Assert.Equal(held.Plan.Lines[0].OfferLineId,allocation.Lines[0].OfferLineId);
        }
        var stock=await Stock(pair.Variant);Assert.Equal(0,StockAvailability.Available(stock.OnHand,stock.Reserved,stock.SourcingReserved));
        Assert.Equal(before,await Snapshot(pair.Variant));
        var json=JsonSerializer.Serialize(proof,new JsonSerializerOptions(JsonSerializerDefaults.Web));
        foreach(var field in new[]{"unitId","unitIds","serial","imei1","ownerId","unitPriceRial","totalRial","internalNote"})Assert.DoesNotContain("\""+field+"\":",json,StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task OrdinaryDemandSeesOnlyPublicCapacityWithoutBorrowingAcceptedHoldOrChangingAnything()
    {
        var pair=await Pair(onHand:10,reserved:1);var missing="missing-"+Id();var before=await Snapshot(pair.Variant);
        var proof=await AssertBatch(pair.Held,[new(pair.Variant.ToUpperInvariant(),5),new(missing,1)]);
        Assert.Equal(4,proof.OrdinaryAvailable[pair.Variant]);Assert.Equal(0,proof.OrdinaryAvailable[missing]);
        Assert.Equal(5,proof.Allocations.Sum(p=>p.Lines.Sum(l=>l.Quantity)));Assert.Equal(before,await Snapshot(pair.Variant));
        Assert.True(proof.OrdinaryAvailable[pair.Variant]<5,"Sales must reject this independent ordinary demand; accepted coverage does not make it available.");
    }

    [Fact]
    public async Task WrongOwnerHiddenDemoAndStaleAllocationVersionFailWithoutEffects()
    {
        var pair=await Pair(demo:true);var before=await Snapshot(pair.Variant);
        Assert.Equal("not_found",(await Assert.ThrowsAsync<BusinessException>(()=>AssertBatch(pair.Held,owner:"another-owner"))).Code);
        Assert.Equal("not_found",(await Assert.ThrowsAsync<BusinessException>(()=>AssertBatch(pair.Held,allowDemo:false))).Code);
        var held=pair.Held[0];var bytes=Convert.FromBase64String(held.Allocation.Version);bytes[^1]^=1;
        var stale=held with{Allocation=held.Allocation with{Version=Convert.ToBase64String(bytes)}};
        Assert.Equal("version_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>AssertBatch([stale,pair.Held[1]]))).Code);
        Assert.Equal(before,await Snapshot(pair.Variant));
    }

    [Fact]
    public async Task CompleteProvenanceAndEveryExactLineAreRequiredBeforeAnyStockIsUsed()
    {
        var pair=await Pair();var held=pair.Held[0];var plan=held.Plan;var before=await Snapshot(pair.Variant);
        foreach(var bad in new[]{plan with{RequestId=Id()},plan with{TaskId=Id()},plan with{OfferId=Id()},plan with{TermsHash=new string('B',64)},plan with{Lines=[plan.Lines[0] with{Quantity=1}]},plan with{Lines=[plan.Lines[0] with{OfferLineId=Id()}]},plan with{Lines=[plan.Lines[0] with{VariantId="different-sku"}]}})
            Assert.Equal("sourcing_allocation_conversion_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>AssertBatch([held with{Plan=bad},pair.Held[1]]))).Code);
        Assert.Equal(before,await Snapshot(pair.Variant));
    }

    [Fact]
    public async Task ReleasedResourceNeverFollowsAReplacementAllocationForTheSameAcceptance()
    {
        var pair=await Pair();var held=pair.Held[0];
        var released=await Tx(db=>Allocations(db).ReleaseAsync("checkout-inventory-qa",held.Allocation.AllocationId,new(Id(),held.Plan.AcceptanceId,held.Allocation.Version,"Explicit synthetic release"),default));
        var replacement=await Allocate(held.Plan);var before=await Snapshot(pair.Variant);
        Assert.NotEqual(held.Allocation.AllocationId,replacement.Allocation.AllocationId);
        Assert.Equal("sourcing_allocation_checkout_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>AssertBatch([held with{Allocation=released},pair.Held[1]]))).Code);
        var proof=await AssertBatch([replacement,pair.Held[1]]);Assert.Contains(proof.Allocations,a=>a.AllocationId==replacement.Allocation.AllocationId);
        Assert.DoesNotContain(proof.Allocations,a=>a.AllocationId==held.Allocation.AllocationId);Assert.Equal(before,await Snapshot(pair.Variant));
    }

    [Fact]
    public async Task ExpiredUnreleasedCapacityDoesNotProduceProofOrExtendAnyDeadline()
    {
        var pair=await Pair();var before=await Snapshot(pair.Variant);clock.Advance(TimeSpan.FromMinutes(1));
        Assert.Equal("sourcing_allocation_deadline_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>AssertBatch(pair.Held))).Code);
        Assert.Equal(before,await Snapshot(pair.Variant));Assert.Equal(5,(await Stock(pair.Variant)).SourcingReserved);
    }

    private static async Task<int> Session(InventoryDbContext db)
    {
        await using var command=db.Database.GetDbConnection().CreateCommand();command.Transaction=db.Database.CurrentTransaction!.GetDbTransaction();command.CommandText="SELECT @@SPID";return Convert.ToInt32(await command.ExecuteScalarAsync());
    }
    private static async Task<bool> ObserveWait(InventoryDbContext blocker,int waiting,int holding)
    {
        var elapsed=Stopwatch.StartNew();while(elapsed.Elapsed<TimeSpan.FromSeconds(8))
        {
            await using var command=blocker.Database.GetDbConnection().CreateCommand();command.Transaction=blocker.Database.CurrentTransaction!.GetDbTransaction();command.CommandTimeout=3;
            // A later exclusive application-lock waiter can queue behind an
            // earlier waiter instead of naming the original holder directly.
            // Require this exact session to be in the holder's bounded SQL
            // blocking chain; elapsed time alone never establishes contention.
            command.CommandText="WITH waiting AS (SELECT session_id FROM sys.dm_exec_requests WHERE blocking_session_id=@holding AND database_id=DB_ID() AND wait_type LIKE 'LCK_M_%' UNION ALL SELECT r.session_id FROM sys.dm_exec_requests r JOIN waiting w ON r.blocking_session_id=w.session_id WHERE r.database_id=DB_ID() AND r.wait_type LIKE 'LCK_M_%') SELECT COUNT(*) FROM waiting WHERE session_id=@waiting OPTION(MAXRECURSION 8);";
            var w=command.CreateParameter();w.ParameterName="@waiting";w.Value=waiting;command.Parameters.Add(w);var h=command.CreateParameter();h.ParameterName="@holding";h.Value=holding;command.Parameters.Add(h);
            if(Convert.ToInt32(await command.ExecuteScalarAsync())>0)return true;await Task.Delay(25);
        }
        return false;
    }
    private Task<SourcingCheckoutInventoryProof> Pending(Held[] held,SourcingCheckoutOrdinaryLine[] ordinary,TaskCompletionSource<int> started)=>Tx(async db=>
    {
        started.SetResult(await Session(db));return await Guard(db).AssertAsync(held[0].Plan.OwnerId,held.Select(h=>h.Request).ToArray(),ordinary,default);
    });

    [Theory][InlineData("allocation")][InlineData("stock")]
    public async Task ActualSqlLockWaitCannotCarryADeadlinePastTheCurrentClock(string target)
    {
        var pair=await Pair();var before=await Snapshot(pair.Variant);
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var blocker=scope.ServiceProvider.GetRequiredService<InventoryDbContext>();await using var tx=await blocker.Database.BeginTransactionAsync(IsolationLevel.Serializable);
        if(target=="stock")await blocker.Stock.FromSqlInterpolated($"SELECT * FROM [inventory].[Stock] WITH (UPDLOCK,HOLDLOCK) WHERE [VariantId]={pair.Variant}").SingleAsync();
        else
        {
            var first=pair.Held.OrderBy(h=>h.Plan.AcceptanceId,StringComparer.Ordinal).First().Allocation.AllocationId;
            await blocker.Set<SourcingStockAllocation>().FromSqlInterpolated($"SELECT * FROM [inventory].[SourcingAllocations] WITH (UPDLOCK,HOLDLOCK) WHERE [Id]={first}").SingleAsync();
        }
        var holding=await Session(blocker);var started=new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously);var pending=Pending(pair.Held,[],started);var waiting=await started.Task.WaitAsync(TimeSpan.FromSeconds(10));bool observed;
        try{observed=await ObserveWait(blocker,waiting,holding);if(observed)clock.Advance(TimeSpan.FromMinutes(1));}finally{await tx.CommitAsync();}
        var error=await Assert.ThrowsAsync<BusinessException>(async()=>await pending);Assert.True(observed,"SQL must prove this batch is waiting on its exact fixture-owned blocker before the explicit clock advances.");
        Assert.Equal("sourcing_allocation_deadline_conflict",error.Code);Assert.Equal(before,await Snapshot(pair.Variant));
    }

    [Fact]
    public async Task ObservedStockContentionReturnsTheCommittedOrdinaryCapacityAndDoesNotRewriteHoldHistory()
    {
        var pair=await Pair(onHand:7);var before=await Snapshot(pair.Variant);
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var blocker=scope.ServiceProvider.GetRequiredService<InventoryDbContext>();await using var tx=await blocker.Database.BeginTransactionAsync(IsolationLevel.Serializable);
        var stock=await blocker.Stock.FromSqlInterpolated($"SELECT * FROM [inventory].[Stock] WITH (UPDLOCK,HOLDLOCK) WHERE [VariantId]={pair.Variant}").SingleAsync();var holding=await Session(blocker);
        var started=new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously);var pending=Pending(pair.Held,[new(pair.Variant,3)],started);var waiting=await started.Task.WaitAsync(TimeSpan.FromSeconds(10));bool observed;string committedVersion="";
        try
        {
            observed=await ObserveWait(blocker,waiting,holding);
            if(observed)
            {
                await new InventoryService(blocker).AdjustAsync(pair.Variant,new(1,"Explicit synthetic Stock adjustment while quote waits",Id(),Convert.ToBase64String(stock.Version)),"checkout-inventory-qa",default);
                committedVersion=Convert.ToBase64String(stock.Version);
            }
        }
        finally{await tx.CommitAsync();}
        var proof=await pending;Assert.True(observed,"The exact guard session must wait on Stock before the actual adjustment commits.");Assert.Equal(3,proof.OrdinaryAvailable[pair.Variant]);
        var after=await Snapshot(pair.Variant);Assert.Equal(before.History,after.History);Assert.Equal(before.Movements+1,after.Movements);
        var fresh=await Stock(pair.Variant);Assert.Equal(8,fresh.OnHand);Assert.Equal(5,fresh.SourcingReserved);Assert.Equal(0,fresh.Reserved);Assert.Equal(committedVersion,Convert.ToBase64String(fresh.Version));
    }

    private static async Task BlockAcceptance(InventoryDbContext db,string acceptance)
    {
        await using var command=db.Database.GetDbConnection().CreateCommand();command.Transaction=db.Database.CurrentTransaction!.GetDbTransaction();command.CommandText="DECLARE @r int; EXEC @r=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;SELECT @r;";
        var parameter=command.CreateParameter();parameter.ParameterName="@resource";parameter.Value="sayman:inventory:sourcing-allocation-acceptance:"+Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(acceptance)));command.Parameters.Add(parameter);Assert.True(Convert.ToInt32(await command.ExecuteScalarAsync())>=0);
    }

    [Fact]
    public async Task OppositeCallerOrderAndOppositeSkuOrderContendOnOneCanonicalBatchWithoutDeadlock()
    {
        var owner="owner-"+Id();var z=await AddStock(2,variant:"z-checkout-"+Id());var a=await AddStock(2,variant:"a-checkout-"+Id());
        var acceptances=new[]{Id(),Id()}.Order(StringComparer.Ordinal).ToArray();
        var first=await Allocate(Plan(z.Variant,1,owner) with{AcceptanceId=acceptances[0]});var second=await Allocate(Plan(a.Variant,1,owner) with{AcceptanceId=acceptances[1]});var before=await Snapshot(z.Variant,a.Variant);
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var blocker=scope.ServiceProvider.GetRequiredService<InventoryDbContext>();await using var tx=await blocker.Database.BeginTransactionAsync(IsolationLevel.Serializable);await BlockAcceptance(blocker,acceptances[0]);var holding=await Session(blocker);
        var startedA=new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously);var startedB=new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously);
        var attemptA=Pending([first,second],[],startedA);var attemptB=Pending([second,first],[],startedB);var sessions=await Task.WhenAll(startedA.Task,startedB.Task).WaitAsync(TimeSpan.FromSeconds(10));bool observedA,observedB;
        try{observedA=await ObserveWait(blocker,sessions[0],holding);observedB=await ObserveWait(blocker,sessions[1],holding);}finally{await tx.CommitAsync();}
        var pair=await Task.WhenAll(attemptA,attemptB);Assert.True(observedA&&observedB,"Both input orders must reach the same first acceptance lock before it is released.");
        foreach(var proof in pair){Assert.Equal(acceptances,proof.Allocations.Select(p=>p.AcceptanceId));Assert.Empty(proof.OrdinaryAvailable);}
        Assert.Equal(before,await Snapshot(z.Variant,a.Variant));
    }
}
