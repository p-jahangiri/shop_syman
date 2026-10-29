using Shop.Modules.Identity;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;
public sealed class CustomerDirectoryTests
{
    [Fact]
    public void CustomerPagingBindsNormalizedFiltersAndCannotReuseStaffCursor()
    {
        var filter = CustomerDirectoryFilter.Create("كارمَند ۱۲", "true", "customer");
        Assert.Equal("کارمند 12", filter.Search);
        var cursor = CustomerDirectoryPaging.Encode("customer-one", filter);
        Assert.Equal("customer-one", CustomerDirectoryPaging.Decode(cursor, filter));
        Assert.Throws<BusinessException>(() => CustomerDirectoryPaging.Decode(cursor, filter with { Kind = "staff" }));
        Assert.Throws<BusinessException>(() => CustomerDirectoryPaging.Decode(cursor, filter with { Active = "false" }));
        var staff = StaffPaging.Encode("customer-one", StaffFilter.Create("كارمند ۱۲", "true"));
        Assert.Throws<BusinessException>(() => CustomerDirectoryPaging.Decode(staff, filter));
    }
    [Fact]
    public void EveryHistoryCursorBindsItsCustomerAndSection()
    {
        var cursor = CustomerHistoryPaging.Encode("opaque-module-cursor", "customer-one", "orders");
        Assert.Equal("opaque-module-cursor", CustomerHistoryPaging.Decode(cursor, "customer-one", "orders"));
        Assert.Throws<BusinessException>(() => CustomerHistoryPaging.Decode(cursor, "customer-two", "orders"));
        Assert.Throws<BusinessException>(() => CustomerHistoryPaging.Decode(cursor, "customer-one", "tickets"));
        Assert.Throws<BusinessException>(() => CustomerHistoryPaging.Decode("invalid!", "customer-one", "orders"));
        Assert.Null(CustomerHistoryPaging.Encode(null, "customer-one", "orders"));
    }
    [Theory]
    [InlineData("unexpected")][InlineData("")]
    public void UnsupportedDirectoryKindsDoNotWidenTheQuery(string kind) =>
        Assert.Throws<BusinessException>(() => CustomerDirectoryFilter.Create(null, null, kind));
}
