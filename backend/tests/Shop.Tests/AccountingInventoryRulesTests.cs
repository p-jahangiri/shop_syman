using Shop.Modules.Inventory;
using Shop.SharedKernel;
using Xunit;
namespace Shop.Tests;
public sealed class AccountingInventoryRulesTests
{
    [Theory]
    [InlineData("0",1,1,0)]
    [InlineData("0.5",2,1,1)]
    [InlineData("1.50",2,1,3)]
    [InlineData("0002",12,1,24)]
    [InlineData("0.00000001",1000000,1,-1)]
    [InlineData("1000000",1,1,1000000)]
    public void ExactConversionsIncludeZeroButNeverRound(string value,int numerator,int denominator,int expected)
    {
        if(expected<0)Assert.Throws<BusinessException>(()=>AccountingInventoryRules.ConvertQuantity(value,numerator,denominator));
        else Assert.Equal(expected,AccountingInventoryRules.ConvertQuantity(value,numerator,denominator));
    }
    [Theory]
    [InlineData(null)] [InlineData("")] [InlineData("-1")] [InlineData("1,000")] [InlineData("1e3")] [InlineData("۱")] [InlineData(" 1")] [InlineData("1.000000001")] [InlineData("99999999999999999999")] [InlineData("1000001")]
    public void AmbiguousOrOutOfRangeQuantityIsNeverAUsableBalance(string? raw)=>Assert.Throws<BusinessException>(()=>AccountingInventoryRules.ConvertQuantity(raw,1,1));
    [Fact] public void ActiveWarehouseNeedsExplicitWholeStoreAcknowledgement()
    {
        var input=new AccountingWarehouseInput(Guid.NewGuid().ToString("N"),"000-C","000-W","انبار نمونه","Sample warehouse",true,false,null);
        Assert.Equal("invalid_accounting_warehouse",Assert.Throws<BusinessException>(()=>AccountingInventoryRules.Normalize(input)).Code);
        Assert.True(AccountingInventoryRules.Normalize(input with{AcknowledgeWholeStorePhysical=true}).IsActive);
        Assert.False(AccountingInventoryRules.Normalize(input with{IsActive=false}).IsActive);
    }
}
