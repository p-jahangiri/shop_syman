using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;

namespace Shop.Modules.Sales;
public sealed class OrderService(SalesDbContext db, CartService carts, CheckoutQuoteService quotes, CheckoutOrderSettingsService settings, IStockReservations reservations, TimeProvider clock, IStockOrderReservationsV2? reservationsV2 = null)
{
    public async Task<CreateOrderResult> CreateAsync(string ownerId, CreateOrderInput supplied, CancellationToken ct)
    {
        var owner = OrderInputRules.Identifier(ownerId); var input = OrderInputRules.Normalize(supplied); RequireTransaction(); await LockOwnerAsync(owner, ct);
        var hash = Hash(JsonSerializer.Serialize(input with { RequestId = "" }));
        var previous = await OrderCommandQueries.PreviousAsync(db,owner,input.RequestId,ct);
        if (previous is not null) {
            EnsureLegacy(previous);
            if (previous.PayloadHash != hash) throw new BusinessException("idempotency_conflict", "This order request id has a different payload.");
            await OrderCommandQueries.LoadHistoryAsync(db,previous,ct);
            await ExpireIfDueAsync(previous, ct); return new(Detail(previous), true);
        }
        if (await OrderCommandQueries.QuoteExistsAsync(db,owner,input.QuoteId,ct)) throw new BusinessException("quote_already_ordered_conflict", "This quote already belongs to an order. Check your orders before continuing.");
        // New commands enter the cart domain before expiry can take Stock.
        // Accepted carts must fail their legacy gate without releasing an old
        // order's hold or creating a Stock -> cart cycle with Quote4. Existing
        // order replay above retains its historical lifecycle behavior.
        await carts.LockForCheckoutAsync(owner, ct);
        await carts.ReadContentsAsync(new(owner, null), ct);
        var policy = await settings.ReadAsync(ct);
        // Independent workers expire other orders in short transactions.
        // A fresh checkout must not take their Stock locks before later
        // Agreement/allocation locks in another versioned workflow.
        if (await OrderCommandQueries.OpenCountAsync(db,owner,clock.GetUtcNow(),ct) >= policy.MaxOpenOrdersPerCustomer) throw new BusinessException("open_order_limit_conflict", "Review or cancel your current temporary order first.");
        var validated = await quotes.ValidateForOrderAsync(owner, input.QuoteId, ct); var snapshot = validated.Data;
        if (snapshot.ShippingRequired != (input.Delivery is not null)) throw new BusinessException("invalid_order_delivery", "Physical orders require a delivery address; digital-only orders must not submit one.");
        var id = Guid.NewGuid().ToString("N"); StockReservationData hold;
        try{hold=await reservations.HoldAsync(new(owner,id,id,snapshot.Lines.Select(l=>new StockReservationLine(l.VariantId,l.Quantity)).ToArray(),TimeSpan.FromMinutes(policy.ReservationMinutes)),ct);}
        catch(BusinessException e)when(e.Code=="insufficient_stock"){throw new BusinessException("cart_review_conflict","An item or quantity changed. Review your cart first.");}
        if (hold.State != StockReservationState.Active) throw new BusinessException("reservation_state_conflict", "The new order reservation is unavailable.");
        var row = new SalesOrder { Id = id, OwnerId = owner, RequestId = input.RequestId, PayloadHash = hash, QuoteId = input.QuoteId, PricingFingerprint = validated.Stored.PricingFingerprint, Locale = snapshot.Locale, State = OrderState.AwaitingPayment, ReservationId = hold.Id, CreatedAt = hold.CreatedAt, ChangedAt = hold.CreatedAt, ExpiresAt = hold.ExpiresAt, ContactName = input.ContactName, ContactPhone = input.ContactPhone, CountryCode = input.Delivery?.CountryCode, Province = input.Delivery?.Province, City = input.Delivery?.City, Address = input.Delivery?.Address, PostalCode = input.Delivery?.PostalCode, ShippingRequired = snapshot.ShippingRequired, Note = input.Note!, MethodId = snapshot.SelectedMethod!.Id, MethodName = snapshot.SelectedMethod.Name, ShippingName = snapshot.ChargeRules!.ShippingName, ItemsSubtotalRial = Parse(snapshot.ItemsSubtotalRial), GoodsTotalRial = Parse(snapshot.GoodsTotalRial), ShippingRial = Parse(snapshot.ShippingRial!), TaxRial = Parse(snapshot.TaxRial!), PayableTotalRial = Parse(snapshot.PayableTotalRial!), TaxIncluded = snapshot.ChargeRules.TaxIncluded, QuoteSnapshotJson = validated.Stored.ResponseJson,
            Lines = snapshot.Lines.Select(l => new SalesOrderLine { OrderId = id, VariantId = l.VariantId, ProductId = l.ProductId, SellerId = l.SellerId, Sku = l.Sku, Name = l.Name, Label = l.Label, Warranty = l.Warranty, PriceVersion = l.PriceVersion!, IsDigital = l.IsDigital, Quantity = l.Quantity, UnitPriceRial = Parse(l.UnitPriceRial), LineTotalRial = Parse(l.LineTotalRial) }).ToList() };
        Event(row, owner, "temporary_order_created"); db.Orders.Add(row); await db.SaveChangesAsync(ct);
        await carts.ConsumeAsync(owner, snapshot.CartVersion, ct); return new(Detail(row), false);
    }
    public async Task<OrderDetailData> ReadAsync(string ownerId, string orderId, CancellationToken ct)
    {
        var owner = OrderInputRules.Identifier(ownerId); var id = OrderInputRules.Uuid(orderId);
        var row=await db.Orders.AsNoTracking().AsSingleQuery().Include(x => x.Lines).Include(x => x.Events).SingleOrDefaultAsync(x => x.OwnerId == owner && x.Id == id, ct) ?? throw Missing();EnsureLegacy(row);return await PaymentDetailAsync(row,ct);
    }
    public async Task<OrderDetailData> CancelAsync(string ownerId, string orderId, string? version, string actorId, CancellationToken ct)
    {
        var owner = OrderInputRules.Identifier(ownerId); var id = OrderInputRules.Uuid(orderId); var actor = OrderInputRules.Identifier(actorId); RequireTransaction(); await LockOwnerAsync(owner, ct);
        var row = await OrderCommandQueries.FindAsync(db,owner,id,ct) ?? throw Missing();
        EnsureLegacy(row);
        await OrderCommandQueries.LoadHistoryAsync(db,row,ct);
        if (row.State is OrderState.Cancelled or OrderState.Expired) return await PaymentDetailAsync(row,ct);
        if (await ExpireIfDueAsync(row, ct)) return await PaymentDetailAsync(row,ct);
        if (row.State != OrderState.AwaitingPayment) throw new BusinessException("order_state_conflict", "This order cannot be cancelled through the unpaid-order flow.");
        if (version != Convert.ToBase64String(row.Version)) throw new BusinessException("version_conflict", "The order changed. Reload before cancelling.");
        var hold = await reservations.ReleaseAsync(owner, row.ReservationId, actor, ct);
        row.State = hold.State == StockReservationState.Expired ? OrderState.Expired : hold.State == StockReservationState.Released ? OrderState.Cancelled : throw new BusinessException("reservation_state_conflict", "The order reservation cannot be released.");
        row.ChangedAt = clock.GetUtcNow(); Event(row, actor, row.State == OrderState.Expired ? "reservation_expired" : "unpaid_order_cancelled"); await db.SaveChangesAsync(ct); return await PaymentDetailAsync(row,ct);
    }
    public async Task<OrderPageData> ListAsync(string? ownerId, string? cursor, CancellationToken ct)
    {
        var query = db.Orders.AsNoTracking().AsQueryable(); if (ownerId is not null) { OrderInputRules.Identifier(ownerId); query = query.Where(x => x.OwnerId == ownerId); }
        if (cursor is not null) { var after = Decode(cursor); query = query.Where(x => x.CreatedAt < after.At || x.CreatedAt == after.At && string.Compare(x.Id, after.Id) < 0); }
        var rows = await query.OrderByDescending(x => x.CreatedAt).ThenByDescending(x => x.Id).Take(21).Select(x => new { Row = x, Count = x.Lines.Sum(l => l.Quantity) }).ToListAsync(ct);
        var page = rows.Take(20).ToArray(); foreach(var item in page)EnsureLegacy(item.Row);return new(page.Select(x => Summary(x.Row, x.Count, ownerId is null)).ToArray(), rows.Count > 20 ? Encode(page[^1].Row) : null);
    }
    public async Task<OrderExpiryCandidate[]> DueAsync(CancellationToken ct) => await db.Orders.AsNoTracking().Where(x => x.State == OrderState.AwaitingPayment && x.ExpiresAt <= clock.GetUtcNow()).OrderBy(x => x.ExpiresAt).ThenBy(x => x.Id).Take(100).Select(x => new OrderExpiryCandidate(x.Id, x.OwnerId)).ToArrayAsync(ct);
    public async Task<bool> ExpireAsync(OrderExpiryCandidate candidate, CancellationToken ct)
    {
        RequireTransaction(); await LockOwnerAsync(OrderInputRules.Identifier(candidate.OwnerId), ct); var id = OrderInputRules.Uuid(candidate.Id);
        var row = await OrderCommandQueries.FindAsync(db,candidate.OwnerId,id,ct);if(row is null)return false;await OrderCommandQueries.LoadEventsAsync(db,row,ct);return await ExpireIfDueAsync(row,ct);
    }
    private async Task<bool> ExpireIfDueAsync(SalesOrder row, CancellationToken ct)
    {
        if (row.State != OrderState.AwaitingPayment || row.ExpiresAt > clock.GetUtcNow()) return false;
        var holdState=row.SnapshotVersion switch {
            null => (await reservations.ReleaseAsync(row.OwnerId,row.ReservationId,"order-expiry",ct)).State,
            2 => (await (reservationsV2??throw new InvalidOperationException("The V2 reservation dispatcher is unavailable.")).ReleaseAsync(row.OwnerId,row.ReservationId,"order-expiry",ct)).State,
            _ => throw new BusinessException("order_contract_upgrade_required","Use the versioned order lifecycle contract.")
        };
        if (holdState is not (StockReservationState.Expired or StockReservationState.Released)) throw new BusinessException("reservation_state_conflict", "An allocated order cannot expire as unpaid.");
        row.State = OrderState.Expired; row.ChangedAt = clock.GetUtcNow(); Event(row, "order-expiry", "reservation_expired"); await db.SaveChangesAsync(ct); return true;
    }
    private OrderState EffectiveState(SalesOrder row) => row.State == OrderState.AwaitingPayment && row.ExpiresAt <= clock.GetUtcNow() ? OrderState.Expired : row.State;
    private OrderSummaryData Summary(SalesOrder row, int count, bool staff = false) => new(row.Id, "SM-" + Money(row.Number), row.Locale, EffectiveState(row).ToString(), row.CreatedAt, row.ExpiresAt, Money(row.PayableTotalRial), count, Convert.ToBase64String(row.Version), staff ? row.OwnerId : null);
    private OrderDetailData Detail(SalesOrder row) { var conditions=UsedOrderConditionSnapshots.Read(row.QuoteSnapshotJson,row.Lines.Select(l=>(l.VariantId,l.VariantId,l.ProductId)));return new(1, Summary(row, row.Lines.Sum(x => x.Quantity)), row.QuoteId, row.ContactName, row.ContactPhone, row.ShippingRequired ? new(row.CountryCode!, row.Province!, row.City!, row.Address!, row.PostalCode!) : null, row.Note, row.ShippingRequired, row.MethodName, row.ShippingName, Money(row.ItemsSubtotalRial), Money(row.GoodsTotalRial), Money(row.ShippingRial), Money(row.TaxRial), Money(row.PayableTotalRial), row.TaxIncluded, row.Lines.OrderBy(x => x.VariantId, StringComparer.Ordinal).Select(l => new OrderLineData(l.VariantId, l.ProductId, l.SellerId, l.Sku, l.Name, l.Label, l.Warranty, l.IsDigital, l.Quantity, Money(l.UnitPriceRial), Money(l.LineTotalRial),conditions.GetValueOrDefault(l.VariantId))).ToArray(), row.Events.OrderBy(x => x.Id).Select(x => new OrderEventData(x.State.ToString(), x.At, x.Reason)).ToArray(), EffectiveState(row) == OrderState.AwaitingPayment, false, "gateway_unconfigured"); }
    private async Task<OrderDetailData> PaymentDetailAsync(SalesOrder row,CancellationToken ct)
    {
        var detail=Detail(row);return await db.CreditOrderLinks.FromSqlInterpolated($"SELECT * FROM [sales].[CreditOrderLinks] WITH (READCOMMITTEDLOCK) WHERE [OrderId]={row.Id} AND [OwnerId]={row.OwnerId}").AsNoTracking().AnyAsync(ct)?detail with{PaymentAvailability=row.State is OrderState.CreditApproved or OrderState.Fulfilled?"credit_manual_authorization":"credit_settlement_pending"}:detail;
    }
    private static void Event(SalesOrder row, string actor, string reason) => row.Events.Add(new() { OrderId = row.Id, State = row.State, ActorId = actor, Reason = reason, At = row.ChangedAt });
    private static string Money(long value) => value.ToString(CultureInfo.InvariantCulture);
    private static long Parse(string value) => long.Parse(value, CultureInfo.InvariantCulture);
    private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    private static BusinessException Missing() => new("not_found", "Order not found.");
    private static void EnsureLegacy(SalesOrder row){if(row.SnapshotVersion is not null)throw new BusinessException("order_contract_upgrade_required","This order requires the versioned order history contract.");}
    private void RequireTransaction() { if (db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel != IsolationLevel.Serializable) throw new InvalidOperationException("Order commands require the shared Serializable checkout transaction."); }
    private async Task LockOwnerAsync(string owner, CancellationToken ct)
    {
        await using var command = db.Database.GetDbConnection().CreateCommand(); command.Transaction = db.Database.CurrentTransaction!.GetDbTransaction(); command.CommandTimeout = 12;
        command.CommandText = "DECLARE @result int; EXEC @result=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @result;"; var parameter = command.CreateParameter(); parameter.ParameterName = "@resource"; parameter.DbType = DbType.String; parameter.Value = "sayman:sales:order-owner:" + Hash(owner.ToUpperInvariant()); command.Parameters.Add(parameter);
        if (Convert.ToInt32(await command.ExecuteScalarAsync(ct)) >= 0) return; await db.Database.CurrentTransaction!.RollbackAsync(CancellationToken.None); throw new BusinessException("order_busy_conflict", "Order operations are busy. Retry the same request id.");
    }
    private sealed record Cursor(DateTimeOffset At, string Id);
    private static string Encode(SalesOrder row) => Convert.ToBase64String(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new Cursor(row.CreatedAt, row.Id)))).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    private static Cursor Decode(string cursor)
    {
        try { if (cursor.Length is < 1 or > 200 || cursor.Any(c => !char.IsAsciiLetterOrDigit(c) && c is not ('-' or '_'))) throw new FormatException(); var raw = cursor.Replace('-', '+').Replace('_', '/'); var data = JsonSerializer.Deserialize<Cursor>(Convert.FromBase64String(raw.PadRight((raw.Length + 3) / 4 * 4, '=')), new JsonSerializerOptions { MaxDepth = 4 }); if (data?.Id is not { Length: 32 } || OrderInputRules.Uuid(data.Id) != data.Id || data.At.Offset != TimeSpan.Zero) throw new FormatException(); return data; }
        catch (Exception e) when (e is FormatException or JsonException or BusinessException or ArgumentException) { throw new BusinessException("invalid_order_cursor", "The order page cursor is invalid."); }
    }
}
