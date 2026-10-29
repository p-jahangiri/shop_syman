using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Credit;
using Shop.SharedKernel;
using Xunit;
namespace Shop.Tests;
public sealed class CreditPurchaseScopeTests
{
    private static string Id() => Guid.NewGuid().ToString("N");
    [Fact] public void GrantRequiresExplicitBasisConfirmationAndStrictInputWithoutClientMoney()
    {
        var input = new GrantCreditPurchaseScopeInput("AAAAAAAAAAA=", Id(), "PayableTotalRial", true);
        Assert.Equal(input, CreditPurchaseScopeRules.Validate(input));
        Assert.Equal("InstallmentsTotalRial", CreditPurchaseScopeRules.Validate(input with { LimitBasis = "InstallmentsTotalRial" }).LimitBasis);
        foreach (var bad in new[] { input with { GrantConfirmed = false }, input with { LimitBasis = "" }, input with { LimitBasis = "Wallet" }, input with { ReviewId = "bad" }, input with { ApplicationVersion = "1" } })
            Assert.Throws<BusinessException>(() => CreditPurchaseScopeRules.Validate(bad));
        var json = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<GrantCreditPurchaseScopeInput>("{\"applicationVersion\":\"AAAAAAAAAAA=\",\"reviewId\":\"" + input.ReviewId + "\",\"limitBasis\":\"PayableTotalRial\"}", json));
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<GrantCreditPurchaseScopeInput>(JsonSerializer.Serialize(input, json).Replace("}", ",\"amountRial\":\"1\"}"), json));
    }
    [Fact] public void RevocationRequiresVersionsAndConfirmationAndStaffMustExplainWithoutRejectingValidPersianEmoji()
    {
        var input = new RevokeCreditPurchaseScopeInput("AAAAAAAAAAA=", "AAAAAAAAAAE=", "fa", "دلیل ساختگی 😀", true);
        Assert.Equal(input, CreditPurchaseScopeRules.Validate(input, true));
        Assert.Equal("", CreditPurchaseScopeRules.Validate(input with { Note = "" }, false).Note);
        foreach (var bad in new[] { input with { RevokeConfirmed = false }, input with { Note = "" }, input with { Note = "\ud800" }, input with { Locale = "xx" }, input with { ScopeVersion = "x" } })
            Assert.Throws<BusinessException>(() => CreditPurchaseScopeRules.Validate(bad, true));
    }
    [Fact] public async Task GrantsRevocationsAndReceiptsAreImmutableThroughAllSaveEntryPoints()
    {
        await using var db = new CreditDbContext(new DbContextOptionsBuilder<CreditDbContext>().UseSqlServer("Server=invalid;Database=NeverConnect;Integrated Security=true").Options);
        foreach (var row in new object[] { new CreditPurchaseScope { Id = Id(), ApplicationId = Id(), ReviewId = Id(), SubmissionId = Id() }, new CreditScopeRevocation { ScopeId = Id(), ApplicationId = Id() }, new CreditScopeCommand { ActorId = "QA", CommandId = Id(), ApplicationId = Id(), ScopeId = Id() } }) {
            db.Attach(row); db.Remove(row);
            Assert.Throws<BusinessException>(() => db.SaveChanges()); Assert.Throws<BusinessException>(() => db.SaveChanges(false));
            await Assert.ThrowsAsync<BusinessException>(() => db.SaveChangesAsync()); await Assert.ThrowsAsync<BusinessException>(() => db.SaveChangesAsync(false)); db.ChangeTracker.Clear();
        }
    }
    [Fact] public void ScopeNotesAndReceiptsUseIndependentCaseRecordAndPurposeBoundEncryption()
    {
        var p = new DataProtectionCreditApplicationProtection(new EphemeralDataProtectionProvider()); var app = Id(); var scope = Id();
        var bytes = p.Protect(app, "scope-note", scope, "synthetic reason");
        Assert.Equal("synthetic reason", p.Unprotect(app, "scope-note", scope, bytes));
        foreach (var purpose in new[] { "scope-receipt", "review-note", "review-receipt", "plan" }) Assert.Throws<BusinessException>(() => p.Unprotect(app, purpose, scope, bytes));
        Assert.Throws<BusinessException>(() => p.Unprotect(Id(), "scope-note", scope, bytes)); Assert.Throws<BusinessException>(() => p.Unprotect(app, "scope-note", Id(), bytes));
    }
}
