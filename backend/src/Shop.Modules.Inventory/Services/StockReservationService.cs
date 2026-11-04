using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;

namespace Shop.Modules.Inventory;

public sealed partial class StockReservationService(InventoryDbContext db, TimeProvider clock, bool allowDemo = false) : IStockReservations, IStockOrderReservationsV2, IStockBoundedReservations
{
    public Task<StockReservationData> HoldAsync(StockHoldRequest request,CancellationToken ct)=>HoldLegacyCoreAsync(request,null,ct);
    public Task<StockReservationData> HoldBoundedAsync(StockBoundedHoldRequest request,CancellationToken ct)
    {
        if(request is null||request.ExpiresAt.Offset!=TimeSpan.Zero||request.ExpiresAt>clock.GetUtcNow().AddHours(1))throw new BusinessException("invalid_reservation","An absolute UTC deadline of at most one hour is required.");
        return HoldLegacyCoreAsync(new(request.OwnerId,request.OrderId,request.RequestId,request.Lines,TimeSpan.FromHours(1)),request.ExpiresAt,ct);
    }
    private async Task<StockReservationData> HoldLegacyCoreAsync(StockHoldRequest request,DateTimeOffset? absoluteDeadline,CancellationToken ct)
    {
        var owner = Identifier(request.OwnerId); var order = Uuid(request.OrderId); var key = Uuid(request.RequestId);
        if (request.Lines is null || request.Lines.Count is < 1 or > 64 || request.Lines.Any(x => x is null) || request.Lifetime < TimeSpan.FromMinutes(1) || request.Lifetime > TimeSpan.FromHours(1))
            throw new BusinessException("invalid_reservation", "Provide 1–64 lines and a reservation lifetime of 1–60 minutes.");
        var lines = request.Lines.Select(x => new StockReservationLine(Identifier(x.VariantId).ToUpperInvariant(), x.Quantity)).OrderBy(x => x.VariantId, StringComparer.Ordinal).ToArray();
        if (lines.Any(x => x.Quantity is < 1 or > 1000000) || lines.Select(x => x.VariantId).Distinct(StringComparer.Ordinal).Count() != lines.Length)
            throw new BusinessException("invalid_reservation", "Lines must have distinct variant ids and positive bounded quantities.");
        var hash = absoluteDeadline is{}until ? Hash(JsonSerializer.Serialize(new{Contract="BoundedLegacyHold1",Order=order,Lines=lines,ExpiresAt=until})) : Hash(JsonSerializer.Serialize(new { Order = order, Lines = lines, LifetimeTicks = request.Lifetime.Ticks }));
        // Know the reservation lock before any row read, including in a Serializable parent transaction.
        var reservationId = Hash("reservation:" + owner.ToUpperInvariant() + ":" + key)[..32].ToLowerInvariant();
        await using var transaction = await BeginAsync(ct);
        await LockAsync("request", owner.ToUpperInvariant() + ":" + key, ct);
        await LockAsync("order", order, ct);
        await LockAsync("reservation", reservationId, ct);
        // The request/order application locks own both immutable identities.
        // A Serializable empty-index range must not survive until Stock and
        // then block another owner's reservation insert behind that same Stock.
        var previous = await db.Reservations.FromSqlInterpolated($"SELECT * FROM [inventory].[Reservations] WITH (READCOMMITTEDLOCK) WHERE [OwnerId]={owner} AND [RequestId]={key}").SingleOrDefaultAsync(ct);
        if (previous is not null) {
            await db.Entry(previous).ReloadAsync(ct);
            RequireLegacy(previous);
            if (previous.PayloadHash != hash) throw new BusinessException("idempotency_conflict", "The reservation request id has a different payload.");
            await LoadImmutableItemsAsync(previous, ct);
            await ExpireIfDueAsync(previous, ct);
            if (transaction is not null) await transaction.CommitAsync(ct);
            return Data(previous);
        }
        if (await db.Reservations.FromSqlInterpolated($"SELECT * FROM [inventory].[Reservations] WITH (READCOMMITTEDLOCK) WHERE [OrderId]={order}").AnyAsync(ct)) throw new BusinessException("reservation_conflict", "This order already has a reservation. Create a new order to try again.");
        var stocks = await LockStockAsync(lines.Select(x => x.VariantId), ct);
        foreach (var line in lines)
            if (!stocks.TryGetValue(line.VariantId, out var stock) || StockAvailability.Available(stock.OnHand,stock.Reserved,stock.SourcingReserved) < line.Quantity)
                throw new BusinessException("insufficient_stock", "A requested variant is unavailable. No units were reserved.");
        // Authoritative aggregate physical capacity for every new legacy or
        // bounded credit hold. Historical replay returned above; do not re-gate it.
        PartialFulfillmentRules.RequireNewOrderCapacity(lines.Select(l=>(stocks[l.VariantId].TrackingMode,l.Quantity)));
        var now = clock.GetUtcNow();
        if(absoluteDeadline<=now)throw new BusinessException("reservation_deadline_conflict","The absolute purchase authority deadline expired before stock could be held.");
        var reservation = new StockReservation { Id = reservationId, OwnerId = owner, OrderId = order, RequestId = key, PayloadHash = hash, State = StockReservationState.Active, CreatedAt = now, ChangedAt = now, ExpiresAt = absoluteDeadline ?? now + request.Lifetime };
        foreach (var line in lines) {
            var stock = stocks[line.VariantId]; stock.Reserved = checked(stock.Reserved + line.Quantity);
            reservation.Items.Add(new() { ReservationId = reservation.Id, VariantId = stock.VariantId, Quantity = line.Quantity });
        }
        db.Reservations.Add(reservation); AddEvent(reservation, owner);
        await db.SaveChangesAsync(ct);
        if (transaction is not null) await transaction.CommitAsync(ct);
        return Data(reservation);
    }

