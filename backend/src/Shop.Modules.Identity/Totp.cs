using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
namespace Shop.Modules.Identity;
public static class Totp
{
    public static string Code(string base32Secret, long step)
    {
        const string alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        var secret = new List<byte>(); var buffer = 0; var bits = 0;
        foreach (var c in base32Secret.TrimEnd('=').ToUpperInvariant()) {
            var value = alphabet.IndexOf(c); if (value < 0) throw new ArgumentException("Invalid authenticator key.", nameof(base32Secret));
            buffer = (buffer << 5) | value; bits += 5;
            if (bits >= 8) { bits -= 8; secret.Add((byte)(buffer >> bits)); buffer &= (1 << bits) - 1; }
        }
        Span<byte> counter = stackalloc byte[8]; BinaryPrimitives.WriteInt64BigEndian(counter, step);
        var hash = HMACSHA1.HashData(secret.ToArray(), counter); var offset = hash[^1] & 15;
        var binary = BinaryPrimitives.ReadInt32BigEndian(hash.AsSpan(offset, 4)) & 0x7fffffff;
        return (binary % 1000000).ToString("D6", System.Globalization.CultureInfo.InvariantCulture);
    }
    public static long? MatchingStep(string secret, string code, DateTimeOffset now)
    {
        var step = now.ToUnixTimeSeconds() / 30;
        foreach (var offset in new[] { 0, -1, 1, -2, 2 }) if (CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(Code(secret, step + offset)), Encoding.ASCII.GetBytes(code))) return step + offset;
        return null;
    }
}
