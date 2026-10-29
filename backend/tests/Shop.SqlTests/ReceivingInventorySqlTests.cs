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

// Inventory's real-SQL core acceptance. Root HTTP tests independently prove
// the authoritative Market plan, Catalog physical identity, policies and audit.
public sealed class ReceivingInventorySqlTests(SqlFixture fixture):IClassFixture<SqlFixture>
{
    private const string InitialVersion="AAAAAAAAAAA=";
    private static string Id()=>Guid.NewGuid().ToString("N");
    private static string Imei()
    {
        var digits="3"+string.Concat(System.Security.Cryptography.RandomNumberGenerator.GetBytes(13).Select(b=>(char)('0'+b%10)));var sum=0;for(var i=0;i<digits.Length;i++){var value=digits[i]-'0';if(i%2==1){value*=2;if(value>9)value-=9;}sum+=value;}return digits+((10-sum%10)%10).ToString(System.Globalization.CultureInfo.InvariantCulture);
    }
    private sealed record Core(InventoryDbContext Db,ReceivingUnitMappingService Mappings,SourcingReceivingService Receiving,SerialInventoryService Serials,StockReservationService Reservations);
    private static Core Services(IServiceProvider sp)
    {
        var db=sp.GetRequiredService<InventoryDbContext>();var reservations=new StockReservationService(db,TimeProvider.System);var serials=new SerialInventoryService(db,reservations,TimeProvider.System);return new(db,new(db,reservations,TimeProvider.System),new(db,reservations,serials,TimeProvider.System,true),serials,reservations);
    }
    private async Task<T> Transaction<T>(Func<Core,Task<T>> action)
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var core=Services(scope.ServiceProvider);Assert.StartsWith("SaymanTest_",core.Db.Database.GetDbConnection().Database);await using var tx=await core.Db.Database.BeginTransactionAsync(IsolationLevel.Serializable);var result=await action(core);await tx.CommitAsync();return result;
    }
    private async Task<T> Read<T>(Func<IServiceProvider,Task<T>> action){await using var scope=fixture.Factory.Services.CreateAsyncScope();return await action(scope.ServiceProvider);}
    private async Task<(string Model,string Variant)> Variant(int? stock=null,int reserved=0,string? forcedVariant=null)
    {
        return await Read(async sp=>{var catalog=sp.GetRequiredService<CatalogDbContext>();var product=new Product{Slug="receiving-"+Id(),CategoryId="phones",BrandId="samsung",Status="Published",Translations=[new(){Locale="fa",Name="کالای مصنوعی آزمون دریافت"},new(){Locale="en",Name="Synthetic receiving SQL product"}]};var variant=new ProductVariant{Id=forcedVariant??Id(),Sku="QA-RECEIVE-"+Id(),PriceRial=123,IsActive=true};product.Variants.Add(variant);catalog.Products.Add(product);await catalog.SaveChangesAsync();if(stock is not null){var inv=sp.GetRequiredService<InventoryDbContext>();inv.Stock.Add(new(){VariantId=variant.Id,OnHand=stock.Value,Reserved=reserved});await inv.SaveChangesAsync();}return(product.Id,variant.Id);});
    }
    private async Task<ReceivingUnitMappingData> Mapping(string variant,int numerator=1,int denominator=1,string? origin=null,string unit="each")
    {
        var id=Id();await Transaction(c=>c.Mappings.SaveAsync("mapping-operator",id,new(Id(),origin??"Holoo-"+Id(),"001","Main",unit,variant,numerator,denominator,"واحد دریافت مصنوعی","Synthetic receiving unit",true,null),default));return await Read(sp=>Services(sp).Mappings.ReadAsync(id,default));
    }
    private static SourcingReceivingPlan Plan((string Model,string Variant) item,int required=10,int received=0,string? offerLine=null)=>new(Id(),Id(),Id(),Id(),"owner-"+Id(),new string('A',64),false,false,InitialVersion,InitialVersion,[new(offerLine??Id(),item.Variant,item.Model,required,received,new string('B',64))]);
    private static SourcingReceiptInput Input(SourcingReceivingPlan plan,ReceivingUnitMappingData mapping,string quantity="1",string? stockVersion=null,string mode="none",ReceivingSerialInput[]? units=null,string? sourceReceipt=null,string line="001")=>new(Id(),plan.RequestVersion,plan.TaskVersion,"manual",mapping.OriginSystem,mapping.CompanyKey,mapping.WarehouseKey,sourceReceipt??"RECEIPT-"+Id(),DateTimeOffset.UtcNow.AddMinutes(-1),"Actual synthetic SQL receipt",false,[new(plan.Lines[0].OfferLineId,line,mapping.Id,mapping.Version,quantity,mode,stockVersion,units??[])]);
    private async Task<SourcingReceivingResult> Receive(SourcingReceivingPlan plan,SourcingReceiptInput input,string? actor=null,string? receipt=null)=>await Transaction(c=>c.Receiving.ReceiveAsync(actor??"receiving-operator",receipt??Id(),plan,input,default));
    private async Task<ReceivingStockState> Stock(string variant)=>Assert.Single(await Read(sp=>Services(sp).Receiving.ReadStockAsync([variant],default)));
    private async Task<(int Stock,int Movements,int Receipts,int Lines,int Units,int Aliases,int Commands,int Reservations,int Orders)> Counts(string variant)=>await Read(async sp=>{var db=sp.GetRequiredService<InventoryDbContext>();return(await db.Stock.Where(s=>s.VariantId==variant).SumAsync(s=>s.OnHand),await db.Movements.CountAsync(m=>m.VariantId==variant),await db.SourcingReceipts.CountAsync(r=>r.Lines.Any(l=>l.VariantId==variant)),await db.SourcingReceiptLines.CountAsync(l=>l.VariantId==variant),await db.SerialUnits.CountAsync(u=>u.VariantId==variant),await db.SerialIdentifiers.CountAsync(a=>db.SerialUnits.Any(u=>u.Id==a.UnitId&&u.VariantId==variant)),await db.ReceivingCommands.CountAsync(c=>c.Operation=="receive"&&db.SourcingReceipts.Any(r=>r.Id==c.TargetId&&r.Lines.Any(l=>l.VariantId==variant))),await db.Reservations.CountAsync(),await sp.GetRequiredService<SalesDbContext>().Orders.CountAsync());});

    [Fact] public async Task ExplicitMappingVersionsReplayBeforeLiveVersionAndPreserveExactSourceKeys()
    {
        var item=await Variant();var id=Id();var origin="Holoo-"+Id();var input=new ReceivingUnitMappingInput(Id(),origin,"001","Main","BOX",item.Variant,12,1,"بستهٔ دوازده‌تایی","Box of twelve",true,null);var saved=await Transaction(c=>c.Mappings.SaveAsync("operator",id,input,default));var current=await Read(sp=>Services(sp).Mappings.ReadAsync(id,default));Assert.Equal("001",current.CompanyKey);Assert.Equal(12,current.Numerator);
        var updated=await Transaction(c=>c.Mappings.SaveAsync("operator",id,input with{RequestId=Id(),Version=current.Version,Numerator=6},default));Assert.NotEqual(saved.Version,updated.Version);var replay=await Transaction(c=>c.Mappings.SaveAsync("operator",id,input,default));Assert.True(replay.Replayed);Assert.Equal(saved.Version,replay.Version);
        Assert.Equal("receiving_mapping_identity_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Transaction(c=>c.Mappings.SaveAsync("operator",id,input with{RequestId=Id(),Version=updated.Version,SourceUnitKey="different-unit"},default)))).Code);
        Assert.Equal("idempotency_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Transaction(c=>c.Mappings.SaveAsync("operator",id,input with{Numerator=2},default)))).Code);
        Assert.Equal("version_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Transaction(c=>c.Mappings.SaveAsync("operator",id,input with{RequestId=Id(),Version=current.Version},default)))).Code);
        Assert.Equal("receiving_mapping_identity_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Transaction(c=>c.Mappings.SaveAsync("other",Id(),input with{RequestId=Id()},default)))).Code);
        var lower=await Mapping(item.Variant,origin:origin.ToLowerInvariant(),unit:"BOX");Assert.NotEqual(id,lower.Id);var page=await Read(sp=>Services(sp).Mappings.PageAsync(origin,"001","Main",item.Variant,null,default));Assert.Equal(id,Assert.Single(page.Items).Id);Assert.Null(page.NextCursor);
        Assert.Equal("not_found",(await Assert.ThrowsAsync<BusinessException>(()=>Read(sp=>Services(sp).Mappings.ReadCommandAsync("other",id,input.RequestId,default)))).Code);
    }

    [Fact] public async Task RationalPartialThenCompleteReceiptChangesOnlyActualOnHandAndKeepsSnapshot()
    {
        var item=await Variant(stock:5,reserved:2);var mapping=await Mapping(item.Variant,numerator:2);var plan=Plan(item,required:4);var before=await Counts(item.Variant);var stock=await Stock(item.Variant);var first=await Receive(plan,Input(plan,mapping,"0.5",stock.Version));Assert.Equal(1,Assert.Single(first.Lines).Quantity);var afterFirst=await Stock(item.Variant);Assert.Equal(6,afterFirst.OnHand);Assert.Equal(2,afterFirst.Reserved);
        var stored=await Read(sp=>Services(sp).Receiving.ReadAsync(first.ReceiptId,default));Assert.Equal("0.5",Assert.Single(stored.Lines).SourceQuantity);Assert.Equal(2,stored.Lines[0].Numerator);
        var changed=new ReceivingUnitMappingInput(Id(),mapping.OriginSystem,mapping.CompanyKey,mapping.WarehouseKey,mapping.SourceUnitKey,mapping.VariantId,6,1,"نگاشت تغییر یافته","Changed unit",true,mapping.Version);await Transaction(c=>c.Mappings.SaveAsync("mapping-operator",mapping.Id,changed,default));Assert.Equal(JsonSerializer.Serialize(stored),JsonSerializer.Serialize(await Read(sp=>Services(sp).Receiving.ReadAsync(first.ReceiptId,default))));
        var current=await Read(sp=>Services(sp).Mappings.ReadAsync(mapping.Id,default));var remaining=plan with{Lines=[plan.Lines[0] with{ReceivedQuantity=1}]};var second=await Receive(remaining,Input(remaining,current,"0.5",afterFirst.Version));Assert.Equal(3,second.Lines[0].Quantity);var completed=await Stock(item.Variant);Assert.Equal(9,completed.OnHand);Assert.Equal(2,completed.Reserved);var counts=await Counts(item.Variant);Assert.Equal(before.Reservations,counts.Reservations);Assert.Equal(before.Orders,counts.Orders);Assert.Equal(2,counts.Movements);Assert.Equal(2,counts.Receipts);
        Assert.Equal("receiving_quantity_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Receive(plan with{Lines=[plan.Lines[0] with{ReceivedQuantity=4}]},Input(plan,current,"0.5",completed.Version)))).Code);
    }

    [Fact] public async Task SerialAndDualImeiReceiptsLinkEveryActualUnitWithoutGuessingWarranty()
    {
        foreach(var mode in new[]{"serial","imei"}){
            var item=await Variant(stock:0);var initial=await Stock(item.Variant);await Transaction(c=>c.Serials.ConfigureAsync(item.Variant,false,new(mode,initial.Version,Id()),"tracking-operator",default));var mapping=await Mapping(item.Variant);var plan=Plan(item,required:2);var units=mode=="serial"?new ReceivingSerialInput[]{new(" case-۱۲۳ "),new("case-456")}:new ReceivingSerialInput[]{new("device",Imei(),Imei())};var result=await Receive(plan,Input(plan,mapping,units.Length.ToString(),(await Stock(item.Variant)).Version,mode,units));
            Assert.Equal(units.Length,result.Lines[0].Quantity);Assert.Equal(units.Length,result.Lines[0].UnitIds.Length);await Read(async sp=>{var db=sp.GetRequiredService<InventoryDbContext>();var ids=result.Lines[0].UnitIds;Assert.Equal(units.Length,await db.SourcingReceiptUnits.CountAsync(u=>ids.Contains(u.UnitId)));var received=await db.SerialUnits.Where(u=>ids.Contains(u.Id)).ToArrayAsync();Assert.All(received,u=>{Assert.Equal("available",u.State);Assert.Null(u.OrderId);Assert.Null(u.ReservationId);Assert.Null(u.WarrantyUntil);});Assert.Equal(mode=="imei"?3:2,await db.SerialIdentifiers.CountAsync(a=>ids.Contains(a.UnitId)));return true;});
        }
    }

    [Fact] public async Task PhysicalLineIdentityRejectsAnotherActorChannelOrTaskAsWholeCommand()
    {
        var item=await Variant();var mapping=await Mapping(item.Variant);var plan=Plan(item);var input=Input(plan,mapping);await Receive(plan,input,"first");var baseline=await Counts(item.Variant);var other=plan with{RequestId=Id(),TaskId=Id(),OfferId=Id(),AcceptanceId=Id()};var next=input with{RequestId=Id(),Channel="csv",Lines=[input.Lines[0] with{StockVersion=(await Stock(item.Variant)).Version},input.Lines[0] with{SourceReceiptLineKey="002",StockVersion=(await Stock(item.Variant)).Version}]};
        var error=await Assert.ThrowsAsync<BusinessException>(()=>Receive(other,next,"second"));Assert.Equal("receiving_external_identity_conflict",error.Code);Assert.Equal(baseline,await Counts(item.Variant));
        // A genuinely different line from that document is a new physical fact.
        var fresh=await Receive(other,next with{RequestId=Id(),Lines=[next.Lines[1]]},"second");Assert.Equal(1,fresh.Lines[0].Quantity);Assert.Equal(2,(await Stock(item.Variant)).OnHand);
    }

    [Fact] public async Task ConcurrentCommandReplayCreatesOneReceiptLedgerAndStableResult()
    {
        var item=await Variant();var mapping=await Mapping(item.Variant);var plan=Plan(item);var input=Input(plan,mapping,"2");var receipt=Id();var both=await Task.WhenAll(Receive(plan,input,receipt:receipt),Receive(plan,input,receipt:receipt));Assert.Single(both,r=>r.Replayed);Assert.Equal(JsonSerializer.Serialize(both[0] with{Replayed=false}),JsonSerializer.Serialize(both[1] with{Replayed=false}));var counts=await Counts(item.Variant);Assert.Equal(2,counts.Stock);Assert.Equal(1,counts.Receipts);Assert.Equal(1,counts.Movements);Assert.Equal(1,counts.Commands);
        Assert.Equal("idempotency_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Receive(plan,input with{Reason="Different reason"},receipt:receipt))).Code);var read=await Read(sp=>Services(sp).Receiving.ReadCommandAsync("receiving-operator",receipt,input.RequestId,default));Assert.True(read.Replayed);Assert.Equal(receipt,read.ReceiptId);Assert.Equal("not_found",(await Assert.ThrowsAsync<BusinessException>(()=>Read(sp=>Services(sp).Receiving.ReadCommandAsync("other",receipt,input.RequestId,default)))).Code);
        // Direct facade replay also precedes a now-stale trusted plan version.
        var stale=plan with{TaskVersion="AQAAAAAAAAA="};Assert.True((await Receive(stale,input,receipt:receipt)).Replayed);
    }

    [Fact] public async Task SharedVariantLinesKeepIndependentProgressAndUseOneAggregatedLedger()
    {
        var item=await Variant(stock:3,reserved:1);var mapping=await Mapping(item.Variant);var plan=Plan(item,required:2);var second=plan.Lines[0] with{OfferLineId=Id(),RequiredQuantity=3};plan=plan with{Lines=[plan.Lines[0],second]};var stock=await Stock(item.Variant);var input=Input(plan,mapping,"2",stock.Version);input=input with{Lines=[input.Lines[0],input.Lines[0] with{OfferLineId=second.OfferLineId,SourceReceiptLineKey="002",SourceQuantity="3"}]};var result=await Receive(plan,input);Assert.Equal(new[]{2,3},result.Lines.Select(l=>l.Quantity));Assert.Single(result.Lines.Select(l=>l.MovementId).Distinct());var final=await Stock(item.Variant);Assert.Equal(8,final.OnHand);Assert.Equal(1,final.Reserved);await Read(async sp=>{var movement=Assert.Single(await sp.GetRequiredService<InventoryDbContext>().Movements.Where(m=>m.VariantId==item.Variant).ToArrayAsync());Assert.Equal(5,movement.Delta);Assert.Equal(8,movement.Balance);return true;});
    }

    [Fact] public async Task ReversedMultiSkuCommandsUseSortedStockLocksAndOnlyOneVersionWins()
    {
        var origin="Holoo-"+Id();var a=await Variant();var b=await Variant();var ma=await Mapping(a.Variant,origin:origin);var mb=await Mapping(b.Variant,origin:origin);var plan=Plan(a,required:2);var other=new SourcingReceivingPlanLine(Id(),b.Variant,b.Model,2,0,new string('B',64));plan=plan with{Lines=[plan.Lines[0],other]};var first=Input(plan,ma);first=first with{Lines=[first.Lines[0],new(other.OfferLineId,"002",mb.Id,mb.Version,"1","none",null,[])]};var second=first with{RequestId=Id(),SourceReceiptKey="OTHER-"+Id(),Lines=first.Lines.Reverse().ToArray()};
        async Task<string?> Try(SourcingReceiptInput input){try{await Receive(plan,input);return null;}catch(BusinessException error){return error.Code;}}
        var results=await Task.WhenAll(Try(first),Try(second));Assert.Single(results,r=>r is null);Assert.Single(results,r=>r=="version_conflict");Assert.Equal(1,(await Stock(a.Variant)).OnHand);Assert.Equal(1,(await Stock(b.Variant)).OnHand);Assert.Equal(1,(await Counts(a.Variant)).Movements);Assert.Equal(1,(await Counts(b.Variant)).Movements);
    }

    [Fact] public async Task PublicOrderHoldRemainsIntactWhenPhysicalReceivingAddsOnHand()
    {
        var item=await Variant(stock:2);var mapping=await Mapping(item.Variant);var plan=Plan(item,required:3);var before=await Counts(item.Variant);var owner=Id();var order=Id();var hold=await Read(sp=>Services(sp).Reservations.HoldAsync(new(owner,order,Id(),[new(item.Variant,2)],TimeSpan.FromMinutes(10)),default));var held=await Stock(item.Variant);Assert.Equal(2,held.Reserved);var received=await Receive(plan,Input(plan,mapping,"3",held.Version));Assert.Equal(3,received.Lines[0].Quantity);var after=await Stock(item.Variant);Assert.Equal(5,after.OnHand);Assert.Equal(2,after.Reserved);Assert.Equal(3,await Read(async sp=>(await sp.GetRequiredService<IInventoryReader>().AvailableAsync([item.Variant],default))[item.Variant]));var stored=await Read(sp=>Services(sp).Reservations.ReadAsync(owner,hold.Id,default));Assert.Equal(StockReservationState.Active,stored.State);Assert.Equal(order,stored.OrderId);Assert.Equal(before.Orders,(await Counts(item.Variant)).Orders);
    }

    [Fact] public async Task DuplicateImeiAcrossVariantsRollsBackEarlierCountOnlyLineAndAllReceiptRows()
    {
        var origin="Holoo-"+Id();var imei=Imei();var first=await Variant(stock:0);var firstVersion=(await Stock(first.Variant)).Version;await Transaction(c=>c.Serials.ConfigureAsync(first.Variant,false,new("imei",firstVersion,Id()),"tracker",default));var firstMapping=await Mapping(first.Variant,origin:origin);var initialPlan=Plan(first);await Receive(initialPlan,Input(initialPlan,firstMapping,stockVersion:(await Stock(first.Variant)).Version,mode:"imei",units:[new(null,imei)]));
        var none=await Variant(forcedVariant:"0"+Id()[1..]);var tracked=await Variant(stock:0,forcedVariant:"f"+Id()[1..]);var trackedVersion=(await Stock(tracked.Variant)).Version;await Transaction(c=>c.Serials.ConfigureAsync(tracked.Variant,false,new("imei",trackedVersion,Id()),"tracker",default));var noneMapping=await Mapping(none.Variant,origin:origin);var trackedMapping=await Mapping(tracked.Variant,origin:origin);var plan=Plan(none);var trackedLine=new SourcingReceivingPlanLine(Id(),tracked.Variant,tracked.Model,1,0,new string('B',64));plan=plan with{Lines=[plan.Lines[0],trackedLine]};var input=Input(plan,noneMapping);input=input with{Lines=[input.Lines[0],new(trackedLine.OfferLineId,"002",trackedMapping.Id,trackedMapping.Version,"1","imei",(await Stock(tracked.Variant)).Version,[new(null,imei)])]};var beforeNone=await Counts(none.Variant);var beforeTracked=await Counts(tracked.Variant);Assert.Equal("serial_identifier_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Receive(plan,input))).Code);Assert.Equal(beforeNone,await Counts(none.Variant));Assert.Equal(beforeTracked,await Counts(tracked.Variant));
    }

    [Fact] public async Task DuplicateAliasInSeparateLinesOfOneVariantIsAConflictAndRollsBackEntireBatch()
    {
        var item=await Variant(stock:0);var initial=(await Stock(item.Variant)).Version;await Transaction(c=>c.Serials.ConfigureAsync(item.Variant,false,new("serial",initial,Id()),"tracker",default));var mapping=await Mapping(item.Variant);var plan=Plan(item,required:2);var input=Input(plan,mapping,stockVersion:(await Stock(item.Variant)).Version,mode:"serial",units:[new("Case-۱۲۳")]);input=input with{Lines=[input.Lines[0],input.Lines[0] with{SourceReceiptLineKey="002",Units=[new("CASE-123")]}]};var baseline=await Counts(item.Variant);Assert.Equal("serial_identifier_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Receive(plan,input))).Code);Assert.Equal(baseline,await Counts(item.Variant));
    }

    [Theory][InlineData("SourcingReceipts")][InlineData("Movements")][InlineData("ReceivingCommands")]
    public async Task ReceiptLedgerOrCommandFailureRollsBackPhysicalStockAndAllowsSameCommandRetry(string table)
    {
        if(table is not ("SourcingReceipts" or "Movements" or "ReceivingCommands"))throw new ArgumentException("Use only a fixed QA failure-injection table.",nameof(table));
        var item=await Variant();var mapping=await Mapping(item.Variant);var plan=Plan(item);var input=Input(plan,mapping);var receipt=Id();var baseline=await Counts(item.Variant);var constraint="CK_ReceivingSqlFailure_"+table;
        var addConstraint="ALTER TABLE [inventory].["+table+"] WITH NOCHECK ADD CONSTRAINT ["+constraint+"] CHECK (1=0)";
        var dropConstraint="ALTER TABLE [inventory].["+table+"] DROP CONSTRAINT ["+constraint+"]";
        await Read(async sp=>{var db=sp.GetRequiredService<InventoryDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);await db.Database.ExecuteSqlRawAsync(addConstraint);return true;});
        try{await Assert.ThrowsAsync<DbUpdateException>(()=>Receive(plan,input,receipt:receipt));}finally{await Read(async sp=>{await sp.GetRequiredService<InventoryDbContext>().Database.ExecuteSqlRawAsync(dropConstraint);return true;});}
        Assert.Equal(baseline,await Counts(item.Variant));var retried=await Receive(plan,input,receipt:receipt);Assert.False(retried.Replayed);Assert.Equal(1,(await Stock(item.Variant)).OnHand);
    }

    [Fact] public async Task CallerRollbackPreservesStockVersionAndTheSamePhysicalCommandForRetry()
    {
        var item=await Variant(stock:0);var mapping=await Mapping(item.Variant);var plan=Plan(item);var before=await Stock(item.Variant);var input=Input(plan,mapping,stockVersion:before.Version);var receipt=Id();
        await using(var scope=fixture.Factory.Services.CreateAsyncScope()){var c=Services(scope.ServiceProvider);await using var parent=await c.Db.Database.BeginTransactionAsync(IsolationLevel.Serializable);var result=await c.Receiving.ReceiveAsync("operator",receipt,plan,input,default);Assert.Same(parent,c.Db.Database.CurrentTransaction);Assert.Equal(1,result.Lines[0].Quantity);await parent.RollbackAsync();}
        Assert.Equal(before,await Stock(item.Variant));Assert.Equal(0,(await Counts(item.Variant)).Receipts);await Receive(plan,input,"operator",receipt);Assert.Equal(1,(await Counts(item.Variant)).Receipts);
    }

    [Fact] public async Task StaleStockMappingAndTrackingModeFailBeforeAnyReceiptOrCountChange()
    {
        var item=await Variant(stock:0);var mapping=await Mapping(item.Variant);var plan=Plan(item);var original=await Stock(item.Variant);var input=Input(plan,mapping,stockVersion:original.Version);await Transaction(c=>c.Serials.ConfigureAsync(item.Variant,false,new("serial",original.Version,Id()),"tracker",default));
        Assert.Equal("version_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Receive(plan,input))).Code);var currentVersion=(await Stock(item.Variant)).Version;Assert.Equal("receiving_tracking_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Receive(plan,input with{RequestId=Id(),Lines=[input.Lines[0] with{StockVersion=currentVersion}]}))).Code);
        var tracked=input with{RequestId=Id(),Lines=[input.Lines[0] with{StockVersion=(await Stock(item.Variant)).Version,TrackingMode="serial",Units=[new("fresh")]}]};await Transaction(c=>c.Mappings.SaveAsync("mapping-operator",mapping.Id,new(Id(),mapping.OriginSystem,mapping.CompanyKey,mapping.WarehouseKey,mapping.SourceUnitKey,mapping.VariantId,1,1,mapping.NameFa,mapping.NameEn,false,mapping.Version),default));Assert.Equal("receiving_mapping_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Receive(plan,tracked))).Code);Assert.Equal(0,(await Counts(item.Variant)).Receipts);Assert.Equal(0,(await Stock(item.Variant)).OnHand);
    }

    [Fact] public async Task FractionalAndOverRemainingQuantitiesNeverWriteAndHistoricalReceiptNeedsAcknowledgement()
    {
        var item=await Variant();var mapping=await Mapping(item.Variant,numerator:1,denominator:2);var plan=Plan(item,required:1);var fractional=Input(plan,mapping);Assert.Equal("receiving_unit_conversion_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Receive(plan,fractional))).Code);Assert.Equal("receiving_quantity_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Receive(plan,Input(plan,mapping,"4")))).Code);var historical=plan with{RequiresNewOffer=true};var input=Input(historical,mapping,"2");Assert.Equal("receiving_historical_acknowledgement_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Receive(historical,input))).Code);var received=await Receive(historical,input with{AcknowledgeHistorical=true});Assert.True(received.RequiresNewOffer);Assert.Equal(1,(await Stock(item.Variant)).OnHand);Assert.Equal(0,(await Stock(item.Variant)).Reserved);
    }

    [Fact] public async Task CatalogCompatibleNonUuidProductIdentityAndAbsentStockProjectionAreSupported()
    {
        var item=await Variant();var mapping=await Mapping(item.Variant);var stock=await Stock(item.Variant);Assert.Equal(item.Variant,stock.VariantId);Assert.Equal("none",stock.TrackingMode);Assert.Equal(0,stock.OnHand);Assert.Null(stock.Version);var plan=Plan(item);plan=plan with{Lines=[plan.Lines[0] with{ProductId="catalog-model_1"}]};var received=await Receive(plan,Input(plan,mapping));Assert.Equal(1,received.Lines[0].Quantity);
    }
}