    public async Task<StockReservationData> ReadAsync(string ownerId, string reservationId, CancellationToken ct)
    {
        var owner = Identifier(ownerId); var id = Uuid(reservationId);
        var reservation = await db.Reservations.AsNoTracking().Include(x => x.Items).SingleOrDefaultAsync(x => x.Id == id && x.OwnerId == owner, ct)
            ?? throw new BusinessException("not_found", "Reservation not found.");
        RequireLegacy(reservation);
        // Reads do not release stock. A due Active hold is never presented as usable while waiting for the expiry worker.
        var data = Data(reservation);
        return reservation.State == StockReservationState.Active && reservation.ExpiresAt <= clock.GetUtcNow() ? data with { State = StockReservationState.Expired } : data;
    }

    public Task<StockReservationData> AllocateAsync(string ownerId, string reservationId, string actorId, CancellationToken ct) => ChangeAsync(ownerId, reservationId, actorId, StockReservationState.Allocated, ct);
    public Task<StockReservationData> ReleaseAsync(string ownerId, string reservationId, string actorId, CancellationToken ct) => ChangeAsync(ownerId, reservationId, actorId, StockReservationState.Released, ct);
    public Task<StockReservationData> FulfillAsync(string ownerId, string reservationId, string actorId, CancellationToken ct) => ChangeAsync(ownerId, reservationId, actorId, StockReservationState.Fulfilled, ct);

    // Bounded, restartable and safe across multiple workers. Allocated/paid orders never expire here.
    public async Task<int> ExpireBatchAsync(int batchSize, CancellationToken ct)
    {
        if (batchSize is < 1 or > 100) throw new ArgumentOutOfRangeException(nameof(batchSize));
        if (db.Database.CurrentTransaction is not null) throw new InvalidOperationException("Expiry batches require their own short transactions.");
        var now = clock.GetUtcNow();
        var candidates = await db.Reservations.AsNoTracking().Where(x => x.State == StockReservationState.Active && x.ExpiresAt <= now && (allowDemo || !db.SourcingAllocationTransfers.Any(t => t.ReservationId == x.Id && t.ContainsDemo))).OrderBy(x => x.ExpiresAt).ThenBy(x => x.Id).Take(batchSize).Select(x => new { x.Id, x.OwnerId }).ToListAsync(ct);
        var expired = 0;
        foreach (var candidate in candidates) {
            await using var transaction = await BeginAsync(ct);
            await LockAsync("reservation", candidate.Id, ct);
            var reservation = await LoadAsync(candidate.OwnerId, candidate.Id, ct);
            if (reservation.ContractVersion == 2 ? await ExpireV2CoreAsync(reservation, "inventory-expiry", ct) : await ExpireIfDueAsync(reservation, ct)) expired++;
            if (transaction is not null) await transaction.CommitAsync(ct);
        }
        return expired;
    }

