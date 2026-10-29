using Microsoft.EntityFrameworkCore;
using Shop.Modules.Inventory;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class StockReservationValidationTests
{
    [Theory]
    [InlineData("zero")]
    [InlineData("negative")]
    [InlineData("overflow")]
    [InlineData("empty")]
    [InlineData("too-many")]
    [InlineData("duplicate")]
    [InlineData("short-life")]
    [InlineData("long-life")]
    [InlineData("invalid-id")]
    [InlineData("empty-order")]
    public async Task InvalidHoldsFailBeforeOpeningAnyDatabaseConnection(string kind)
    {
        await using var db = new InventoryDbContext(DesignTimeOptions.Create<InventoryDbContext>("inventory"));
        var request = new StockHoldRequest("owner", Guid.NewGuid().ToString("N"), Guid.NewGuid().ToString("N"), [new("variant", 1)], TimeSpan.FromMinutes(10));
        request = kind switch {
            "zero" => request with { Lines = [new("variant", 0)] },
            "negative" => request with { Lines = [new("variant", -1)] },
            "overflow" => request with { Lines = [new("variant", int.MaxValue)] },
            "empty" => request with { Lines = [] },
            "too-many" => request with { Lines = Enumerable.Range(0, 65).Select(i => new StockReservationLine("v" + i, 1)).ToArray() },
            "duplicate" => request with { Lines = [new("variant", 1), new("VARIANT", 1)] },
            "short-life" => request with { Lifetime = TimeSpan.FromSeconds(59) },
            "long-life" => request with { Lifetime = TimeSpan.FromMinutes(61) },
            "invalid-id" => request with { Lines = [new("invalid/id", 1)] },
            "empty-order" => request with { OrderId = Guid.Empty.ToString() },
            _ => throw new ArgumentOutOfRangeException(nameof(kind))
        };
        Assert.Equal("invalid_reservation", (await Assert.ThrowsAsync<BusinessException>(() => new StockReservationService(db, TimeProvider.System).HoldAsync(request, CancellationToken.None))).Code);
        Assert.Equal(System.Data.ConnectionState.Closed, db.Database.GetDbConnection().State);
    }
}
