using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Sales;
public sealed class CustomerAddressBook
{
    public string OwnerId { get; set; } = "";
    public long Revision { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
public sealed class CustomerAddress
{
    public string Id { get; set; } = "";
    public string OwnerId { get; set; } = "";
    public string ProtectedData { get; set; } = "";
    public bool IsDefault { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public byte[] Version { get; set; } = [];
}
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
public sealed record SaveAddressInput(string Label, string ContactName, string ContactPhone, OrderAddressInput Delivery, bool? MakeDefault, string? Version);
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
public sealed record DeleteAddressInput(string Version);
public sealed record SavedAddressData(string Id, string Label, string ContactName, string ContactPhone, OrderAddressInput Delivery, bool IsDefault, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt, string Version);
public sealed record AddressBookData(int SchemaVersion, int Capacity, SavedAddressData[] Items);
public sealed record SaveAddressResult(int SchemaVersion, SavedAddressData Address, bool Replayed);
public interface IAddressProtection
{
    string Protect(string ownerId, string addressId, string plaintext);
    string Unprotect(string ownerId, string addressId, string ciphertext);
}
public interface IAddressBook
{
    Task<AddressBookData> ReadAsync(string ownerId, CancellationToken ct);
    Task<SaveAddressResult> SaveAsync(string ownerId, string id, SaveAddressInput input, CancellationToken ct);
    Task DeleteAsync(string ownerId, string id, DeleteAddressInput input, CancellationToken ct);
}
public static class AddressBookRules
{
    public const int Capacity = 20;
    public static string Id(string? value) { try { return OrderInputRules.Uuid(value); } catch (BusinessException) { throw Invalid(); } }
    public static SaveAddressInput Normalize(SaveAddressInput input)
    {
        try {
            if (input.MakeDefault is null || input.Delivery is null) throw Invalid();
            var label = input.Label?.Normalize(NormalizationForm.FormKC).Trim();
            if (label is null || label.Length is < 1 or > 60 || label.Any(char.IsControl)) throw Invalid();
            if (input.Version is not null) Version(input.Version);
            var contact = OrderInputRules.NormalizeContact(input.ContactName, input.ContactPhone, input.Delivery);
            return new(label, contact.Name, contact.Phone, contact.Delivery!, input.MakeDefault, input.Version);
        } catch (BusinessException e) when (e.Code == "invalid_order") { throw Invalid(); }
        catch (ArgumentException) { throw Invalid(); }
    }
    public static byte[] Version(string? value)
    {
        try { if (value is not { Length: 12 }) throw Invalid(); var bytes = Convert.FromBase64String(value); return bytes.Length == 8 ? bytes : throw Invalid(); }
        catch (FormatException) { throw Invalid(); }
    }
    public static BusinessException Invalid() => new("invalid_address", "Provide a label, bounded recipient details, an Iranian delivery address and the current version.");
}
public sealed class AddressBookService(SalesDbContext db, IAddressProtection protection, TimeProvider time) : IAddressBook
{
    private sealed record AddressPayload(int SchemaVersion, string Label, string ContactName, string ContactPhone, OrderAddressInput Delivery, string CreateFingerprint);
    private static readonly JsonSerializerOptions Json = new() { MaxDepth = 8, UnmappedMemberHandling = System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow };
    private static string Owner(string owner) => OrderInputRules.Identifier(owner);
    private static string Fingerprint(SaveAddressInput input) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(input with { Version = null }, Json))));
    private AddressPayload Payload(CustomerAddress row)
    {
        try {
            if (row.ProtectedData.Length is < 1 or > 32768) throw new CryptographicException();
            var text = protection.Unprotect(row.OwnerId, row.Id, row.ProtectedData);
            if (text.Length > 32768) throw new CryptographicException();
            var value = JsonSerializer.Deserialize<AddressPayload>(text, Json) ?? throw new CryptographicException();
            if (value.SchemaVersion != 1 || value.CreateFingerprint is not { Length: 64 } || value.CreateFingerprint.Any(c => !char.IsAsciiHexDigit(c))) throw new CryptographicException();
            var canonical = AddressBookRules.Normalize(new(value.Label, value.ContactName, value.ContactPhone, value.Delivery, false, null));
            if (canonical.Label != value.Label || canonical.ContactName != value.ContactName || canonical.ContactPhone != value.ContactPhone || canonical.Delivery != value.Delivery) throw new CryptographicException();
            return value;
        } catch (Exception e) when (e is CryptographicException or JsonException or BusinessException or ArgumentException) { throw new BusinessException("address_unavailable", "Saved address data could not be read. No replacement data was returned."); }
    }
    private SavedAddressData Data(CustomerAddress row)
    {
        var value = Payload(row);
        return new(row.Id, value.Label, value.ContactName, value.ContactPhone, value.Delivery, row.IsDefault, row.CreatedAt, row.UpdatedAt, Convert.ToBase64String(row.Version));
    }
    public async Task<AddressBookData> ReadAsync(string ownerId, CancellationToken ct)
    {
        Owner(ownerId);
        var rows = await db.Addresses.AsNoTracking().Where(x => x.OwnerId == ownerId).OrderByDescending(x => x.IsDefault).ThenByDescending(x => x.CreatedAt).ThenBy(x => x.Id).Take(AddressBookRules.Capacity + 1).ToArrayAsync(ct);
        if (rows.Length > AddressBookRules.Capacity || rows.Length > 0 && rows.Count(x => x.IsDefault) != 1) throw new BusinessException("address_unavailable", "The address book exceeds its capacity or its default is inconsistent.");
        return new(1, AddressBookRules.Capacity, rows.Select(Data).ToArray());
    }
    private async Task<CustomerAddressBook> LockAsync(string ownerId, CancellationToken ct)
    {
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT [OwnerId] FROM [sales].[AddressBooks] WITH (UPDLOCK,HOLDLOCK) WHERE [OwnerId]={ownerId}", ct);
        var book = await db.AddressBooks.SingleOrDefaultAsync(x => x.OwnerId == ownerId, ct);
        if (book is null) { book = new() { OwnerId = ownerId, UpdatedAt = time.GetUtcNow() }; db.AddressBooks.Add(book); await db.SaveChangesAsync(ct); }
        return book;
    }
    public async Task<SaveAddressResult> SaveAsync(string ownerId, string id, SaveAddressInput input, CancellationToken ct)
    {
        Owner(ownerId); id = AddressBookRules.Id(id); input = AddressBookRules.Normalize(input);
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var book = await LockAsync(ownerId, ct);
        var row = await db.Addresses.SingleOrDefaultAsync(x => x.OwnerId == ownerId && x.Id == id, ct);
        var fingerprint = Fingerprint(input);
        if (row is not null && input.Version is null) {
            var current = Payload(row);
            if (current.CreateFingerprint != fingerprint || current.Label != input.Label || current.ContactName != input.ContactName || current.ContactPhone != input.ContactPhone || current.Delivery != input.Delivery) throw Conflict();
            return new(1, Data(row), true);
        }
        var count = await db.Addresses.CountAsync(x => x.OwnerId == ownerId, ct);
        if (row is null) {
            if (input.Version is not null) throw new BusinessException("not_found", "This saved address was not found.");
            if (count >= AddressBookRules.Capacity) throw new BusinessException("address_limit", "The address book is full. Edit or remove an existing address first.");
            row = new() { Id = id, OwnerId = ownerId, CreatedAt = time.GetUtcNow(), IsDefault = count == 0 }; db.Addresses.Add(row);
        } else if (!row.Version.SequenceEqual(AddressBookRules.Version(input.Version))) throw Conflict();
        var createFingerprint = db.Entry(row).State == EntityState.Added ? fingerprint : Payload(row).CreateFingerprint;
        var changedAt = time.GetUtcNow();
        if (input.MakeDefault == true && !row.IsDefault) {
            await db.Addresses.Where(x => x.OwnerId == ownerId && x.IsDefault).ExecuteUpdateAsync(s => s.SetProperty(x => x.IsDefault, false).SetProperty(x => x.UpdatedAt, changedAt), ct);
            row.IsDefault = true;
        }
        var value = new AddressPayload(1, input.Label, input.ContactName, input.ContactPhone, input.Delivery, createFingerprint);
        row.ProtectedData = protection.Protect(ownerId, id, JsonSerializer.Serialize(value, Json));
        if (row.ProtectedData.Length > 32768) throw AddressBookRules.Invalid();
        row.UpdatedAt = changedAt; book.UpdatedAt = row.UpdatedAt; book.Revision = checked(book.Revision + 1);
        await db.SaveChangesAsync(ct); await transaction.CommitAsync(ct);
        return new(1, Data(row), false);
    }
    public async Task DeleteAsync(string ownerId, string id, DeleteAddressInput input, CancellationToken ct)
    {
        Owner(ownerId); id = AddressBookRules.Id(id); var version = AddressBookRules.Version(input.Version);
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var book = await LockAsync(ownerId, ct);
        var row = await db.Addresses.SingleOrDefaultAsync(x => x.OwnerId == ownerId && x.Id == id, ct);
        if (row is null) throw new BusinessException("not_found", "This saved address was not found.");
        if (!row.Version.SequenceEqual(version)) throw Conflict();
        var wasDefault = row.IsDefault; db.Addresses.Remove(row); await db.SaveChangesAsync(ct);
        if (wasDefault) {
            var next = await db.Addresses.Where(x => x.OwnerId == ownerId).OrderBy(x => x.CreatedAt).ThenBy(x => x.Id).FirstOrDefaultAsync(ct);
            if (next is not null) { next.IsDefault = true; next.UpdatedAt = time.GetUtcNow(); }
        }
        book.Revision = checked(book.Revision + 1); book.UpdatedAt = time.GetUtcNow();
        await db.SaveChangesAsync(ct); await transaction.CommitAsync(ct);
    }
    private static BusinessException Conflict() => new("address_version_conflict", "This address changed or its creation request was reused. Reload before saving.");
}
