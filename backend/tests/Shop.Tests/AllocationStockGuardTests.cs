using System.Data;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Inventory;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class AllocationStockGuardTests
{
    [Theory]
    [InlineData(10,2,3,5)]
    [InlineData(10,2,8,0)]
    [InlineData(0,0,0,0)]
    [InlineData(int.MaxValue,0,0,int.MaxValue)]
    [InlineData(int.MaxValue,1,int.MaxValue-1,0)]
    public void PublicAvailabilityExcludesBothKindsOfHeldStock(int onHand,int reserved,int sourcingReserved,int expected)=>Assert.Equal(expected,StockAvailability.Available(onHand,reserved,sourcingReserved));

    [Theory]
    [InlineData(10,2,9)]
    [InlineData(int.MaxValue,int.MaxValue,int.MaxValue)]
    [InlineData(-1,0,0)]
    [InlineData(1,-1,0)]
    [InlineData(1,0,-1)]
    public void InvalidOrOverflowingHeldTotalsCannotBecomePublicAvailability(int onHand,int reserved,int sourcingReserved)=>Assert.Throws<InvalidOperationException>(()=>StockAvailability.Available(onHand,reserved,sourcingReserved));

    [Fact]
    public async Task Version2CompositionKeepsBothHoldsAndLegacyReadsFailExplicitlyForSourcingStock()
    {
        var service=new AdminStockService(new Catalog(),new Stock());
        var row=await service.FindV2Async("variant",CancellationToken.None);
        Assert.Equal(10,row.OnHand);Assert.Equal(2,row.Reserved);Assert.Equal(5,row.SourcingReserved);Assert.Equal(3,row.Available);
        var page=await service.PageV2Async(AdminStockQuery.Create(),null,CancellationToken.None);Assert.Equal(2,page.Version);Assert.Equal(row,Assert.Single(page.Items));
        Assert.Equal("inventory_contract_upgrade_required",(await Assert.ThrowsAsync<BusinessException>(()=>service.FindAsync("variant",CancellationToken.None))).Code);
        Assert.Equal("inventory_contract_upgrade_required",(await Assert.ThrowsAsync<BusinessException>(()=>service.PageAsync(AdminStockQuery.Create(),null,CancellationToken.None))).Code);
        using var json=JsonDocument.Parse(JsonSerializer.Serialize(row,new JsonSerializerOptions(JsonSerializerDefaults.Web)));
        Assert.Equal(new[]{"available","isActive","nameEn","nameFa","onHand","productId","productStatus","reserved","sku","sourcingReserved","variantId","version"},json.RootElement.EnumerateObject().Select(p=>p.Name).OrderBy(n=>n,StringComparer.Ordinal).ToArray());
        using var internalRecord=JsonDocument.Parse(JsonSerializer.Serialize(new AdminStockRecord("variant",10,2,"AAAAAAAAAAE="){SourcingReserved=5},new JsonSerializerOptions(JsonSerializerDefaults.Web)));
        Assert.False(internalRecord.RootElement.TryGetProperty("sourcingReserved",out _));
    }

    [Fact]
    public async Task Version1WithoutSourcingHoldsPreservesItsExactWireAndQuantities()
    {
        var service=new AdminStockService(new Catalog(),new Stock(0));var row=await service.FindAsync("variant",CancellationToken.None);
        Assert.Equal(10,row.OnHand);Assert.Equal(2,row.Reserved);Assert.Equal(8,row.Available);
        var page=await service.PageAsync(AdminStockQuery.Create(),null,CancellationToken.None);Assert.Equal(1,page.Version);Assert.Equal(row,Assert.Single(page.Items));
        using var json=JsonDocument.Parse(JsonSerializer.Serialize(row,new JsonSerializerOptions(JsonSerializerDefaults.Web)));
        Assert.Equal(new[]{"available","isActive","nameEn","nameFa","onHand","productId","productStatus","reserved","sku","variantId","version"},json.RootElement.EnumerateObject().Select(p=>p.Name).OrderBy(n=>n,StringComparer.Ordinal).ToArray());
    }

    [Fact]
    public void AvailableSerialQueryExcludesEveryActiveClaimWithoutTakingAnAllocationParentLock()
    {
        using var db=new InventoryDbContext(DesignTimeOptions.Create<InventoryDbContext>("inventory"));
        var available=SerialInventoryService.Query(db,SerialPageQuery.Create("variant","available",null),null).ToQueryString();
        Assert.Contains("NOT EXISTS",available);Assert.Contains("[SerialUnitClaims]",available);Assert.Contains("[IsActive]",available);Assert.DoesNotContain("[SourcingAllocations]",available);Assert.DoesNotContain("[ExpiresAt]",available);
        var historical=SerialInventoryService.Query(db,SerialPageQuery.Create("variant","all",null),null).ToQueryString();
        Assert.DoesNotContain("[SerialUnitClaims]",historical);Assert.Equal(ConnectionState.Closed,db.Database.GetDbConnection().State);
    }

    [Theory][InlineData(false)][InlineData(true)]
    public async Task PendingSourcingCountsOrUnitClaimsBlockDigitalConversionBeforeSql(bool unitClaim)
    {
        using var db=new InventoryDbContext(DesignTimeOptions.Create<InventoryDbContext>("inventory"));
        if(unitClaim)db.SerialUnitClaims.Add(new(){Id=Guid.NewGuid().ToString("N"),UnitId=Guid.NewGuid().ToString("N"),VariantId="variant",OriginAllocationId=Guid.NewGuid().ToString("N"),OfferLineId=Guid.NewGuid().ToString("N"),IsActive=true,State="AllocationHeld",CreatedAt=DateTimeOffset.UnixEpoch,ChangedAt=DateTimeOffset.UnixEpoch});
        else db.Stock.Add(new(){VariantId="variant",OnHand=1,SourcingReserved=1});
        var service=new SerialInventoryService(db,new StockReservationService(db,TimeProvider.System),TimeProvider.System);
        var error=await Assert.ThrowsAsync<BusinessException>(()=>service.AssertDigitalVariantsAllowedAsync(["VARIANT"],CancellationToken.None));
        Assert.Equal("serial_digital_conflict",error.Code);Assert.Equal(ConnectionState.Closed,db.Database.GetDbConnection().State);
    }

    private sealed class Stock(int sourcingReserved=5):IAdminStockReader
    {
        public Task<AdminStockRecord[]> ReadAsync(string[] variantIds,CancellationToken ct)=>Task.FromResult(new[]{new AdminStockRecord("variant",10,2,"AAAAAAAAAAE="){SourcingReserved=sourcingReserved}});
        public Task<AdminStockSummary> SummaryAsync(CancellationToken ct)=>Task.FromResult(new AdminStockSummary("1","1","1"));
    }
    private sealed class Catalog:IAdminStockCatalog
    {
        private static readonly StockVariantMetadata Row=new("variant","product","SKU","کالا","Product",true,"Published");
        public Task<StockVariantPage> PageAsync(AdminStockQuery query,string? cursor,CancellationToken ct)=>Task.FromResult(new StockVariantPage([Row],null));
        public Task<StockVariantMetadata?> FindAsync(string id,CancellationToken ct)=>Task.FromResult<StockVariantMetadata?>(Row);
        public Task<AdminCatalogSummary> SummaryAsync(CancellationToken ct)=>Task.FromResult(new AdminCatalogSummary("1","1"));
    }
}
