using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Identity;
using Shop.SharedKernel;
using Xunit;
namespace Shop.Tests;
public sealed class CustomerLoginContinuityTests
{
    [Fact]public void NoEmailCustomerHasNoEmailOnlyCandidateButKeepsItsUsernameCandidate()
    {
        Assert.Empty(CustomerLoginContinuityRules.Identifiers("phone-customer",null,true,false));
        Assert.Equal(new CustomerLoginIdentifier("phone-customer",false),Assert.Single(CustomerLoginContinuityRules.Identifiers("phone-customer",null,false,true)));
    }
    [Fact]public void AtCharacterAlwaysChoosesEmailLookupEvenWhenTheKnownValueIsAUserName()
    {
        Assert.Empty(CustomerLoginContinuityRules.Identifiers("customer@example.test",null,false,true));
        Assert.Equal(new CustomerLoginIdentifier("customer@example.test",true),Assert.Single(CustomerLoginContinuityRules.Identifiers("customer@example.test",null,true,false)));
    }
    [Fact]public void CandidateBoundsTrimAndDuplicateRulesMatchPasswordDispatchWithoutInventingAnIdentifier()
    {
        Assert.Empty(CustomerLoginContinuityRules.Identifiers(new string('a',257),null,false,true));
        Assert.Empty(CustomerLoginContinuityRules.Identifiers("   ",null,false,true));
        Assert.Equal(new CustomerLoginIdentifier("name",false),Assert.Single(CustomerLoginContinuityRules.Identifiers(" name ",null,false,true)));
        Assert.Single(CustomerLoginContinuityRules.Identifiers("same@example.test","same@example.test",true,false));
        Assert.Equal(2,CustomerLoginContinuityRules.Identifiers("alias@example.test","primary@example.test",true,false).Length);
    }
    private static IdentityDbContext Unused()=>new(new DbContextOptionsBuilder<IdentityDbContext>().UseSqlServer("Server=unused;Database=unused").Options);
    [Fact]public async Task KeepingBothPasswordMethodsNeedsNeitherAnAmbientTransactionNorAnySqlRead()
    {
        using var db=Unused();await new CustomerLoginContinuity(db,new UpperInvariantLookupNormalizer()).RequireAsync(true,true,default);Assert.Empty(db.ChangeTracker.Entries());
    }
    [Theory][InlineData(true,false)][InlineData(false,true)]
    public async Task SingleMethodCannotValidateOutsideTheRootSerializableBoundary(bool email,bool username)
    {
        using var db=Unused();await Assert.ThrowsAsync<InvalidOperationException>(()=>new CustomerLoginContinuity(db,new UpperInvariantLookupNormalizer()).RequireAsync(email,username,default));Assert.Empty(db.ChangeTracker.Entries());
    }
    [Fact]public async Task NoMethodFailsClosedWithoutOpeningTheDatabase()
    {
        using var db=Unused();Assert.Equal("customer_login_continuity_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>new CustomerLoginContinuity(db,new UpperInvariantLookupNormalizer()).RequireAsync(false,false,default))).Code);Assert.Empty(db.ChangeTracker.Entries());
    }
}
