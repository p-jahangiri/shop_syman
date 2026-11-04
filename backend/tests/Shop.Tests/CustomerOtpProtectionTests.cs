using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;
using Xunit;

namespace Shop.Tests;

public sealed class CustomerOtpProtectionTests
{
    [Theory]
    [InlineData("key")]
    [InlineData("fingerprint")]
    [InlineData("receipt")]
    [InlineData("otp-code")]
    public void EnvelopesRoundTripOnlyInTheirPurposeAndRevision(string purpose)
    {
        var protection = new DataProtectionCustomerOtpProtection(new EphemeralDataProtectionProvider());
        var envelope = protection.Protect(purpose, "synthetic-revision-one", "synthetic-value-001234");
        Assert.Equal("synthetic-value-001234", protection.Unprotect(purpose, "synthetic-revision-one", envelope));
        Assert.Throws<CryptographicException>(() => protection.Unprotect(purpose, "synthetic-revision-two", envelope));
        var other = purpose == "key" ? "otp-code" : "key";
        Assert.Throws<CryptographicException>(() => protection.Unprotect(other, "synthetic-revision-one", envelope));
        envelope[^1] ^= 1;
        Assert.Throws<CryptographicException>(() => protection.Unprotect(purpose, "synthetic-revision-one", envelope));
    }

    [Fact]
    public void AnotherKeyRingCannotOpenTheEnvelope()
    {
        var first = new DataProtectionCustomerOtpProtection(new EphemeralDataProtectionProvider());
        var second = new DataProtectionCustomerOtpProtection(new EphemeralDataProtectionProvider());
        var envelope = first.Protect("key", "synthetic-revision", "synthetic-api-key");
        Assert.Throws<CryptographicException>(() => second.Unprotect("key", "synthetic-revision", envelope));
    }

    [Fact]
    public void UnboundedOrUnrecognizedEnvelopesAreRejectedWithoutExposingTheirContents()
    {
        var protection = new DataProtectionCustomerOtpProtection(new EphemeralDataProtectionProvider());
        Assert.Throws<CryptographicException>(() => protection.Protect("unknown", "revision", "synthetic-secret"));
        Assert.Throws<CryptographicException>(() => protection.Protect("key", "bad\nbinding", "synthetic-secret"));
        Assert.Throws<CryptographicException>(() => protection.Protect("key", "revision", new string('x', 24577)));
        Assert.Throws<CryptographicException>(() => protection.Unprotect("key", "revision", new byte[32769]));
    }

}
