using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.DataProtection;
using Shop.Modules.Support;
public sealed class DataProtectionTicketProtection(IDataProtectionProvider provider) : ITicketProtection
{
    private IDataProtector Protector(string ticketId, string kind, string recordId)
    {
        TicketRules.Id(ticketId);
        if (kind is not ("subject" or "message" or "receipt") || string.IsNullOrEmpty(recordId) || recordId.Length > 100) throw TicketRules.Unavailable();
        return provider.CreateProtector("Sayman.Support.PrivateContent.v1", ticketId, kind, recordId);
    }
    public byte[] Protect(string ticketId, string kind, string recordId, string text)
    {
        var raw = new UTF8Encoding(false, true).GetBytes(text); if (raw.Length is < 1 or > 32000) throw TicketRules.Unavailable();
        var value = Protector(ticketId, kind, recordId).Protect(raw); if (value.Length > 65536) throw TicketRules.Unavailable(); return value;
    }
    public string Unprotect(string ticketId, string kind, string recordId, byte[] protectedText)
    {
        try { if (protectedText is null || protectedText.Length is < 1 or > 65536) throw TicketRules.Unavailable(); var raw = Protector(ticketId, kind, recordId).Unprotect(protectedText); if (raw.Length is < 1 or > 32000) throw TicketRules.Unavailable(); return new UTF8Encoding(false, true).GetString(raw); }
        catch (Exception e) when (e is CryptographicException or DecoderFallbackException or ArgumentException) { throw TicketRules.Unavailable(); }
    }
}
