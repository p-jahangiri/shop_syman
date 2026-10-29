using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Identity;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class StaffProvisioningTests
{
    private static CreateStaffAccountInput Input() => new("06102cc0-20b9-4aee-953e-187d6030c5b6",
        "Shop.Staff", "همکار نمونه", "Synthetic-Initial-Secret-47!", ["SupportAgent", "CatalogManager"]);

    [Fact]
    public void CanonicalCommandBindsPasswordContactAndEveryRoleWithoutInventingEmail()
    {
        var value = StaffProvisioningRules.Validate(Input());
        Assert.Equal("shop.staff", value.UserName);
        Assert.Equal(new[] { "CatalogManager", "SupportAgent" }, value.Roles);
        Assert.Null(value.Email);
        var fingerprint = StaffProvisioningRules.Fingerprint(value);
        Assert.Equal(64, fingerprint.Length);
        Assert.Equal(fingerprint, StaffProvisioningRules.Fingerprint(StaffProvisioningRules.Validate(Input() with { Roles = ["CatalogManager", "SupportAgent"] })));
        Assert.NotEqual(fingerprint, StaffProvisioningRules.Fingerprint(value with { InitialPassword = "Another-Synthetic-Secret-47!" }));
        Assert.NotEqual(fingerprint, StaffProvisioningRules.Fingerprint(value with { Email = "staff@example.invalid" }));
        Assert.NotEqual(fingerprint, StaffProvisioningRules.Fingerprint(value with { Roles = ["Administrator"] }));
    }

    [Theory]
    [InlineData("ابجد")]
    [InlineData("a")]
    [InlineData("staff user")]
    [InlineData("staff@example.invalid")]
    [InlineData(" staff")]
    public void AmbiguousUsernamesAreRejected(string name) => Assert.Throws<BusinessException>(() => StaffProvisioningRules.Validate(Input() with { UserName = name }));

    [Fact]
    public void InvalidCommandRolesContactAndMalformedTextAreRejected()
    {
        Assert.Throws<BusinessException>(() => StaffProvisioningRules.Validate(Input() with { RequestId = Guid.Empty.ToString("D") }));
        Assert.Throws<BusinessException>(() => StaffProvisioningRules.Validate(Input() with { Roles = ["Root"] }));
        Assert.Throws<BusinessException>(() => StaffProvisioningRules.Validate(Input() with { Roles = ["SupportAgent", "SupportAgent"] }));
        Assert.Throws<BusinessException>(() => StaffProvisioningRules.Validate(Input() with { Email = "not-email" }));
        Assert.Throws<BusinessException>(() => StaffProvisioningRules.Validate(Input() with { DisplayName = "نام\u202eفریبنده" }));
        Assert.Throws<BusinessException>(() => StaffProvisioningRules.Password(new string((char)0xd800, 12)));
        Assert.Throws<BusinessException>(() => StaffProvisioningRules.Password("short"));
    }

    [Fact]
    public void ManagedStaffIdentityDoesNotChangeActualContactVerification()
    {
        var user = new ShopUser();
        Assert.False(StaffProvisioningRules.ManagedStaffContact(user));
        user.ProvisionedByAdministrator = true;
        Assert.True(StaffProvisioningRules.ManagedStaffContact(user));
        Assert.False(user.EmailConfirmed);
        Assert.False(user.PhoneNumberConfirmed);
    }

    [Fact]
    public void ProtectedReceiptCannotMoveBetweenActorCommandOrPurpose()
    {
        var protection = new StaffProvisioningProtection(new EphemeralDataProtectionProvider());
        var id = Input().RequestId;
        var secret = "Synthetic-Initial-Secret-47!";
        var bytes = protection.Protect("actor-a", id, "receipt", secret);
        Assert.DoesNotContain(secret, Convert.ToBase64String(bytes));
        Assert.Equal(secret, protection.Unprotect("actor-a", id, "receipt", bytes));
        Assert.Throws<CryptographicException>(() => protection.Unprotect("actor-b", id, "receipt", bytes));
        Assert.Throws<CryptographicException>(() => protection.Unprotect("actor-a", Guid.NewGuid().ToString("D"), "receipt", bytes));
        Assert.Throws<CryptographicException>(() => protection.Unprotect("actor-a", id, "fingerprint", bytes));
        Assert.Throws<CryptographicException>(() => protection.Unprotect("actor-a", id, "receipt", new byte[16385]));
    }

    [Fact]
    public async Task StaffCreationReceiptsCannotBeEditedOrDeletedThroughContext()
    {
        using var db = new IdentityDbContext(DesignTimeOptions.Create<IdentityDbContext>("identity"));
        var row = new StaffCreationCommand { ActorId = "actor", RequestId = Guid.NewGuid(), UserId = "target" };
        db.Attach(row);
        db.Entry(row).State = EntityState.Modified;
        Assert.Throws<InvalidOperationException>(() => db.SaveChanges());
        db.Entry(row).State = EntityState.Deleted;
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public void LegacyStaffContractOmitsNewFalseFlagsAndNewReceiptContainsNoPassword()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var old = new StaffRow("one", "staff", "نام", true, true, false, DateTimeOffset.UtcNow, "version", ["SupportAgent"]);
        var legacy = JsonNode.Parse(JsonSerializer.Serialize(old, options))!.AsObject();
        Assert.False(legacy.ContainsKey("requiresPasswordChange"));
        Assert.False(legacy.ContainsKey("provisionedByAdministrator"));
        var value = new StaffAccountCreated(1, Input().RequestId, false, old with { RequiresPasswordChange = true, ProvisionedByAdministrator = true });
        var json = JsonSerializer.Serialize(value, options);
        Assert.DoesNotContain("passwordHash", json);
        Assert.DoesNotContain("initialPassword", json);
        Assert.DoesNotContain(Input().InitialPassword, json);
        Assert.True(JsonNode.Parse(json)!["staff"]!["requiresPasswordChange"]!.GetValue<bool>());
    }

    [Theory]
    [InlineData("staff_password_change", "staff.write", "Administrator")]
    [InlineData("mfa_pending", "staff.write", "Administrator")]
    [InlineData("access", "staff.read", "Administrator")]
    [InlineData("access", "staff.write", "SalesManager")]
    public async Task IncompleteOrUnauthorizedSessionCannotProvisionStaff(string kind, string permission, string role)
    {
        using var host = new ApiFactory();
        using var client = host.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-Kind", kind);
        client.DefaultRequestHeaders.Add("X-Test-Permissions", permission);
        client.DefaultRequestHeaders.Add("X-Test-Roles", role);
        using var response = await client.PostAsJsonAsync("/api/admin/staff/accounts", Input());
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Theory]
    [InlineData("access")]
    [InlineData("mfa_pending")]
    public async Task FullAccessAndMfaGrantsCannotUseInitialPasswordEndpoint(string kind)
    {
        using var host = new ApiFactory();
        using var client = host.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-Kind", kind);
        using var response = await client.PostAsJsonAsync("/api/auth/staff/password", new ChangeInitialStaffPasswordInput("Another-Synthetic-Secret-47!"));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }
}
