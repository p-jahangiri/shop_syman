using Shop.Modules.Inventory;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class StockOrderReservationV2RulesTests
{
    private static string Id() => Guid.NewGuid().ToString("N");
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-10-24T10:00:00Z");
    private static StockOrderHoldV2Request Request()
    {
        var allocation = Id(); var offer = Id();
        var plan = new SourcingStockAllocationPlan(Id(), Id(), Id(), Id(), "owner", new('A', 64), Now.AddMinutes(20), false, [new(offer, "same-sku", "model", 2, new('B', 64))]);
        return new("owner", Id(), Id(), Now.AddSeconds(30), [new(Id(), "SAME-SKU", 1), new(Id(), "same-sku", 2, allocation, offer)], [new(plan, allocation, "AAAAAAAAAAE=")]);
    }

    [Fact]
    public void OrdinaryAndSeparateAcceptedRightsKeepTheSameSkuWithoutMergingLineIds()
    {
        var request = Request(); var secondAllocation = Id(); var secondOffer = Id();
        var secondPlan = request.Allocations[0].Plan with { AcceptanceId = Id(), OfferId = Id(), Lines = [new(secondOffer, "same-sku", "model", 3, new('B', 64))] };
        request = request with { Lines = [.. request.Lines, new(Id(), "same-sku", 3, secondAllocation, secondOffer)], Allocations = [.. request.Allocations, new(secondPlan, secondAllocation, "AAAAAAAAAAE=")] };
        var normalized = StockOrderReservationV2Rules.Normalize(request, false);
        Assert.Equal(3, normalized.Lines.Length); Assert.Single(normalized.Lines.Select(l => l.VariantId).Distinct()); Assert.Equal(3, normalized.Lines.Select(l => l.LineId).Distinct().Count());
        Assert.Equal(6, normalized.Lines.Sum(l => l.Quantity)); Assert.Equal(2, normalized.Allocations.Length);
        Assert.Equal(request.ExpiresAt, normalized.ExpiresAt);
    }

    [Theory]
    [InlineData("partial")][InlineData("duplicate-line")][InlineData("wrong-quantity")][InlineData("foreign-allocation")][InlineData("half-provenance")][InlineData("sku-overflow")][InlineData("duplicate-acceptance")]
    public void EveryAcceptedAllocationMustBeCoveredExactlyWithoutBorrowingOrdinaryRights(string kind)
    {
        var request = Request(); var accepted = request.Lines[1];
        request = kind switch {
            "partial" => request with { Lines = [request.Lines[0]] },
            "duplicate-line" => request with { Lines = [request.Lines[0], accepted, accepted] },
            "wrong-quantity" => request with { Lines = [request.Lines[0], accepted with { Quantity = 1 }] },
            "foreign-allocation" => request with { Lines = [request.Lines[0], accepted with { AllocationId = Id() }] },
            "half-provenance" => request with { Lines = [request.Lines[0], accepted with { OfferLineId = null }] },
            "sku-overflow" => request with { Lines = [request.Lines[0] with { Quantity = 1000000 }, accepted] },
            "duplicate-acceptance" => request with { Allocations = [request.Allocations[0], request.Allocations[0] with { AllocationId = Id() }] },
            _ => throw new ArgumentOutOfRangeException(nameof(kind))
        };
        Assert.Equal("invalid_order_reservation_v2", Assert.Throws<BusinessException>(() => StockOrderReservationV2Rules.Normalize(request, false)).Code);
    }

    [Fact]
    public void ForeignOwnerAndProductionDemoStayHiddenBeforeStockAccess()
    {
        var request = Request(); var allocation = request.Allocations[0];
        foreach (var plan in new[] { allocation.Plan with { OwnerId = "another-owner" }, allocation.Plan with { ContainsDemo = true } })
            Assert.Equal("not_found", Assert.Throws<BusinessException>(() => StockOrderReservationV2Rules.Normalize(request with { Allocations = [allocation with { Plan = plan }] }, false)).Code);
    }

    [Fact]
    public void AnAbsoluteDeadlineCanHaveLessThanOneMinuteLeftAndNeverMovesForward()
    {
        var deadline = Now.AddSeconds(1);
        StockOrderReservationV2Rules.ValidateDeadline(deadline, [Now.AddSeconds(2)], Now);
        Assert.Equal("reservation_deadline_conflict", Assert.Throws<BusinessException>(() => StockOrderReservationV2Rules.ValidateDeadline(deadline, [Now.AddSeconds(2)], deadline)).Code);
    }

    [Theory]
    [InlineData("past")][InlineData("beyond-authority")][InlineData("beyond-hour")][InlineData("non-utc")]
    public void ACallerCannotExtendTheCurrentOrderOrAcceptedAuthority(string kind)
    {
        var deadline = kind switch { "past" => Now, "beyond-authority" => Now.AddMinutes(11), "beyond-hour" => Now.AddMinutes(61), "non-utc" => Now.AddMinutes(5).ToOffset(TimeSpan.FromHours(3.5)), _ => throw new ArgumentOutOfRangeException(nameof(kind)) };
        Assert.Equal("reservation_deadline_conflict", Assert.Throws<BusinessException>(() => StockOrderReservationV2Rules.ValidateDeadline(deadline, [Now.AddMinutes(10)], Now)).Code);
    }

    [Fact]
    public void TwoAllocationsOfOneHundredTrackedUnitsAreNotAWholeCartLimitOfOneHundred()
    {
        var request = Request(); var first = request.Allocations[0]; var secondId = Id(); var secondOffer = Id();
        var firstPlan = first.Plan with { Lines = [first.Plan.Lines[0] with { Quantity = 100 }] };
        var secondPlan = firstPlan with { AcceptanceId = Id(), OfferId = Id(), Lines = [firstPlan.Lines[0] with { OfferLineId = secondOffer }] };
        var normalized = StockOrderReservationV2Rules.Normalize(request with { Lines = [new(Id(), "same-sku", 100, first.AllocationId, firstPlan.Lines[0].OfferLineId), new(Id(), "same-sku", 100, secondId, secondOffer)], Allocations = [first with { Plan = firstPlan }, new(secondPlan, secondId, first.Version)] }, false);
        Assert.Equal(200, normalized.Lines.Sum(l => l.Quantity)); Assert.Equal(2, normalized.Lines.Length);
    }
}
