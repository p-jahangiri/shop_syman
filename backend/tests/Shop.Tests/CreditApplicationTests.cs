using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Credit;
using Shop.Modules.Identity;
using Shop.SharedKernel;
using Xunit;
namespace Shop.Tests;
public sealed class CreditApplicationTests
{
    [Theory]
    [InlineData("0")][InlineData("-1")][InlineData("1.0")][InlineData("01")][InlineData("۱۰۰")][InlineData(" 10")][InlineData("9223372036854775808")]
    public void Requested_money_requires_canonical_positive_integer_rial(string value)=>Assert.Equal("invalid_credit_application",Assert.Throws<BusinessException>(()=>CreditApplicationRules.Amount(value)).Code);
    [Fact]
    public void Exact_large_rial_and_scoped_cursor_are_preserved()
    {
        Assert.Equal(long.MaxValue,CreditApplicationRules.Amount("9223372036854775807"));var token=CreditApplicationRules.Cursor(long.MaxValue,"owner|Draft");Assert.Equal(long.MaxValue,CreditApplicationRules.Cursor(token,"owner|Draft"));Assert.Throws<BusinessException>(()=>CreditApplicationRules.Cursor(token,"other|Draft"));Assert.Throws<BusinessException>(()=>CreditApplicationRules.Cursor(token,"owner|Cancelled"));Assert.Equal("SYNTHETIC",CreditApplicationRules.Actor("synthetic"));
    }
    [Fact]
    public void Private_plan_and_receipt_protection_cannot_move_between_applications_or_kinds()
    {
        var protection=new DataProtectionCreditApplicationProtection(new EphemeralDataProtectionProvider());var id=Guid.NewGuid().ToString("N");var other=Guid.NewGuid().ToString("N");const string text="{\"requestedAmountRial\":\"9007199254740993\"}";var bytes=protection.Protect(id,"plan",id,text);Assert.Equal(text,protection.Unprotect(id,"plan",id,bytes));Assert.DoesNotContain(text,System.Text.Encoding.UTF8.GetString(bytes));Assert.Throws<BusinessException>(()=>protection.Unprotect(other,"plan",id,bytes));Assert.Throws<BusinessException>(()=>protection.Unprotect(id,"receipt",id,bytes));bytes[^1]^=1;Assert.Throws<BusinessException>(()=>protection.Unprotect(id,"plan",id,bytes));
    }
    [Fact]
    public void Existing_financial_plan_readers_and_support_do_not_gain_private_case_access()
    {
        foreach(var role in new[]{"CatalogManager","FinanceManager","SalesManager","SupportAgent","ContentManager","InventoryManager"})Assert.DoesNotContain("credit.read",ShopPermissions.Roles[role]);Assert.Equal(new[]{"credit.read","credit.write"},ShopPermissions.Roles["CreditReviewer"]);Assert.Contains("credit.read",ShopPermissions.Roles["Administrator"]);
    }
    [Fact]
    public async Task All_save_entry_points_reject_editing_historical_terms_without_querying_SQL()
    {
        await using var db=new CreditDbContext(new DbContextOptionsBuilder<CreditDbContext>().UseSqlServer("Server=invalid;Database=NeverConnect;Integrated Security=true").Options);var row=new CreditApplication{OwnerId="SYNTHETIC",PlanId="plan",PlanVersion="AAAAAAAAAAE=",RequestedAmountRial=100,PlanHash=new string('A',64),ProtectedPlan=[1],CreatedAt=DateTimeOffset.UtcNow,ChangedAt=DateTimeOffset.UtcNow};db.Attach(row);row.RequestedAmountRial=200;
        Assert.Equal("credit_application_history_immutable",Assert.Throws<BusinessException>(()=>db.SaveChanges()).Code);Assert.Throws<BusinessException>(()=>db.SaveChanges(false));await Assert.ThrowsAsync<BusinessException>(()=>db.SaveChangesAsync());await Assert.ThrowsAsync<BusinessException>(()=>db.SaveChangesAsync(false));
    }
    [Fact]
    public async Task Historical_commands_and_events_cannot_be_deleted()
    {
        await using var db=new CreditDbContext(new DbContextOptionsBuilder<CreditDbContext>().UseSqlServer("Server=invalid;Database=NeverConnect;Integrated Security=true").Options);db.Attach(new CreditApplicationEvent{Sequence=1,ApplicationId=Guid.NewGuid().ToString("N"),ActorId="SYNTHETIC",Action="Created",At=DateTimeOffset.UtcNow});db.Remove(db.ChangeTracker.Entries<CreditApplicationEvent>().Single().Entity);await Assert.ThrowsAsync<BusinessException>(()=>db.SaveChangesAsync());
    }
}
