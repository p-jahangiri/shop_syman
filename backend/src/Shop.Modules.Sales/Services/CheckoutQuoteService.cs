using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;

namespace Shop.Modules.Sales;
public sealed partial class CheckoutQuoteService(SalesDbContext db, CartService carts, ICheckoutCatalogReader catalog, IInventoryReader inventory, IPurchaseConfiguration purchasing, CheckoutChargePolicyService chargePolicies, CheckoutOrderSettingsService orderSettings, TimeProvider clock)
{
    private static readonly JsonSerializerOptions SnapshotJson = new() { NumberHandling = JsonNumberHandling.WriteAsString | JsonNumberHandling.AllowReadingFromString };
    public async Task<CheckoutQuoteData> CreateAsync(CartIdentity identity, string locale, CheckoutQuoteInput input, CancellationToken ct)
    {
        if (locale is not ("fa" or "en") || !OptionalId(input.MethodId) || !OptionalId(input.PlanId)) throw new BusinessException("invalid_quote", "Use a supported locale and bounded method/plan identifiers.");
        if (identity.OwnerId is null && identity.GuestToken is null) throw new BusinessException("empty_cart", "Add items to your cart first.");
        var actor = CartService.ActorKey(identity); var methodId = input.MethodId?.ToLowerInvariant(); var planId = input.PlanId?.ToLowerInvariant();
        if (methodId is null && planId is not null) throw new BusinessException("invalid_quote", "Select a purchase method before a plan.");
        var requestId = methodId is null ? null : Guid.TryParse(input.RequestId, out var parsed) && parsed != Guid.Empty ? parsed.ToString("N") : throw new BusinessException("invalid_quote", "A UUID request id is required for a saved quote.");
        var payloadHash = Hash(JsonSerializer.Serialize(new { Locale = locale, input.CartVersion, MethodId = methodId, PlanId = planId }));
        if (db.Database.CurrentTransaction is not { } transaction || transaction.GetDbTransaction().IsolationLevel != IsolationLevel.Serializable) throw new InvalidOperationException("Checkout quotes require a Serializable transaction coordinated by the composition root.");
        // Validate the current guest lifecycle even on replay. A consumed or
        // expired guest token must not reopen an earlier private snapshot.
        await LockAsync(CartService.LockResource(identity), false, ct);
        var cart = await carts.ReadContentsAsync(identity, ct);
        if (requestId is not null) {
            await LockAsync("sayman:sales:quote:" + Hash(actor + ":" + requestId), true, ct);
            var previous = await db.Quotes.FromSqlInterpolated($"SELECT * FROM [sales].[CheckoutQuotes] WITH (UPDLOCK,HOLDLOCK) WHERE [ActorKey]={actor} AND [RequestId]={requestId}").AsNoTracking().SingleOrDefaultAsync(ct);
            if (previous is not null) {
                if (previous.ContractVersion is not (null or 3)) throw new BusinessException("quote_contract_conflict", "This request id belongs to another quote contract.");
                if (previous.PayloadHash != payloadHash) throw new BusinessException("idempotency_conflict", "This quote request id has a different payload.");
                var replay = JsonSerializer.Deserialize<CheckoutQuoteData>(previous.ResponseJson, SnapshotJson) ?? throw new InvalidOperationException("Saved quote snapshot is invalid.");
                if (previous.ExpiresAt <= clock.GetUtcNow()) replay = replay with { CanPlaceOrder = false, Blockers = replay.Blockers.Append("quote_expired").Distinct().ToArray(), TemporaryOrder = replay.TemporaryOrder is null ? null : replay.TemporaryOrder with { CanCreate = false, Blockers = replay.TemporaryOrder.Blockers.Append("quote_expired").Distinct().ToArray() } };
                return replay;
            }
        }
        if (cart.Id is null || cart.Version is null || cart.Lines.Length == 0) throw new BusinessException("empty_cart", "Add items to your cart first.");
        if (input.CartVersion != cart.Version) throw new BusinessException("cart_version_conflict", "The cart changed. Reload before requesting a quote.");
        var now = clock.GetUtcNow(); var quoteId = methodId is null ? null : Guid.NewGuid().ToString("N");
        var result = await CalculateAsync(locale, input with { MethodId = methodId, PlanId = planId }, cart, quoteId, now, quoteId is null ? null : now.AddMinutes(5), true, ct);
        var json = JsonSerializer.Serialize(result, SnapshotJson);
        if (Encoding.Unicode.GetByteCount(json) > 1048576 || Encoding.UTF8.GetByteCount(json) > 524288) throw new BusinessException("quote_configuration_limit", "The quote snapshot is too large.");
        if (quoteId is not null) {
            db.Quotes.Add(new() { Id = quoteId, ContractVersion = 3, ActorKey = actor, RequestId = requestId!, PayloadHash = payloadHash, CartId = cart.Id, CartVersion = cart.Version, PricingFingerprint = result.PricingFingerprint, CreatedAt = now, ExpiresAt = result.ExpiresAt!.Value, ItemsSubtotalRial = Parse(result.ItemsSubtotalRial), MarkupRial = Parse(result.MarkupRial), DownPaymentRial = Parse(result.DownPaymentRial), GoodsTotalRial = Parse(result.GoodsTotalRial), ShippingRial = result.ShippingRial is null ? null : Parse(result.ShippingRial), TaxRial = result.TaxRial is null ? null : Parse(result.TaxRial), PayableTotalRial = result.PayableTotalRial is null ? null : Parse(result.PayableTotalRial), ChargePolicyVersion = result.ChargeRules!.Version, ShippingMode = result.ChargeRules.ShippingMode, TaxMode = result.ChargeRules.TaxMode, TaxRateBasisPoints = result.ChargeRules.TaxRateBasisPoints, TaxableBaseRial = result.ChargeRules.TaxableBaseRial is null ? null : Parse(result.ChargeRules.TaxableBaseRial), TaxIncluded = result.ChargeRules.TaxIncluded, ResponseJson = json,
                Lines = result.Lines.Select(l => new CheckoutQuoteLine { QuoteId = quoteId, VariantId = l.VariantId, ProductId = l.ProductId, SellerId = l.SellerId, CategoryId = l.CategoryId, Sku = l.Sku, Name = l.Name, Label = l.Label, Warranty = l.Warranty, PriceVersion = l.PriceVersion!, IsDigital = l.IsDigital, Quantity = l.Quantity, UnitPriceRial = long.Parse(l.UnitPriceRial, CultureInfo.InvariantCulture), LineTotalRial = long.Parse(l.LineTotalRial, CultureInfo.InvariantCulture) }).ToList(),
                Installments = result.Installments.Select(i => new CheckoutQuoteInstallment { QuoteId = quoteId, Sequence = i.Sequence, MonthOffset = i.MonthOffset, AmountRial = long.Parse(i.AmountRial, CultureInfo.InvariantCulture) }).ToList() });
            await db.SaveChangesAsync(ct);
        }
        return result;
    }
    private async Task<CheckoutQuoteData> CalculateAsync(string locale, CheckoutQuoteInput input, (string? Id, string? Version, CartLineInput[] Lines) cart, string? quoteId, DateTimeOffset now, DateTimeOffset? expires, bool checkInventory, CancellationToken ct)
    {
        if (cart.Id is null || cart.Version is null || cart.Lines.Length == 0) throw new BusinessException("empty_cart", "Add items to your cart first.");
        var methodId = input.MethodId; var planId = input.PlanId;
        var ids = cart.Lines.Select(x => x.VariantId).ToArray(); var variants = await catalog.ReadCheckoutVariantsAsync(locale, ids, ct);
        // Normal quote creation observes availability. During order validation,
        // HoldAsync is the final stock authority and must obtain Stock U locks
        // before any Stock read can retain S under the parent Serializable tx.
        var available = checkInventory ? await inventory.AvailableAsync(ids, ct) : null;
        if (cart.Lines.Any(l => !variants.ContainsKey(l.VariantId) || checkInventory && available!.GetValueOrDefault(l.VariantId) < l.Quantity)) throw new BusinessException("cart_review_conflict", "An item or quantity changed. Review your cart first.");
        QuoteLineData[] lines;
        long subtotal;
        try {
            lines = cart.Lines.Select(l => { var p = variants[l.VariantId]; return new QuoteLineData(l.VariantId, p.Variant.ProductId, p.SellerId, p.Variant.CategoryId, p.Sku, p.Variant.Name, p.Variant.Label, p.Warranty, p.Variant.IsDigital, l.Quantity, Money(p.Variant.PriceRial), Money(checked(p.Variant.PriceRial * l.Quantity)), p.PriceVersion,p.UsedCondition); }).ToArray();
            subtotal = lines.Aggregate(0L, (sum, l) => checked(sum + long.Parse(l.LineTotalRial, CultureInfo.InvariantCulture)));
        }
        catch (OverflowException) { throw new BusinessException("quote_amount_limit", "The quote exceeds the supported integer rial amount."); }
        DigitalDeliveryRules.RequireOrderCapacity(lines.Select(l => (l.IsDigital, l.Quantity, l.Sku, l.Name, l.Label)));
        var rules = (await purchasing.MethodsAsync(locale, ct)).OrderBy(x => x.Id, StringComparer.Ordinal).ToArray();
        var allPlans = (await purchasing.PlansAsync(locale, ct)).OrderBy(x => x.Id, StringComparer.Ordinal).ToArray();
        var choice = CheckoutQuoteChoices.Select(subtotal, variants.Values, rules, allPlans, methodId, planId);
        var plans = choice.Plans; var methods = choice.Methods; var method = choice.Method; var plan = choice.Plan; var calculation = choice.Amounts;
        var shippingRequired = lines.Any(l => !l.IsDigital);
        var charges = CheckoutChargeCalculator.Calculate(subtotal, calculation.GoodsTotalRial, shippingRequired, await chargePolicies.ReadAsync(ct), locale);
        var settings = await orderSettings.ReadAsync(ct);
        var temporary = CheckoutOrderSettingsService.Option(settings, method, charges.PayableTotalRial is null ? null : Money(charges.PayableTotalRial.Value));
        var fingerprint = Hash(JsonSerializer.Serialize(new { Lines = lines, Variants = variants.Values.OrderBy(x => x.Variant.Id, StringComparer.Ordinal).ToArray(), Method = method, Plan = plan, ChargeRules = charges.Rules, temporary.SettingsVersion }, SnapshotJson));
        var blockers = new List<string>();
        if (charges.TaxRial is null && charges.Rules.TaxMode != "included_unitemized") blockers.Add(charges.Rules.TaxMode == "unconfigured" ? "tax_unconfigured" : "tax_basis_unavailable");
        if (charges.ShippingRial is null) blockers.Add("shipping_unconfigured");
        if (method is null) blockers.Add(methods.Length == 0 ? "no_purchase_method" : "method_required");
        else { blockers.Add(method.Kind switch { "cheque" => "credit_approval_required", "installment" => "installment_provider_unconfigured", _ => "gateway_unconfigured" }); if (method.RequiresApproval && method.Kind != "cheque") blockers.Add("approval_required"); }
        var result = new CheckoutQuoteData(3, locale, quoteId, cart.Version, fingerprint, now, expires, lines, Money(subtotal), Money(calculation.MarkupRial), Money(calculation.DownPaymentRial), Money(calculation.GoodsTotalRial), shippingRequired, charges.ShippingRial is null ? null : Money(charges.ShippingRial.Value), charges.TaxRial is null ? null : Money(charges.TaxRial.Value), charges.PayableTotalRial is null ? null : Money(charges.PayableTotalRial.Value), methods, plans, method, plan, calculation.Installments, method?.RequiresApproval == true || method?.Kind == "cheque", blockers.Count == 0, blockers.ToArray(), charges.Rules, temporary);
        return result;
    }
    private static long Parse(string value) => long.Parse(value, CultureInfo.InvariantCulture);
    private static bool OptionalId(string? id) => id is null || id.Length is > 0 and <= 64 && id.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_');
    private static string Money(long amount) => amount.ToString(CultureInfo.InvariantCulture);
    private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    private async Task LockAsync(string resource, bool exclusive, CancellationToken ct)
    {
        var transaction = db.Database.CurrentTransaction!; await using var command = db.Database.GetDbConnection().CreateCommand(); command.Transaction = transaction.GetDbTransaction(); command.CommandTimeout = 12;
        command.CommandText = "DECLARE @result int; EXEC @result=sys.sp_getapplock @Resource=@resource,@LockMode=@mode,@LockOwner='Transaction',@LockTimeout=10000; SELECT @result;";
        foreach (var (name, value) in new[] { ("@resource", resource), ("@mode", exclusive ? "Exclusive" : "Shared") }) { var parameter = command.CreateParameter(); parameter.ParameterName = name; parameter.DbType = DbType.String; parameter.Size = 255; parameter.Value = value; command.Parameters.Add(parameter); }
        if (Convert.ToInt32(await command.ExecuteScalarAsync(ct)) >= 0) return;
        await transaction.RollbackAsync(CancellationToken.None); throw new BusinessException("quote_busy_conflict", "The quote is busy. Retry with the same request id.");
    }
}
