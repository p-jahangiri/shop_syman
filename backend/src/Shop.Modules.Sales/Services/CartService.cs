using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;

namespace Shop.Modules.Sales;

public sealed class CartService(SalesDbContext db, ICartCatalogReader catalog, IInventoryReader inventory, TimeProvider clock)
{
    private IMarketSourcingReader? sourcingReader;
    public CartService(SalesDbContext db,ICartCatalogReader catalog,IInventoryReader inventory,TimeProvider clock,IMarketSourcingReader sourcing):this(db,catalog,inventory,clock){sourcingReader=sourcing;}
    public static string CreateGuestToken() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    public static bool ValidGuestToken(string? token) => token is { Length: 43 } && token.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_');
    internal static string ActorKey(CartIdentity identity) { ValidateIdentity(identity); return Hash(Key(identity)); }
    internal static string LockResource(CartIdentity identity) => "sayman:sales:cart:" + ActorKey(identity);
    internal Task LockIdentityAsync(CartIdentity identity, bool exclusive, CancellationToken ct) { ValidateIdentity(identity); return LockAsync(Key(identity), exclusive, ct); }
    internal async Task LockForCheckoutAsync(string ownerId, CancellationToken ct)
    {
        var identity = new CartIdentity(ownerId, null); ValidateIdentity(identity);
        if (db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel != IsolationLevel.Serializable) throw new InvalidOperationException("Checkout requires a Serializable parent transaction.");
        await LockAsync(Key(identity), true, ct);
    }
    internal async Task ConsumeAsync(string ownerId, string version, CancellationToken ct)
    {
        await LockForCheckoutAsync(ownerId, ct); var cart = await FindAsync(new(ownerId, null), true, ct);
        EnsureV1(cart);
        if (cart is null || Convert.ToBase64String(cart.Version) != version) throw new BusinessException("cart_version_conflict", "The cart changed before order creation.");
        db.CartLines.RemoveRange(cart.Lines); cart.Lines.Clear(); Touch(cart); await db.SaveChangesAsync(ct);
    }
    internal async Task ConsumePurchasesV2Async(string ownerId,string version,QuoteLineV5Data[] lines,CancellationToken ct)
    {
        CartOfferRules.RequireParent(db);await LockForCheckoutAsync(ownerId,ct);
        var cart=await FindAsync(new(ownerId,null),true,ct);EnsureCapacity(cart);
        if(cart is null||Convert.ToBase64String(cart.Version)!=version)throw new BusinessException("cart_version_conflict","The cart changed before order creation.");
        var expected=cart.Lines.Select(l=>new{Id=CartOfferRules.OrdinaryLineId(cart.Id,l.VariantId),l.VariantId,l.Quantity}).Concat(cart.OfferLines.Select(l=>new{Id=l.Id,l.VariantId,l.Quantity})).ToArray();
        if(lines is not {Length:>0 and <=64}||expected.Length!=lines.Length||lines.Select(l=>l.LineId).Distinct(StringComparer.Ordinal).Count()!=lines.Length||lines.Any(l=>!expected.Any(e=>e.Id==l.LineId&&e.VariantId.Equals(l.VariantId,StringComparison.OrdinalIgnoreCase)&&e.Quantity==l.Quantity)))throw new BusinessException("cart_version_conflict","The exact purchase selection changed before order creation.");
        db.CartLines.RemoveRange(cart.Lines);db.CartOfferLines.RemoveRange(cart.OfferLines);cart.Lines.Clear();cart.OfferLines.Clear();
        // Independent sourcing enquiries remain in this same cart/version.
        Touch(cart);await db.SaveChangesAsync(ct);
    }
    internal async Task<(string? Id, string? Version, CartLineInput[] Lines)> ReadContentsAsync(CartIdentity identity, CancellationToken ct)
    {
        ValidateIdentity(identity);
        if (identity.OwnerId is null && identity.GuestToken is null) return (null, null, []);
        await using var transaction = db.Database.CurrentTransaction is null ? await BeginAsync(ct) : null;
        if (db.Database.CurrentTransaction!.GetDbTransaction().IsolationLevel is not (IsolationLevel.ReadCommitted or IsolationLevel.Serializable)) throw new InvalidOperationException("Cart reads require ReadCommitted or Serializable isolation.");
        await LockAsync(Key(identity), false, ct); var cart = await FindAsync(identity, false, ct);
        EnsureV1(cart);
        var result = (cart?.Id, cart is null ? null : Convert.ToBase64String(cart.Version), cart?.Lines.OrderBy(x => x.VariantId, StringComparer.Ordinal).Select(x => new CartLineInput(x.VariantId, x.Quantity)).ToArray() ?? []);
        if (transaction is not null) await transaction.CommitAsync(ct); return result;
    }
    public async Task<CartSnapshot> ReadAsync(CartIdentity identity, string locale, CancellationToken ct)
    {
        ValidateIdentity(identity); ValidateLocale(locale);
        if (identity.OwnerId is null && identity.GuestToken is null) return Empty(locale);
        await using var transaction = await BeginAsync(ct); await LockAsync(Key(identity), false, ct);
        var cart = await FindAsync(identity, false, ct); var result = await SnapshotAsync(cart, locale, ct);
        await transaction.CommitAsync(ct); return result;
    }
    public async Task<CartSnapshot> ReplaceAsync(CartIdentity identity, string locale, CartInput input, CancellationToken ct)
    {
        ValidateIdentity(identity); ValidateLocale(locale); ValidateLines(input.Lines);
        if (identity.OwnerId is null && identity.GuestToken is null) throw new BusinessException("invalid_cart", "A guest session is required for cart changes.");
        await using var transaction = await BeginAsync(ct);
        var cart = await ReplaceInTransactionAsync(identity, locale, input, false, ct);
        var result = await SnapshotAsync(cart, locale, ct); await transaction.CommitAsync(ct); return result;
    }
    // Join-parent cores never start/commit a second transaction. V2 callers
    // resolve agreement/allocation reads before entering ordinary Stock reads.
    internal async Task<ShoppingCart> ReplaceInTransactionAsync(CartIdentity identity, string locale, CartInput input, bool allowOfferLines, CancellationToken ct)
    {
        RequireParent(); ValidateIdentity(identity); ValidateLocale(locale); var lines = ValidateLines(input.Lines);
        if (identity.OwnerId is null && identity.GuestToken is null) throw new BusinessException("invalid_cart", "A guest session is required for cart changes.");
        await LockIdentityAsync(identity, true, ct); var cart = await FindAsync(identity, true, ct);
        if (!allowOfferLines) EnsureV1(cart); EnsureCapacity(cart, lines.Length);
        CartOfferRules.EnsureSkuCapacity(lines.Select(l=>(l.VariantId,l.Quantity)).Concat((cart?.OfferLines??[]).Select(l=>(l.VariantId,l.Quantity))));
        // Legacy no-op replay must not bypass the V1 upgrade gate above.
        if (cart is not null && Same(cart.Lines, lines)) return cart;
        if (input.Version != (cart is null ? null : Convert.ToBase64String(cart.Version))) throw new BusinessException("cart_version_conflict", "The cart changed. Reload before editing.");
        var old = cart?.Lines.ToDictionary(x => x.VariantId, x => x.Quantity, StringComparer.OrdinalIgnoreCase) ?? new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var variants = await catalog.ReadCartVariantsAsync(locale, lines.Select(x => x.VariantId).ToArray(), ct);
        var available = await inventory.AvailableAsync(lines.Select(x => x.VariantId), ct);
        foreach (var line in lines.Where(x => x.Quantity > old.GetValueOrDefault(x.VariantId))) {
            if (!variants.ContainsKey(line.VariantId)) throw new BusinessException("cart_variant_unavailable", "A requested variant is no longer available.");
            if (available.GetValueOrDefault(line.VariantId) < line.Quantity) throw new BusinessException("insufficient_stock", "A requested quantity exceeds current stock. Reload the cart.");
        }
        EnsureBoundedAmount(lines, variants);
        if (cart is null) { cart = NewCart(identity); db.Carts.Add(cart); }
        var incoming = lines.ToDictionary(x => x.VariantId, StringComparer.OrdinalIgnoreCase);
        foreach (var existing in cart.Lines.ToArray()) {
            if (incoming.TryGetValue(existing.VariantId, out var line)) { existing.Quantity = line.Quantity; incoming.Remove(existing.VariantId); }
            else { db.CartLines.Remove(existing); cart.Lines.Remove(existing); }
        }
        foreach (var line in incoming.Values) cart.Lines.Add(new() { CartId = cart.Id, VariantId = line.VariantId, Quantity = line.Quantity });
        Touch(cart); await db.SaveChangesAsync(ct); return cart;
    }
    public async Task<CartSnapshot> MergeAsync(string ownerId, string? guestToken, string locale, CancellationToken ct)
    {
        var member = new CartIdentity(ownerId, null); ValidateIdentity(member); ValidateLocale(locale);
        if (guestToken is null) return await ReadAsync(member, locale, ct);
        ValidateIdentity(new(null, guestToken)); await using var transaction = await BeginAsync(ct);
        var cart = await MergeInTransactionAsync(ownerId, guestToken, locale, false, ct);
        var result = await SnapshotAsync(cart, locale, ct); await transaction.CommitAsync(ct); return result;
    }
    internal async Task<ShoppingCart?> MergeInTransactionAsync(string ownerId, string? guestToken, string locale, bool allowOfferLines, CancellationToken ct)
    {
        RequireParent(); var member = new CartIdentity(ownerId, null); ValidateIdentity(member); ValidateLocale(locale);
        if (guestToken is null) { await LockIdentityAsync(member, false, ct); var current = await FindAsync(member, true, ct); if (!allowOfferLines) EnsureV1(current); EnsureCapacity(current); return current; }
        var guestIdentity = new CartIdentity(null, guestToken); ValidateIdentity(guestIdentity);
        foreach (var key in new[] { Key(member), Key(guestIdentity) }.Order(StringComparer.Ordinal)) await LockAsync(key, true, ct);
        var cart = await FindAsync(member, true, ct);
        // Both identity domains are exclusively locked above. A merged guest
        // is read here deliberately so its existing merge receipt still works;
        // normal FindAsync continues to reject that consumed guest session.
        var guest = await ReadLockedCartAsync(guestIdentity,true,ct);
        if (guest is null || guest.GuestExpiresAt <= clock.GetUtcNow()) throw new BusinessException("cart_session_expired", "The guest cart session is unavailable.");
        if (!allowOfferLines) { EnsureV1(cart); EnsureV1(guest); }
        if (guest.OfferLines.Count != 0) throw new BusinessException("cart_offer_owner_conflict", "A guest cart cannot carry or transfer an accepted price agreement.");
        EnsureCapacity(cart); EnsureCapacity(guest);
        if (guest.MergedIntoCartId is not null) {
            if (guest.MergedIntoCartId != cart?.Id) throw new BusinessException("cart_session_expired", "The guest cart session is unavailable.");
            return cart;
        }
        var quantities = (cart?.Lines ?? []).Concat(guest.Lines).GroupBy(x => x.VariantId, StringComparer.OrdinalIgnoreCase).Select(g => new CartLineInput(g.Key, checked(g.Sum(x => (long)x.Quantity)) is var n && n <= 1000000 ? (int)n : throw new BusinessException("cart_limit", "Merged quantities exceed the cart limit."))).ToArray();
        EnsureCapacity(cart, quantities.Length);
        CartOfferRules.EnsureSkuCapacity(quantities.Select(l=>(l.VariantId,l.Quantity)).Concat((cart?.OfferLines??[]).Select(l=>(l.VariantId,l.Quantity))));
        var sourcingGroups=(cart?.SourcingLines??[]).Concat(guest.SourcingLines).GroupBy(x=>x.ListingId,StringComparer.OrdinalIgnoreCase).ToArray();
        if(sourcingGroups.Any(g=>g.Select(l=>l.ConfigurationId).Distinct(StringComparer.OrdinalIgnoreCase).Count()>1))throw new BusinessException("cart_phone_configuration_conflict","The two carts select different configurations of the same phone. Review a cart before merging; both carts were preserved.");
        var sourcing = sourcingGroups.Select(g => new SourcingCartSelection(g.Key, g.Sum(x => (long)x.Quantity) is var n && n <= 1000000 ? (int)n : throw new BusinessException("cart_limit", "Merged sourcing quantities exceed the cart limit.")){ConfigurationId=g.First().ConfigurationId}).ToArray();
        if (sourcing.Length > 24) throw new BusinessException("cart_limit", "Merge exceeds 24 sourcing lines. Edit a cart before merging.");
        if(sourcingReader is not null&&sourcing.Length>0){var candidates=await sourcingReader.ReadConfiguredAsync(locale,sourcing.Select(line=>line.ListingId).ToArray(),sourcing.Where(line=>line.ConfigurationId is not null).ToDictionary(line=>line.ListingId,line=>line.ConfigurationId!,StringComparer.OrdinalIgnoreCase),ct);if(candidates.Values.Any(candidate=>candidate.Issue=="phone_configuration_required"))throw new BusinessException("phone_configuration_required","Choose the exact phone configuration in the original cart before merging; both carts were preserved.");}
        var variants = await catalog.ReadCartVariantsAsync(locale, quantities.Select(x => x.VariantId).ToArray(), ct); EnsureBoundedAmount(quantities, variants);
        if (cart is null) { cart = NewCart(member); db.Carts.Add(cart); }
        foreach (var line in quantities) {
            var existing = cart.Lines.SingleOrDefault(x => string.Equals(x.VariantId, line.VariantId, StringComparison.OrdinalIgnoreCase));
            if (existing is null) cart.Lines.Add(new() { CartId = cart.Id, VariantId = line.VariantId, Quantity = line.Quantity }); else existing.Quantity = line.Quantity;
        }
        foreach (var line in sourcing) {
            var existing = cart.SourcingLines.SingleOrDefault(x => string.Equals(x.ListingId, line.ListingId, StringComparison.OrdinalIgnoreCase));
            if (existing is null) cart.SourcingLines.Add(new() { CartId = cart.Id, ListingId = line.ListingId, Quantity = line.Quantity,ConfigurationId=line.ConfigurationId }); else{existing.Quantity = line.Quantity;existing.ConfigurationId=line.ConfigurationId;}
        }
        foreach (var line in guest.Lines.ToArray()) db.CartLines.Remove(line); guest.Lines.Clear();
        foreach (var line in guest.SourcingLines.ToArray()) db.CartSourcingLines.Remove(line); guest.SourcingLines.Clear();
        guest.MergedIntoCartId = cart.Id; Touch(guest); Touch(cart); await db.SaveChangesAsync(ct); return cart;
    }
    private async Task<CartSnapshot> SnapshotAsync(ShoppingCart? cart, string locale, CancellationToken ct)
    {
        EnsureV1(cart); return await SnapshotOrdinaryAsync(cart, locale, ct);
    }
    internal async Task<CartSnapshot> SnapshotOrdinaryAsync(ShoppingCart? cart, string locale, CancellationToken ct)
    {
        if (cart is null) return Empty(locale);
        var ids = cart.Lines.Select(x => x.VariantId).ToArray(); var variants = await catalog.ReadCartVariantsAsync(locale, ids, ct); var stock = await inventory.AvailableAsync(ids, ct);
        var lines = new List<CartLineData>(); long subtotal = 0; var validTotal = true;
        foreach (var line in cart.Lines.OrderBy(x => x.VariantId, StringComparer.Ordinal)) {
            if (!variants.TryGetValue(line.VariantId, out var variant)) { lines.Add(new(line.VariantId, line.Quantity, null, null, null, null, null, 0, null, "unavailable")); validTotal = false; continue; }
            var available = stock.GetValueOrDefault(line.VariantId); string? issue = available < line.Quantity ? "insufficient_stock" : null; string? lineTotal = null;
            try { var amount = checked(variant.PriceRial * line.Quantity); lineTotal = Money(amount); subtotal = checked(subtotal + amount); }
            catch (OverflowException) { validTotal = false; issue = "amount_limit"; }
            lines.Add(new(line.VariantId, line.Quantity, variant.ProductId, variant.Slug, variant.Name, variant.Label, Money(variant.PriceRial), available, lineTotal, issue)
            {
                CompareAtRial = variant.CompareAtPriceRial is long compareAt && compareAt > variant.PriceRial ? Money(compareAt) : null
            });
        }
        return new(1, locale, Convert.ToBase64String(cart.Version), lines.ToArray(), validTotal ? Money(subtotal) : null, lines.Any(x => x.Issue is not null));
    }
    internal async Task<ShoppingCart?> FindAsync(CartIdentity identity, bool tracking, CancellationToken ct)
    {
        var cart=await ReadLockedCartAsync(identity,tracking,ct);
        if (identity.OwnerId is null && cart is not null && (cart.MergedIntoCartId is not null || cart.GuestExpiresAt <= clock.GetUtcNow())) throw new BusinessException("cart_session_expired", "The guest cart session is unavailable.");
        return cart;
    }
    // Every caller first owns the existing cart identity application lock:
    // Shared for a coherent read, Exclusive for mutations (both identities in
    // canonical order for merge). This domain protects the complete cart graph.
    // Under a Serializable checkout, eager empty child reads must not retain
    // RangeS locks across other carts and later wait for Stock: another order
    // already holding Stock has to delete its own accepted lines. Narrow RC
    // reads avoid that inversion; the parent transaction and other modules'
    // isolation are unchanged. No child table is read for a missing header.
    private async Task<ShoppingCart?> ReadLockedCartAsync(CartIdentity identity,bool tracking,CancellationToken ct)
    {
        ValidateIdentity(identity);RequireParent();if(identity.OwnerId is null&&identity.GuestToken is null)return null;
        IQueryable<ShoppingCart> headers;
        if(identity.OwnerId is not null){var owner=identity.OwnerId;headers=db.Carts.FromSqlInterpolated($"SELECT * FROM [sales].[Carts] WITH (READCOMMITTEDLOCK) WHERE [OwnerId]={owner}");}
        else{var hash=Hash(identity.GuestToken!);headers=db.Carts.FromSqlInterpolated($"SELECT * FROM [sales].[Carts] WITH (READCOMMITTEDLOCK) WHERE [GuestTokenHash]={hash}");}
        if(!tracking)headers=headers.AsNoTracking();var cart=await headers.SingleOrDefaultAsync(ct);if(cart is null)return null;var id=cart.Id;
        IQueryable<ShoppingCartLine> lines=db.CartLines.FromSqlInterpolated($"SELECT * FROM [sales].[CartLines] WITH (READCOMMITTEDLOCK) WHERE [CartId]={id}");
        IQueryable<CartSourcingLine> inquiries=db.CartSourcingLines.FromSqlInterpolated($"SELECT * FROM [sales].[CartSourcingLines] WITH (READCOMMITTEDLOCK) WHERE [CartId]={id}");
        IQueryable<CartOfferLine> offers=db.CartOfferLines.FromSqlInterpolated($"SELECT * FROM [sales].[CartOfferLines] WITH (READCOMMITTEDLOCK) WHERE [CartId]={id}");
        if(!tracking){lines=lines.AsNoTracking();inquiries=inquiries.AsNoTracking();offers=offers.AsNoTracking();}
        cart.Lines=await lines.ToListAsync(ct);cart.SourcingLines=await inquiries.ToListAsync(ct);cart.OfferLines=await offers.ToListAsync(ct);return cart;
    }
    internal static void EnsureV1(ShoppingCart? cart) { if (cart?.OfferLines.Count > 0) throw new BusinessException("cart_contract_upgrade_required", "This cart contains accepted offer lines. Use the complete Cart2 contract."); }
    internal static void EnsureCapacity(ShoppingCart? cart, int? ordinaryCount = null)
    {
        if ((ordinaryCount ?? cart?.Lines.Count ?? 0) + (cart?.OfferLines.Count ?? 0) > 64 || cart?.SourcingLines.Count > 24) throw new BusinessException("cart_limit", "The same cart supports at most 64 purchase lines and 24 independent sourcing enquiries.");
        if(ordinaryCount is null&&cart is not null)CartOfferRules.EnsureSkuCapacity(cart.Lines.Select(l=>(l.VariantId,l.Quantity)).Concat(cart.OfferLines.Select(l=>(l.VariantId,l.Quantity))));
    }
    internal void RequireParent() { if (db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel is not (IsolationLevel.ReadCommitted or IsolationLevel.Serializable)) throw new InvalidOperationException("Cart cores require a shared parent transaction."); }
    internal ShoppingCart NewCart(CartIdentity identity) => new() { OwnerId = identity.OwnerId, GuestTokenHash = identity.GuestToken is null ? null : Hash(identity.GuestToken), GuestExpiresAt = identity.OwnerId is null ? clock.GetUtcNow() + TimeSpan.FromDays(30) : null, UpdatedAt = clock.GetUtcNow() };
    internal void Touch(ShoppingCart cart) { cart.Revision = checked(cart.Revision + 1); cart.UpdatedAt = clock.GetUtcNow(); }
    private static CartSnapshot Empty(string locale) => new(1, locale, null, [], "0", false);
    private static string Money(long value) => value.ToString(CultureInfo.InvariantCulture);
    private static bool Same(IEnumerable<ShoppingCartLine> old, CartLineInput[] lines) { var map = old.ToDictionary(x => x.VariantId, x => x.Quantity, StringComparer.OrdinalIgnoreCase); return map.Count == lines.Length && lines.All(x => map.GetValueOrDefault(x.VariantId) == x.Quantity); }
    private static CartLineInput[] ValidateLines(CartLineInput[]? input)
    {
        if (input is null || input.Length > 64 || input.Any(x => x is null || !Identifier(x.VariantId) || x.Quantity is < 1 or > 1000000)) throw new BusinessException("invalid_cart", "Provide up to 64 distinct variants and bounded positive quantities.");
        var lines = input.Select(x => x with { VariantId = x.VariantId.ToLowerInvariant() }).ToArray();
        if (lines.Select(x => x.VariantId).Distinct(StringComparer.Ordinal).Count() != lines.Length) throw new BusinessException("invalid_cart", "Duplicate cart lines are not allowed."); return lines;
    }
    private static void EnsureBoundedAmount(CartLineInput[] lines, IReadOnlyDictionary<string, CartCatalogVariant> variants)
    {
        try { long total = 0; foreach (var line in lines) if (variants.TryGetValue(line.VariantId, out var variant)) total = checked(total + checked(variant.PriceRial * line.Quantity)); }
        catch (OverflowException) { throw new BusinessException("cart_amount_limit", "The cart amount exceeds the supported rial limit."); }
    }
    private static bool Identifier(string? id) => id is { Length: > 0 and <= 64 } && id.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_');
    internal static void ValidateIdentity(CartIdentity identity) { if (identity.OwnerId is not null ? !Identifier(identity.OwnerId) || identity.GuestToken is not null : identity.GuestToken is not null && !ValidGuestToken(identity.GuestToken)) throw new BusinessException("invalid_cart_session", "Invalid cart identity."); }
    internal static void ValidateLocale(string locale) { if (locale is not ("fa" or "en")) throw new BusinessException("invalid_cart", "Unsupported locale."); }
    private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    private static string Key(CartIdentity identity) => identity.OwnerId is not null ? "member:" + identity.OwnerId.ToUpperInvariant() : "guest:" + Hash(identity.GuestToken!);
    private async Task<IDbContextTransaction> BeginAsync(CancellationToken ct)
    {
        if (db.Database.CurrentTransaction is not null) throw new InvalidOperationException("Cart commands require their own request transaction.");
        return await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
    }
    private async Task LockAsync(string key, bool exclusive, CancellationToken ct)
    {
        var transaction = db.Database.CurrentTransaction!; await using var command = db.Database.GetDbConnection().CreateCommand(); command.Transaction = transaction.GetDbTransaction(); command.CommandTimeout = 12;
        command.CommandText = "DECLARE @result int; EXEC @result=sys.sp_getapplock @Resource=@resource,@LockMode=@mode,@LockOwner='Transaction',@LockTimeout=10000; SELECT @result;";
        foreach (var (name, value) in new[] { ("@resource", "sayman:sales:cart:" + Hash(key)), ("@mode", exclusive ? "Exclusive" : "Shared") }) { var parameter = command.CreateParameter(); parameter.ParameterName = name; parameter.DbType = DbType.String; parameter.Size = 255; parameter.Value = value; command.Parameters.Add(parameter); }
        var result = Convert.ToInt32(await command.ExecuteScalarAsync(ct)); if (result >= 0) return;
        await transaction.RollbackAsync(CancellationToken.None); throw new BusinessException("cart_busy_conflict", "The cart is busy. Reload and try again.");
    }
}
