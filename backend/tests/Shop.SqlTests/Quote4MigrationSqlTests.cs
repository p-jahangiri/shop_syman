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

// Each fact owns one fresh SqlFixture GUID. All historical rows below are
// trusted migration fixtures, never checkout through disabled business policy.
public sealed class Quote4MigrationSqlTests:IAsyncLifetime
{
    private readonly SqlFixture fixture=new();
    private const string Base34="20261024025922_CartAcceptedOffers";
    private const string V4="20261024045600_CheckoutQuotesV4";
    private const string Version="AAAAAAAAAAE=";
    private const long Price=9007199254740993;
    private static readonly string Hash=new('A',64);
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web);
    private static string Id()=>Guid.NewGuid().ToString("N");
    public Task InitializeAsync()=>fixture.InitializeAsync();
    public Task DisposeAsync()=>fixture.DisposeAsync();
    private async Task<T> Scope<T>(Func<IServiceProvider,Task<T>> action)
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var sales=scope.ServiceProvider.GetRequiredService<SalesDbContext>();
        Assert.StartsWith("SaymanTest_",sales.Database.GetDbConnection().Database);return await action(scope.ServiceProvider);
    }
    private static async Task<string[]> Applied(SalesDbContext db)=>(await db.Database.GetAppliedMigrationsAsync()).ToArray();
    private static Task<int> V4Shape(SalesDbContext db)=>db.Database.SqlQueryRaw<int>("""
        SELECT CASE WHEN OBJECT_ID(N'[sales].[CheckoutQuoteLinesV4]',N'U') IS NULL THEN 0 ELSE 1 END
             + CASE WHEN COL_LENGTH(N'sales.CheckoutQuotes',N'ContractVersion') IS NULL THEN 0 ELSE 1 END AS [Value]
        """).SingleAsync();

    // All pre-V4 columns are explicit for Quotes; this query remains valid
    // while its new ContractVersion column and LinesV4 table are absent.
    private static Task<string> OldSnapshot(SalesDbContext db)=>db.Database.SqlQueryRaw<string>("""
        SELECT (SELECT
          JSON_QUERY((SELECT * FROM [sales].[Carts] ORDER BY [Id] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Carts],
          JSON_QUERY((SELECT * FROM [sales].[CartLines] ORDER BY [CartId],[VariantId] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [CartLines],
          JSON_QUERY((SELECT [CartId],[ListingId],[Quantity] FROM [sales].[CartSourcingLines] ORDER BY [CartId],[ListingId] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Inquiries],
          JSON_QUERY((SELECT * FROM [sales].[CartOfferLines] ORDER BY [CartId],[AgreementLineId] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [AcceptedLines],
          JSON_QUERY((SELECT * FROM [sales].[SourcingConversions] ORDER BY [Id] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Conversions],
          JSON_QUERY((SELECT * FROM [sales].[CartOfferCommandReceipts] ORDER BY [ActorId],[Operation],[CommandId] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Receipts],
          JSON_QUERY((SELECT [Id],[ActorKey],[RequestId],[PayloadHash],[CartId],[CartVersion],[PricingFingerprint],[CreatedAt],[ExpiresAt],[ItemsSubtotalRial],[MarkupRial],[DownPaymentRial],[GoodsTotalRial],[ShippingRial],[TaxRial],[PayableTotalRial],[ChargePolicyVersion],[ShippingMode],[TaxMode],[TaxableBaseRial],[TaxRateBasisPoints],[TaxIncluded],[ResponseJson] FROM [sales].[CheckoutQuotes] ORDER BY [Id] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Quotes],
          JSON_QUERY((SELECT * FROM [sales].[CheckoutQuoteLines] ORDER BY [QuoteId],[VariantId] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [QuoteLines],
          JSON_QUERY((SELECT * FROM [sales].[CheckoutQuoteInstallments] ORDER BY [QuoteId],[Sequence] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Installments],
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
          JSON_QUERY((SELECT [Id],[Sku],[PriceRial],[CompareAtPriceRial],[Version] FROM [catalog].[Variants] ORDER BY [Id] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [PublicPrices],
          JSON_QUERY((SELECT t.[name] AS [Table],k.[name] AS [Key],ic.[key_ordinal],c.[name] AS [Column]
            FROM sys.key_constraints k JOIN sys.tables t ON t.[object_id]=k.[parent_object_id]
            JOIN sys.schemas s ON s.[schema_id]=t.[schema_id]
            JOIN sys.index_columns ic ON ic.[object_id]=k.[parent_object_id] AND ic.[index_id]=k.[unique_index_id]
            JOIN sys.columns c ON c.[object_id]=ic.[object_id] AND c.[column_id]=ic.[column_id]
            WHERE k.[type]='PK' AND s.[name]='sales' AND t.[name] IN ('AddressBooks','Addresses','Carts','CartLines','CartSourcingLines','CartOfferLines','SourcingConversions','CartOfferCommandReceipts','CheckoutQuotes','CheckoutQuoteLines','CheckoutQuoteInstallments','Orders','OrderLines','OrderEvents','SourcingPriceAgreements','SourcingPriceAgreementLines','CheckoutOrderSettings','CheckoutChargePolicies','__EFMigrationsHistory')
            ORDER BY t.[name],ic.[key_ordinal] FOR JSON PATH)) AS [OldPrimaryKeys]
          FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS [Value]
        """).SingleAsync();
    private static Task<string> V4Snapshot(SalesDbContext db)=>db.Database.SqlQueryRaw<string>("""
        SELECT (SELECT
          JSON_QUERY((SELECT [Id],[ContractVersion] FROM [sales].[CheckoutQuotes] ORDER BY [Id] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Markers],
          JSON_QUERY((SELECT * FROM [sales].[CheckoutQuoteLinesV4] ORDER BY [QuoteId],[LineId] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Lines],
          JSON_QUERY((SELECT * FROM [sales].[__EFMigrationsHistory] ORDER BY [MigrationId] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Migrations]
          FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS [Value]
        """).SingleAsync();
    private static Task<string> SchemaSnapshot(SalesDbContext db)=>db.Database.SqlQueryRaw<string>("""
        SELECT (SELECT
          JSON_QUERY((SELECT t.[name] AS [Table],c.[column_id],c.[name],ty.[name] AS [Type],c.[max_length],c.[precision],c.[scale],c.[is_nullable],c.[is_identity],c.[is_computed]
            FROM sys.tables t JOIN sys.schemas s ON s.[schema_id]=t.[schema_id]
            JOIN sys.columns c ON c.[object_id]=t.[object_id] JOIN sys.types ty ON ty.[user_type_id]=c.[user_type_id]
            WHERE s.[name]='sales' ORDER BY t.[name],c.[column_id] FOR JSON PATH)) AS [Columns],
          JSON_QUERY((SELECT t.[name] AS [Table],o.[name],o.[type],OBJECT_DEFINITION(o.[object_id]) AS [Definition]
            FROM sys.tables t JOIN sys.schemas s ON s.[schema_id]=t.[schema_id]
            JOIN sys.objects o ON o.[parent_object_id]=t.[object_id]
            WHERE s.[name]='sales' ORDER BY t.[name],o.[type],o.[name] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Constraints],
          JSON_QUERY((SELECT t.[name] AS [Table],i.[name],i.[type],i.[is_unique],i.[is_primary_key],i.[filter_definition],ic.[key_ordinal],ic.[is_included_column],c.[name] AS [Column]
            FROM sys.tables t JOIN sys.schemas s ON s.[schema_id]=t.[schema_id]
            JOIN sys.indexes i ON i.[object_id]=t.[object_id] JOIN sys.index_columns ic ON ic.[object_id]=i.[object_id] AND ic.[index_id]=i.[index_id]
            JOIN sys.columns c ON c.[object_id]=ic.[object_id] AND c.[column_id]=ic.[column_id]
            WHERE s.[name]='sales' ORDER BY t.[name],i.[name],ic.[key_ordinal],ic.[index_column_id] FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [Indexes]
          FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS [Value]
        """).SingleAsync();

    private sealed record Historical(string Owner,string Cart,string CartVersion,string Quote,string Order,string Variant,string Reservation,string Json);
    private Task<Historical> SeedLegacy()=>Scope(async sp=>
    {
        var sales=sp.GetRequiredService<SalesDbContext>();var inventory=sp.GetRequiredService<InventoryDbContext>();var owner="quote4-history-"+Id();var variant="quote4-history-"+Id();var orderId=Id();
        inventory.Stock.Add(new(){VariantId=variant,OnHand=4});await inventory.SaveChangesAsync();
        var reservations=sp.GetRequiredService<IStockReservations>();var hold=await reservations.HoldAsync(new(owner,orderId,Id(),[new(variant,1)],TimeSpan.FromMinutes(30)),default);await reservations.ReleaseAsync(owner,hold.Id,"synthetic-quote4-history",default);
        var now=DateTimeOffset.UtcNow;var cart=new ShoppingCart{Id=Id(),OwnerId=owner,Revision=5,UpdatedAt=now,Lines=[new(){VariantId=variant,Quantity=1}],SourcingLines=[new(){ListingId=Id(),Quantity=2}]};sales.Carts.Add(cart);await sales.SaveChangesAsync();var cartVersion=Convert.ToBase64String(cart.Version);var quoteId=Id();var money=Price.ToString(CultureInfo.InvariantCulture);
        var data=new CheckoutQuoteData(3,"fa",quoteId,cartVersion,Hash,now.AddMinutes(-2),now.AddMinutes(3),[new(variant,"synthetic-model","synthetic-seller","phones","QA-HISTORY","تاریخچهٔ مصنوعی","Synthetic legacy line","Synthetic warranty",true,1,money,money,Version)],money,"0","0",money,false,null,null,null,[],[],null,null,[new(1,1,money)],false,false,["synthetic_migration_history"],new(null,"unconfigured","Synthetic history only","No current policy is enabled",null,null,"unconfigured","unconfigured",null,"goods","half_up",null,false),new(false,30,true,["synthetic_migration_history"]));
        var json=JsonSerializer.Serialize(data,Json);
        sales.Quotes.Add(new(){Id=quoteId,ContractVersion=null,ActorKey=Hash,RequestId=Id(),PayloadHash=Hash,CartId=cart.Id,CartVersion=cartVersion,PricingFingerprint=Hash,CreatedAt=data.CreatedAt,ExpiresAt=data.ExpiresAt!.Value,ItemsSubtotalRial=Price,GoodsTotalRial=Price,ShippingMode="unconfigured",TaxMode="unconfigured",ResponseJson=json,
            Lines=[new(){VariantId=variant,ProductId="synthetic-model",SellerId="synthetic-seller",CategoryId="phones",Sku="QA-HISTORY",Name="تاریخچهٔ مصنوعی",Label="Synthetic legacy line",Warranty="Synthetic warranty",PriceVersion=Version,IsDigital=true,Quantity=1,UnitPriceRial=Price,LineTotalRial=Price}],
            Installments=[new(){Sequence=1,MonthOffset=1,AmountRial=Price}]});
        sales.Orders.Add(new(){Id=orderId,OwnerId=owner,RequestId=Id(),PayloadHash=Hash,QuoteId=quoteId,PricingFingerprint=Hash,Locale="fa",State=OrderState.Cancelled,ReservationId=hold.Id,CreatedAt=hold.CreatedAt,ExpiresAt=hold.ExpiresAt,ChangedAt=now,ContactName="Synthetic migration history",ContactPhone="09100000000",Note="Trusted historical fixture, not current financial policy.",MethodId="synthetic-history",MethodName="Synthetic historical method",ShippingName="Synthetic history only",ItemsSubtotalRial=Price,GoodsTotalRial=Price,PayableTotalRial=Price,QuoteSnapshotJson=json,
            Lines=[new(){VariantId=variant,ProductId="synthetic-model",SellerId="synthetic-seller",Sku="QA-HISTORY",Name="تاریخچهٔ مصنوعی",Label="Synthetic legacy line",Warranty="Synthetic warranty",PriceVersion=Version,IsDigital=true,Quantity=1,UnitPriceRial=Price,LineTotalRial=Price}],
            Events=[new(){State=OrderState.Cancelled,ActorId="synthetic-migration-history",Reason="synthetic_migration_history",At=now}]});
        await sales.SaveChangesAsync();Assert.Equal(0,await sales.OrderSettings.CountAsync());Assert.Equal(0,await sales.ChargePolicies.CountAsync());
        return new Historical(owner,cart.Id,cartVersion,quoteId,orderId,variant,hold.Id,json);
    });

    [Fact]
    public async Task PopulatedLegacyNullMarkerMoneyJsonInstallmentsKeysAndStockVersionsSurviveEmptyV4DowngradeAndUpgrade()
    {
        var old=await SeedLegacy();var before=await Scope(sp=>OldSnapshot(sp.GetRequiredService<SalesDbContext>()));var migrations=await Scope(sp=>Applied(sp.GetRequiredService<SalesDbContext>()));
        Assert.Equal(V4,migrations.SkipWhile(m=>m!=Base34).Skip(1).First());
        await Scope(async sp=>
        {
            var sales=sp.GetRequiredService<SalesDbContext>();Assert.Equal(2,await V4Shape(sales));Assert.Equal(0,await sales.QuoteLinesV4.CountAsync());Assert.Null((await sales.Quotes.AsNoTracking().SingleAsync(q=>q.Id==old.Quote)).ContractVersion);
            await sales.GetService<IMigrator>().MigrateAsync(Base34);Assert.Equal(Base34,(await Applied(sales))[^1]);Assert.Equal(0,await V4Shape(sales));Assert.Equal(before,await OldSnapshot(sales));return true;
        });
        // No current typed Quote model was queried while its marker was absent.
        await Scope(async sp=>
        {
            var sales=sp.GetRequiredService<SalesDbContext>();await sales.Database.MigrateAsync();Assert.Equal(migrations,await Applied(sales));Assert.Equal(2,await V4Shape(sales));Assert.Equal(before,await OldSnapshot(sales));Assert.Equal(0,await sales.QuoteLinesV4.CountAsync());
            var quote=await sales.Quotes.AsNoTracking().Include(q=>q.Lines).Include(q=>q.Installments).SingleAsync(q=>q.Id==old.Quote);Assert.Null(quote.ContractVersion);Assert.Equal(old.Json,quote.ResponseJson);Assert.Equal(Price,quote.ItemsSubtotalRial);Assert.Equal(Price,Assert.Single(quote.Lines).UnitPriceRial);Assert.Equal(Price,Assert.Single(quote.Installments).AmountRial);
            var parsed=JsonSerializer.Deserialize<CheckoutQuoteData>(quote.ResponseJson,Json)!;Assert.Equal(3,parsed.SchemaVersion);Assert.Equal("9007199254740993",Assert.Single(parsed.Lines).UnitPriceRial);Assert.Equal("9007199254740993",Assert.Single(parsed.Installments).AmountRial);
            var cart=await sales.Carts.AsNoTracking().Include(c=>c.Lines).Include(c=>c.SourcingLines).SingleAsync(c=>c.Id==old.Cart);Assert.Equal(old.CartVersion,Convert.ToBase64String(cart.Version));Assert.Single(cart.Lines);Assert.Single(cart.SourcingLines);
            var order=await sp.GetRequiredService<OrderService>().ReadAsync(old.Owner,old.Order,default);Assert.Equal(1,order.SchemaVersion);Assert.Equal("Cancelled",order.Summary.State);Assert.Equal("9007199254740993",order.PayableTotalRial);Assert.Equal(old.Variant,Assert.Single(order.Lines).VariantId);Assert.False(order.CanPay);
            Assert.Equal(old.Json,(await sales.Orders.AsNoTracking().SingleAsync(o=>o.Id==old.Order)).QuoteSnapshotJson);Assert.Equal(StockReservationState.Released,(await sp.GetRequiredService<InventoryDbContext>().Reservations.AsNoTracking().SingleAsync(r=>r.Id==old.Reservation)).State);
            Assert.Equal(0,await sales.OrderSettings.CountAsync());Assert.Equal(0,await sales.ChargePolicies.CountAsync());return true;
        });
    }

    private Task<string> SeedV4(Historical old,int? marker=4)=>Scope(async sp=>
    {
        var db=sp.GetRequiredService<SalesDbContext>();var now=DateTimeOffset.UtcNow;var id=Id();var ordinary=new CheckoutQuoteLineV4{QuoteId=id,LineId=Id(),LineKind="ordinary",VariantId=old.Variant,ProductId="synthetic-model",SellerId="synthetic-seller",CategoryId="phones",Sku="QA-HISTORY",Name="Synthetic ordinary",Label="Ordinary",Warranty="Synthetic",PriceVersion=Version,Quantity=1,UnitPriceRial=1,LineTotalRial=1};
        var accepted=new CheckoutQuoteLineV4{QuoteId=id,LineId=Id(),LineKind="acceptedOffer",VariantId=old.Variant,ProductId="synthetic-model",SellerId="synthetic-seller",CategoryId="phones",Sku="QA-HISTORY",Name="Synthetic accepted",Label="Accepted",Warranty="Synthetic",Quantity=1,UnitPriceRial=Price,LineTotalRial=Price,ConversionId=Id(),AgreementId=Id(),AgreementLineId=Id(),RequestId=Id(),TaskId=Id(),OfferId=Id(),AcceptanceId=Id(),AllocationId=Id(),OfferLineId=Id(),TermsHash=Hash,AgreementVersion=Version,AllocationVersion=Version,PurchaseUntil=now.AddHours(1),AllocationExpiresAt=now.AddMinutes(30)};
        var provenance=new AcceptedQuoteLineV4Data(accepted.ConversionId!,accepted.AgreementId!,accepted.AgreementLineId!,accepted.RequestId!,accepted.TaskId!,accepted.OfferId!,accepted.AcceptanceId!,accepted.AllocationId!,accepted.OfferLineId!,Hash,Version,Version,accepted.PurchaseUntil!.Value,accepted.AllocationExpiresAt!.Value);
        var total=checked(Price+1);var money=total.ToString(CultureInfo.InvariantCulture);
        var data=new CheckoutQuoteV4Data(4,"en",id,old.CartVersion,Hash,now,now.AddMinutes(5),[new(ordinary.LineId,"ordinary",old.Variant,ordinary.ProductId,ordinary.SellerId,ordinary.CategoryId,ordinary.Sku,ordinary.Name,ordinary.Label,ordinary.Warranty,false,1,"1","1",Version,null),new(accepted.LineId,"acceptedOffer",old.Variant,accepted.ProductId,accepted.SellerId,accepted.CategoryId,accepted.Sku,accepted.Name,accepted.Label,accepted.Warranty,false,1,Price.ToString(CultureInfo.InvariantCulture),Price.ToString(CultureInfo.InvariantCulture),null,provenance)],money,"0","0",money,true,null,null,null,[],[],null,null,[],false,false,[CheckoutQuoteV4Rules.OrderUnavailable],new(null,"unconfigured","Synthetic history only","No current policy is enabled",null,null,"unconfigured","unconfigured",null,"goods","half_up",null,false),new(false,30,true,[CheckoutQuoteV4Rules.OrderUnavailable]),false);
        // Storage guard history only: no Agreement or Inventory capability is
        // claimed by these synthetic provenance IDs or optional NULL marker.
        db.Quotes.Add(new(){Id=id,ContractVersion=marker,ActorKey=Hash,RequestId=Id(),PayloadHash=Hash,CartId=old.Cart,CartVersion=old.CartVersion,PricingFingerprint=Hash,CreatedAt=now,ExpiresAt=now.AddMinutes(5),ItemsSubtotalRial=total,GoodsTotalRial=total,ShippingMode="unconfigured",TaxMode="unconfigured",ResponseJson=JsonSerializer.Serialize(data,Json),LinesV4=[ordinary,accepted]});await db.SaveChangesAsync();return id;
    });
    private async Task RejectBeforeDdl(string[] migrations)
    {
        var before=await Scope(sp=>OldSnapshot(sp.GetRequiredService<SalesDbContext>()));var v4=await Scope(sp=>V4Snapshot(sp.GetRequiredService<SalesDbContext>()));var schema=await Scope(sp=>SchemaSnapshot(sp.GetRequiredService<SalesDbContext>()));
        await Scope(async sp=>
        {
            var db=sp.GetRequiredService<SalesDbContext>();var error=await Assert.ThrowsAsync<SqlException>(()=>db.GetService<IMigrator>().MigrateAsync(Base34));Assert.Equal(51000,error.Number);
            Assert.Equal(migrations,await Applied(db));Assert.Equal(2,await V4Shape(db));Assert.Equal(schema,await SchemaSnapshot(db));Assert.Equal(before,await OldSnapshot(db));Assert.Equal(v4,await V4Snapshot(db));return true;
        });
    }

    [Fact]
    public async Task DowngradeRejectsV4LinesHeaderOnlyAndIndependentLineHistoryBeforeAnyDdlOrMigrationHistoryChange()
    {
        var old=await SeedLegacy();var quote=await SeedV4(old);var source=await Scope(sp=>Applied(sp.GetRequiredService<SalesDbContext>()));Assert.Contains(V4,source);
        // A lawful empty Order2 downgrade is a separate committed migration.
        // Start at V4 so its own 51000 guard must preserve every local object.
        await Scope(async sp=>{await sp.GetRequiredService<SalesDbContext>().GetService<IMigrator>().MigrateAsync(V4);return true;});
        var migrations=await Scope(sp=>Applied(sp.GetRequiredService<SalesDbContext>()));Assert.Equal(V4,migrations[^1]);
        await RejectBeforeDdl(migrations);
        await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();await db.QuoteLinesV4.Where(l=>l.QuoteId==quote).ExecuteDeleteAsync();Assert.Equal(4,(await db.Quotes.AsNoTracking().SingleAsync(q=>q.Id==quote)).ContractVersion);Assert.Equal(0,await db.QuoteLinesV4.CountAsync());return true;});
        await RejectBeforeDdl(migrations);
        // Independently exercise the OR-lines guard. A nullable-marker header
        // with V4 line storage is synthetic legacy/corrupt-history input, not a
        // successful service invocation; downgrade must still preserve it.
        await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();await db.Quotes.Where(q=>q.Id==quote).ExecuteDeleteAsync();Assert.Equal(0,await db.Quotes.CountAsync(q=>q.ContractVersion==4));return true;});
        var lineOnly=await SeedV4(old,marker:null);
        await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();Assert.Null((await db.Quotes.AsNoTracking().SingleAsync(q=>q.Id==lineOnly)).ContractVersion);Assert.Equal(2,await db.QuoteLinesV4.CountAsync());Assert.Equal(0,await db.Quotes.CountAsync(q=>q.ContractVersion==4));return true;});
        await RejectBeforeDdl(migrations);
        await Scope(async sp=>{var db=sp.GetRequiredService<SalesDbContext>();await db.Database.MigrateAsync();Assert.Equal(source,await Applied(db));Assert.Equal(old.Json,(await db.Orders.AsNoTracking().SingleAsync(o=>o.Id==old.Order)).QuoteSnapshotJson);Assert.Equal(2,await db.QuoteLinesV4.CountAsync());return true;});
    }
}
