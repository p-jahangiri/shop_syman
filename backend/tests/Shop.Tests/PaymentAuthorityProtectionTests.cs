using Microsoft.AspNetCore.DataProtection;
using Shop.SharedKernel;
using Xunit;
namespace Shop.Tests;
public sealed class PaymentAuthorityProtectionTests
{
    [Fact]public void RemoteAuthorityIsEncryptedAndBoundToTheOriginalAttemptAndKeyRing()
    {
        var service=new DataProtectionPaymentAuthorityProtection(new EphemeralDataProtectionProvider());var attempt=new string('a',32);const string remote="synthetic-remote-authority";var value=service.Protect(attempt,remote);Assert.DoesNotContain(remote,System.Text.Encoding.UTF8.GetString(value));Assert.Equal(remote,service.Unprotect(attempt,value));Assert.Throws<BusinessException>(()=>service.Unprotect(new string('b',32),value));value[^1]^=1;Assert.Throws<BusinessException>(()=>service.Unprotect(attempt,value));
    }
}
