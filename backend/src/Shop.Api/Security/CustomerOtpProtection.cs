using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.DataProtection;
using Shop.SharedKernel;

public sealed class DataProtectionCustomerOtpProtection(IDataProtectionProvider provider) : ICustomerOtpProtection
{
    private const int PlaintextLimit = 24 * 1024;
    private const int EnvelopeLimit = 32 * 1024;
    private static readonly UTF8Encoding Utf8 = new(false, true);

    private IDataProtector Protector(string purpose, string binding)
    {
        if (purpose is not ("key" or "fingerprint" or "receipt" or "otp-code")
            || binding is not { Length: > 0 and <= 256 } || binding.Any(char.IsControl))
            throw new CryptographicException("The customer authentication envelope is unavailable.");
        return provider.CreateProtector("Sayman.Identity.CustomerOtp.v1", purpose, binding);
    }

    public byte[] Protect(string purpose, string binding, string value)
    {
        var protector = Protector(purpose, binding);
        var bytes = Utf8.GetBytes(value);
        try
        {
            if (bytes.Length is < 1 or > PlaintextLimit)
                throw new CryptographicException("The customer authentication envelope is unavailable.");
            return protector.Protect(bytes);
        }
        finally { CryptographicOperations.ZeroMemory(bytes); }
    }

    public string Unprotect(string purpose, string binding, byte[] value)
    {
        if (value is not { Length: > 0 and <= EnvelopeLimit })
            throw new CryptographicException("The customer authentication envelope is unavailable.");
        var bytes = Protector(purpose, binding).Unprotect(value);
        try
        {
            if (bytes.Length is < 1 or > PlaintextLimit)
                throw new CryptographicException("The customer authentication envelope is unavailable.");
            return Utf8.GetString(bytes);
        }
        finally { CryptographicOperations.ZeroMemory(bytes); }
    }
}
