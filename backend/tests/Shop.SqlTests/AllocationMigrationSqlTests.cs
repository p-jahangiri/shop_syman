using System.Data;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Inventory;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;

// Each fact owns a fresh database. Downgrades happen only inside that GUID QA;
// no accepted main database or private owner key ring is read or changed.
public sealed class AllocationMigrationSqlTests:IAsyncLifetime
{
    private readonly SqlFixture fixture=new();
    private const string Inventory31="20261023232400_SourcingReceiving";
    private const string Inventory33="20261024010005_SourcingAllocations";
    private const string Sales31="20261023201115_CartSourcingLines";
    private const string Sales33="20261024010045_SourcingPriceAgreements";
    private static string Id()=>Guid.NewGuid().ToString("N");
    public Task InitializeAsync()=>fixture.InitializeAsync();
    public Task DisposeAsync()=>fixture.DisposeAsync();
    private async Task<T> Scope<T>(Func<IServiceProvider,Task<T>> action){await using var scope=fixture.Factory.Services.CreateAsyncScope();Assert.StartsWith("SaymanTest_",scope.ServiceProvider.GetRequiredService<InventoryDbContext>().Database.GetDbConnection().Database);return await action(scope.ServiceProvider);}
    private static Task<string> OldBusinessSnapshot(InventoryDbContext db)=>db.Database.SqlQueryRaw<string>("""
        SELECT (SELECT
          JSON_QUERY((SELECT [VariantId],[OnHand],[Reserved],[TrackingMode] FROM [inventory].[Stock] ORDER BY [VariantId] FOR JSON PATH)) AS [Stock],
          JSON_QUERY((SELECT [Id],[OwnerId],[OrderId],[RequestId],[PayloadHash],[State],[CreatedAt],[ExpiresAt],[ChangedAt],[Version] FROM [inventory].[Reservations] ORDER BY [Id] FOR JSON PATH)) AS [Reservations],
          JSON_QUERY((SELECT * FROM [inventory].[ReservationItems] ORDER BY [ReservationId],[VariantId] FOR JSON PATH)) AS [ReservationItems],
          JSON_QUERY((SELECT * FROM [inventory].[ReservationEvents] ORDER BY [Id] FOR JSON PATH)) AS [ReservationEvents],
          JSON_QUERY((SELECT * FROM [inventory].[Movements] ORDER BY [Id] FOR JSON PATH)) AS [Movements],
          JSON_QUERY((SELECT [Id],[VariantId],[Serial],[Imei1],[Imei2],[State],[ReservationId],[OrderId],[WarrantyUntil],[CreatedAt],[ChangedAt],[Version] FROM [inventory].[SerialUnits] ORDER BY [Id] FOR JSON PATH)) AS [SerialUnits],
          JSON_QUERY((SELECT * FROM [inventory].[SerialIdentifiers] ORDER BY [Key] FOR JSON PATH)) AS [SerialIdentifiers],
          JSON_QUERY((SELECT * FROM [inventory].[SerialUnitEvents] ORDER BY [Id] FOR JSON PATH)) AS [SerialEvents],
          JSON_QUERY((SELECT [Id],[Sku],[PriceRial],[CompareAtPriceRial] FROM [catalog].[Variants] ORDER BY [Id] FOR JSON PATH)) AS [Prices],
          JSON_QUERY((SELECT [Id],[Number],[OwnerId],[RequestId],[PayloadHash],[QuoteId],[PricingFingerprint],[Locale],[State],[ReservationId],[CreatedAt],[ExpiresAt],[ChangedAt],[ContactName],[ContactPhone],[ShippingRequired],[CountryCode],[Province],[City],[Address],[PostalCode],[Note],[MethodId],[MethodName],[ShippingName],[ItemsSubtotalRial],[GoodsTotalRial],[ShippingRial],[TaxRial],[PayableTotalRial],[TaxIncluded],[QuoteSnapshotJson],[Version] FROM [sales].[Orders] ORDER BY [Id] FOR JSON PATH)) AS [Orders],
          JSON_QUERY((SELECT * FROM [sales].[CheckoutOrderSettings] ORDER BY [Id] FOR JSON PATH)) AS [Settings]
          FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS [Value]
        """).SingleAsync();

