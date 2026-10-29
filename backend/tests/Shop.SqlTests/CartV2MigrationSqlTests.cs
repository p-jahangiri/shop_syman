using System.Globalization;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Inventory;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;

// xUnit creates a separate instance per fact: every migration/downgrade and
// synthetic historical row belongs to this fresh SqlFixture GUID database.
public sealed class CartV2MigrationSqlTests:IAsyncLifetime
{
    private readonly SqlFixture fixture=new();
    private const string Sales33="20261024010045_SourcingPriceAgreements";
    private const string Cart2="20261024025922_CartAcceptedOffers";
    private const string Quote4="20261024045600_CheckoutQuotesV4";
    private const string V="AAAAAAAAAAE=";
    private const long Price=9007199254740993;
    private static readonly string Hash=new('A',64);
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web);
    private static string Id()=>Guid.NewGuid().ToString("N");
    public Task InitializeAsync()=>fixture.InitializeAsync();
    public Task DisposeAsync()=>fixture.DisposeAsync();
    private async Task<T> Scope<T>(Func<IServiceProvider,Task<T>> action)
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<SalesDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);return await action(scope.ServiceProvider);
    }
    // Only pre-Cart2 tables appear here, so this projection remains valid while
    // the current typed EF model's three new tables are absent at Sales33.
    private static Task<string> OldSnapshot(SalesDbContext db)=>db.Database.SqlQueryRaw<string>("""
        SELECT (SELECT
          JSON_QUERY((SELECT * FROM [sales].[Carts] ORDER BY [Id] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Carts],
          JSON_QUERY((SELECT * FROM [sales].[CartLines] ORDER BY [CartId],[VariantId] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Ordinary],
          JSON_QUERY((SELECT [CartId],[ListingId],[Quantity] FROM [sales].[CartSourcingLines] ORDER BY [CartId],[ListingId] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Inquiry],
          JSON_QUERY((SELECT [Id],[ActorKey],[RequestId],[PayloadHash],[CartId],[CartVersion],[PricingFingerprint],[CreatedAt],[ExpiresAt],[ItemsSubtotalRial],[MarkupRial],[DownPaymentRial],[GoodsTotalRial],[ShippingRial],[TaxRial],[PayableTotalRial],[ChargePolicyVersion],[ShippingMode],[TaxMode],[TaxableBaseRial],[TaxRateBasisPoints],[TaxIncluded],[ResponseJson] FROM [sales].[CheckoutQuotes] ORDER BY [Id] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Quotes],
          JSON_QUERY((SELECT * FROM [sales].[CheckoutQuoteLines] ORDER BY [QuoteId],[VariantId] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [QuoteLines],
          JSON_QUERY((SELECT * FROM [sales].[CheckoutQuoteInstallments] ORDER BY [QuoteId],[Sequence] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [QuoteInstallments],
          JSON_QUERY((SELECT [Id],[Number],[OwnerId],[RequestId],[PayloadHash],[QuoteId],[PricingFingerprint],[Locale],[State],[ReservationId],[CreatedAt],[ExpiresAt],[ChangedAt],[ContactName],[ContactPhone],[ShippingRequired],[CountryCode],[Province],[City],[Address],[PostalCode],[Note],[MethodId],[MethodName],[ShippingName],[ItemsSubtotalRial],[GoodsTotalRial],[ShippingRial],[TaxRial],[PayableTotalRial],[TaxIncluded],[QuoteSnapshotJson],[Version] FROM [sales].[Orders] ORDER BY [Id] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Orders],
          JSON_QUERY((SELECT * FROM [sales].[OrderLines] ORDER BY [OrderId],[VariantId] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [OrderLines],
          JSON_QUERY((SELECT * FROM [sales].[OrderEvents] ORDER BY [Id] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [OrderEvents],
          JSON_QUERY((SELECT * FROM [sales].[SourcingPriceAgreements] ORDER BY [Id] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Agreements],
          JSON_QUERY((SELECT * FROM [sales].[SourcingPriceAgreementLines] ORDER BY [AgreementId],[Id] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [AgreementLines],
          JSON_QUERY((SELECT * FROM [sales].[CheckoutOrderSettings] ORDER BY [Id] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Settings],
          JSON_QUERY((SELECT * FROM [sales].[CheckoutChargePolicies] ORDER BY [Id] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Policies],
          JSON_QUERY((SELECT * FROM [inventory].[Stock] ORDER BY [VariantId] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Stock],
          JSON_QUERY((SELECT * FROM [inventory].[Reservations] ORDER BY [Id] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Reservations],
          JSON_QUERY((SELECT * FROM [inventory].[ReservationItems] ORDER BY [ReservationId],[VariantId] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [ReservationItems],
          JSON_QUERY((SELECT * FROM [inventory].[ReservationEvents] ORDER BY [Id] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [ReservationEvents],
          JSON_QUERY((SELECT * FROM [inventory].[Movements] ORDER BY [Id] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Movements],
          JSON_QUERY((SELECT * FROM [inventory].[SerialUnits] ORDER BY [Id] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Units],
          JSON_QUERY((SELECT * FROM [inventory].[SerialIdentifiers] ORDER BY [Key] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Aliases],
          JSON_QUERY((SELECT * FROM [inventory].[SerialUnitEvents] ORDER BY [Id] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [UnitEvents],
          JSON_QUERY((SELECT * FROM [inventory].[SerialCommands] ORDER BY [ActorId],[RequestId] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [SerialCommands],
          JSON_QUERY((SELECT [Id],[Sku],[PriceRial],[CompareAtPriceRial],[Version] FROM [catalog].[Variants] ORDER BY [Id] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [PublicPrices],
          JSON_QUERY((SELECT s.[name] AS [Schema],t.[name] AS [Table],k.[name] AS [Key],ic.[key_ordinal],c.[name] AS [Column]
            FROM sys.key_constraints k JOIN sys.tables t ON t.[object_id]=k.[parent_object_id]
            JOIN sys.schemas s ON s.[schema_id]=t.[schema_id]
            JOIN sys.index_columns ic ON ic.[object_id]=k.[parent_object_id] AND ic.[index_id]=k.[unique_index_id]
            JOIN sys.columns c ON c.[object_id]=ic.[object_id] AND c.[column_id]=ic.[column_id]
            WHERE k.[type]='PK' AND s.[name]='sales' AND t.[name] IN ('Carts','CartLines','CartSourcingLines','CheckoutQuotes','CheckoutQuoteLines','CheckoutQuoteInstallments','Orders','OrderLines','OrderEvents','SourcingPriceAgreements','SourcingPriceAgreementLines')
            ORDER BY s.[name],t.[name],ic.[key_ordinal] FOR JSON PATH)) AS [OldPrimaryKeys]
          FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS [Value]
        """).SingleAsync();
    private static Task<int> NewTableCount(SalesDbContext db)=>db.Database.SqlQueryRaw<int>("""
        SELECT COUNT(*) AS [Value] FROM sys.tables t JOIN sys.schemas s ON s.[schema_id]=t.[schema_id]
        WHERE s.[name]='sales' AND t.[name] IN ('CartOfferLines','SourcingConversions','CartOfferCommandReceipts')
        """).SingleAsync();
    private static Task<string> NewSnapshot(SalesDbContext db)=>db.Database.SqlQueryRaw<string>("""
        SELECT (SELECT
          JSON_QUERY((SELECT * FROM [sales].[CartOfferLines] ORDER BY [CartId],[AgreementLineId] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Lines],
          JSON_QUERY((SELECT * FROM [sales].[SourcingConversions] ORDER BY [Id] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Conversions],
          JSON_QUERY((SELECT * FROM [sales].[CartOfferCommandReceipts] ORDER BY [ActorId],[Operation],[CommandId] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Commands]
          FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS [Value]
        """).SingleAsync();
    private static async Task<string[]> Applied(SalesDbContext db)=>(await db.Database.GetAppliedMigrationsAsync()).ToArray();
    private sealed record Historical(string Owner,string Cart,string Quote,string Order,string Variant,string SerialVariant,string Hold,string QuoteJson);
    private async Task<Historical> SeedOldHistory()=>await Scope(async sp=>{
        var sales=sp.GetRequiredService<SalesDbContext>();var inventory=sp.GetRequiredService<InventoryDbContext>();var owner="migration-history-"+Id();var variant="migration-count-"+Id();var serial="migration-device-"+Id();var orderId=Id();inventory.Stock.AddRange(new StockItem{VariantId=variant,OnHand=4},new StockItem{VariantId=serial});await inventory.SaveChangesAsync();
        // Real ordinary reservation/serial mechanics, with synthetic identifiers.
        // The historical cancelled order below is a trusted migration fixture,
        // never a successful invocation of today's disabled checkout policies.
        var reservations=sp.GetRequiredService<IStockReservations>();var hold=await reservations.HoldAsync(new(owner,orderId,Id(),[new(variant,1)],TimeSpan.FromMinutes(30)),default);await reservations.ReleaseAsync(owner,hold.Id,"synthetic-migration-history",default);
        var serials=sp.GetRequiredService<SerialInventoryService>();var stock=await inventory.Stock.SingleAsync(s=>s.VariantId==serial);var configured=await serials.ConfigureAsync(serial,false,new("serial",Convert.ToBase64String(stock.Version),Id()),"migration-history",default);await serials.ReceiveAsync(serial,false,new([new("QA-HISTORY-"+Id())],"Synthetic historical device for migration preservation",configured.Stock.Version,Id()),"migration-history",default);
        var now=DateTimeOffset.UtcNow;var cart=new ShoppingCart{Id=Id(),OwnerId=owner,Revision=7,UpdatedAt=now,Lines=[new(){VariantId=variant,Quantity=1}],SourcingLines=[new(){ListingId=Id(),Quantity=2}]};sales.Carts.Add(cart);await sales.SaveChangesAsync();var cartVersion=Convert.ToBase64String(cart.Version);var quoteId=Id();var money=Price.ToString(CultureInfo.InvariantCulture);
        var quoteData=new CheckoutQuoteData(3,"fa",quoteId,cartVersion,Hash,now.AddMinutes(-2),now.AddMinutes(3),[new(variant,"synthetic-history-model","synthetic-seller","phones","QA-HISTORICAL","ردیف تاریخی مصنوعی","Synthetic old variant","Synthetic old warranty",true,1,money,money,V)],money,"0","0",money,false,null,null,null,[],[],null,null,[],false,false,["synthetic_migration_history"],new(null,"unconfigured","Synthetic history only","No current policy is enabled",null,null,"unconfigured","unconfigured",null,"goods","half_up",null,false),new(false,30,true,["synthetic_migration_history"]));
        var json=JsonSerializer.Serialize(quoteData,Json);sales.Quotes.Add(new(){Id=quoteId,ActorKey=Hash,RequestId=Id(),PayloadHash=Hash,CartId=cart.Id,CartVersion=cartVersion,PricingFingerprint=Hash,CreatedAt=quoteData.CreatedAt,ExpiresAt=quoteData.ExpiresAt!.Value,ItemsSubtotalRial=Price,GoodsTotalRial=Price,ShippingMode="unconfigured",TaxMode="unconfigured",ResponseJson=json,Lines=[new(){VariantId=variant,ProductId="synthetic-history-model",SellerId="synthetic-seller",CategoryId="phones",Sku="QA-HISTORICAL",Name="ردیف تاریخی مصنوعی",Label="Synthetic old variant",Warranty="Synthetic old warranty",PriceVersion=V,IsDigital=true,Quantity=1,UnitPriceRial=Price,LineTotalRial=Price}]});
        sales.Orders.Add(new(){Id=orderId,OwnerId=owner,RequestId=Id(),PayloadHash=Hash,QuoteId=quoteId,PricingFingerprint=Hash,Locale="fa",State=OrderState.Cancelled,ReservationId=hold.Id,CreatedAt=hold.CreatedAt,ExpiresAt=hold.ExpiresAt,ChangedAt=now,ContactName="Synthetic migration history",ContactPhone="09100000000",Note="Trusted synthetic pre-Cart2 historical row; no current financial policy enabled.",MethodId="synthetic-history",MethodName="Synthetic historical method",ShippingName="Synthetic history only",ItemsSubtotalRial=Price,GoodsTotalRial=Price,PayableTotalRial=Price,QuoteSnapshotJson=json,Lines=[new(){VariantId=variant,ProductId="synthetic-history-model",SellerId="synthetic-seller",Sku="QA-HISTORICAL",Name="ردیف تاریخی مصنوعی",Label="Synthetic old variant",Warranty="Synthetic old warranty",PriceVersion=V,IsDigital=true,Quantity=1,UnitPriceRial=Price,LineTotalRial=Price}],Events=[new(){State=OrderState.Cancelled,ActorId="synthetic-migration-history",Reason="synthetic_migration_history",At=now}]});await sales.SaveChangesAsync();Assert.Equal(0,await sales.OrderSettings.CountAsync());Assert.Equal(0,await sales.ChargePolicies.CountAsync());return new Historical(owner,cart.Id,quoteId,orderId,variant,serial,hold.Id,json);
    });

    [Fact] public async Task PopulatedSales33HistorySurvivesEmptyCart2DowngradeAndUpgradeWithoutRewritingKeysMoneyStockJsonOrVersions()
    {
        var old=await SeedOldHistory();var before=await Scope(sp=>OldSnapshot(sp.GetRequiredService<SalesDbContext>()));var source=await Scope(sp=>Applied(sp.GetRequiredService<SalesDbContext>()));Assert.Equal(new[]{Cart2,Quote4},source.SkipWhile(m=>m!=Sales33).Skip(1).Take(2));
        await Scope(async sp=>{var sales=sp.GetRequiredService<SalesDbContext>();Assert.Equal(3,await NewTableCount(sales));Assert.Equal(0,await sales.CartOfferLines.CountAsync());Assert.Equal(0,await sales.SourcingConversions.CountAsync());Assert.Equal(0,await sales.CartOfferCommandReceipts.CountAsync());await sales.GetService<IMigrator>().MigrateAsync(Sales33);Assert.Equal(Sales33,(await Applied(sales))[^1]);Assert.Equal(0,await NewTableCount(sales));Assert.Equal(before,await OldSnapshot(sales));return true;});
        // Only old-table SQL was executed at target33; the current EF model's
        // OfferLines navigation was never queried against absent Cart2 tables.
        await Scope(async sp=>{var sales=sp.GetRequiredService<SalesDbContext>();await sales.Database.MigrateAsync();Assert.Equal(source,await Applied(sales));Assert.Equal(3,await NewTableCount(sales));Assert.Equal(before,await OldSnapshot(sales));Assert.Equal(0,await sales.CartOfferLines.CountAsync());Assert.Equal(0,await sales.SourcingConversions.CountAsync());Assert.Equal(0,await sales.CartOfferCommandReceipts.CountAsync());
            var cart=await sales.Carts.AsNoTracking().Include(c=>c.Lines).Include(c=>c.SourcingLines).SingleAsync(c=>c.Id==old.Cart);Assert.Single(cart.Lines);Assert.Single(cart.SourcingLines);var stored=await sales.Quotes.AsNoTracking().SingleAsync(q=>q.Id==old.Quote);Assert.Equal(old.QuoteJson,stored.ResponseJson);Assert.Equal(3,JsonSerializer.Deserialize<CheckoutQuoteData>(stored.ResponseJson,Json)!.SchemaVersion);Assert.Equal("9007199254740993",JsonSerializer.Deserialize<CheckoutQuoteData>(stored.ResponseJson,Json)!.Lines[0].UnitPriceRial);var order=await sp.GetRequiredService<OrderService>().ReadAsync(old.Owner,old.Order,default);Assert.Equal(1,order.SchemaVersion);Assert.Equal("Cancelled",order.Summary.State);Assert.Equal("9007199254740993",order.PayableTotalRial);Assert.Equal(old.Variant,Assert.Single(order.Lines).VariantId);Assert.False(order.CanPay);Assert.Equal(old.QuoteJson,(await sales.Orders.AsNoTracking().SingleAsync(o=>o.Id==old.Order)).QuoteSnapshotJson);
            var inventory=sp.GetRequiredService<InventoryDbContext>();Assert.Equal(StockReservationState.Released,(await inventory.Reservations.AsNoTracking().SingleAsync(r=>r.Id==old.Hold)).State);Assert.Single(await inventory.SerialUnits.AsNoTracking().Where(u=>u.VariantId==old.SerialVariant).ToArrayAsync());Assert.Equal(0,await sales.OrderSettings.CountAsync());Assert.Equal(0,await sales.ChargePolicies.CountAsync());return true;});
    }
    private sealed record NewHistory(string Cart,string Agreement,string Conversion,string Command);
    private async Task<NewHistory> SeedNewHistory()=>await Scope(async sp=>{
        var db=sp.GetRequiredService<SalesDbContext>();var now=DateTimeOffset.UtcNow;var owner="synthetic-conversion-"+Id();var cart=new ShoppingCart{Id=Id(),OwnerId=owner,Revision=1,UpdatedAt=now};var agreementId=Id();var offerLine=Id();var lineId=SourcingPriceAgreementRules.LineId(agreementId,offerLine);var variant="synthetic-migration-"+Id();var product="synthetic-model-"+Id();var allocation=Id();
        var sku=new OfferSkuSnapshot(variant,product,"synthetic-seller","QA-MIGRATION",new(product,"synthetic-history","phones","گوشی","Phones","brand","Synthetic","تاریخچه مصنوعی","Synthetic history","صرفاً آزمون migration","Migration fixture only",["/products/phone-green.svg"],[]),"نمونه","Synthetic","green","سبز","Green","نمونه","Synthetic",[],["online"],null,[],"1",V,Hash,Hash);
        var agreement=new SourcingPriceAgreement{Id=agreementId,RequestId=Id(),TaskId=Id(),OfferId=Id(),Revision=1,AcceptanceId=agreementId,OwnerId=owner,TermsHash=Hash,SnapshotHash=Hash,TermsFa="تاریخچه مصنوعی migration",TermsEn="Synthetic migration history",PurchaseUntil=now.AddHours(1),AllocationId=allocation,State="Revoked",ContainsDemo=true,CreatedAt=now,ChangedAt=now,Lines=[new(){AgreementId=agreementId,Id=lineId,OfferLineId=offerLine,ListingId=Id(),VariantId=variant,Quantity=1,UnitPriceRial=Price,LineTotalRial=Price,SkuSnapshotJson=JsonSerializer.Serialize(sku,Json)}]};db.Carts.Add(cart);db.SourcingPriceAgreements.Add(agreement);await db.SaveChangesAsync();
        // Trusted historical shape only: no conversion endpoint is invoked and
        // this synthetic history does not claim a live Inventory allocation.
        var conversionId=Id();var command=Id();var cartLine=CartOfferRules.OfferLineId(cart.Id,agreementId,lineId);var links=new[]{new SourcingCartLineLink(cartLine,lineId,offerLine)};var version=Convert.ToBase64String(cart.Version);db.SourcingConversions.Add(new(){Id=conversionId,OwnerId=owner,RequestId=agreement.RequestId,TaskId=agreement.TaskId,OfferId=agreement.OfferId,AcceptanceId=agreement.AcceptanceId,AgreementId=agreementId,AllocationId=allocation,CartId=cart.Id,CartVersion=version,CommandId=command,LineLinksJson=JsonSerializer.Serialize(links,Json),ContainsDemo=true,CreatedAt=now});db.CartOfferLines.Add(new(){CartId=cart.Id,Id=cartLine,ConversionId=conversionId,AgreementId=agreementId,AgreementLineId=lineId,RequestId=agreement.RequestId,TaskId=agreement.TaskId,OfferId=agreement.OfferId,AcceptanceId=agreement.AcceptanceId,AllocationId=allocation,AllocationVersion=V,AllocationExpiresAt=now.AddMinutes(30),OfferLineId=offerLine,VariantId=variant,Quantity=1,ContainsDemo=true,CreatedAt=now});var result=new SourcingConversionMutation(1,conversionId,agreement.RequestId,agreement.TaskId,agreement.OfferId,agreement.AcceptanceId,agreementId,allocation,cart.Id,version,links,command,now,false);db.CartOfferCommandReceipts.Add(new(){ActorId=owner.ToUpperInvariant(),Operation="convert",CommandId=command,AgreementId=agreementId,RequestId=agreement.RequestId,OfferId=agreement.OfferId,PayloadHash=Hash,ResultJson=JsonSerializer.Serialize(result,Json),ContainsDemo=true,At=now});await db.SaveChangesAsync();return new NewHistory(cart.Id,agreementId,conversionId,command);
    });
    private async Task RejectDowngradeBeforeDdl(string[] migrations)
    {
        var old=await Scope(sp=>OldSnapshot(sp.GetRequiredService<SalesDbContext>()));var fresh=await Scope(sp=>NewSnapshot(sp.GetRequiredService<SalesDbContext>()));await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();var error=await Assert.ThrowsAsync<SqlException>(()=>db.GetService<IMigrator>().MigrateAsync(Sales33));Assert.Equal(51000,error.Number);Assert.Equal(migrations,await Applied(db));Assert.Equal(3,await NewTableCount(db));Assert.Equal(old,await OldSnapshot(db));Assert.Equal(fresh,await NewSnapshot(db));return true;});
    }
    [Fact] public async Task DowngradeRejectsCurrentLinesHistoricalConversionAndReceiptOnlyHistoryBeforeDroppingAnyTable()
    {
        var rows=await SeedNewHistory();var source=await Scope(sp=>Applied(sp.GetRequiredService<SalesDbContext>()));Assert.Equal(new[]{Cart2,Quote4},source.SkipWhile(m=>m!=Sales33).Skip(1).Take(2));
        // Empty later Quote4 and Order2 migrations can legitimately reverse first.
        // Prove Cart2's own pre-DDL guard from its immediate version boundary.
        await Scope(async sp=>{await sp.GetRequiredService<SalesDbContext>().GetService<IMigrator>().MigrateAsync(Cart2);return true;});
        var migrations=await Scope(sp=>Applied(sp.GetRequiredService<SalesDbContext>()));Assert.Equal(Cart2,migrations[^1]);await RejectDowngradeBeforeDdl(migrations);
        await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();await db.CartOfferLines.Where(l=>l.CartId==rows.Cart&&l.AgreementId==rows.Agreement).ExecuteDeleteAsync();Assert.Equal(0,await db.CartOfferLines.CountAsync());Assert.Equal(1,await db.SourcingConversions.CountAsync());Assert.Equal(1,await db.CartOfferCommandReceipts.CountAsync());return true;});await RejectDowngradeBeforeDdl(migrations);
        // Receipt-only history is deliberately tested in this GUID QA: losing
        // its idempotent historical success is destructive even without a line.
        await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();await db.SourcingConversions.Where(c=>c.Id==rows.Conversion).ExecuteDeleteAsync();Assert.Equal(0,await db.SourcingConversions.CountAsync());Assert.Single(await db.CartOfferCommandReceipts.Where(c=>c.CommandId==rows.Command).ToArrayAsync());return true;});await RejectDowngradeBeforeDdl(migrations);
        await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();await db.Database.MigrateAsync();Assert.Equal(source,await Applied(db));Assert.Single(await db.CartOfferCommandReceipts.Where(c=>c.CommandId==rows.Command).ToArrayAsync());return true;});
    }
}
