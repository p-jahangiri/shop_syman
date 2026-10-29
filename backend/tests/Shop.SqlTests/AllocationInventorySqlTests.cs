using System.Data;
using System.Data.Common;
using System.Diagnostics;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Inventory;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;

// Internal Inventory core only. Root HTTP tests separately prove the real
// Market acceptance, current Catalog and retained Sales price agreement.
public sealed class AllocationInventorySqlTests(SqlFixture fixture):IClassFixture<SqlFixture>
{
    private const string V="AAAAAAAAAAA=";
    private static string Id()=>Guid.NewGuid().ToString("N");
    private static readonly string Hash=new('A',64);
    private sealed class Clock:TimeProvider
    {
        private long ticks=DateTimeOffset.UtcNow.UtcTicks;
        public override DateTimeOffset GetUtcNow()=>new(Interlocked.Read(ref ticks),TimeSpan.Zero);
        public void Advance(TimeSpan by)=>Interlocked.Add(ref ticks,by.Ticks);
    }
    private readonly Clock clock=new();
    private sealed record Core(InventoryDbContext Db,StockReservationService Reservations,SerialInventoryService Serials,SourcingAllocationService Allocations);
    private Core Services(IServiceProvider sp){var db=sp.GetRequiredService<InventoryDbContext>();var holds=new StockReservationService(db,clock);return new(db,holds,new(db,holds,clock),new(db,holds,clock,true));}
    private async Task<T> Scope<T>(Func<IServiceProvider,Task<T>> action){await using var scope=fixture.Factory.Services.CreateAsyncScope();return await action(scope.ServiceProvider);}
    private async Task<T> Tx<T>(Func<Core,Task<T>> action){await using var scope=fixture.Factory.Services.CreateAsyncScope();var core=Services(scope.ServiceProvider);Assert.StartsWith("SaymanTest_",core.Db.Database.GetDbConnection().Database);await using var tx=await core.Db.Database.BeginTransactionAsync(IsolationLevel.Serializable);var result=await action(core);await tx.CommitAsync();return result;}
    private async Task<StockItem> Stock(string id)=>await Scope(sp=>sp.GetRequiredService<InventoryDbContext>().Stock.AsNoTracking().SingleAsync(s=>s.VariantId==id));
    private async Task<string> AddStock(int quantity,int reserved=0,string mode="none")=>await Scope(async sp=>{var db=sp.GetRequiredService<InventoryDbContext>();var id="allocation-"+Id();db.Stock.Add(new(){VariantId=id,OnHand=quantity,Reserved=reserved,TrackingMode=mode});await db.SaveChangesAsync();return id;});
    private SourcingStockAllocationPlan Plan(string variant,int quantity=1,string? owner=null)=>new(Id(),Id(),Id(),Id(),owner??"owner-"+Id(),Hash,clock.GetUtcNow().AddHours(2),false,[new(Id(),variant,"catalog-model_1",quantity,Hash)]);
    private async Task<SourcingAllocationInput> Input(SourcingStockAllocationPlan plan,SerialUnitData[]? units=null)
    {
        var lines=new List<SourcingAllocationLineInput>();foreach(var line in plan.Lines){var stock=await Stock(line.VariantId);lines.Add(new(line.OfferLineId,Convert.ToBase64String(stock.Version),stock.TrackingMode,units?.Where(u=>u.VariantId.Equals(line.VariantId,StringComparison.OrdinalIgnoreCase)).Select(u=>new SourcingAllocationUnitInput(u.Id,u.Version)).ToArray()??[]));}return new(Id(),V,V,V,plan.AcceptanceId,plan.TermsHash,clock.GetUtcNow().AddHours(1),"PRIVATE-ALLOCATION-REASON",lines.ToArray());
    }
    private async Task<SourcingAllocationMutation> Allocate(SourcingStockAllocationPlan plan,SourcingAllocationInput input,string? id=null,string actor="inventory-operator")=>await Tx(c=>c.Allocations.AllocateAsync(actor,id??Id(),plan,input,default));
    private async Task<SourcingAllocationData> Read(string id,string? owner=null)=>await Scope(sp=>Services(sp).Allocations.ReadAsync(id,owner,default));
    private async Task<SourcingAllocationMutation> Release(SourcingAllocationMutation allocation,string? key=null)=>await Tx(c=>c.Allocations.ReleaseAsync("inventory-operator",allocation.AllocationId,new(key??Id(),allocation.AcceptanceId,allocation.Version,"PRIVATE-RELEASE-REASON"),default));
    private async Task<(int OnHand,int Reserved,int Sourcing,int Movements,int Allocations,int Commands,int Claims,int Orders,int Reservations)> Counts(string variant)=>await Scope(async sp=>{var db=sp.GetRequiredService<InventoryDbContext>();var row=await db.Stock.AsNoTracking().SingleAsync(s=>s.VariantId==variant);return(row.OnHand,row.Reserved,row.SourcingReserved,await db.Movements.CountAsync(m=>m.VariantId==variant),await db.Set<SourcingStockAllocation>().CountAsync(a=>a.Lines.Any(l=>l.VariantId==variant)),await db.Set<SourcingAllocationCommand>().CountAsync(c=>db.Set<SourcingStockAllocation>().Any(a=>a.Id==c.AllocationId&&a.Lines.Any(l=>l.VariantId==variant))),await db.Set<SerialUnitClaim>().CountAsync(c=>c.VariantId==variant&&c.IsActive),await sp.GetRequiredService<SalesDbContext>().Orders.CountAsync(),await db.Reservations.CountAsync());});
    private async Task<(string Variant,SerialUnitData[] Units)> Tracked(int count=2)
    {
        var variant=await AddStock(0);var stock=await Stock(variant);await Tx(c=>c.Serials.ConfigureAsync(variant,false,new("serial",Convert.ToBase64String(stock.Version),Id()),"tracker",default));var receipt=await Tx(async c=>{var current=await c.Db.Stock.AsNoTracking().SingleAsync(s=>s.VariantId==variant);return await c.Serials.ReceiveAsync(variant,false,new(Enumerable.Range(0,count).Select(i=>new SerialUnitInput("QA-"+variant+"-"+i)).ToArray(),"Actual synthetic serial receipt",Convert.ToBase64String(current.Version),Id()),"tracker",default);});return(variant,receipt.Units);
    }
    private sealed class BeforeSummaryVersionRead(Func<Task> change):DbCommandInterceptor
    {
        private int triggered;
        public bool Triggered=>Volatile.Read(ref triggered)==1;
        public override async ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command,CommandEventData eventData,InterceptionResult<DbDataReader> result,CancellationToken ct=default)
        {
            // The final summary projection selects Id/Version/IsActive only.
            // Parent and split child graph reads include OfferId or Quantity.
            var sql=command.CommandText;if(sql.Contains("[inventory].[SourcingAllocations]",StringComparison.Ordinal)&&sql.Contains("[Version]",StringComparison.Ordinal)&&sql.Contains("[IsActive]",StringComparison.Ordinal)&&!sql.Contains("[OfferId]",StringComparison.Ordinal)&&!sql.Contains("[Quantity]",StringComparison.Ordinal)&&Interlocked.CompareExchange(ref triggered,1,0)==0)await change();return result;
        }
    }
    private static async Task<int> Session(InventoryDbContext db)
    {
        await using var command=db.Database.GetDbConnection().CreateCommand();command.Transaction=db.Database.CurrentTransaction!.GetDbTransaction();command.CommandText="SELECT @@SPID";return Convert.ToInt32(await command.ExecuteScalarAsync());
    }
    private static async Task<bool> ObserveStockWait(InventoryDbContext blocker,int waitingSession,int blockerSession)
    {
        var elapsed=Stopwatch.StartNew();while(elapsed.Elapsed<TimeSpan.FromSeconds(8)){
            await using var command=blocker.Database.GetDbConnection().CreateCommand();command.Transaction=blocker.Database.CurrentTransaction!.GetDbTransaction();command.CommandTimeout=3;command.CommandText="SELECT COUNT(*) FROM sys.dm_exec_requests WHERE session_id=@waiting AND blocking_session_id=@blocker AND database_id=DB_ID() AND wait_type LIKE 'LCK_M_%'";var waiting=command.CreateParameter();waiting.ParameterName="@waiting";waiting.Value=waitingSession;command.Parameters.Add(waiting);var holding=command.CreateParameter();holding.ParameterName="@blocker";holding.Value=blockerSession;command.Parameters.Add(holding);if(Convert.ToInt32(await command.ExecuteScalarAsync())>0)return true;await Task.Delay(25);
        }return false;
    }

    [Fact] public async Task RealCountStockIsHeldWithoutChangingOnHandOrdersOrLedgerAndReleaseReplaysExactly()
    {
        var variant=await AddStock(5,reserved:1);var plan=Plan(variant,2);var before=await Counts(variant);var input=await Input(plan);var id=Id();var first=await Allocate(plan,input,id);var replay=await Allocate(plan,input,id);Assert.True(replay.Replayed);Assert.Equal(first with{Replayed=true},replay);Assert.Equal(input.ExpiresAt,first.ExpiresAt);var held=await Counts(variant);Assert.Equal(5,held.OnHand);Assert.Equal(1,held.Reserved);Assert.Equal(2,held.Sourcing);Assert.Equal(before.Movements,held.Movements);Assert.Equal(before.Orders,held.Orders);Assert.Equal(before.Reservations,held.Reservations);Assert.Equal(2,await Scope(async sp=>(await sp.GetRequiredService<IInventoryReader>().AvailableAsync([variant],default))[variant]));
        var command=Id();var released=await Release(first,command);var repeated=await Release(first,command);Assert.True(repeated.Replayed);Assert.Equal(released with{Replayed=true},repeated);Assert.Equal(0,(await Counts(variant)).Sourcing);Assert.Equal(5,(await Counts(variant)).OnHand);Assert.Equal(2,(await Scope(sp=>Services(sp).Allocations.EventsAsync(id,null,null,default))).Items.Length);Assert.True((await Allocate(plan,input,id)).Replayed);Assert.Equal(0,(await Counts(variant)).Sourcing);
    }

    [Fact] public async Task WholeAcceptedAllocationRejectsMissingLineInsufficientStockOrChangedTermsWithoutPartialEffect()
    {
        var a=await AddStock(2);var b=await AddStock(0);var plan=Plan(a,2);plan=plan with{Lines=[plan.Lines[0],new(Id(),b,"model_b",1,Hash)]};var input=await Input(plan);Assert.Equal("insufficient_stock",(await Assert.ThrowsAsync<BusinessException>(()=>Allocate(plan,input))).Code);Assert.Equal(0,(await Counts(a)).Sourcing);Assert.Equal(0,(await Counts(a)).Allocations);Assert.Equal("sourcing_allocation_plan_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Allocate(plan,input with{Lines=[input.Lines[0]]}))).Code);Assert.Equal("sourcing_allocation_plan_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Allocate(plan,input with{TermsHash=new string('B',64)}))).Code);
    }

    [Fact] public async Task SharedSkuLinesUseTheirExactQuantitiesAndOnePhysicalCounter()
    {
        var variant=await AddStock(5);var plan=Plan(variant,2);plan=plan with{Lines=[plan.Lines[0],plan.Lines[0] with{OfferLineId=Id(),Quantity=3}]};var allocated=await Allocate(plan,await Input(plan));var data=await Read(allocated.AllocationId);Assert.Equal(2,data.Lines.Length);Assert.Equal(5,data.Lines.Sum(l=>l.Quantity));Assert.Equal(5,(await Counts(variant)).Sourcing);await Release(allocated);Assert.Equal(0,(await Counts(variant)).Sourcing);
    }

    [Fact] public async Task StaleStockVersionChangedTrackingAndForeignPhysicalPicksFailWithoutHoldingCapacity()
    {
        var variant=await AddStock(3);var plan=Plan(variant);var stale=await Input(plan);await Scope(async sp=>{var db=sp.GetRequiredService<InventoryDbContext>();var stock=await db.Stock.SingleAsync(s=>s.VariantId==variant);stock.OnHand++;await db.SaveChangesAsync();return true;});Assert.Equal("version_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Allocate(plan,stale))).Code);
        var fresh=await Input(plan);var wrongMode=fresh with{Lines=[fresh.Lines[0] with{TrackingMode="serial",Units=[new(Id(),V)]}]};Assert.Equal("sourcing_allocation_tracking_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Allocate(plan,wrongMode))).Code);Assert.Equal(0,(await Counts(variant)).Sourcing);
        var tracked=await Tracked();var foreign=await Tracked();var trackedPlan=Plan(tracked.Variant);var foreignPick=await Input(trackedPlan,[tracked.Units[0]]);foreignPick=foreignPick with{Lines=[foreignPick.Lines[0] with{Units=[new(foreign.Units[0].Id,foreign.Units[0].Version)]}]};Assert.Equal("sourcing_allocation_unit_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Allocate(trackedPlan,foreignPick))).Code);Assert.Equal(0,(await Counts(tracked.Variant)).Claims);Assert.Equal(0,(await Counts(tracked.Variant)).Sourcing);
    }

    [Fact] public async Task ExactTrackedPicksCreateImmutableOriginClaimsButKeepUnitsPhysicallyAvailable()
    {
        var tracked=await Tracked();var plan=Plan(tracked.Variant,2);var allocated=await Allocate(plan,await Input(plan,tracked.Units));var data=await Read(allocated.AllocationId,plan.OwnerId);Assert.Equal(tracked.Units.Select(u=>u.Id).Order(),data.Lines[0].UnitIds.Order());await Scope(async sp=>{var db=sp.GetRequiredService<InventoryDbContext>();var claims=await db.Set<SerialUnitClaim>().Where(c=>c.OriginAllocationId==allocated.AllocationId).ToArrayAsync();Assert.Equal(2,claims.Length);Assert.All(claims,c=>{Assert.True(c.IsActive);Assert.Equal("AllocationHeld",c.State);Assert.Equal(plan.Lines[0].OfferLineId,c.OfferLineId);Assert.Null(c.OrderId);Assert.Null(c.ReservationId);Assert.Null(c.OrderLineId);});Assert.All(await db.SerialUnits.Where(u=>u.VariantId==tracked.Variant).ToArrayAsync(),u=>{Assert.Equal("available",u.State);Assert.Null(u.WarrantyUntil);});return true;});
        var filter=SerialPageQuery.Create(tracked.Variant,"available",null);Assert.Equal("serial_contract_upgrade_required",(await Assert.ThrowsAsync<BusinessException>(()=>Scope(sp=>Services(sp).Serials.PageAsync(filter,null,default)))).Code);var available=await Scope(sp=>new SerialInventoryV2Reader(sp.GetRequiredService<InventoryDbContext>()).PageAsync(filter,null,default));Assert.Empty(available.Items);Assert.Equal(0,available.Stock.Available);Assert.Equal(2,available.Stock.SourcingReserved);await Scope(async sp=>{Assert.Empty(await SerialInventoryService.Query(sp.GetRequiredService<InventoryDbContext>(),filter,null).ToArrayAsync());return true;});
        await Release(allocated);var historical=await Read(allocated.AllocationId);Assert.Equal(2,historical.Lines[0].UnitIds.Length);Assert.Equal(0,(await Counts(tracked.Variant)).Claims);
    }

    [Fact] public async Task OrdinaryRetirementAndPaidAssignmentCannotStealClaimedUnitWhenOtherUnitsAreFree()
    {
        var tracked=await Tracked(3);var plan=Plan(tracked.Variant);var held=await Allocate(plan,await Input(plan,[tracked.Units[0]]));var stock=await Stock(tracked.Variant);var retire=await Assert.ThrowsAsync<BusinessException>(()=>Tx(c=>c.Serials.RetireAsync(tracked.Variant,tracked.Units[0].Id,new(tracked.Units[0].Version,"Attempt claimed retirement",Convert.ToBase64String(stock.Version),Id()),"operator",default)));Assert.Equal("serial_state_conflict",retire.Code);
        var owner=Id();var reservation=await Scope(sp=>Services(sp).Reservations.HoldAsync(new(owner,Id(),Id(),[new(tracked.Variant,1)],TimeSpan.FromMinutes(10)),default));await Scope(sp=>Services(sp).Reservations.AllocateAsync(owner,reservation.Id,"verified-payment-test",default));await Assert.ThrowsAsync<BusinessException>(()=>Scope(async sp=>{await Services(sp).Serials.AssignAsync(new(owner,reservation.Id,"operator",Id(),[new(tracked.Units[0].Id,tracked.Units[0].Version)]),default);return true;}));Assert.Equal(1,(await Counts(tracked.Variant)).Claims);Assert.Equal("Active",(await Read(held.AllocationId)).State);
    }

    [Fact] public async Task TwoAllocationsForLastUnitAndConcurrentSameCommandNeverDoubleHold()
    {
        var variant=await AddStock(1);var plan=Plan(variant);var input=await Input(plan);var id=Id();var pair=await Task.WhenAll(Allocate(plan,input,id),Allocate(plan,input,id));Assert.Single(pair,r=>r.Replayed);Assert.Equal(1,(await Counts(variant)).Sourcing);Assert.Equal(1,(await Counts(variant)).Allocations);var other=Plan(variant);var otherInput=await Input(other);Assert.Equal("insufficient_stock",(await Assert.ThrowsAsync<BusinessException>(()=>Allocate(other,otherInput))).Code);
    }

    [Fact] public async Task ActiveAcceptanceCannotBeAllocatedAgainButExplicitReleaseAllowsNewHistoricalResource()
    {
        var variant=await AddStock(3);var plan=Plan(variant);var allocated=await Allocate(plan,await Input(plan));var duplicateInput=await Input(plan);Assert.Equal("sourcing_allocation_active_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Allocate(plan,duplicateInput))).Code);await Release(allocated);var next=await Allocate(plan,await Input(plan));Assert.NotEqual(allocated.AllocationId,next.AllocationId);Assert.Equal(1,(await Counts(variant)).Sourcing);Assert.Equal(2,(await Counts(variant)).Allocations);
    }

    [Fact] public async Task ExpiryClockImmediatelyClosesCapacityAndCompetingWorkersReleaseOnlyOnce()
    {
        var variant=await AddStock(2);var plan=Plan(variant);var input=await Input(plan);input=input with{ExpiresAt=clock.GetUtcNow().AddMinutes(1)};var allocated=await Allocate(plan,input);clock.Advance(TimeSpan.FromMinutes(1));var due=await Read(allocated.AllocationId);Assert.Equal("Active",due.State);Assert.Equal("Expired",due.EffectiveState);Assert.Equal(1,(await Counts(variant)).Sourcing);var pair=await Task.WhenAll(Scope(sp=>Services(sp).Allocations.ExpireBatchAsync(100,default)),Scope(sp=>Services(sp).Allocations.ExpireBatchAsync(100,default)));Assert.Equal(1,pair.Sum());Assert.Equal(0,(await Counts(variant)).Sourcing);Assert.Equal("Expired",(await Read(allocated.AllocationId)).State);var replay=await Allocate(plan,input,allocated.AllocationId);Assert.True(replay.Replayed);Assert.Equal(input.ExpiresAt,replay.ExpiresAt);Assert.Equal(0,(await Counts(variant)).Sourcing);
    }

    [Fact] public async Task DeadlineIsRecheckedAfterStockLockWaitRatherThanExtendedByRelativeDuration()
    {
        var variant=await AddStock(2);var plan=Plan(variant);var input=await Input(plan);input=input with{ExpiresAt=clock.GetUtcNow().AddSeconds(1)};await using var blockerScope=fixture.Factory.Services.CreateAsyncScope();var blocker=blockerScope.ServiceProvider.GetRequiredService<InventoryDbContext>();await using var transaction=await blocker.Database.BeginTransactionAsync(IsolationLevel.Serializable);await blocker.Stock.FromSqlInterpolated($"SELECT * FROM [inventory].[Stock] WITH (UPDLOCK,HOLDLOCK) WHERE [VariantId]={variant}").SingleAsync();var blockerSession=await Session(blocker);var started=new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously);
        async Task<SourcingAllocationMutation> Attempt(){await using var scope=fixture.Factory.Services.CreateAsyncScope();var c=Services(scope.ServiceProvider);await using var tx=await c.Db.Database.BeginTransactionAsync(IsolationLevel.Serializable);started.SetResult(await Session(c.Db));var result=await c.Allocations.AllocateAsync("inventory-operator",Id(),plan,input,default);await tx.CommitAsync();return result;}
        var pending=Attempt();var pendingSession=await started.Task.WaitAsync(TimeSpan.FromSeconds(10));bool observed;try{observed=await ObserveStockWait(blocker,pendingSession,blockerSession);clock.Advance(TimeSpan.FromSeconds(2));}finally{await transaction.CommitAsync();}Assert.Equal("sourcing_allocation_deadline_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>pending)).Code);Assert.True(observed,"The exact allocation SQL session must be observed waiting on the fixture-owned Stock blocker before advancing the fixed clock.");Assert.Equal(0,(await Counts(variant)).Sourcing);Assert.Equal(0,(await Counts(variant)).Allocations);
    }

    [Fact] public async Task FiftyAcceptanceSummaryPageKeepsExactSharedSkuQuantitiesAndPriceFreeWire()
    {
        var variant=await AddStock(10);var first=Plan(variant,2);first=first with{Lines=[first.Lines[0],first.Lines[0] with{OfferLineId=Id(),Quantity=3}]};var second=Plan(variant,1,first.OwnerId);var a=await Allocate(first,await Input(first));var b=await Allocate(second,await Input(second));var ids=new[]{first.AcceptanceId,second.AcceptanceId}.Concat(Enumerable.Range(0,48).Select(_=>Id())).ToArray();var summaries=await Scope(sp=>Services(sp).Allocations.ReadSummariesAsync(ids,first.OwnerId,default));Assert.Equal(2,summaries.Length);var one=Assert.Single(summaries,s=>s.Id==a.AllocationId);Assert.Equal(5,one.Quantity);Assert.Equal(2,one.Lines.Length);Assert.Equal(first.Lines.Select(l=>l.OfferLineId).Order(),one.Lines.Select(l=>l.OfferLineId).Order());Assert.Equal(new[]{2,3},one.Lines.Select(l=>l.Quantity).Order());Assert.Equal(1,Assert.Single(summaries,s=>s.Id==b.AllocationId).Quantity);Assert.Single(await Scope(sp=>Services(sp).Allocations.ReadSummariesAsync([first.AcceptanceId,first.AcceptanceId],first.OwnerId,default)));var json=JsonSerializer.Serialize(summaries,new JsonSerializerOptions(JsonSerializerDefaults.Web));foreach(var field in new[]{"unitIds","ownerId","actorId","serial","imei1","unitPriceRial","reason"})Assert.DoesNotContain("\""+field+"\":",json);
    }

    [Fact] public async Task SummaryOwnerDemoAndActiveFiltersUseEffectiveExpiryWithoutReleasingCapacity()
    {
        var variant=await AddStock(10);var own=Plan(variant);var input=await Input(own);await Allocate(own,input with{ExpiresAt=clock.GetUtcNow().AddMinutes(1)});var other=Plan(variant);await Allocate(other,await Input(other));var demo=Plan(variant,1,own.OwnerId) with{ContainsDemo=true};await Allocate(demo,await Input(demo));var released=Plan(variant,1,own.OwnerId);var release=await Allocate(released,await Input(released));await Release(release);clock.Advance(TimeSpan.FromMinutes(1));var ids=new[]{own.AcceptanceId,other.AcceptanceId,demo.AcceptanceId,released.AcceptanceId};
        var owner=await Scope(sp=>{var db=sp.GetRequiredService<InventoryDbContext>();return new SourcingAllocationService(db,new(db,clock),clock,false).ReadSummariesAsync(ids,own.OwnerId,default);});var only=Assert.Single(owner);Assert.Equal(own.AcceptanceId,only.AcceptanceId);Assert.Equal("Active",only.State);Assert.Equal("Expired",only.EffectiveState);Assert.Equal(1,only.Quantity);Assert.Equal(3,(await Counts(variant)).Sourcing);var staff=await Scope(sp=>Services(sp).Allocations.ReadSummariesAsync(ids,null,default));Assert.Equal(3,staff.Length);Assert.Single(staff,s=>s.IsDemo);Assert.DoesNotContain(staff,s=>s.AcceptanceId==released.AcceptanceId);Assert.Empty(await Scope(sp=>Services(sp).Allocations.ReadSummariesAsync(ids,"another-owner",default)));
    }

    [Fact] public async Task SummarySplitReadRejectsDeterministicReleaseBeforeFinalVersionProjection()
    {
        var variant=await AddStock(2);var plan=Plan(variant);var allocation=await Allocate(plan,await Input(plan));var interceptor=new BeforeSummaryVersionRead(async()=>{await Release(allocation);});var options=new DbContextOptionsBuilder<InventoryDbContext>().UseSqlServer(fixture.Connection).AddInterceptors(interceptor).Options;await using var db=new InventoryDbContext(options);var service=new SourcingAllocationService(db,new(db,clock),clock,true);Assert.Equal("version_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>service.ReadSummariesAsync([plan.AcceptanceId],plan.OwnerId,default))).Code);Assert.True(interceptor.Triggered,"The writer must run at the final summary version projection, after the split graph was loaded.");Assert.Equal("Released",(await Read(allocation.AllocationId)).State);Assert.Equal(0,(await Counts(variant)).Sourcing);
    }

    [Theory][InlineData("event")][InlineData("command")][InlineData("claim")]
    public async Task EventCommandOrClaimFailureRollsBackCountersAndAllowsIdenticalRetry(string failure)
    {
        var tracked=await Tracked();var plan=Plan(tracked.Variant);var input=await Input(plan,[tracked.Units[0]]);var id=Id();var table=failure switch{"event"=>"SourcingAllocationEvents","command"=>"SourcingAllocationCommands","claim"=>"SerialUnitClaims",_=>throw new ArgumentException(nameof(failure))};var add="ALTER TABLE [inventory].["+table+"] WITH NOCHECK ADD CONSTRAINT [CK_AllocationFailure] CHECK (1=0)";var drop="ALTER TABLE [inventory].["+table+"] DROP CONSTRAINT [CK_AllocationFailure]";await Scope(async sp=>{await sp.GetRequiredService<InventoryDbContext>().Database.ExecuteSqlRawAsync(add);return true;});try{await Assert.ThrowsAsync<DbUpdateException>(()=>Allocate(plan,input,id));}finally{await Scope(async sp=>{await sp.GetRequiredService<InventoryDbContext>().Database.ExecuteSqlRawAsync(drop);return true;});}Assert.Equal(0,(await Counts(tracked.Variant)).Sourcing);Assert.Equal(0,(await Counts(tracked.Variant)).Claims);Assert.Equal(0,(await Counts(tracked.Variant)).Allocations);await Allocate(plan,input,id);Assert.Equal(1,(await Counts(tracked.Variant)).Sourcing);
    }

    [Fact] public async Task OwnerActorTargetPrivacyAndParentRollbackRetainExactReceiptBoundary()
    {
        var variant=await AddStock(2);var plan=Plan(variant);var input=await Input(plan);var id=Id();await using(var scope=fixture.Factory.Services.CreateAsyncScope()){var core=Services(scope.ServiceProvider);await using var parent=await core.Db.Database.BeginTransactionAsync(IsolationLevel.Serializable);await core.Allocations.AllocateAsync("operator",id,plan,input,default);Assert.Same(parent,core.Db.Database.CurrentTransaction);await parent.RollbackAsync();}Assert.Equal(0,(await Counts(variant)).Sourcing);var allocated=await Allocate(plan,input,id);Assert.Equal("not_found",(await Assert.ThrowsAsync<BusinessException>(()=>Read(id,"another-owner"))).Code);Assert.Equal("not_found",(await Assert.ThrowsAsync<BusinessException>(()=>Scope(sp=>Services(sp).Allocations.ReadCommandAsync("other",id,"allocate",input.RequestId,default)))).Code);Assert.Equal("idempotency_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Allocate(plan,input with{Reason="Changed reason"},id))).Code);Assert.Equal("idempotency_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Allocate(plan,input,Id()))).Code);var ownerEvents=await Scope(sp=>Services(sp).Allocations.EventsAsync(id,plan.OwnerId,null,default));Assert.DoesNotContain("PRIVATE",JsonSerializer.Serialize(ownerEvents));var staffEvents=await Scope(sp=>Services(sp).Allocations.EventsAsync(id,null,null,default));Assert.Contains("PRIVATE-ALLOCATION",JsonSerializer.Serialize(staffEvents));await Release(allocated);
    }

    [Fact] public async Task LifecycleReleaseIsAtomicAndTransferredHistoryNeverReactivatesOrReleases()
    {
        var variant=await AddStock(3);var plan=Plan(variant);
        await Allocate(plan,await Input(plan));
        await Tx(async c=>{await c.Allocations.ReleaseForAcceptanceAsync("staff",plan.AcceptanceId,"Supply explicitly closed",default);return true;});
        Assert.Equal(0,(await Counts(variant)).Sourcing);
        await Tx(async c=>{await c.Allocations.ReleaseForAcceptanceAsync("staff",plan.AcceptanceId,"Repeated hook",default);return true;});
        var next=await Allocate(plan,await Input(plan));
        // Only a stored future transfer marker, not proof of Order2 transfer.
        await Scope(async sp=>{var db=sp.GetRequiredService<InventoryDbContext>();await db.Set<SourcingStockAllocation>().Where(a=>a.Id==next.AllocationId).ExecuteUpdateAsync(s=>s.SetProperty(a=>a.State,"Transferred").SetProperty(a=>a.IsActive,false));return true;});
        var transferred=await Read(next.AllocationId);Assert.Equal("Transferred",transferred.State);
        var releaseError=await Assert.ThrowsAsync<BusinessException>(()=>Tx(c=>c.Allocations.ReleaseAsync("operator",transferred.Id,new(Id(),transferred.AcceptanceId,transferred.Version,"Must not free order Stock"),default)));
        Assert.Equal("sourcing_allocation_transferred_conflict",releaseError.Code);
        var lifecycleError=await Assert.ThrowsAsync<BusinessException>(()=>Tx(async c=>{await c.Allocations.ReleaseForAcceptanceAsync("operator",plan.AcceptanceId,"Must not free order Stock",default);return true;}));
        Assert.Equal("sourcing_allocation_transferred_conflict",lifecycleError.Code);
        Assert.Equal(1,(await Counts(variant)).Sourcing);
    }
}
