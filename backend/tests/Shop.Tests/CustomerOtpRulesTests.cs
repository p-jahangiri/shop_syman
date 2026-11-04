using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Identity;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class CustomerOtpRulesTests
{
    [Theory]
    [InlineData("09120000000")]
    [InlineData("+989120000000")]
    [InlineData("00989120000000")]
    [InlineData("989120000000")]
    [InlineData("۰۹۱۲۰۰۰۰۰۰۰")]
    [InlineData("٠٩١٢٠٠٠٠٠٠٠")]
    [InlineData("  +۹۸۹۱۲۰۰۰۰۰۰۰  ")]
    public void EquivalentSupportedNumbersHaveOneCanonicalIdentity(string value)
        => Assert.Equal("+989120000000", CustomerOtpRules.NormalizePhone(value));

    [Theory]
    [InlineData(null)] [InlineData("")] [InlineData("9120000000")]
    [InlineData("+98912000000")] [InlineData("+9891200000000")]
    [InlineData("+982120000000")] [InlineData("0912 0000000")]
    [InlineData("0912-000-0000")] [InlineData("(0912)0000000")]
    [InlineData("+98912000000x")] [InlineData("+98912000000\u202e")]
    [InlineData("+98912000000\n0")]
    public void UnsupportedNumbersFailWithoutReturningTheInput(string? value)
    {
        Assert.False(CustomerOtpRules.TryNormalizePhone(value, out var canonical));
        Assert.Empty(canonical);
        var error = Assert.Throws<BusinessException>(() => CustomerOtpRules.NormalizePhone(value));
        Assert.Equal("invalid_otp", error.Code);
        Assert.Equal("Check the mobile verification fields.", error.Message);
    }

    [Theory]
    [InlineData(null)] [InlineData("")] [InlineData("00000000000000000000000000000000")]
    [InlineData("ABCDEFABCDEFABCDEFABCDEFABCDEFAB")]
    [InlineData("12345678-1234-1234-1234-123456789012")]
    public void PublicCommandIdsAreNonemptyCanonicalLowercaseHex(string? value)
        => Assert.Throws<BusinessException>(() => CustomerOtpRules.Id(value));

    [Fact]
    public void CodesAreSixAsciiDigitsAndDtoHasNoPhoneCodeOrKey()
    {
        foreach (var code in Enumerable.Range(0, 64).Select(_ => CustomerOtpRules.NewCode()))
        {
            Assert.Equal(6, code.Length);
            Assert.All(code, c => Assert.InRange(c, '0', '9'));
        }
        var row = new CustomerOtpChallenge { CanonicalPhone = "+989120000000", ProtectedCode = [1, 2, 3],
            SettingsKeyRevision = "private-key-revision", CreatedAt = DateTimeOffset.UtcNow,
            ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(5), ResendAt = DateTimeOffset.UtcNow.AddMinutes(1), State = "Unknown" };
        var dto = CustomerOtpRules.Dto(row);
        Assert.Equal("unknown", dto.Delivery);
        var json = JsonSerializer.Serialize(dto);
        foreach (var field in new[] { "CanonicalPhone", "ProtectedCode", "SettingsKeyRevision", row.CanonicalPhone, row.SettingsKeyRevision })
            Assert.DoesNotContain(field, json);
        Assert.Equal("Customer OTP start [redacted]", new CustomerOtpStartInput(row.CanonicalPhone, row.Id).ToString());
        Assert.Equal("Customer OTP verification [redacted]", new CustomerOtpVerifyInput(row.Id, "001234").ToString());
    }

    private static CustomerSmsSettingsInput Settings() => new(null, Guid.NewGuid().ToString("N"),
        "smsIr", true, "live", 170274, "CODE", "NAME", "کاربر سایمان", "replace", "synthetic-key-only");

    [Fact]
    public void SandboxCannotBeMislabelledAsLiveOrAcceptedAsAProductionSetting()
    {
        var sandbox = Settings() with { Mode = "sandbox", TemplateId = 123456, CodeParameterName = "Code", NameParameterName = null, GenericName = "" };
        Assert.Equal(sandbox, CustomerSmsRules.Validate(sandbox, development: true));
        Assert.Throws<BusinessException>(() => CustomerSmsRules.Validate(sandbox, development: false));
        Assert.Throws<BusinessException>(() => CustomerSmsRules.Validate(sandbox with { Mode = "live" }, development: true));
        Assert.Throws<BusinessException>(() => CustomerSmsRules.Validate(sandbox with { TemplateId = 170274 }, development: true));
        Assert.False(CustomerSmsRules.LoginAvailable(new() { Enabled = true, Mode = "sandbox", TemplateId = 123456, ProtectedApiKey = [1] }));
        Assert.False(CustomerSmsRules.LoginAvailable(new() { Enabled = true, Mode = "live", TemplateId = 123456, ProtectedApiKey = [1] }));
    }

    [Fact]
    public void KeyOperationIsExplicitAndSettingsMetadataIsWriteOnlyForCredentials()
    {
        var input = Settings();
        Assert.Equal(input, CustomerSmsRules.Validate(input, true));
        Assert.Throws<BusinessException>(() => CustomerSmsRules.Validate(input with { ApiKeyAction = "keep" }, true));
        Assert.Throws<BusinessException>(() => CustomerSmsRules.Validate(input with { ApiKeyAction = "clear" }, true));
        Assert.Throws<BusinessException>(() => CustomerSmsRules.Validate(input with { ApiKey = null }, true));
        Assert.Throws<BusinessException>(() => CustomerSmsRules.Validate(input with { NameParameterName = "code" }, true));
        Assert.Equal("Customer SMS settings input [redacted]", input.ToString());
        var dto = CustomerSmsRules.Dto(new() { Enabled = true, ProtectedApiKey = [1, 2, 3], KeyRevision = "private-revision" });
        Assert.True(dto.KeyConfigured);
        Assert.Equal("configured", dto.Availability);
        var json = JsonSerializer.Serialize(dto);
        foreach (var value in new[] { "ProtectedApiKey", "KeyRevision", "private-revision", input.ApiKey! }) Assert.DoesNotContain(value, json);
        Assert.Equal("unconfigured", CustomerSmsRules.Dto(null).Availability);
    }

    [Fact]
    public void CanonicalUniquenessAndProtectedPersistentChallengesAreRelational()
    {
        using var db = new IdentityDbContext(DesignTimeOptions.Create<IdentityDbContext>("identity"));
        var user = db.Model.FindEntityType(typeof(ShopUser))!;
        Assert.Contains(user.GetIndexes(), i => i.IsUnique && i.Properties.Select(p => p.Name).SequenceEqual(new[] { "CanonicalPhone" }));
        var challenge = db.Model.FindEntityType(typeof(CustomerOtpChallenge))!;
        Assert.Contains(challenge.GetIndexes(), i => i.IsUnique && i.Properties.Single().Name == "RequestId");
        Assert.True(challenge.FindProperty("Version")!.IsConcurrencyToken);
        Assert.DoesNotContain(challenge.GetProperties(), p => p.Name is "Code" or "ApiKey");
        Assert.Equal(System.Data.ConnectionState.Closed, db.Database.GetDbConnection().State);
    }
}
