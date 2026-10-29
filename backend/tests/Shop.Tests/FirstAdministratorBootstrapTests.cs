using Microsoft.Extensions.Configuration;
using Shop.Modules.Identity;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class FirstAdministratorBootstrapTests
{
    private const string Password = "Synthetic-Bootstrap-Secret-47!";

    [Theory]
    [InlineData(null, null)]
    [InlineData("owner", null)]
    [InlineData(null, Password)]
    [InlineData("owner", "Short-Secret-1!")]
    public void PartialOrShortConfigurationFailsWithoutEchoingSecrets(string? name, string? password)
    {
        var error = Assert.Throws<InvalidOperationException>(() => FirstAdministratorRules.Validate(name, password, null));
        Assert.DoesNotContain(Password, error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void BootstrapUsesTheExistingStaffRulesWithoutInventingVerifiedContact()
    {
        var value = FirstAdministratorRules.Validate("OWNER", Password, null);
        Assert.Equal("owner", value.UserName);
        Assert.Equal(["Administrator"], value.Roles);
        Assert.Null(value.Email);
        Assert.Equal(Password, value.InitialPassword);
        Assert.Throws<BusinessException>(() => FirstAdministratorRules.Validate("bad@name", Password, null));
        Assert.Throws<BusinessException>(() => FirstAdministratorRules.Validate("owner", Password, "Bad\u202ename"));
        Assert.Throws<BusinessException>(() => FirstAdministratorRules.Validate("owner", new string('x', 129), null));
    }

    [Fact]
    public async Task MissingConfigurationFailsBeforeResolvingAnyDatabaseService()
    {
        await Assert.ThrowsAsync<InvalidOperationException>(() => FirstAdministratorCommand.RunAsync(
            new RejectServices(), new ConfigurationBuilder().Build(), ["--bootstrap-admin"], default));
    }

    [Theory]
    [InlineData("--migrate")]
    [InlineData("--seed-dev")]
    [InlineData("--Bootstrap:AdminPassword=must-not-be-an-argument")]
    public async Task OtherCommandsAndCredentialArgumentsCannotBeCombined(string argument)
    {
        await Assert.ThrowsAsync<InvalidOperationException>(() => FirstAdministratorCommand.RunAsync(
            new RejectServices(), new ConfigurationBuilder().Build(), ["--bootstrap-admin", argument], default));
    }

    private sealed class RejectServices : IServiceProvider
    {
        public object? GetService(Type type) => throw new Xunit.Sdk.XunitException("Bootstrap attempted to resolve " + type.Name);
    }
}
