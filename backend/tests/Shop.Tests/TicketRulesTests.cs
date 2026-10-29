using Microsoft.AspNetCore.DataProtection;
using Shop.Modules.Identity;
using Shop.Modules.Support;
using Shop.SharedKernel;
using Xunit;
namespace Shop.Tests;
public sealed class TicketRulesTests
{
    [Fact] public void PrivateContentCannotMoveBetweenTicketsMessagesOrContentKinds()
    {
        var service = new DataProtectionTicketProtection(new EphemeralDataProtectionProvider()); var ticket = Guid.NewGuid().ToString("N"); var message = Guid.NewGuid().ToString("N");
        var bytes = service.Protect(ticket, "message", message, "متن خصوصی برای آزمون؛ نه اطلاعات مالک");
        Assert.Equal("متن خصوصی برای آزمون؛ نه اطلاعات مالک", service.Unprotect(ticket, "message", message, bytes));
        foreach (var read in new Func<string>[] { () => service.Unprotect(Guid.NewGuid().ToString("N"), "message", message, bytes), () => service.Unprotect(ticket, "message", Guid.NewGuid().ToString("N"), bytes), () => service.Unprotect(ticket, "subject", message, bytes) }) Assert.Equal("ticket_unavailable", Assert.Throws<BusinessException>(read).Code);
        bytes[^1] ^= 1; Assert.Equal("ticket_unavailable", Assert.Throws<BusinessException>(() => service.Unprotect(ticket, "message", message, bytes)).Code);
    }
    [Fact] public void PrivateSupportHasDedicatedPermissionsInsteadOfFinancialOrContentAccess()
    {
        Assert.Equal(new[] { "support.read", "support.write" }, ShopPermissions.Roles["SupportAgent"]);
        Assert.All(new[] { "CatalogManager", "InventoryManager", "ContentManager", "FinanceManager", "SalesManager" }, role => Assert.DoesNotContain(ShopPermissions.Roles[role], p => p.StartsWith("support.", StringComparison.Ordinal)));
        Assert.Contains("support.read", ShopPermissions.Roles["Administrator"]); Assert.Contains("support.write", ShopPermissions.Roles["Administrator"]);
    }
    [Fact] public void CursorBindsOwnerAndTicketWithoutExposingTheOwner()
    {
        const string scope = "messages|OWNER-SECRET|0123456789abcdef0123456789abcdef"; var cursor = TicketRules.Cursor(9007199254740993, scope);
        Assert.Equal(9007199254740993, TicketRules.Cursor(cursor, scope, true)); Assert.Equal(0, TicketRules.Cursor(null, scope, true)); Assert.Equal(long.MaxValue, TicketRules.Cursor(null, scope, false));
        Assert.Throws<BusinessException>(() => TicketRules.Cursor(cursor, scope + "other", true)); Assert.DoesNotContain("OWNER-SECRET", System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(cursor)));
        Assert.Throws<BusinessException>(() => TicketRules.Cursor(" "+cursor, scope, true)); Assert.Throws<BusinessException>(() => TicketRules.Cursor("bad", scope, true));
    }
    [Theory][InlineData("\u202eprivate")][InlineData("body\0tail")][InlineData(" \n\t ")]
    public void InvalidOrDisguisedPrivateTextIsRejected(string body) => Assert.Throws<BusinessException>(() => TicketRules.Text(body, 1, 4000));
    [Fact] public void TextPreservesPlainContentAndNormalizesOnlyLineEndingsAndOuterSpace()
    {
        Assert.Equal("سلام\nline <b>plain</b>", TicketRules.Text("  سلام\r\nline <b>plain</b>  ", 1, 4000));
        Assert.Throws<BusinessException>(() => TicketRules.Text("عنوان\nدوم", 1, 120, true)); Assert.Throws<BusinessException>(() => TicketRules.Text(new string('a', 4001), 1, 4000));
        Assert.Throws<BusinessException>(() => TicketRules.Text(new string('\ud800', 1), 1, 4000));
        Assert.Equal("OWNER-ONE", TicketRules.Actor("owner-one")); Assert.Throws<BusinessException>(() => TicketRules.Id(new string('0',32)));
    }
}
