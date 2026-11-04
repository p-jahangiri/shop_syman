using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;

namespace Shop.Modules.Sales;

public sealed class OrderV2Service(SalesDbContext db,CartService carts,CheckoutQuoteV5Service quotes,CheckoutOrderSettingsService settings,SourcingPriceAgreementService agreements,IStockOrderReservationsV2 reservations,OrderService legacy,TimeProvider clock,bool allowDemo)
{
    public async Task<CreateOrderResultV2> CreateAsync(string ownerId,CreateOrderInput supplied,CancellationToken ct)
    {
        var owner=OrderInputRules.Identifier(ownerId);var input=OrderInputRules.Normalize(supplied);CartOfferRules.RequireParent(db);await OrderV2Locks.OwnerAsync(db,owner,ct);
        var hash=Hash(JsonSerializer.Serialize(new{ContractVersion=2,Input=input with{RequestId=""}}));
        var previous=await OrderCommandQueries.PreviousAsync(db,owner,input.RequestId,ct);
        if(previous is not null){
            RequireV2(previous);GuardEnvironment(previous);
            if(previous.PayloadHash!=hash)throw new BusinessException("idempotency_conflict","This order request id has a different payload.");
            await OrderCommandQueries.LoadHistoryAsync(db,previous,ct);
            await ExpireIfDueAsync(previous,ct);return new(Detail(previous),true);
        }
        if(await OrderCommandQueries.QuoteExistsAsync(db,owner,input.QuoteId,ct))throw new BusinessException("quote_already_ordered_conflict","This quote already belongs to an order. Review your order history.");
        await carts.LockForCheckoutAsync(owner,ct);
        var policy=await settings.ReadAsync(ct);
        // Due reservations remain conservative until independent workers free
        // them. Expiring another order here would acquire Stock before the
        // new command's Agreement/allocation locks.
        if(await OrderCommandQueries.OpenCountAsync(db,owner,clock.GetUtcNow(),ct)>=policy.MaxOpenOrdersPerCustomer)throw new BusinessException("open_order_limit_conflict","Review or cancel your current temporary order first.");
        var validated=await quotes.ValidateForOrderAsync(owner,input.QuoteId,ct);var snapshot=validated.Data;
        DigitalDeliveryRules.RequireOrderCapacity(snapshot.Lines.Select(l=>(l.IsDigital,l.Quantity,l.Sku,l.Name,l.Label)));
        if(snapshot.ShippingRequired!=(input.Delivery is not null))throw new BusinessException("invalid_order_delivery","Physical orders require a delivery address; digital-only orders must not submit one.");
        var until=CheckoutQuoteV5Rules.OrderExpiry(clock.GetUtcNow(),validated.Stored.ExpiresAt,snapshot.Lines,policy.ReservationMinutes);
        // Preserve quote freshness throughout creation/SQL waits without
        // shortening the separately configured payment reservation.
        var creationUntil=until<validated.Stored.ExpiresAt?until:validated.Stored.ExpiresAt;
        var id=Guid.NewGuid().ToString("N");
        StockOrderReservationDataV2 hold;
        try{hold=await reservations.HoldAsync(new(owner,id,id,until,snapshot.Lines.Select(l=>new StockOrderLineV2(l.LineId,l.VariantId,l.Quantity,l.Accepted?.AllocationId,l.Accepted?.OfferLineId)).ToArray(),validated.Agreements.Select(a=>new StockOrderAllocationV2(a.StockPlan,a.Agreement.AllocationId,a.Lines[0].Accepted!.AllocationVersion)).ToArray()),ct);}
        catch(BusinessException e)when(e.Code=="insufficient_stock"){throw new BusinessException("cart_review_conflict","An ordinary quantity changed outside accepted stock holds. Review your cart first.");}
        ValidateHold(hold,id,until,snapshot.Lines);EnsureDeadline(creationUntil);
        var row=new SalesOrder{Id=id,SnapshotVersion=2,ContainsDemo=snapshot.Lines.Any(l=>l.Accepted?.ContainsDemo==true),OwnerId=owner,RequestId=input.RequestId,PayloadHash=hash,QuoteId=input.QuoteId,PricingFingerprint=validated.Stored.PricingFingerprint,Locale=snapshot.Locale,State=OrderState.AwaitingPayment,ReservationId=hold.Id,CreatedAt=hold.CreatedAt,ChangedAt=hold.CreatedAt,ExpiresAt=hold.ExpiresAt,ContactName=input.ContactName,ContactPhone=input.ContactPhone,CountryCode=input.Delivery?.CountryCode,Province=input.Delivery?.Province,City=input.Delivery?.City,Address=input.Delivery?.Address,PostalCode=input.Delivery?.PostalCode,ShippingRequired=snapshot.ShippingRequired,Note=input.Note!,MethodId=snapshot.SelectedMethod!.Id,MethodName=snapshot.SelectedMethod.Name,ShippingName=snapshot.ChargeRules!.ShippingName,ItemsSubtotalRial=Parse(snapshot.ItemsSubtotalRial),GoodsTotalRial=Parse(snapshot.GoodsTotalRial),ShippingRial=Parse(snapshot.ShippingRial!),TaxRial=snapshot.TaxRial is null?null:Parse(snapshot.TaxRial),TaxBreakdownKnown=snapshot.ChargeRules!.TaxMode!="included_unitemized",PayableTotalRial=Parse(snapshot.PayableTotalRial!),TaxIncluded=snapshot.ChargeRules.TaxIncluded,QuoteSnapshotJson=validated.Stored.ResponseJson,LinesV2=snapshot.Lines.Select(l=>StoreLine(id,l)).ToList()};
        Event(row,owner,"temporary_order_v2_created");db.Orders.Add(row);EnsureDeadline(creationUntil);await db.SaveChangesAsync(ct);EnsureDeadline(creationUntil);
        await agreements.ConsumeForOrderAsync(owner,validated.Agreements,id,ct);EnsureDeadline(creationUntil);
        await carts.ConsumePurchasesV2Async(owner,snapshot.CartVersion,snapshot.Lines,ct);EnsureDeadline(creationUntil);
        foreach(var a in validated.Agreements){
            var eventId=Hash("order-accepted:"+id+":"+a.Agreement.Id)[..32].ToLowerInvariant();
            var payload=new SourcingAgreementOrderedEvent(1,eventId,id,owner,a.Agreement.Id,a.Agreement.RequestId,a.Agreement.TaskId,a.Agreement.OfferId,a.Agreement.AcceptanceId,a.Agreement.AllocationId,a.Agreement.ContainsDemo,hold.CreatedAt);
            db.OrderOutbox.Add(new(){Id=eventId,OrderId=id,AgreementId=a.Agreement.Id,PayloadJson=JsonSerializer.Serialize(payload,OrderOutboxService.Json),CreatedAt=hold.CreatedAt});
        }
        EnsureDeadline(creationUntil);await db.SaveChangesAsync(ct);EnsureDeadline(creationUntil);return new(Detail(row),false);
    }
    public async Task<OrderDetailV2Data> ReadAsync(string ownerId,string orderId,CancellationToken ct)
    {
        var owner=OrderInputRules.Identifier(ownerId);var id=OrderInputRules.Uuid(orderId);var row=await Graph().AsNoTracking().SingleOrDefaultAsync(o=>o.OwnerId==owner&&o.Id==id,ct)??throw Missing();
        GuardVersion(row);GuardEnvironment(row);return await PaymentDetailAsync(row,ct);
    }
    public Task<OrderPageV2Data> ListAsync(string? ownerId,string? cursor,CancellationToken ct)=>ListCoreAsync(ownerId,cursor,false,ct);
    internal Task<OrderPageV2Data> ListCreditForScheduleAsync(string? cursor,CancellationToken ct)=>ListCoreAsync(null,cursor,true,ct);
    public Task<OrderPageV2Data> ListForStaffAsync(string? cursor, string? state, string? reference, CancellationToken ct)
    {
        OrderState? filter = null;
        if (state is not null)
        {
            if (!Enum.GetNames<OrderState>().Contains(state, StringComparer.Ordinal))
                throw new BusinessException("invalid_order_filter", "The order state is invalid.");
            filter = Enum.Parse<OrderState>(state);
        }
        long? number = null;
        if (reference is not null)
        {
            var digits = reference.StartsWith("SM-", StringComparison.OrdinalIgnoreCase) ? reference.AsSpan(3) : reference.AsSpan();
            if (!long.TryParse(digits, NumberStyles.None, CultureInfo.InvariantCulture, out var parsed) || parsed <= 0)
                throw new BusinessException("invalid_order_filter", "Use the exact order reference, for example SM-100.");
            number = parsed;
        }
        return ListCoreAsync(null, cursor, false, ct, filter, number);
    }
    private async Task<OrderPageV2Data> ListCoreAsync(string? ownerId,string? cursor,bool creditOnly,CancellationToken ct,OrderState? state=null,long? number=null)
    {
        var query=db.Orders.AsNoTracking().Where(o=>allowDemo||!o.ContainsDemo);if(creditOnly)query=query.Where(o=>db.CreditOrderLinks.Any(l=>l.OrderId==o.Id));if(ownerId is not null){OrderInputRules.Identifier(ownerId);query=query.Where(o=>o.OwnerId==ownerId);}
        if (number is { } exactNumber) query = query.Where(o => o.Number == exactNumber);
        var asOf = clock.GetUtcNow();
        if (state is { } expectedState)
        {
            query = expectedState switch
            {
                OrderState.AwaitingPayment => query.Where(o => o.State == OrderState.AwaitingPayment && o.ExpiresAt > asOf),
                OrderState.Expired => query.Where(o => o.State == OrderState.Expired || o.State == OrderState.AwaitingPayment && o.ExpiresAt <= asOf),
                _ => query.Where(o => o.State == expectedState)
            };
        }
        if(cursor is not null){var after=Decode(cursor);query=query.Where(o=>o.CreatedAt<after.At||o.CreatedAt==after.At&&string.Compare(o.Id,after.Id)<0);}
        var rows=await query.OrderByDescending(o=>o.CreatedAt).ThenByDescending(o=>o.Id).Take(21).Select(o=>new{Row=o,Count=o.SnapshotVersion==2?o.LinesV2.Sum(l=>l.Quantity):o.Lines.Sum(l=>l.Quantity)}).ToArrayAsync(ct);
        var page=rows.Take(20).ToArray();foreach(var item in page)GuardVersion(item.Row);
        return new(2,page.Select(x=>Summary(x.Row,x.Count,ownerId is null,asOf)).ToArray(),rows.Length>20?Encode(page[^1].Row):null);
    }
    public async Task<OrderDetailV2Data> CancelAsync(string ownerId,string orderId,string? version,string actorId,CancellationToken ct)
    {
        var owner=OrderInputRules.Identifier(ownerId);var id=OrderInputRules.Uuid(orderId);var actor=OrderInputRules.Identifier(actorId);CartOfferRules.RequireParent(db);await OrderV2Locks.OwnerAsync(db,owner,ct);
        var row=await OrderCommandQueries.FindAsync(db,owner,id,ct)??throw Missing();GuardVersion(row);GuardEnvironment(row);await OrderCommandQueries.LoadHistoryAsync(db,row,ct);
        if(row.SnapshotVersion is null){await legacy.CancelAsync(owner,id,version,actor,ct);return await ReadAsync(owner,id,ct);}
        if(row.State is OrderState.Cancelled or OrderState.Expired)return await PaymentDetailAsync(row,ct);
        if(await ExpireIfDueAsync(row,ct))return await PaymentDetailAsync(row,ct);
        if(row.State!=OrderState.AwaitingPayment)throw new BusinessException("order_state_conflict","This order cannot be cancelled through the unpaid-order flow.");
        if(version!=Convert.ToBase64String(row.Version))throw new BusinessException("version_conflict","The order changed. Reload before cancelling.");
        var hold=await reservations.ReleaseAsync(owner,row.ReservationId,actor,ct);
        row.State=hold.State==StockReservationState.Expired?OrderState.Expired:hold.State==StockReservationState.Released?OrderState.Cancelled:throw new BusinessException("reservation_state_conflict","The order reservation cannot be released.");
        row.ChangedAt=clock.GetUtcNow();Event(row,actor,row.State==OrderState.Expired?"reservation_expired":"unpaid_order_cancelled");await db.SaveChangesAsync(ct);return await PaymentDetailAsync(row,ct);
    }
    private async Task<bool> ExpireIfDueAsync(SalesOrder row,CancellationToken ct)
    {
        if(row.State!=OrderState.AwaitingPayment||row.ExpiresAt>clock.GetUtcNow())return false;
        var hold=await reservations.ReleaseAsync(row.OwnerId,row.ReservationId,"order-expiry",ct);
        if(hold.State is not(StockReservationState.Expired or StockReservationState.Released))throw new BusinessException("reservation_state_conflict","An allocated order cannot expire as unpaid.");
        row.State=OrderState.Expired;row.ChangedAt=clock.GetUtcNow();Event(row,"order-expiry","reservation_expired");await db.SaveChangesAsync(ct);return true;
    }
    private IQueryable<SalesOrder> Graph()=>db.Orders.AsSingleQuery().Include(o=>o.Lines).Include(o=>o.LinesV2).Include(o=>o.Events);
    private void EnsureDeadline(DateTimeOffset until){if(until<=clock.GetUtcNow())throw new BusinessException("quote_expired_conflict","The order quote or accepted stock deadline expired during this command.");}
    private void GuardEnvironment(SalesOrder row){if(row.ContainsDemo&&!allowDemo)throw Missing();}
    private static void GuardVersion(SalesOrder row){if(row.SnapshotVersion is not(null or 2))throw Upgrade();}
    private static void RequireV2(SalesOrder row){if(row.SnapshotVersion!=2)throw new BusinessException("order_contract_conflict","This request id belongs to another order contract.");}
    private static void ValidateHold(StockOrderReservationDataV2 hold,string order,DateTimeOffset until,QuoteLineV5Data[] lines)
    {
        if(hold.SchemaVersion!=2||hold.OrderId!=order||hold.State!=StockReservationState.Active||hold.ExpiresAt!=until||hold.CreatedAt>=until||hold.Lines.Length!=lines.Length||hold.Lines.Select(l=>l.LineId).Distinct(StringComparer.Ordinal).Count()!=lines.Length||lines.Any(l=>!hold.Lines.Any(h=>h.LineId==l.LineId&&h.VariantId.Equals(l.VariantId,StringComparison.OrdinalIgnoreCase)&&h.Quantity==l.Quantity&&h.AllocationId==l.Accepted?.AllocationId&&h.OfferLineId==l.Accepted?.OfferLineId&&h.TrackingMode is "none" or "serial" or "imei")))throw new InvalidOperationException("The exact line-aware reservation transfer is required.");
    }
    internal static SalesOrderLineV2 StoreLine(string order,QuoteLineV5Data l)=>new(){OrderId=order,LineId=l.LineId,LineKind=l.LineKind,VariantId=l.VariantId,ProductId=l.ProductId,SellerId=l.SellerId,CategoryId=l.CategoryId,Sku=l.Sku,Name=l.Name,Label=l.Label,Warranty=l.Warranty,PriceVersion=l.PriceVersion,IsDigital=l.IsDigital,Quantity=l.Quantity,UnitPriceRial=Parse(l.UnitPriceRial),LineTotalRial=Parse(l.LineTotalRial),ConversionId=l.Accepted?.ConversionId,AgreementId=l.Accepted?.AgreementId,AgreementLineId=l.Accepted?.AgreementLineId,RequestId=l.Accepted?.RequestId,TaskId=l.Accepted?.TaskId,OfferId=l.Accepted?.OfferId,AcceptanceId=l.Accepted?.AcceptanceId,AllocationId=l.Accepted?.AllocationId,OfferLineId=l.Accepted?.OfferLineId,TermsHash=l.Accepted?.TermsHash,AgreementVersion=l.Accepted?.AgreementVersion,AllocationVersion=l.Accepted?.AllocationVersion,PurchaseUntil=l.Accepted?.PurchaseUntil,AllocationExpiresAt=l.Accepted?.AllocationExpiresAt,Revision=l.Accepted?.Revision,SnapshotHash=l.Accepted?.SnapshotHash,TermsFa=l.Accepted?.TermsFa,TermsEn=l.Accepted?.TermsEn,MaterialFingerprint=l.Accepted?.MaterialFingerprint,ContainsDemo=l.Accepted?.ContainsDemo==true};
    private static OrderLineV2Data Line(SalesOrderLineV2 l,IReadOnlyDictionary<string,UsedItemConditionData> conditions)=>new(l.LineId,l.LineKind,l.VariantId,l.ProductId,l.SellerId,l.CategoryId,l.Sku,l.Name,l.Label,l.Warranty,l.IsDigital,l.Quantity,Money(l.UnitPriceRial),Money(l.LineTotalRial),l.PriceVersion,l.LineKind=="ordinary"?null:new(l.ConversionId!,l.AgreementId!,l.AgreementLineId!,l.RequestId!,l.TaskId!,l.OfferId!,l.AcceptanceId!,l.AllocationId!,l.OfferLineId!,l.TermsHash!,l.AgreementVersion!,l.AllocationVersion!,l.PurchaseUntil!.Value,l.AllocationExpiresAt!.Value,l.Revision!.Value,l.SnapshotHash!,l.TermsFa!,l.TermsEn!,l.MaterialFingerprint!,l.ContainsDemo),conditions.GetValueOrDefault(l.LineId));
    private OrderState EffectiveState(SalesOrder row, DateTimeOffset? asOf = null)=>row.State==OrderState.AwaitingPayment&&row.ExpiresAt<=(asOf ?? clock.GetUtcNow())?OrderState.Expired:row.State;
    private OrderSummaryV2Data Summary(SalesOrder row,int count,bool staff=false,DateTimeOffset? asOf=null)=>new(row.Id,"SM-"+Money(row.Number),row.Locale,EffectiveState(row,asOf).ToString(),row.CreatedAt,row.ExpiresAt,Money(row.PayableTotalRial),count,Convert.ToBase64String(row.Version),row.SnapshotVersion??1,staff?row.OwnerId:null);
    private OrderDetailV2Data Detail(SalesOrder row)
    {
        GuardVersion(row);
        var conditions=UsedOrderConditionSnapshots.Read(row.QuoteSnapshotJson,row.SnapshotVersion==2?row.LinesV2.Select(l=>(l.LineId,l.VariantId,l.ProductId)):row.Lines.Select(l=>(l.VariantId,l.VariantId,l.ProductId)));
        var lines=row.SnapshotVersion==2?row.LinesV2.OrderBy(l=>l.LineId,StringComparer.Ordinal).Select(l=>Line(l,conditions)).ToArray():row.Lines.OrderBy(l=>l.VariantId,StringComparer.Ordinal).Select(l=>new OrderLineV2Data(Hash("legacy-order-line:"+row.Id+":"+l.VariantId.ToLowerInvariant())[..32].ToLowerInvariant(),"ordinary",l.VariantId,l.ProductId,l.SellerId,null,l.Sku,l.Name,l.Label,l.Warranty,l.IsDigital,l.Quantity,Money(l.UnitPriceRial),Money(l.LineTotalRial),OrderV2HistoryRules.PriceVersion(l.PriceVersion),null,conditions.GetValueOrDefault(l.VariantId))).ToArray();
        if(lines.Length==0||lines.Length>64||row.SnapshotVersion==2&&row.Lines.Count!=0||row.SnapshotVersion is null&&row.LinesV2.Count!=0)throw new BusinessException("order_snapshot_unavailable","The complete versioned order snapshot is unavailable.");
        return new(2,row.SnapshotVersion??1,Summary(row,lines.Sum(l=>l.Quantity)),row.QuoteId,row.ContactName,row.ContactPhone,row.ShippingRequired?new(row.CountryCode!,row.Province!,row.City!,row.Address!,row.PostalCode!):null,row.Note,row.ShippingRequired,row.MethodName,row.ShippingName,Money(row.ItemsSubtotalRial),Money(row.GoodsTotalRial),Money(row.ShippingRial),Money(row.TaxRial),Money(row.PayableTotalRial),row.TaxIncluded,lines,row.Events.OrderBy(e=>e.Id).Select(e=>new OrderEventData(e.State.ToString(),e.At,e.Reason)).ToArray(),EffectiveState(row)==OrderState.AwaitingPayment,false,"gateway_unconfigured",OrderShippingSnapshots.PostpaidMode(row.QuoteSnapshotJson,row.ShippingRequired,row.ShippingRial),OrderTaxSnapshots.BreakdownKnown(row));
    }
    private async Task<OrderDetailV2Data> PaymentDetailAsync(SalesOrder row,CancellationToken ct)
    {
        var detail=Detail(row);return await db.CreditOrderLinks.FromSqlInterpolated($"SELECT * FROM [sales].[CreditOrderLinks] WITH (READCOMMITTEDLOCK) WHERE [OrderId]={row.Id} AND [OwnerId]={row.OwnerId}").AsNoTracking().AnyAsync(ct)?detail with{PaymentAvailability=row.State is OrderState.CreditApproved or OrderState.Fulfilled?"credit_manual_authorization":"credit_settlement_pending"}:detail;
    }
    private static void Event(SalesOrder row,string actor,string reason)=>row.Events.Add(new(){OrderId=row.Id,State=row.State,ActorId=actor,Reason=reason,At=row.ChangedAt});
    private static string? Money(long? amount)=>amount?.ToString(CultureInfo.InvariantCulture);
    private static string Money(long n)=>n.ToString(CultureInfo.InvariantCulture);private static long Parse(string n)=>long.Parse(n,CultureInfo.InvariantCulture);
    private static string Hash(string value)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    private static BusinessException Missing()=>new("not_found","Order not found.");private static BusinessException Upgrade()=>new("order_contract_upgrade_required","Use the versioned order history contract.");
    private sealed record Cursor(DateTimeOffset At,string Id);
    private static string Encode(SalesOrder row)=>Convert.ToBase64String(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new Cursor(row.CreatedAt,row.Id)))).TrimEnd('=').Replace('+','-').Replace('/','_');
    private static Cursor Decode(string cursor)
    {
        try{if(cursor.Length is <1 or >200||cursor.Any(c=>!char.IsAsciiLetterOrDigit(c)&&c is not('-' or '_')))throw new FormatException();var raw=cursor.Replace('-','+').Replace('_','/');var value=JsonSerializer.Deserialize<Cursor>(Convert.FromBase64String(raw.PadRight((raw.Length+3)/4*4,'=')),new JsonSerializerOptions{MaxDepth=4});if(value is null||value.At.Offset!=TimeSpan.Zero||value.Id.Length!=32||OrderInputRules.Uuid(value.Id)!=value.Id)throw new FormatException();return value;}
        catch(Exception e)when(e is FormatException or JsonException or BusinessException or ArgumentException){throw new BusinessException("invalid_order_cursor","The order page cursor is invalid.");}
    }
}
internal static class OrderV2Locks
{
    internal static async Task OwnerAsync(SalesDbContext db,string owner,CancellationToken ct)
    {
        CartOfferRules.RequireParent(db);await using var command=db.Database.GetDbConnection().CreateCommand();command.Transaction=db.Database.CurrentTransaction!.GetDbTransaction();command.CommandTimeout=12;command.CommandText="DECLARE @result int;EXEC @result=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;SELECT @result;";var p=command.CreateParameter();p.ParameterName="@resource";p.Value="sayman:sales:order-owner:"+Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(owner.ToUpperInvariant())));command.Parameters.Add(p);
        if(Convert.ToInt32(await command.ExecuteScalarAsync(ct),CultureInfo.InvariantCulture)>=0)return;await db.Database.CurrentTransaction!.RollbackAsync(CancellationToken.None);throw new BusinessException("order_busy_conflict","Order operations are busy. Retry the same request id.");
    }
}