    [Fact] public async Task PopulatedSchema31UpgradesBothModulesWithoutChangingPhysicalStockReservationCustodyOrPrices()
    {
        var existing=await Scope(async sp=>{
            var db=sp.GetRequiredService<InventoryDbContext>();
            var normal=await db.Stock.AsNoTracking().Where(s=>s.TrackingMode=="none"&&s.OnHand>=3).OrderBy(s=>s.VariantId).FirstAsync();
            // A trusted, explicitly synthetic pre-existing reservation; this is
            // migration preservation evidence, not a Sales order creation test.
            var hold=await sp.GetRequiredService<IStockReservations>().HoldAsync(new("migration-"+Id(),Id(),Id(),[new(normal.VariantId,2)],TimeSpan.FromMinutes(30)),default);
            var serialVariant="migration-serial-"+Id();db.Stock.Add(new(){VariantId=serialVariant});await db.SaveChangesAsync();
            var serials=sp.GetRequiredService<SerialInventoryService>();var stock=await db.Stock.SingleAsync(s=>s.VariantId==serialVariant);
            var mode=await serials.ConfigureAsync(serialVariant,false,new("serial",Convert.ToBase64String(stock.Version),Id()),"migration-fixture",default);
            await serials.ReceiveAsync(serialVariant,false,new([new("QA-MIGRATION-"+Id())],"Synthetic pre-upgrade physical device",mode.Stock.Version,Id()),"migration-fixture",default);
            return (Variant:normal.VariantId,Hold:hold.Id,Serial:serialVariant);
        });
        var before=await Scope(sp=>OldBusinessSnapshot(sp.GetRequiredService<InventoryDbContext>()));
        await Scope(async sp=>{
            var inventory=sp.GetRequiredService<InventoryDbContext>();var sales=sp.GetRequiredService<SalesDbContext>();
            var sourceInventory=(await inventory.Database.GetAppliedMigrationsAsync()).ToArray();var sourceSales=(await sales.Database.GetAppliedMigrationsAsync()).ToArray();
            await sales.GetService<IMigrator>().MigrateAsync(Sales31);
            await inventory.GetService<IMigrator>().MigrateAsync(Inventory31);
            Assert.Equal(5,(await inventory.Database.GetAppliedMigrationsAsync()).Count());Assert.Equal(6,(await sales.Database.GetAppliedMigrationsAsync()).Count());
            Assert.Equal(before,await OldBusinessSnapshot(inventory));
            await inventory.GetService<IMigrator>().MigrateAsync(Inventory33);await sales.GetService<IMigrator>().MigrateAsync(Sales33);
            Assert.Equal(6,(await inventory.Database.GetAppliedMigrationsAsync()).Count());Assert.Equal(7,(await sales.Database.GetAppliedMigrationsAsync()).Count());
            Assert.Equal(before,await OldBusinessSnapshot(inventory));
            // Restore current schema before typed Reservations/SerialUnits or
            // Orders can select their newly added nullable contract columns.
            await inventory.Database.MigrateAsync();await sales.Database.MigrateAsync();Assert.Equal(sourceInventory,await inventory.Database.GetAppliedMigrationsAsync());Assert.Equal(sourceSales,await sales.Database.GetAppliedMigrationsAsync());
            Assert.Equal(before,await OldBusinessSnapshot(inventory));Assert.All(await inventory.Stock.AsNoTracking().ToArrayAsync(),row=>Assert.Equal(0,row.SourcingReserved));
            var held=await inventory.Reservations.AsNoTracking().SingleAsync(r=>r.Id==existing.Hold);Assert.Equal(StockReservationState.Active,held.State);
            var physical=await inventory.Stock.AsNoTracking().SingleAsync(s=>s.VariantId==existing.Variant);
            Assert.Equal(physical.OnHand-physical.Reserved,await inventory.Database.SqlQuery<int>($"SELECT [Available] AS [Value] FROM [inventory].[AvailableStockV1] WHERE [VariantId]={existing.Variant}").SingleAsync());
            Assert.Single(await inventory.SerialUnits.AsNoTracking().Where(u=>u.VariantId==existing.Serial).ToArrayAsync());
            Assert.Empty(await inventory.SourcingAllocations.AsNoTracking().ToArrayAsync());Assert.Empty(await sales.SourcingPriceAgreements.AsNoTracking().ToArrayAsync());return true;
        });
    }

