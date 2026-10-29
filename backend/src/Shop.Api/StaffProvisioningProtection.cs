using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.DataProtection;
using Shop.Modules.Identity;

public sealed class StaffProvisioningProtection(IDataProtectionProvider provider) : IStaffProvisioningProtection
{
    private static readonly UTF8Encoding Utf8 = new(false, true);
    private IDataProtector Purpose(string actor, string command, string kind)
    {
        StaffFilter.Id(actor);
        StaffProvisioningRules.CommandId(command);
        if (kind is not ("fingerprint" or "receipt")) throw new ArgumentException("Unknown staff envelope purpose.");
        return provider.CreateProtector("Sayman.Identity.StaffCreation.v1", actor, command, kind);
    }
    public byte[] Protect(string actorId, string requestId, string kind, string value)
    {
        var bytes = Utf8.GetBytes(value);
        try {
            if (bytes.Length is < 1 or > 12000) throw new CryptographicException("Staff envelope is outside its bounds.");
            return Purpose(actorId, requestId, kind).Protect(bytes);
        } finally { CryptographicOperations.ZeroMemory(bytes); }
    }
    public string Unprotect(string actorId, string requestId, string kind, byte[] value)
    {
        if (value is null || value.Length is < 1 or > 16384) throw new CryptographicException("Staff envelope is outside its bounds.");
        var bytes = Purpose(actorId, requestId, kind).Unprotect(value);
        try {
            if (bytes.Length is < 1 or > 12000) throw new CryptographicException("Staff envelope is outside its bounds.");
            return Utf8.GetString(bytes);
        } finally { CryptographicOperations.ZeroMemory(bytes); }
    }
}
