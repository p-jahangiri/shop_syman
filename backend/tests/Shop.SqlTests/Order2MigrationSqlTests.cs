using System.Data;
using System.Globalization;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Inventory;
using Shop.Modules.Market;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;

// Every theory row/fact owns its own GUID database. Direct history shapes below
// are explicitly synthetic guard fixtures, never successful commercial orders.
public sealed class Order2MigrationSqlTests : IAsyncLifetime
{
    private readonly SqlFixture fixture = new();
    private const string InventoryBase = "20261024010005_SourcingAllocations";
    private const string SalesBase = "20261024045600_CheckoutQuotesV4";
    private const string MarketBase = "20261023232427_SourcingSupply";
    private const long Price = 9007199254740993;
    private const string Version = "AAAAAAAAAAE=";
    private static readonly string Hash = new('A', 64);
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static string Id() => Guid.NewGuid().ToString("N");
    public Task InitializeAsync() => fixture.InitializeAsync();
    public Task DisposeAsync() => fixture.DisposeAsync();
    private async Task<T> Scope<T>(Func<IServiceProvider, Task<T>> action)
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        Assert.StartsWith("SaymanTest_", scope.ServiceProvider.GetRequiredService<InventoryDbContext>().Database.GetDbConnection().Database);
        return await action(scope.ServiceProvider);
    }
    private static Task<string> SchemaSnapshot(DbContext db) => db.Database.SqlQueryRaw<string>("""
        SELECT (SELECT
          JSON_QUERY((SELECT s.[name] AS [Schema],t.[name] AS [Table],t.[object_id] AS [TableObjectId],c.[column_id],c.[name],ty.[name] AS [Type],c.[max_length],c.[precision],c.[scale],c.[is_nullable],c.[is_identity],c.[is_computed]
            FROM sys.tables t JOIN sys.schemas s ON s.[schema_id]=t.[schema_id] JOIN sys.columns c ON c.[object_id]=t.[object_id] JOIN sys.types ty ON ty.[user_type_id]=c.[user_type_id]
            WHERE s.[name] IN ('inventory','sales','market') ORDER BY s.[name],t.[name],c.[column_id] FOR JSON PATH)) AS [Columns],
          JSON_QUERY((SELECT s.[name] AS [Schema],t.[name] AS [Table],t.[object_id] AS [TableObjectId],o.[object_id] AS [ConstraintObjectId],o.[name],o.[type],OBJECT_DEFINITION(o.[object_id]) AS [Definition]
            FROM sys.tables t JOIN sys.schemas s ON s.[schema_id]=t.[schema_id] JOIN sys.objects o ON o.[parent_object_id]=t.[object_id]
            WHERE s.[name] IN ('inventory','sales','market') ORDER BY s.[name],t.[name],o.[type],o.[name] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Constraints],
          JSON_QUERY((SELECT s.[name] AS [Schema],t.[name] AS [Table],i.[name],i.[type],i.[is_unique],i.[is_primary_key],i.[filter_definition],ic.[key_ordinal],ic.[is_included_column],c.[name] AS [Column]
            FROM sys.tables t JOIN sys.schemas s ON s.[schema_id]=t.[schema_id] JOIN sys.indexes i ON i.[object_id]=t.[object_id] JOIN sys.index_columns ic ON ic.[object_id]=i.[object_id] AND ic.[index_id]=i.[index_id] JOIN sys.columns c ON c.[object_id]=ic.[object_id] AND c.[column_id]=ic.[column_id]
            WHERE s.[name] IN ('inventory','sales','market') ORDER BY s.[name],t.[name],i.[name],ic.[key_ordinal],ic.[index_column_id] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Indexes],
          JSON_QUERY((SELECT * FROM [inventory].[__EFMigrationsHistory] ORDER BY [MigrationId] FOR JSON PATH)) AS [InventoryMigrations],
          JSON_QUERY((SELECT * FROM [sales].[__EFMigrationsHistory] ORDER BY [MigrationId] FOR JSON PATH)) AS [SalesMigrations],
          JSON_QUERY((SELECT * FROM [market].[__EFMigrationsHistory] ORDER BY [MigrationId] FOR JSON PATH)) AS [MarketMigrations]
          FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS [Value]
        """).SingleAsync();

    private static Task<string> CurrentHistory(DbContext db) => db.Database.SqlQueryRaw<string>("""
        SELECT (SELECT
          JSON_QUERY((SELECT * FROM inventory.Stock ORDER BY VariantId FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Stock],
          JSON_QUERY((SELECT * FROM inventory.Reservations ORDER BY Id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Reservations],
          JSON_QUERY((SELECT * FROM inventory.ReservationItems ORDER BY ReservationId,VariantId FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Items],
          JSON_QUERY((SELECT * FROM inventory.ReservationEvents ORDER BY Id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [ReservationEvents],
          JSON_QUERY((SELECT * FROM inventory.ReservationLineEntitlements ORDER BY ReservationId,LineId FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Entitlements],
          JSON_QUERY((SELECT * FROM inventory.SourcingAllocationTransfers ORDER BY AllocationId FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Transfers],
          JSON_QUERY((SELECT * FROM inventory.SourcingAllocations ORDER BY Id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Allocations],
          JSON_QUERY((SELECT * FROM inventory.SourcingAllocationLines ORDER BY AllocationId,OfferLineId FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [AllocationLines],
          JSON_QUERY((SELECT * FROM inventory.SourcingAllocationCommands ORDER BY ActorId,Operation,CommandId FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [AllocationCommands],
          JSON_QUERY((SELECT * FROM inventory.SourcingAllocationEvents ORDER BY Id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [AllocationEvents],
          JSON_QUERY((SELECT * FROM inventory.SerialUnits ORDER BY Id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Units],
          JSON_QUERY((SELECT * FROM inventory.SerialUnitClaims ORDER BY Id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Claims],
          JSON_QUERY((SELECT * FROM inventory.SerialUnitEvents ORDER BY Id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [UnitEvents],
          JSON_QUERY((SELECT * FROM inventory.SerialCommands ORDER BY ActorId,RequestId FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [SerialCommands],
          JSON_QUERY((SELECT * FROM inventory.Movements ORDER BY Id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Movements],
          JSON_QUERY((SELECT * FROM sales.CheckoutQuotes ORDER BY Id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Quotes],
          JSON_QUERY((SELECT * FROM sales.CheckoutQuoteLines ORDER BY QuoteId,VariantId FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [QuoteLines],
          JSON_QUERY((SELECT * FROM sales.CheckoutQuoteLinesV4 ORDER BY QuoteId,LineId FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [QuoteLinesV4],
          JSON_QUERY((SELECT * FROM sales.CheckoutQuoteInstallments ORDER BY QuoteId,[Sequence] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Installments],
          JSON_QUERY((SELECT * FROM sales.Orders ORDER BY Id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Orders],
          JSON_QUERY((SELECT * FROM sales.OrderLines ORDER BY OrderId,VariantId FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [OrderLines],
          JSON_QUERY((SELECT * FROM sales.OrderLinesV2 ORDER BY OrderId,LineId FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [OrderLinesV2],
          JSON_QUERY((SELECT * FROM sales.OrderEvents ORDER BY Id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [OrderEvents],
          JSON_QUERY((SELECT * FROM sales.OrderOutbox ORDER BY Id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Outbox],
          JSON_QUERY((SELECT * FROM market.SourcingRequests ORDER BY Id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Requests],
          JSON_QUERY((SELECT * FROM market.SourcingOffers ORDER BY Id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Offers],
          JSON_QUERY((SELECT * FROM market.SourcingOfferAcceptances ORDER BY OfferId FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Acceptances],
          JSON_QUERY((SELECT * FROM market.SourcingSupplyTasks ORDER BY Id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Tasks],
          JSON_QUERY((SELECT * FROM market.SourcingOrderLinks ORDER BY AgreementId FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Links]
          FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS [Value]
        """).SingleAsync();

    private Task Reject<TContext>(string target) where TContext : DbContext => Scope(async sp => {
        var db = sp.GetRequiredService<TContext>();
        // Pin this historical migration's guard to its own schema. Later empty
        // migrations legitimately downgrade in their own transactions before
        // EF reaches the older guard; that is not an Order2 guard failure.
        if(typeof(TContext)==typeof(InventoryDbContext))await db.GetService<IMigrator>().MigrateAsync("20261024073909_OrderReservationsV2");
        if(typeof(TContext)==typeof(MarketDbContext))await db.GetService<IMigrator>().MigrateAsync("20261024074132_SourcingOrderLinks");
        if(typeof(TContext)==typeof(SalesDbContext))await db.GetService<IMigrator>().MigrateAsync("20261024074017_AcceptedOfferOrdersV2");
        var schema = await SchemaSnapshot(db); var history = await CurrentHistory(db); var applied = (await db.Database.GetAppliedMigrationsAsync()).ToArray();
        var error = await Assert.ThrowsAsync<SqlException>(() => db.GetService<IMigrator>().MigrateAsync(target));
        Assert.Equal(51000, error.Number); Assert.Equal(applied, await db.Database.GetAppliedMigrationsAsync()); Assert.Equal(schema, await SchemaSnapshot(db)); Assert.Equal(history, await CurrentHistory(db)); return true;
    });

    private async Task<StockOrderReservationDataV2> ActualInventoryHold() => await Scope(async sp => {
        var db = sp.GetRequiredService<InventoryDbContext>(); var service = sp.GetRequiredService<StockReservationService>(); var serials = sp.GetRequiredService<SerialInventoryService>(); var variant = "migration-order2-" + Id();
        db.Stock.Add(new() { VariantId = variant }); await db.SaveChangesAsync(); var stock = await db.Stock.SingleAsync(s => s.VariantId == variant);
        var configured = await serials.ConfigureAsync(variant, false, new("serial", Convert.ToBase64String(stock.Version), Id()), "migration-order2", default);
        var receipt = await serials.ReceiveAsync(variant, false, new([new("QA-ORDER2-MIGRATION-" + Id())], "Synthetic migration guard physical receipt", configured.Stock.Version, Id()), "migration-order2", default);
        var now = DateTimeOffset.UtcNow; var owner = "migration-order2-" + Id(); var offerLine = Id(); var plan = new SourcingStockAllocationPlan(Id(), Id(), Id(), Id(), owner, Hash, now.AddHours(1), false, [new(offerLine, variant, "synthetic-model", 1, Hash)]);
        var refreshed = await db.Stock.AsNoTracking().SingleAsync(s => s.VariantId == variant);
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
        var allocation = await sp.GetRequiredService<IInventorySourcingAllocations>().AllocateAsync("migration-order2", Id(), plan, new(Id(), Version, Version, Version, plan.AcceptanceId, Hash, now.AddMinutes(20), "Synthetic migration guard sourcing hold", [new(offerLine, Convert.ToBase64String(refreshed.Version), "serial", [new(receipt.Units[0].Id, receipt.Units[0].Version)])]), default);
        var result = await ((IStockOrderReservationsV2)service).HoldAsync(new(owner, Id(), Id(), now.AddMinutes(10), [new(Id(), variant, 1, allocation.AllocationId, offerLine)], [new(plan, allocation.AllocationId, allocation.Version)]), default);
        await tx.CommitAsync(); return result;
    });

    [Theory][InlineData("actual-transfer")][InlineData("header-only")]
    public async Task InventoryGuardRetainsActualTransferredClaimsOrAnIndependentContractHeaderBeforeAnyDdl(string kind)
    {
        if (kind == "actual-transfer") {
            var hold = await ActualInventoryHold();
            await Scope(async sp => { var db = sp.GetRequiredService<InventoryDbContext>(); Assert.Single(await db.ReservationLineEntitlements.Where(l => l.ReservationId == hold.Id).ToArrayAsync()); Assert.Single(await db.SourcingAllocationTransfers.Where(t => t.ReservationId == hold.Id).ToArrayAsync()); var claim = await db.SerialUnitClaims.SingleAsync(c => c.ReservationId == hold.Id); Assert.Equal("OrderHeld", claim.State); Assert.True(claim.IsActive); return true; });
        } else await Scope(async sp => {
            var db = sp.GetRequiredService<InventoryDbContext>(); var now = DateTimeOffset.UtcNow;
            // Independent corrupt/header-only history must also block removal.
            db.Reservations.Add(new() { Id = Id(), ContractVersion = 2, OwnerId = "synthetic-header-only", OrderId = Id(), RequestId = Id(), PayloadHash = Hash, State = StockReservationState.Released, CreatedAt = now, ChangedAt = now, ExpiresAt = now.AddMinutes(10) }); await db.SaveChangesAsync(); return true;
        });
        await Reject<InventoryDbContext>(InventoryBase);
    }

    private sealed record Legacy(string Owner, string Variant, string QuoteId, string OrderId, string ReservationId, string QuoteJson, byte[] OrderVersion);
    private Task<Legacy> SeedLegacy() => Scope(async sp => {
        var inventory = sp.GetRequiredService<InventoryDbContext>(); var sales = sp.GetRequiredService<SalesDbContext>(); var owner = "order2-history-" + Id(); var variant = "order2-history-" + Id(); var orderId = Id();
        inventory.Stock.Add(new() { VariantId = variant, OnHand = 3 }); await inventory.SaveChangesAsync();
        var hold = await sp.GetRequiredService<IStockReservations>().HoldAsync(new(owner, orderId, Id(), [new(variant, 1)], TimeSpan.FromMinutes(30)), default); await sp.GetRequiredService<IStockReservations>().ReleaseAsync(owner, hold.Id, "synthetic-migration-history", default);
        var now = DateTimeOffset.UtcNow; var money = Price.ToString(CultureInfo.InvariantCulture); var quoteId = Id();
        var data = new CheckoutQuoteData(3, "fa", quoteId, Version, Hash, now.AddMinutes(-1), now.AddMinutes(4), [new(variant, "synthetic-model", "synthetic-seller", "phones", "QA-HISTORY", "تاریخچهٔ مصنوعی", "Synthetic history", "Synthetic warranty", true, 1, money, money, Version)], money, "0", "0", money, false, null, null, null, [], [], null, null, [new(1, 1, money)], false, false, ["synthetic_migration_history"]);
        var json = JsonSerializer.Serialize(data, Json);
        sales.Quotes.Add(new() { Id = quoteId, ActorKey = Hash, RequestId = Id(), PayloadHash = Hash, CartId = Id(), CartVersion = Version, PricingFingerprint = Hash, CreatedAt = data.CreatedAt, ExpiresAt = data.ExpiresAt!.Value, ItemsSubtotalRial = Price, GoodsTotalRial = Price, ShippingMode = "unconfigured", TaxMode = "unconfigured", ResponseJson = json, Lines = [new() { VariantId = variant, ProductId = "synthetic-model", SellerId = "synthetic-seller", CategoryId = "phones", Sku = "QA-HISTORY", Name = "تاریخچهٔ مصنوعی", Label = "Synthetic history", Warranty = "Synthetic warranty", PriceVersion = Version, IsDigital = true, Quantity = 1, UnitPriceRial = Price, LineTotalRial = Price }], Installments = [new() { Sequence = 1, MonthOffset = 1, AmountRial = Price }] });
        var order = new SalesOrder { Id = orderId, OwnerId = owner, RequestId = Id(), PayloadHash = Hash, QuoteId = quoteId, PricingFingerprint = Hash, Locale = "fa", State = OrderState.Cancelled, ReservationId = hold.Id, CreatedAt = hold.CreatedAt, ChangedAt = now, ExpiresAt = hold.ExpiresAt, ContactName = "Synthetic migration history", ContactPhone = "09100000000", MethodId = "synthetic-history", MethodName = "Synthetic historical method", ShippingName = "Synthetic history only", ItemsSubtotalRial = Price, GoodsTotalRial = Price, PayableTotalRial = Price, QuoteSnapshotJson = json, Lines = [new() { VariantId = variant, ProductId = "synthetic-model", SellerId = "synthetic-seller", Sku = "QA-HISTORY", Name = "تاریخچهٔ مصنوعی", Label = "Synthetic history", Warranty = "Synthetic warranty", PriceVersion = Version, IsDigital = true, Quantity = 1, UnitPriceRial = Price, LineTotalRial = Price }], Events = [new() { State = OrderState.Cancelled, ActorId = "synthetic-migration-history", Reason = "synthetic_migration_history", At = now }] };
        sales.Orders.Add(order); await sales.SaveChangesAsync(); Assert.Equal(0, await sales.OrderSettings.CountAsync()); Assert.Equal(0, await sales.ChargePolicies.CountAsync());
        return new Legacy(owner, variant, quoteId, orderId, hold.Id, json, order.Version.ToArray());
    });

    [Theory]
    [InlineData("quote-marker")][InlineData("quote-json-camel")][InlineData("quote-json-pascal")]
    [InlineData("order-header")][InlineData("order-line")][InlineData("outbox")][InlineData("demo-order")]
    public async Task SalesGuardIndependentlyRetainsEveryNewContractHistoryBeforeAnyDdl(string kind)
    {
        var old = await SeedLegacy();
        await Scope(async sp => {
            var db = sp.GetRequiredService<SalesDbContext>();
            if (kind.StartsWith("quote-", StringComparison.Ordinal)) {
                var quote = await db.Quotes.SingleAsync(q => q.Id == old.QuoteId);
                if (kind == "quote-marker") quote.ContractVersion = 5;
                else quote.ResponseJson = kind == "quote-json-camel" ? "{\"schemaVersion\":5,\"fixture\":\"Synthetic independent JSON guard\"}" : "{\"SchemaVersion\":5,\"fixture\":\"Synthetic independent JSON guard\"}";
            } else if (kind == "order-header") (await db.Orders.SingleAsync(o => o.Id == old.OrderId)).SnapshotVersion = 2;
            else if (kind == "demo-order") (await db.Orders.SingleAsync(o => o.Id == old.OrderId)).ContainsDemo = true;
            else if (kind == "order-line") db.Set<SalesOrderLineV2>().Add(new() { OrderId = old.OrderId, LineId = Id(), LineKind = "ordinary", VariantId = old.Variant, ProductId = "synthetic-model", SellerId = "synthetic-seller", CategoryId = "phones", Sku = "QA-HISTORY", Name = "Synthetic independent V2 line", Label = "Synthetic", Warranty = "Synthetic", PriceVersion = Version, Quantity = 1, UnitPriceRial = Price, LineTotalRial = Price });
            else db.Set<SalesOrderOutboxEvent>().Add(new() { Id = Id(), OrderId = old.OrderId, AgreementId = Id(), PayloadJson = "{\"fixture\":\"Synthetic independent outbox guard\"}", CreatedAt = DateTimeOffset.UtcNow });
            await db.SaveChangesAsync(); return true;
        });
        await Reject<SalesDbContext>(SalesBase);
    }

    [Fact]
    public async Task MarketGuardRetainsAnImmutableHistoricalOrderProjectionBeforeAnyDdl()
    {
        await Scope(async sp => {
            var db = sp.GetRequiredService<MarketDbContext>(); var now = DateTimeOffset.UtcNow; var request = Id(); var offer = Id(); var acceptance = Id(); var task = Id(); var owner = "synthetic-order-link-" + Id();
            db.SourcingRequests.Add(new() { Id = request, OwnerId = owner, SubmitRequestId = Id(), PayloadHash = Hash, CartId = Id(), SubmittedCartVersion = Version, Locale = "fa", ProtectedNote = "Synthetic migration fixture only", CreatedAt = now, ChangedAt = now });
            db.SourcingOffers.Add(new() { Id = offer, RequestId = request, State = "Accepted", IsActive = true, AcceptanceId = acceptance, AcceptedAt = now, PublishedAt = now, TermsFa = "نمونهٔ تاریخی", TermsEn = "Synthetic migration history", TermsHash = Hash, AcceptUntil = now.AddMinutes(5), PurchaseUntil = now.AddMinutes(10), CreatedAt = now, ChangedAt = now });
            db.SourcingOfferAcceptances.Add(new() { OfferId = offer, Id = acceptance, OwnerId = owner, TermsHash = Hash, OfferVersion = Version, At = now });
            db.SourcingSupplyTasks.Add(new() { Id = task, RequestId = request, OfferId = offer, AcceptanceId = acceptance, OwnerId = owner, TermsHash = Hash, CreatedAt = now, ChangedAt = now });
            db.SourcingOrderLinks.Add(new() { AgreementId = acceptance, EventId = Id(), PayloadHash = Hash, OrderId = Id(), OwnerId = owner, RequestId = request, TaskId = task, OfferId = offer, AcceptanceId = acceptance, AllocationId = Id(), CreatedAt = now, ProjectedAt = now });
            await db.SaveChangesAsync(); Assert.Single(await db.SourcingOrderLinks.ToArrayAsync()); return true;
        });
        await Reject<MarketDbContext>(MarketBase);
    }

    private static Task<string> LegacySnapshot(DbContext db) => db.Database.SqlQueryRaw<string>("""
        SELECT (SELECT
          JSON_QUERY((SELECT [Id],[OwnerId],[OrderId],[RequestId],[PayloadHash],[State],[CreatedAt],[ExpiresAt],[ChangedAt],[Version] FROM inventory.Reservations ORDER BY Id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Reservations],
          JSON_QUERY((SELECT * FROM inventory.ReservationItems ORDER BY ReservationId,VariantId FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Items],
          JSON_QUERY((SELECT * FROM inventory.ReservationEvents ORDER BY Id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [ReservationEvents],
          JSON_QUERY((SELECT [VariantId],[OnHand],[Reserved],[Version],[TrackingMode],[SourcingReserved] FROM inventory.Stock ORDER BY VariantId FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Stock],
          JSON_QUERY((SELECT [Id],[VariantId],[Serial],[Imei1],[Imei2],[State],[ReservationId],[OrderId],[WarrantyUntil],[CreatedAt],[ChangedAt],[Version] FROM inventory.SerialUnits ORDER BY Id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Units],
          JSON_QUERY((SELECT * FROM inventory.SerialUnitClaims ORDER BY Id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Claims],
          JSON_QUERY((SELECT * FROM sales.CheckoutQuotes ORDER BY Id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Quotes],
          JSON_QUERY((SELECT * FROM sales.CheckoutQuoteLines ORDER BY QuoteId,VariantId FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [QuoteLines],
          JSON_QUERY((SELECT * FROM sales.CheckoutQuoteInstallments ORDER BY QuoteId,[Sequence] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Installments],
          JSON_QUERY((SELECT [Id],[Number],[OwnerId],[RequestId],[PayloadHash],[QuoteId],[PricingFingerprint],[Locale],[State],[ReservationId],[CreatedAt],[ExpiresAt],[ChangedAt],[ContactName],[ContactPhone],[ShippingRequired],[CountryCode],[Province],[City],[Address],[PostalCode],[Note],[MethodId],[MethodName],[ShippingName],[ItemsSubtotalRial],[GoodsTotalRial],[ShippingRial],[TaxRial],[PayableTotalRial],[TaxIncluded],[QuoteSnapshotJson],[Version] FROM sales.Orders ORDER BY Id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Orders],
          JSON_QUERY((SELECT * FROM sales.OrderLines ORDER BY OrderId,VariantId FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [OrderLines],
          JSON_QUERY((SELECT * FROM sales.OrderEvents ORDER BY Id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [OrderEvents],
          JSON_QUERY((SELECT * FROM market.Listings ORDER BY Id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Listings],
          JSON_QUERY((SELECT * FROM market.SourcingRequests ORDER BY Id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Requests]
          FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS [Value]
        """).SingleAsync();
    private static Task<int> NewShape(DbContext db) => db.Database.SqlQueryRaw<int>("""
        SELECT (SELECT COUNT(*) FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id WHERE (s.name='inventory' AND t.name IN ('ReservationLineEntitlements','SourcingAllocationTransfers')) OR (s.name='sales' AND t.name IN ('OrderLinesV2','OrderOutbox')) OR (s.name='market' AND t.name='SourcingOrderLinks'))
          + CASE WHEN COL_LENGTH('inventory.Reservations','ContractVersion') IS NULL THEN 0 ELSE 1 END
          + CASE WHEN COL_LENGTH('inventory.SerialUnits','OrderLineId') IS NULL THEN 0 ELSE 1 END
          + CASE WHEN COL_LENGTH('sales.Orders','SnapshotVersion') IS NULL THEN 0 ELSE 1 END
          + CASE WHEN COL_LENGTH('sales.Orders','ContainsDemo') IS NULL THEN 0 ELSE 1 END AS [Value]
        """).SingleAsync();

    [Fact]
    public async Task EmptyAdditiveOrder2DowngradeAndUpgradePreservesAllLegacyJsonMoneyKeysAndRowVersions()
    {
        var old = await SeedLegacy(); await Scope(async sp=>{Assert.False(await sp.GetRequiredService<InventoryDbContext>().Stock.AnyAsync(s=>s.IsSingleUnit));return true;}); var before = await Scope(sp => LegacySnapshot(sp.GetRequiredService<SalesDbContext>()));
        await Scope(async sp => {
            var inventory = sp.GetRequiredService<InventoryDbContext>(); var sales = sp.GetRequiredService<SalesDbContext>(); var market = sp.GetRequiredService<MarketDbContext>();
            var inventoryMigrations = (await inventory.Database.GetAppliedMigrationsAsync()).ToArray(); var salesMigrations = (await sales.Database.GetAppliedMigrationsAsync()).ToArray(); var marketMigrations = (await market.Database.GetAppliedMigrationsAsync()).ToArray(); Assert.Equal(9, await NewShape(sales));
            await market.GetService<IMigrator>().MigrateAsync(MarketBase); await sales.GetService<IMigrator>().MigrateAsync(SalesBase); await inventory.GetService<IMigrator>().MigrateAsync(InventoryBase);
            Assert.Equal(0, await NewShape(sales)); Assert.Equal(before, await LegacySnapshot(sales));
            // Only explicit pre-Order2 SQL ran while current typed model columns
            // were absent. Reupgrade all owners before any typed entity read.
            await inventory.Database.MigrateAsync(); await sales.Database.MigrateAsync(); await market.Database.MigrateAsync();
            Assert.False(await inventory.Stock.AnyAsync(s=>s.IsSingleUnit)); Assert.Equal(inventoryMigrations, await inventory.Database.GetAppliedMigrationsAsync()); Assert.Equal(salesMigrations, await sales.Database.GetAppliedMigrationsAsync()); Assert.Equal(marketMigrations, await market.Database.GetAppliedMigrationsAsync()); Assert.Equal(9, await NewShape(sales)); Assert.Equal(before, await LegacySnapshot(sales));
            var order = await sales.Orders.AsNoTracking().Include(o => o.Lines).SingleAsync(o => o.Id == old.OrderId); Assert.Null(order.SnapshotVersion); Assert.False(order.ContainsDemo); Assert.Equal(old.OrderVersion, order.Version); Assert.Equal(old.QuoteJson, order.QuoteSnapshotJson); Assert.Equal(Price, order.PayableTotalRial); Assert.Equal(Price, Assert.Single(order.Lines).UnitPriceRial);
            var quote = await sales.Quotes.AsNoTracking().Include(q => q.Installments).SingleAsync(q => q.Id == old.QuoteId); Assert.Null(quote.ContractVersion); Assert.Equal(old.QuoteJson, quote.ResponseJson); Assert.Equal("9007199254740993", Assert.Single(JsonSerializer.Deserialize<CheckoutQuoteData>(quote.ResponseJson, Json)!.Lines).UnitPriceRial); Assert.Equal(Price, Assert.Single(quote.Installments).AmountRial);
            Assert.Null((await inventory.Reservations.AsNoTracking().SingleAsync(r => r.Id == old.ReservationId)).ContractVersion); Assert.Equal(0, await sales.OrderSettings.CountAsync()); Assert.Equal(0, await sales.ChargePolicies.CountAsync()); return true;
        });
    }
}
