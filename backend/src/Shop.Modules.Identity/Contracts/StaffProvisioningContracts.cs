using System.ComponentModel.DataAnnotations;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Identity;
using Shop.SharedKernel;

namespace Shop.Modules.Identity;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CreateStaffAccountInput(string RequestId, string UserName, string DisplayName,
    string InitialPassword, string[] Roles, string? Email = null);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ChangeInitialStaffPasswordInput(string NewPassword);
public sealed record StaffAccountCreated(int SchemaVersion, string RequestId, bool Replayed, StaffRow Staff);

public interface IStaffProvisioning
{
    Task<StaffAccountCreated> CreateAsync(string actorId, string stamp, CreateStaffAccountInput input, string traceId, CancellationToken ct);
    Task<StaffAccountCreated> ReceiptAsync(string actorId, string stamp, string requestId, CancellationToken ct);
}

public interface IStaffProvisioningProtection
{
    byte[] Protect(string actorId, string requestId, string kind, string value);
    string Unprotect(string actorId, string requestId, string kind, byte[] value);
}

public static partial class StaffProvisioningRules
{
    public static string CommandId(string value)
    {
        if (!Guid.TryParseExact(value, "D", out var id) || id == Guid.Empty || value != id.ToString("D")) throw Invalid();
        return value;
    }

    public static CreateStaffAccountInput Validate(CreateStaffAccountInput input)
    {
        CommandId(input.RequestId);
        if (input.UserName is null || !UserNamePattern().IsMatch(input.UserName)) throw Invalid();
        if (input.DisplayName is null || input.DisplayName.Length is < 1 or > 200 || input.DisplayName != input.DisplayName.Trim()
            || input.DisplayName.Any(c => char.IsControl(c) || c is '\u202a' or '\u202b' or '\u202c' or '\u202d' or '\u202e' or '\u2066' or '\u2067' or '\u2068' or '\u2069')) throw Invalid();
        Password(input.InitialPassword);
        var roles = StaffInput.Roles(input.Roles);
        if (input.Email is not null && (input.Email.Length is < 3 or > 256 || input.Email != input.Email.Trim()
            || input.Email.Any(char.IsControl) || !new EmailAddressAttribute().IsValid(input.Email))) throw Invalid();
        try { _ = new UTF8Encoding(false, true).GetByteCount(input.DisplayName + input.InitialPassword); }
        catch (EncoderFallbackException) { throw Invalid(); }
        return input with { UserName = input.UserName.ToLowerInvariant(), Roles = roles };
    }

    public static void Password(string value)
    {
        if (value is null || value.Length is < 12 or > 128 || value.Any(char.IsControl)) throw Invalid();
        try { _ = new UTF8Encoding(false, true).GetByteCount(value); }
        catch (EncoderFallbackException) { throw Invalid(); }
    }

    // This digest must only be stored inside the actor/command-bound protected envelope.
    public static string Fingerprint(CreateStaffAccountInput canonical)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(canonical);
        try { return Convert.ToHexString(SHA256.HashData(bytes)); }
        finally { CryptographicOperations.ZeroMemory(bytes); }
    }

    public static bool ManagedStaffContact(ShopUser user) => user.EmailConfirmed || user.PhoneNumberConfirmed || user.ProvisionedByAdministrator;
    private static BusinessException Invalid() => new("invalid_staff_account", "Check the username, display name, password, email and supported roles.");
    [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$", RegexOptions.CultureInvariant)]
    private static partial Regex UserNamePattern();
}

// Email is optional for a username-based staff account. When present it remains
// valid and unique; the filtered SQL unique index is the concurrent-write fence.
public sealed class OptionalIdentityEmailValidator : IUserValidator<ShopUser>
{
    public async Task<IdentityResult> ValidateAsync(UserManager<ShopUser> manager, ShopUser user)
    {
        if (user.Email is null) return IdentityResult.Success;
        if (user.Email.Length is < 3 or > 256 || !new EmailAddressAttribute().IsValid(user.Email))
            return IdentityResult.Failed(manager.ErrorDescriber.InvalidEmail(user.Email));
        var existing = await manager.FindByEmailAsync(user.Email);
        return existing is not null && existing.Id != user.Id
            ? IdentityResult.Failed(manager.ErrorDescriber.DuplicateEmail(user.Email))
            : IdentityResult.Success;
    }
}