    private async Task<StockReservationData> ChangeAsync(string ownerId, string reservationId, string actorId, StockReservationState target, CancellationToken ct)
    {
        var owner = Identifier(ownerId); var id = Uuid(reservationId); var actor = Identifier(actorId);
        await using var transaction = await BeginAsync(ct);
        await LockAsync("reservation", id, ct);
        var reservation = await LoadAsync(owner, id, ct);
        RequireLegacy(reservation);
        await ExpireIfDueAsync(reservation, ct);
        if (reservation.State == target || reservation.State == StockReservationState.Expired || target == StockReservationState.Allocated && reservation.State == StockReservationState.Fulfilled) {
            if (transaction is not null) await transaction.CommitAsync(ct);
            return Data(reservation);
        }
        if (!(target == StockReservationState.Allocated && reservation.State == StockReservationState.Active ||
              target == StockReservationState.Released && reservation.State is StockReservationState.Active or StockReservationState.Allocated ||
              target == StockReservationState.Fulfilled && reservation.State == StockReservationState.Allocated))
            throw new BusinessException("reservation_state_conflict", "This reservation cannot make the requested transition.");
        if (target is StockReservationState.Released or StockReservationState.Fulfilled) await RemoveReservedAsync(reservation, target == StockReservationState.Fulfilled, actor, ct);
        reservation.State = target; reservation.ChangedAt = clock.GetUtcNow(); AddEvent(reservation, actor);
        await db.SaveChangesAsync(ct);
        if (transaction is not null) await transaction.CommitAsync(ct);
        return Data(reservation);
    }

