using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;
namespace Shop.Modules.Sales;
public sealed partial class CreditOrderService(SalesDbContext db,CartService carts,CreditCheckoutQuoteService quotes,CheckoutOrderSettingsService settings,SourcingPriceAgreementService agreements,IStockBoundedReservations ordinaryStock,IStockOrderReservationsV2 acceptedStock,ICreditPurchaseScopeClaims claims,ICreditOrderProtection protection,OrderV2Service orders,TimeProvider clock,ChequeReviewHoldService reviewHolds,bool allowDemo)
{
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web){MaxDepth=48,NumberHandling=JsonNumberHandling.AllowReadingFromString,UnmappedMemberHandling=JsonUnmappedMemberHandling.Disallow,RespectNullableAnnotations=true,RespectRequiredConstructorParameters=true};
    public async Task<CreditOrderResult> CreateAsync(string owner,string commandId,CreditOrderInput supplied,CancellationToken ct)
    {
        owner=CreditCheckoutQuoteRules.Owner(owner);var input=CreditOrderRules.Validate(supplied,commandId);CartOfferRules.RequireParent(db);await OrderV2Locks.OwnerAsync(db,owner,ct);
        var hash=Hash(JsonSerializer.Serialize(new{Contract="Sayman.CreditOrder.v1",Input=input},Json));
        var prior=await db.CreditOrderLinks.FromSqlInterpolated($"SELECT * FROM [sales].[CreditOrderLinks] WITH (READCOMMITTEDLOCK) WHERE [OwnerId]={owner} AND [CommandId]={commandId}").AsNoTracking().SingleOrDefaultAsync(ct);
        if(prior is not null){if(prior.PayloadHash!=hash)throw new BusinessException("credit_order_idempotency_conflict","This cheque order command has different input.");var receipt=ReadReceipt(prior);await VerifyRetainedHoldAsync(prior,receipt,ct);return receipt with{Replayed=true};}
        if(await OrderCommandQueries.PreviousAsync(db,owner,commandId,ct)is not null)throw new BusinessException("credit_order_idempotency_conflict","This command belongs to another order contract.");
        var reviewPolicy=await reviewHolds.ForNewOrderAsync(input.ReviewHoldPolicyVersion,ct);
        // Scope locks precede cart/allocation/Stock. The validation consumer
        // retains the exact old Quote3/5 JSON while rechecking today's facts.
        var quote=await quotes.ValidateForOrderAsync(owner,input.CreditQuoteId,input.Fingerprint,ct);
        if(await OrderCommandQueries.QuoteExistsAsync(db,owner,quote.BaseQuote.Id,ct))throw new BusinessException("quote_already_ordered_conflict","This calculation already belongs to an order.");
        var policy=await settings.ReadAsync(ct);
        if(!policy.ChequeOrdersEnabled||policy.Version.Length!=8)throw new BusinessException("credit_order_unavailable_conflict","Temporary ordering must be explicitly configured by the store.");
        if(await OrderCommandQueries.OpenCountAsync(db,owner,clock.GetUtcNow(),ct)>=policy.MaxOpenOrdersPerCustomer)throw new BusinessException("open_order_limit_conflict","Review or cancel an existing temporary order first.");
        var basic=quote.Ordinary;var mixed=quote.Accepted;var shipping=basic?.ShippingRequired??mixed!.ShippingRequired;
        if(shipping!=(input.Delivery is not null))throw new BusinessException("invalid_order_delivery","Only a physical order requires a delivery address.");
        if(!allowDemo&&mixed?.Lines.Any(l=>l.Accepted?.ContainsDemo==true)==true)throw CreditCheckoutQuoteRules.Missing();
        var until=ChequeReviewHoldService.Deadline(reviewPolicy,clock.GetUtcNow(),policy.ReservationMinutes,quote);var creationUntil=until<quote.Stored.ExpiresAt?until:quote.Stored.ExpiresAt;EnsureDeadline(creationUntil);
        var id=Guid.NewGuid().ToString("N");string reservationId;DateTimeOffset createdAt;
        try{
            if(basic is not null){
                var lines=basic.Lines.Select(l=>new StockReservationLine(l.VariantId,l.Quantity)).ToArray();var hold=await ordinaryStock.HoldBoundedAsync(new(owner,id,id,lines,until),ct);
                if(hold.OrderId!=id||hold.State!=StockReservationState.Active||hold.ExpiresAt!=until||hold.CreatedAt>=until||hold.Lines.Count!=lines.Length||lines.Any(l=>!hold.Lines.Any(h=>h.VariantId.Equals(l.VariantId,StringComparison.OrdinalIgnoreCase)&&h.Quantity==l.Quantity)))throw new InvalidOperationException("The exact absolute ordinary stock hold is required.");
                reservationId=hold.Id;createdAt=hold.CreatedAt;
            }else{
                var snapshot=mixed!;var hold=await acceptedStock.HoldAsync(new(owner,id,id,until,snapshot.Lines.Select(l=>new StockOrderLineV2(l.LineId,l.VariantId,l.Quantity,l.Accepted?.AllocationId,l.Accepted?.OfferLineId)).ToArray(),quote.Agreements.Select(a=>new StockOrderAllocationV2(a.StockPlan,a.Agreement.AllocationId,a.Lines[0].Accepted!.AllocationVersion)).ToArray()),ct);
                if(hold.SchemaVersion!=2||hold.OrderId!=id||hold.State!=StockReservationState.Active||hold.ExpiresAt!=until||hold.CreatedAt>=until||hold.Lines.Length!=snapshot.Lines.Length||hold.Lines.Select(l=>l.LineId).Distinct(StringComparer.Ordinal).Count()!=snapshot.Lines.Length||snapshot.Lines.Any(l=>!hold.Lines.Any(h=>h.LineId==l.LineId&&h.VariantId.Equals(l.VariantId,StringComparison.OrdinalIgnoreCase)&&h.Quantity==l.Quantity&&h.AllocationId==l.Accepted?.AllocationId&&h.OfferLineId==l.Accepted?.OfferLineId)))throw new InvalidOperationException("The exact accepted line and allocation transfer is required.");
                reservationId=hold.Id;createdAt=hold.CreatedAt;
            }
        }catch(BusinessException e)when(e.Code=="insufficient_stock"){throw new BusinessException("cart_review_conflict","The selected quantity is no longer available outside accepted stock holds.");}
        EnsureDeadline(creationUntil);var method=basic?.SelectedMethod??mixed!.SelectedMethod!;var charges=basic?.ChargeRules??mixed!.ChargeRules!;
        var row=new SalesOrder{Id=id,SnapshotVersion=basic is null?2:null,ContainsDemo=mixed?.Lines.Any(l=>l.Accepted?.ContainsDemo==true)==true,OwnerId=owner,RequestId=commandId,PayloadHash=hash,QuoteId=quote.BaseQuote.Id,PricingFingerprint=quote.BaseQuote.PricingFingerprint,Locale=quote.Data.Locale,State=OrderState.AwaitingPayment,ReservationId=reservationId,CreatedAt=createdAt,ChangedAt=createdAt,ExpiresAt=until,ContactName=input.ContactName,ContactPhone=input.ContactPhone,CountryCode=input.Delivery?.CountryCode,Province=input.Delivery?.Province,City=input.Delivery?.City,Address=input.Delivery?.Address,PostalCode=input.Delivery?.PostalCode,ShippingRequired=shipping,Note=input.Note!,MethodId=method.Id,MethodName=method.Name,ShippingName=charges.ShippingName,ItemsSubtotalRial=quote.BaseQuote.ItemsSubtotalRial,GoodsTotalRial=quote.BaseQuote.GoodsTotalRial,ShippingRial=quote.BaseQuote.ShippingRial!.Value,TaxRial=quote.BaseQuote.TaxRial!.Value,PayableTotalRial=quote.BaseQuote.PayableTotalRial!.Value,TaxIncluded=quote.BaseQuote.TaxIncluded,QuoteSnapshotJson=quote.BaseQuote.ResponseJson};
        if(basic is not null)row.Lines=basic.Lines.Select(l=>new SalesOrderLine{OrderId=id,VariantId=l.VariantId,ProductId=l.ProductId,SellerId=l.SellerId,Sku=l.Sku,Name=l.Name,Label=l.Label,Warranty=l.Warranty,PriceVersion=l.PriceVersion!,IsDigital=l.IsDigital,Quantity=l.Quantity,UnitPriceRial=Parse(l.UnitPriceRial),LineTotalRial=Parse(l.LineTotalRial)}).ToList();
        else row.LinesV2=mixed!.Lines.Select(l=>OrderV2Service.StoreLine(id,l)).ToList();
        row.Events.Add(new(){OrderId=id,State=row.State,ActorId=owner,Reason="credit_temporary_order_created",At=createdAt});db.Orders.Add(row);await db.SaveChangesAsync(ct);EnsureDeadline(creationUntil);
        var assessed=Parse(quote.Data.Assessment.AssessedAmountRial!);var use=await claims.ClaimAsync(new(owner,quote.Authority,id,quote.Stored.Id,quote.Stored.Fingerprint,assessed),ct);EnsureDeadline(creationUntil);
        if(use.OrderId!=id||use.ScopeId!=quote.Authority.ScopeId||use.ApplicationId!=quote.Authority.ApplicationId||use.CreditQuoteId!=quote.Stored.Id||use.QuoteFingerprint!=quote.Stored.Fingerprint||use.AssessedAmountRial!=assessed||use.At<createdAt||use.At>=until)throw new InvalidOperationException("The exact immutable Credit scope claim is required.");
        if(basic is not null)await carts.ConsumeAsync(owner,basic.CartVersion,ct);
        else{
            await agreements.ConsumeForOrderAsync(owner,quote.Agreements,id,ct);await carts.ConsumePurchasesV2Async(owner,mixed!.CartVersion,mixed.Lines,ct);
            foreach(var a in quote.Agreements){var eventId=Hash("order-accepted:"+id+":"+a.Agreement.Id)[..32].ToLowerInvariant();var payload=new SourcingAgreementOrderedEvent(1,eventId,id,owner,a.Agreement.Id,a.Agreement.RequestId,a.Agreement.TaskId,a.Agreement.OfferId,a.Agreement.AcceptanceId,a.Agreement.AllocationId,a.Agreement.ContainsDemo,createdAt);db.OrderOutbox.Add(new(){Id=eventId,OrderId=id,AgreementId=a.Agreement.Id,PayloadJson=JsonSerializer.Serialize(payload,OrderOutboxService.Json),CreatedAt=createdAt});}
        }
        await db.SaveChangesAsync(ct);EnsureDeadline(creationUntil);
        var link=new CreditOrderLink{OrderId=id,OwnerId=owner,CommandId=commandId,PayloadHash=hash,CreditQuoteId=quote.Stored.Id,ApplicationId=quote.Authority.ApplicationId,ScopeId=quote.Authority.ScopeId,QuoteFingerprint=quote.Stored.Fingerprint,LimitBasis=quote.Authority.LimitBasis,LimitAmountRial=quote.Authority.LimitAmountRial,AssessedAmountRial=assessed,AcceptedAt=use.At};
        var detail=(await orders.ReadAsync(owner,id,ct))with{PaymentAvailability="credit_settlement_pending"};CreditReviewHoldData? retainedHold=reviewPolicy is null?null:new(reviewPolicy.PolicyRevisionId,reviewPolicy.PolicyVersion,reviewPolicy.MaximumMinutes,quote.Stored.ExpiresAt,until);
        if(retainedHold is not null)db.CreditOrderReviewHolds.Add(new(){OrderId=id,PolicyRevisionId=retainedHold.PolicyRevisionId,PolicyVersion=retainedHold.PolicyVersion,Minutes=retainedHold.Minutes,CreatedAt=createdAt,QuoteExpiresAt=retainedHold.QuoteExpiresAt,ExpiresAt=retainedHold.ExpiresAt});
        var result=new CreditOrderResult(1,false,commandId,Data(link),detail,retainedHold);var raw=JsonSerializer.Serialize(result,Json);link.ResultHash=Hash(raw);link.ProtectedResult=protection.Protect(owner,id,raw);db.CreditOrderLinks.Add(link);await db.SaveChangesAsync(ct);EnsureDeadline(creationUntil);return result;
    }
    public async Task<CreditOrderResult> ReceiptAsync(string owner,string commandId,CancellationToken ct)
    {
        owner=CreditCheckoutQuoteRules.Owner(owner);CreditCheckoutQuoteRules.Id(commandId);var link=await db.CreditOrderLinks.AsNoTracking().SingleOrDefaultAsync(x=>x.OwnerId==owner&&x.CommandId==commandId,ct)??throw CreditCheckoutQuoteRules.Missing();var receipt=ReadReceipt(link);await VerifyRetainedHoldAsync(link,receipt,ct);return receipt with{Replayed=true};
    }
    public async Task<CreditOrderDetail> DetailAsync(string owner,string id,CancellationToken ct)
    {
        owner=CreditCheckoutQuoteRules.Owner(owner);CreditCheckoutQuoteRules.Id(id);var link=await db.CreditOrderLinks.AsNoTracking().SingleOrDefaultAsync(x=>x.OwnerId==owner&&x.OrderId==id,ct)??throw CreditCheckoutQuoteRules.Missing();var receipt=ReadReceipt(link);await VerifyRetainedHoldAsync(link,receipt,ct);var detail=await orders.ReadAsync(owner,id,ct);if(receipt.ReviewHold is{}h&&detail.Summary.ExpiresAt!=h.ExpiresAt)throw CreditOrderRules.Unavailable();if(detail.CanPay)throw CreditOrderRules.Unavailable();var calculation=await quotes.DetailAsync(owner,link.CreditQuoteId,ct);if(calculation.Fingerprint!=link.QuoteFingerprint||calculation.Authority.ScopeId!=link.ScopeId||calculation.Authority.ApplicationId!=link.ApplicationId)throw CreditOrderRules.Unavailable();return new(1,Data(link),detail,calculation,receipt.ReviewHold);
    }
    private async Task VerifyRetainedHoldAsync(CreditOrderLink link,CreditOrderResult receipt,CancellationToken ct)
    {
        var row=await db.CreditOrderReviewHolds.AsNoTracking().SingleOrDefaultAsync(x=>x.OrderId==link.OrderId,ct);
        if(receipt.ReviewHold is null){if(row is not null)throw CreditOrderRules.Unavailable();return;}
        var h=receipt.ReviewHold;
        try{ChequeReviewHoldRules.Id(h.PolicyRevisionId);ChequeReviewHoldRules.Version(h.PolicyVersion);if(row is null||row.CreatedAt!=receipt.Order.Summary.CreatedAt||h.Minutes is<1 or>60||h.QuoteExpiresAt<=row.CreatedAt||h.ExpiresAt<=row.CreatedAt||h.ExpiresAt>row.CreatedAt.AddMinutes(h.Minutes)||h.ExpiresAt!=receipt.Order.Summary.ExpiresAt||h!=new CreditReviewHoldData(row.PolicyRevisionId,row.PolicyVersion,row.Minutes,row.QuoteExpiresAt,row.ExpiresAt))throw CreditOrderRules.Unavailable();var revision=await db.ChequeReviewHoldRevisions.AsNoTracking().SingleOrDefaultAsync(x=>x.Id==h.PolicyRevisionId,ct);if(revision is not{Enabled:true}||revision.Minutes!=h.Minutes||revision.CreatedAt>row.CreatedAt)throw CreditOrderRules.Unavailable();}catch(BusinessException){throw CreditOrderRules.Unavailable();}
    }
    public async Task EnsureCreationCommitAsync(string owner,CreditOrderResult result,CancellationToken ct)
    {
        owner=CreditCheckoutQuoteRules.Owner(owner);var link=await db.CreditOrderLinks.AsNoTracking().SingleOrDefaultAsync(x=>x.OrderId==result.Order.Summary.Id&&x.OwnerId==owner,ct)??throw CreditOrderRules.Unavailable();var quote=await db.CreditCheckoutQuotes.AsNoTracking().SingleOrDefaultAsync(x=>x.Id==link.CreditQuoteId&&x.OwnerId==owner,ct)??throw CreditOrderRules.Unavailable();EnsureDeadline(quote.ExpiresAt);EnsureDeadline(result.Order.Summary.ExpiresAt);await VerifyRetainedHoldAsync(link,result,ct);
    }
    private CreditOrderResult ReadReceipt(CreditOrderLink link)
    {
        try{var raw=protection.Unprotect(link.OwnerId,link.OrderId,link.ProtectedResult);if(Hash(raw)!=link.ResultHash)throw CreditOrderRules.Unavailable();var result=JsonSerializer.Deserialize<CreditOrderResult>(raw,Json)??throw CreditOrderRules.Unavailable();if(result.SchemaVersion!=1||result.Replayed||result.CommandId!=link.CommandId||result.Credit!=Data(link)||result.Order.Summary.Id!=link.OrderId||result.Order.Summary.State!="AwaitingPayment"||result.Order.CanPay||result.Order.PaymentAvailability!="credit_settlement_pending"||result.Order.Events.All(e=>e.Reason!="credit_temporary_order_created")||result.Order.Summary.CreatedAt>link.AcceptedAt||result.Order.Summary.ExpiresAt<=link.AcceptedAt)throw CreditOrderRules.Unavailable();return result;}catch(Exception e)when(e is JsonException or NullReferenceException){throw CreditOrderRules.Unavailable();}
    }
    private static CreditOrderLinkData Data(CreditOrderLink x)=>new(x.OrderId,x.CreditQuoteId,x.ApplicationId,x.ScopeId,x.QuoteFingerprint,x.LimitBasis,x.LimitAmountRial.ToString(CultureInfo.InvariantCulture),x.AssessedAmountRial.ToString(CultureInfo.InvariantCulture),x.AcceptedAt);
    private void EnsureDeadline(DateTimeOffset until){if(until<=clock.GetUtcNow())throw new BusinessException("credit_quote_expired_conflict","The cheque quote or purchase authority expired during ordering. No partial order may commit.");}
    private static long Parse(string value)=>long.Parse(value,NumberStyles.None,CultureInfo.InvariantCulture);
    private static string Hash(string text)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)));
}