    [Fact] public async Task InventoryDowngradeCannotForgetAnActualActiveSourcingHoldOrPartiallyDropItsHistory()
    {
        var allocated=await Scope(async sp=>{
            var db=sp.GetRequiredService<InventoryDbContext>();var stock=await db.Stock.AsNoTracking().Where(s=>s.TrackingMode=="none"&&s.OnHand>=2).OrderBy(s=>s.VariantId).FirstAsync();
            var now=DateTimeOffset.UtcNow;var acceptance=Id();var line=Id();var hash=new string('A',64);var placeholder=Convert.ToBase64String(new byte[8]);
            var plan=new SourcingStockAllocationPlan(Id(),Id(),Id(),acceptance,"migration-owner",hash,now.AddHours(1),false,[new(line,stock.VariantId,"synthetic-migration-model",1,hash)]);
            var input=new SourcingAllocationInput(Id(),placeholder,placeholder,placeholder,acceptance,hash,now.AddMinutes(10),"Synthetic migration hold",[new(line,Convert.ToBase64String(stock.Version),"none",[])]);
            await using var transaction=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var result=await sp.GetRequiredService<IInventorySourcingAllocations>().AllocateAsync("migration-fixture",Id(),plan,input,default);await transaction.CommitAsync();return result;
        });
        var source=await Scope(async sp=>(await sp.GetRequiredService<InventoryDbContext>().Database.GetAppliedMigrationsAsync()).ToArray());
        // Later empty Order2 storage may reverse lawfully. The allocation guard
        // itself is tested only from its immediate version 33 boundary.
        await Scope(async sp=>{await sp.GetRequiredService<InventoryDbContext>().GetService<IMigrator>().MigrateAsync(Inventory33);return true;});
        var before=await Scope(sp=>OldBusinessSnapshot(sp.GetRequiredService<InventoryDbContext>()));
        await Scope(async sp=>{
            var db=sp.GetRequiredService<InventoryDbContext>();var error=await Assert.ThrowsAsync<SqlException>(()=>db.GetService<IMigrator>().MigrateAsync(Inventory31));Assert.Equal(51000,error.Number);
            Assert.Equal(6,(await db.Database.GetAppliedMigrationsAsync()).Count());Assert.Equal(before,await OldBusinessSnapshot(db));
            await db.Database.MigrateAsync();Assert.Equal(source,await db.Database.GetAppliedMigrationsAsync());Assert.Equal(before,await OldBusinessSnapshot(db));
            var hold=await sp.GetRequiredService<IInventorySourcingAllocations>().ReadAsync(allocated.AllocationId,null,default);Assert.Equal("Active",hold.State);
            var line=Assert.Single(hold.Lines);var stock=await db.Stock.AsNoTracking().SingleAsync(s=>s.VariantId==line.VariantId);Assert.Equal(1,stock.SourcingReserved);
            Assert.Equal(stock.OnHand-stock.Reserved-1,await db.Database.SqlQuery<int>($"SELECT [Available] AS [Value] FROM [inventory].[AvailableStockV1] WHERE [VariantId]={line.VariantId}").SingleAsync());
            Assert.Equal(1,await db.SourcingAllocationCommands.CountAsync(c=>c.AllocationId==allocated.AllocationId));Assert.Equal(1,await db.SourcingAllocationEvents.CountAsync(e=>e.AllocationId==allocated.AllocationId));return true;
        });
    }
}