    internal async Task<StockReservation> LoadAsync(string owner, string id, CancellationToken ct)
    {
        var reservation = await db.Reservations.FromSqlInterpolated($"SELECT * FROM [inventory].[Reservations] WITH (READCOMMITTEDLOCK) WHERE [Id]={id} AND [OwnerId]={owner}").SingleOrDefaultAsync(ct)
            ?? throw new BusinessException("not_found", "Reservation not found.");
        await db.Entry(reservation).ReloadAsync(ct);
        await LoadImmutableItemsAsync(reservation, ct);
        return reservation;
    }
    private async Task LoadImmutableItemsAsync(StockReservation row, CancellationToken ct)
    {
        // Immutable after the creating transaction commits. The caller already
        // owns the reservation lock, including replay, serial and expiry paths.
        row.Items = await db.ReservationItems.FromSqlInterpolated($"SELECT * FROM [inventory].[ReservationItems] WITH (READCOMMITTEDLOCK) WHERE [ReservationId]={row.Id}").ToListAsync(ct);
    }
    private async Task<bool> ExpireIfDueAsync(StockReservation reservation, CancellationToken ct)
    {
        RequireLegacy(reservation);
        if (reservation.State != StockReservationState.Active || reservation.ExpiresAt > clock.GetUtcNow()) return false;
        // A replay holds request/order locks; use the same reservation lock as all other transitions.
        await LockAsync("reservation", reservation.Id, ct); await db.Entry(reservation).ReloadAsync(ct);
        if (reservation.State != StockReservationState.Active || reservation.ExpiresAt > clock.GetUtcNow()) return false;
        await RemoveReservedAsync(reservation, false, "inventory-expiry", ct);
        reservation.State = StockReservationState.Expired; reservation.ChangedAt = clock.GetUtcNow(); AddEvent(reservation, "inventory-expiry");
        await db.SaveChangesAsync(ct); return true;
    }
    private async Task RemoveReservedAsync(StockReservation reservation, bool fulfill, string actor, CancellationToken ct)
    {
        await GuardNoPartialDispatchAsync(reservation.Id,ct);
        var stocks = await LockStockAsync(reservation.Items.Select(x => x.VariantId), ct);
        foreach (var line in reservation.Items) {
            var stock = stocks[line.VariantId];
            _=StockAvailability.Available(stock.OnHand,stock.Reserved,stock.SourcingReserved);
            if (stock.Reserved < line.Quantity || stock.OnHand < line.Quantity) throw new InvalidOperationException("Reserved stock invariant failed.");
        }
        var serials=await db.SerialUnits.Where(u=>u.ReservationId==reservation.Id&&u.State=="assigned").ToArrayAsync(ct);
        var unitIds=serials.Select(u=>u.Id).ToArray();
        // This legacy path owns only ordinary reservations. OrderHeld transfer
        // and its provenance-bound claim transitions belong to OrderSnapshot2.
        // Inspect claims under the existing Stock locks; never lock their parent allocation here.
        if(db.SerialUnitClaims.Local.Any(c=>c.IsActive&&(c.ReservationId==reservation.Id||c.OrderId==reservation.OrderId||unitIds.Contains(c.UnitId)))||await db.SerialUnitClaims.AnyAsync(c=>c.IsActive&&(c.ReservationId==reservation.Id||c.OrderId==reservation.OrderId||unitIds.Contains(c.UnitId)),ct))throw new BusinessException("sourcing_allocation_claim_conflict","An active sourcing claim cannot be released or fulfilled through an ordinary reservation.");
        if(fulfill&&reservation.Items.Any(line=>stocks[line.VariantId].TrackingMode!="none"&&serials.Count(u=>u.VariantId.Equals(line.VariantId,StringComparison.OrdinalIgnoreCase))!=line.Quantity))throw new BusinessException("serial_assignment_required","Assign every tracked unit of the order before fulfillment.");
        foreach(var unit in serials){var orderId=unit.OrderId;unit.State=fulfill?"delivered":"available";unit.ChangedAt=clock.GetUtcNow();if(!fulfill){unit.OrderId=null;unit.ReservationId=null;unit.WarrantyUntil=null;}db.SerialEvents.Add(new(){UnitId=unit.Id,State=unit.State,ActorId=actor,At=unit.ChangedAt,OrderId=orderId,Reason=fulfill?"Order fulfillment":"Order release"});}
        foreach (var line in reservation.Items) {
            var stock = stocks[line.VariantId]; stock.Reserved -= line.Quantity;
            if (!fulfill) continue;
            stock.OnHand -= line.Quantity;
            db.Movements.Add(new() { VariantId = stock.VariantId, Delta = -line.Quantity, Balance = stock.OnHand, ActorId = actor, At = clock.GetUtcNow(), Reason = "Order fulfillment " + reservation.OrderId, RequestId = Hash("fulfill:" + reservation.Id + ":" + stock.VariantId.ToUpperInvariant()) });
        }
    }
    internal async Task<Dictionary<string, StockItem>> LockStockAsync(IEnumerable<string> variantIds, CancellationToken ct)
    {
        var stocks = new Dictionary<string, StockItem>(StringComparer.OrdinalIgnoreCase);
        foreach (var id in variantIds.OrderBy(x => x.ToUpperInvariant(), StringComparer.Ordinal)) {
            var item = await db.Stock.FromSqlInterpolated($"SELECT * FROM [inventory].[Stock] WITH (UPDLOCK, HOLDLOCK) WHERE [VariantId] = {id}").SingleOrDefaultAsync(ct);
            if (item is null) continue;
            await db.Entry(item).ReloadAsync(ct); stocks.Add(item.VariantId, item);
        }
        return stocks;
    }
    internal async Task<IDbContextTransaction?> BeginAsync(CancellationToken ct)
    {
        if (db.Database.CurrentTransaction is not { } current) return await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        if (current.GetDbTransaction().IsolationLevel is not (IsolationLevel.ReadCommitted or IsolationLevel.Serializable)) throw new InvalidOperationException("Inventory commands require ReadCommitted or Serializable isolation.");
        return null;
    }
    internal async Task LockAsync(string kind, string value, CancellationToken ct)
    {
        var transaction = db.Database.CurrentTransaction ?? throw new InvalidOperationException("Inventory locks require an active transaction.");
        await using var command = db.Database.GetDbConnection().CreateCommand(); command.Transaction = transaction.GetDbTransaction(); command.CommandTimeout = 12;
        command.CommandText = "DECLARE @result int; EXEC @result = sys.sp_getapplock @Resource=@resource, @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=10000; SELECT @result;";
        var parameter = command.CreateParameter(); parameter.ParameterName = "@resource"; parameter.DbType = DbType.String; parameter.Size = 255; parameter.Value = "sayman:inventory:" + kind + ":" + Hash(value); command.Parameters.Add(parameter);
        var result = Convert.ToInt32(await command.ExecuteScalarAsync(ct));
        if (result >= 0) return;
        // SQL application-lock failures do not necessarily abort SQL transactions themselves.
        await transaction.RollbackAsync(CancellationToken.None);
        throw new BusinessException("inventory_busy_conflict", "Inventory is busy. Retry the same request id.");
    }
    private void AddEvent(StockReservation reservation, string actor) => db.ReservationEvents.Add(new() { ReservationId = reservation.Id, State = reservation.State, ActorId = actor, At = reservation.ChangedAt });
    private static StockReservationData Data(StockReservation r) => new(r.Id, r.OrderId, r.State, r.CreatedAt, r.ExpiresAt, r.Items.OrderBy(x => x.VariantId, StringComparer.Ordinal).Select(x => new StockReservationLine(x.VariantId, x.Quantity)).ToArray());
    private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    private static string Uuid(string value) => Guid.TryParse(value, out var id) && id != Guid.Empty ? id.ToString("N") : throw new BusinessException("invalid_reservation", "A nonempty UUID is required.");
    private static string Identifier(string value) => !string.IsNullOrEmpty(value) && value.Length <= 64 && value.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_') ? value : throw new BusinessException("invalid_reservation", "A bounded ASCII identifier is required.");
    internal static void RequireLegacy(StockReservation reservation)
    {
        if (reservation.ContractVersion is not null) throw new BusinessException("reservation_contract_upgrade_required", "This reservation requires the explicit version 2 order contract.");
    }
}
