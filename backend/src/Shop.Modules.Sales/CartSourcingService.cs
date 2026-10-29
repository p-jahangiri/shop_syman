using System.Data;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;

namespace Shop.Modules.Sales;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CartSourcingLineInput(string ListingId, int Quantity)
{
    [JsonIgnore(Condition=JsonIgnoreCondition.WhenWritingNull)]public string? ConfigurationId{get;init;}
}
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CartSourcingInput(CartSourcingLineInput[] Lines, string? Version);
public sealed record CartSourcingLineData(string ListingId, int Quantity, SourcingCandidate Candidate)
{
    [JsonIgnore(Condition=JsonIgnoreCondition.WhenWritingNull)]public string? ConfigurationId{get;init;}
}
public sealed record CartSourcingSnapshot(int SchemaVersion, string Locale, [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] string? Version, int Capacity, bool RequestOnly, bool CanPay, CartSourcingLineData[] Lines, bool HasIssues);

public sealed class CartSourcingService(SalesDbContext db, CartService carts, IMarketSourcingReader market) : ISourcingCart
{
    public const int Capacity = 24;
    private const int MaximumResponseBytes = 2 * 1024 * 1024;
    private static readonly JsonSerializerOptions ResponseJson = new(JsonSerializerDefaults.Web) { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull, Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping, MaxDepth = 32 };
    public async Task<CartSourcingSnapshot> ReadAsync(CartIdentity identity, string locale, CancellationToken ct)
    {
        CartService.ValidateIdentity(identity); CartService.ValidateLocale(locale); RequireParent();
        if (identity.OwnerId is null && identity.GuestToken is null) return Empty(locale);
        await carts.LockIdentityAsync(identity, false, ct);
        return await SnapshotAsync(await carts.FindAsync(identity, false, ct), locale, ct);
    }
    public async Task<CartSourcingSnapshot> ReplaceAsync(CartIdentity identity, string locale, CartSourcingInput input, CancellationToken ct)
    {
        CartService.ValidateIdentity(identity); CartService.ValidateLocale(locale); var lines = ValidateLines(input);
        if (identity.OwnerId is null && identity.GuestToken is null) throw new BusinessException("invalid_cart", "A guest session is required for cart changes.");
        RequireParent(); await carts.LockIdentityAsync(identity, true, ct);
        var cart = await carts.FindAsync(identity, true, ct);
        var old = cart?.SourcingLines.ToDictionary(x => x.ListingId, x => (x.Quantity,x.ConfigurationId), StringComparer.OrdinalIgnoreCase) ?? new Dictionary<string, (int Quantity,string? ConfigurationId)>(StringComparer.OrdinalIgnoreCase);
        // An unchanged body may be replayed without touching the shared revision,
        // but candidates are always freshly read so new issues remain visible.
        if (old.Count == lines.Length && lines.All(line => old.GetValueOrDefault(line.ListingId) == (line.Quantity,line.ConfigurationId))) return await SnapshotAsync(cart, locale, ct);
        if (input.Version != (cart is null ? null : Convert.ToBase64String(cart.Version))) throw new BusinessException("cart_version_conflict", "The cart changed. Reload before editing.");
        var candidates = await market.ReadConfiguredAsync(locale, lines.Select(x => x.ListingId).ToArray(),Configurations(lines),ct);
        foreach (var line in lines.Where(line => line.Quantity > old.GetValueOrDefault(line.ListingId).Quantity||line.ConfigurationId!=old.GetValueOrDefault(line.ListingId).ConfigurationId)) {
            var candidate = Candidate(line.ListingId, candidates);
            if(candidate.Issue=="phone_configuration_required")throw new BusinessException("phone_configuration_required","Choose the exact phone RAM, storage and color before adding this model.");
            if (candidate.Model?.HasAvailableStoreOffer == true || candidate.Issue == "now_in_store") throw new BusinessException("now_in_store", "This model now has an available store offer. Review it before requesting sourcing.");
            if (candidate.Model is null || candidate.Fingerprint is null || candidate.Issue is not null) throw new BusinessException("sourcing_unavailable", "A selected market model is no longer eligible for sourcing.");
        }
        if (cart is null) { cart = carts.NewCart(identity); db.Carts.Add(cart); }
        var incoming = lines.ToDictionary(x => x.ListingId, StringComparer.OrdinalIgnoreCase);
        foreach (var existing in cart.SourcingLines.ToArray()) {
            if (incoming.TryGetValue(existing.ListingId, out var line)) { existing.Quantity = line.Quantity;existing.ConfigurationId=line.ConfigurationId; incoming.Remove(existing.ListingId); }
            else { db.CartSourcingLines.Remove(existing); cart.SourcingLines.Remove(existing); }
        }
        foreach (var line in incoming.Values) cart.SourcingLines.Add(new() { CartId = cart.Id, ListingId = line.ListingId, Quantity = line.Quantity,ConfigurationId=line.ConfigurationId });
        carts.Touch(cart); await db.SaveChangesAsync(ct);
        return await SnapshotAsync(cart, locale, ct);
    }
    public async Task<SourcingCartContents> ReadForSubmissionAsync(string ownerId, CancellationToken ct)
    {
        var identity = Owner(ownerId); RequireParent(); await carts.LockIdentityAsync(identity, true, ct);
        var cart = await carts.FindAsync(identity, false, ct);
        if (cart is null) return new(null, null, []);
        EnsureCapacity(cart);
        return new(cart.Id, Convert.ToBase64String(cart.Version), cart.SourcingLines.OrderBy(x => x.ListingId, StringComparer.Ordinal).Select(x => new SourcingCartSelection(x.ListingId, x.Quantity){ConfigurationId=x.ConfigurationId}).ToArray());
    }
    public async Task ConsumeSourcingAsync(string ownerId, string version, CancellationToken ct)
    {
        var identity = Owner(ownerId); RequireParent(); await carts.LockIdentityAsync(identity, true, ct);
        var cart = await carts.FindAsync(identity, true, ct);
        if (cart is null || cart.SourcingLines.Count == 0 || Convert.ToBase64String(cart.Version) != version) throw new BusinessException("cart_version_conflict", "The cart changed before sourcing submission.");
        db.CartSourcingLines.RemoveRange(cart.SourcingLines); cart.SourcingLines.Clear(); carts.Touch(cart); await db.SaveChangesAsync(ct);
    }
    private async Task<CartSourcingSnapshot> SnapshotAsync(ShoppingCart? cart, string locale, CancellationToken ct)
    {
        if (cart is null) return Empty(locale);
        EnsureCapacity(cart);
        var candidates = await market.ReadConfiguredAsync(locale, cart.SourcingLines.Select(x => x.ListingId).ToArray(),cart.SourcingLines.Where(l=>l.ConfigurationId is not null).ToDictionary(l=>l.ListingId,l=>l.ConfigurationId!,StringComparer.OrdinalIgnoreCase),ct);
        var lines = cart.SourcingLines.OrderBy(x => x.ListingId, StringComparer.Ordinal).Select(line => new CartSourcingLineData(line.ListingId, line.Quantity, Candidate(line.ListingId, candidates)){ConfigurationId=line.ConfigurationId}).ToArray();
        var result = new CartSourcingSnapshot(1, locale, Convert.ToBase64String(cart.Version), Capacity, true, false, lines, lines.Any(line => line.Candidate.Issue is not null || line.Candidate.Model is null || line.Candidate.Model.HasAvailableStoreOffer));
        if (JsonSerializer.SerializeToUtf8Bytes(result, ResponseJson).Length > MaximumResponseBytes) throw new BusinessException("sourcing_capacity_unavailable", "The sourcing cart response exceeds its supported UTF-8 size. Split the selection or reduce its specifications before retrying.");
        return result;
    }
    private static SourcingCandidate Candidate(string id, IReadOnlyDictionary<string, SourcingCandidate> candidates)
    {
        if (candidates.TryGetValue(id, out var candidate) && string.Equals(candidate.ListingId, id, StringComparison.OrdinalIgnoreCase)) return candidate;
        return new(id, null, null, null, null, null, null, null, null, null, false, false, "unavailable");
    }
    private static CartSourcingLineInput[] ValidateLines(CartSourcingInput input)
    {
        if (input is null || input.Lines is null || input.Lines.Length > Capacity || input.Lines.Any(x => x is null || !Identifier(x.ListingId) || x.Quantity is < 1 or > 1000000)) throw new BusinessException("invalid_cart", "Provide up to 24 distinct market listings with bounded positive quantities.");
        var lines = input.Lines.Select(line => line with { ListingId = line.ListingId.ToLowerInvariant(),ConfigurationId=line.ConfigurationId is null?null:Identifier(line.ConfigurationId)?line.ConfigurationId.ToLowerInvariant():throw new BusinessException("invalid_cart","Use a valid phone configuration identifier.") }).ToArray();
        if (lines.Select(line => line.ListingId).Distinct(StringComparer.Ordinal).Count() != lines.Length) throw new BusinessException("invalid_cart", "Duplicate sourcing lines are not allowed.");
        return lines;
    }
    private static IReadOnlyDictionary<string,string> Configurations(CartSourcingLineInput[] lines)=>lines.Where(l=>l.ConfigurationId is not null).ToDictionary(l=>l.ListingId,l=>l.ConfigurationId!,StringComparer.OrdinalIgnoreCase);
    private static bool Identifier(string? id) => id is { Length: 32 } && id.All(char.IsAsciiHexDigit) && Guid.TryParseExact(id, "N", out var value) && value != Guid.Empty;
    private static CartIdentity Owner(string ownerId) { if (ownerId is null) throw new BusinessException("invalid_cart_session", "An owner is required for sourcing submission."); var identity = new CartIdentity(ownerId, null); CartService.ValidateIdentity(identity); return identity; }
    private static void EnsureCapacity(ShoppingCart cart) { if (cart.SourcingLines.Count > Capacity) throw new BusinessException("cart_limit", "The sourcing cart exceeds its supported capacity."); }
    private static CartSourcingSnapshot Empty(string locale) => new(1, locale, null, Capacity, true, false, [], false);
    private void RequireParent() { if (db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel != IsolationLevel.Serializable) throw new InvalidOperationException("Sourcing carts require the root Serializable transaction."); }
}
