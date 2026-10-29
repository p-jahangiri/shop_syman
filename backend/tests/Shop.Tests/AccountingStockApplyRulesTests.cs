using Shop.Modules.Inventory;
using Shop.SharedKernel;
using Xunit;
namespace Shop.Tests;
public sealed class AccountingStockApplyRulesTests
{
    private static AccountingStockApplyInput Input()=>new(Guid.NewGuid().ToString("N"),new string('A',64),[2,1]," Synthetic physical reconciliation ",true,true);
    [Fact]public void SelectedRowsAreAnExplicitSortedSetAndReasonIsBounded()
    {
        var value=AccountingStockApplyRules.Normalize(Input());Assert.Equal([1,2],value.RowNumbers);Assert.Equal("Synthetic physical reconciliation",value.Reason);
        Assert.Equal(AccountingStockApplyRules.Hash("batch",value),AccountingStockApplyRules.Hash("batch",value with{RowNumbers=[1,2]}));
        Assert.NotEqual(AccountingStockApplyRules.Hash("batch",value),AccountingStockApplyRules.Hash("other",value));
    }
    [Theory][InlineData(false,true)][InlineData(true,false)][InlineData(false,false)]
    public void BothConfirmationsAreRequired(bool physical,bool unposted)=>Assert.Throws<BusinessException>(()=>AccountingStockApplyRules.Normalize(Input() with{AcknowledgeWholeStorePhysical=physical,AcknowledgeUnpostedSalesReconciled=unposted}));
    [Fact]public void MissingDuplicateOutOfRangeOrExcessiveRowsCannotBecomeACommand()
    {
        foreach(var rows in new[]{Array.Empty<int>(),[1,1],[0],[201],Enumerable.Range(1,201).ToArray()})Assert.Throws<BusinessException>(()=>AccountingStockApplyRules.Normalize(Input() with{RowNumbers=rows}));
        Assert.Throws<BusinessException>(()=>AccountingStockApplyRules.Normalize(Input() with{RowNumbers=null!}));
        Assert.Throws<BusinessException>(()=>AccountingStockApplyRules.Normalize(Input() with{PreviewFingerprint=new string('a',64)}));
        Assert.Throws<BusinessException>(()=>AccountingStockApplyRules.Normalize(Input() with{Reason=new string('a',401)}));
    }
}
