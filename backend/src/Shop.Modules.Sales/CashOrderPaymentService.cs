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

public sealed class CashOrderPaymentService(SalesDbContext db,IStockReservations legacy,IStockOrderReservationsV2 versioned,TimeProvider clock,bool allowDemo=false):ICashPaymentOrders
{
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web){UnmappedMemberHandling=JsonUnmappedMemberHandling.Disallow,RespectRequiredConstructorParameters=true,RespectNullableAnnotations=true};
    private sealed record Line(string Key,string VariantId,string ProductId,string Sku,string Name,string Label,string Warranty,int Quantity,long UnitPriceRial,long LineTotalRial,bool IsDigital);
    public Task LockOwnerAsync(string ownerId,CancellationToken ct)=>LockAsync("order-owner",OrderInputRules.Identifier(ownerId).ToUpperInvariant(),ct);
    public async Task<CashOrderPaymentReadiness> ReadAsync(string ownerId,string orderId,CancellationToken ct)
    {
        var order=await OrderAsync(ownerId,orderId,ct);var fingerprint=ValidateSnapshot(order);var blockers=new List<string>();
        if(order.State!=OrderState.AwaitingPayment)blockers.Add("order_not_awaiting_payment");
        if(order.ExpiresAt<=clock.GetUtcNow())blockers.Add("order_expired");
        if(blockers.Count==0){var hold=await HoldAsync(order,false,ct);if(hold!=StockReservationState.Active)blockers.Add("reservation_not_active");}
        return new(1,order.Id,order.OwnerId,order.State==OrderState.AwaitingPayment&&order.ExpiresAt<=clock.GetUtcNow()?"Expired":order.State.ToString(),Convert.ToBase64String(order.Version),order.MethodId,order.PayableTotalRial,fingerprint,order.ExpiresAt,order.ContainsDemo,blockers.Count==0,blockers.ToArray());
    }
    public async Task<CashOrderSettlement> ConfirmVerifiedAsync(VerifiedCashPayment supplied,CancellationToken ct)
    {
        CartOfferRules.RequireParent(db);var proof=CashPaymentProofRules.Normalize(supplied);var hash=CashPaymentProofRules.Fingerprint(proof);
        await LockAsync("order-owner",proof.OwnerId.ToUpperInvariant(),ct);await LockAsync("cash-payment-attempt",proof.AttemptId,ct);
        await LockAsync("cash-payment-reference",proof.ProviderKey+":"+proof.AccountKey+":"+proof.ReferenceHash,ct);
        var previous=await db.OrderCashPayments.FromSqlInterpolated($"SELECT * FROM [sales].[OrderCashPayments] WITH (READCOMMITTEDLOCK) WHERE [OrderId]={proof.OrderId}").AsNoTracking().SingleOrDefaultAsync(ct);
        if(previous is not null){
            if(previous.ContainsDemo&&!allowDemo)throw Missing();
            if(previous.AttemptId==proof.AttemptId){if(previous.ProofHash!=hash)throw new BusinessException("payment_proof_conflict","The recorded payment attempt has another verified proof.");return Receipt(previous) with{Replayed=true};}
        }
        var order=await OrderAsync(proof.OwnerId,proof.OrderId,ct);var now=clock.GetUtcNow();
        if(proof.VerifiedAt>now||proof.VerifiedAt<order.CreatedAt)throw new BusinessException("invalid_payment_proof","The server verification time is outside this order's lifetime.");
        if(await db.OrderCashPayments.FromSqlInterpolated($"SELECT * FROM [sales].[OrderCashPayments] WITH (READCOMMITTEDLOCK) WHERE [AttemptId]={proof.AttemptId} OR [VerificationId]={proof.VerificationId}").AsNoTracking().AnyAsync(ct))return Review(order,proof,"payment_attempt_bound_elsewhere",now);
        if(await db.OrderCashPayments.FromSqlInterpolated($"SELECT * FROM [sales].[OrderCashPayments] WITH (READCOMMITTEDLOCK) WHERE [ProviderKey]={proof.ProviderKey} AND [AccountKey]={proof.AccountKey} AND ([ReferenceHash]={proof.ReferenceHash} OR [AuthorityHash]={proof.AuthorityHash})").AsNoTracking().AnyAsync(ct))return Review(order,proof,"payment_reference_already_used",now);
        if(ValidateSnapshot(order)!=proof.SnapshotFingerprint)return Review(order,proof,"payment_original_snapshot_changed",now);
        if(proof.AmountRial!=order.PayableTotalRial||!proof.MethodId.Equals(order.MethodId,StringComparison.OrdinalIgnoreCase))return Review(order,proof,"payment_amount_or_method_mismatch",now);
        if(previous is not null||order.State is OrderState.Paid or OrderState.Fulfilled)return Review(order,proof,"order_already_paid",now);
        if(order.State!=OrderState.AwaitingPayment)return Review(order,proof,"order_not_awaiting_payment",now);
        if(order.ExpiresAt<=now)return Review(order,proof,"payment_after_order_deadline",now);
        if(await HoldAsync(order,false,ct)!=StockReservationState.Active)return Review(order,proof,"reservation_not_active",now);
        if(await HoldAsync(order,true,ct)!=StockReservationState.Allocated)return Review(order,proof,"reservation_not_allocated",clock.GetUtcNow());
        now=clock.GetUtcNow();
        // Retry in a fresh root transaction. Never commit a late allocation and
        // a review result together if the clock crosses during a SQL wait.
        if(order.ExpiresAt<=now)throw new BusinessException("payment_deadline_retry","The order deadline elapsed while allocating. Roll back and reconcile the same proof.");
        order.State=OrderState.Paid;order.ChangedAt=now;order.Events.Add(new(){OrderId=order.Id,State=OrderState.Paid,ActorId="payment-verification",Reason="cash_payment_verified",At=now});await db.SaveChangesAsync(ct);
        var result=new CashOrderSettlement(1,proof.AttemptId,proof.VerificationId,order.Id,"applied","verified_amount_and_reservation",Money(proof.AmountRial),Convert.ToBase64String(order.Version),now,order.ContainsDemo,false);
        var json=JsonSerializer.Serialize(result,Json);db.OrderCashPayments.Add(new(){OrderId=order.Id,AttemptId=proof.AttemptId,VerificationId=proof.VerificationId,OwnerId=order.OwnerId,MethodId=proof.MethodId,ProviderKey=proof.ProviderKey,AccountKey=proof.AccountKey,AuthorityHash=proof.AuthorityHash,ReferenceHash=proof.ReferenceHash,ProofHash=hash,SnapshotFingerprint=proof.SnapshotFingerprint,AmountRial=proof.AmountRial,VerifiedAt=proof.VerifiedAt,RecordedAt=now,ContainsDemo=order.ContainsDemo,ResponseJson=json,ResponseHash=Hash(json)});await db.SaveChangesAsync(ct);return result;
    }
    private async Task<SalesOrder> OrderAsync(string ownerId,string orderId,CancellationToken ct)
    {
        CartOfferRules.RequireParent(db);var owner=OrderInputRules.Identifier(ownerId);var id=CashPaymentProofRules.Id(orderId);await LockAsync("order-owner",owner.ToUpperInvariant(),ct);var row=await OrderCommandQueries.FindAsync(db,owner,id,ct)??throw Missing();await db.Entry(row).ReloadAsync(ct);
        if(row.ContainsDemo&&!allowDemo)throw Missing();if(row.SnapshotVersion is not(null or 2))throw Unavailable();await OrderCommandQueries.LoadHistoryAsync(db,row,ct);return row;
    }
    private async Task<StockReservationState> HoldAsync(SalesOrder order,bool allocate,CancellationToken ct)
    {
        if(order.SnapshotVersion==2){var hold=allocate?await versioned.AllocateAsync(order.OwnerId,order.ReservationId,"payment-verification",ct):await versioned.ReadAsync(order.OwnerId,order.ReservationId,ct);var lines=Lines(order);
            if(hold.SchemaVersion!=2||hold.Id!=order.ReservationId||hold.OrderId!=order.Id||hold.ExpiresAt!=order.ExpiresAt||hold.Lines.Length!=lines.Length||lines.Any(l=>!hold.Lines.Any(h=>h.LineId==l.Key&&h.VariantId.Equals(l.VariantId,StringComparison.OrdinalIgnoreCase)&&h.Quantity==l.Quantity&&h.AllocationId==order.LinesV2.Single(x=>x.LineId==l.Key).AllocationId&&h.OfferLineId==order.LinesV2.Single(x=>x.LineId==l.Key).OfferLineId)))throw Unavailable();return hold.State;
        }
        var original=allocate?await legacy.AllocateAsync(order.OwnerId,order.ReservationId,"payment-verification",ct):await legacy.ReadAsync(order.OwnerId,order.ReservationId,ct);var expected=Lines(order);
        if(original.Id!=order.ReservationId||original.OrderId!=order.Id||original.ExpiresAt!=order.ExpiresAt||original.Lines.Count!=expected.Length||expected.Any(l=>!original.Lines.Any(h=>h.VariantId.Equals(l.VariantId,StringComparison.OrdinalIgnoreCase)&&h.Quantity==l.Quantity)))throw Unavailable();return original.State;
    }
    private static Line[] Lines(SalesOrder o)=>(o.SnapshotVersion==2?o.LinesV2.Select(l=>new Line(l.LineId,l.VariantId,l.ProductId,l.Sku,l.Name,l.Label,l.Warranty,l.Quantity,l.UnitPriceRial,l.LineTotalRial,l.IsDigital)):o.Lines.Select(l=>new Line(l.VariantId,l.VariantId,l.ProductId,l.Sku,l.Name,l.Label,l.Warranty,l.Quantity,l.UnitPriceRial,l.LineTotalRial,l.IsDigital))).OrderBy(l=>l.Key,StringComparer.Ordinal).ToArray();
    private static string ValidateSnapshot(SalesOrder o)
    {
        try{
            if(o.QuoteSnapshotJson.Length is <2 or >524288)throw Unavailable();using var document=JsonDocument.Parse(o.QuoteSnapshotJson,new(){MaxDepth=32});var root=document.RootElement;Unique(root);
            var schema=root.GetProperty("SchemaVersion").GetString();if(schema!=(o.SnapshotVersion==2?"5":"3")||root.GetProperty("QuoteId").GetString()!=o.QuoteId||root.GetProperty("PricingFingerprint").GetString()!=o.PricingFingerprint||root.GetProperty("RequiresApproval").GetBoolean())throw Unavailable();
            var method=root.GetProperty("SelectedMethod");if(method.GetProperty("Id").GetString()!=o.MethodId||method.GetProperty("Kind").GetString()!="online"||method.GetProperty("RequiresApproval").GetBoolean()||!method.GetProperty("Enabled").GetBoolean()||root.GetProperty("SelectedPlan").ValueKind!=JsonValueKind.Null)throw Unavailable();
            if(Amount(root,"PayableTotalRial")!=o.PayableTotalRial||Amount(root,"ItemsSubtotalRial")!=o.ItemsSubtotalRial||Amount(root,"GoodsTotalRial")!=o.GoodsTotalRial||Amount(root,"ShippingRial")!=o.ShippingRial||Amount(root,"TaxRial")!=o.TaxRial)throw Unavailable();
            if(root.GetProperty("ShippingRequired").GetBoolean()!=o.ShippingRequired||root.GetProperty("ChargeRules").GetProperty("TaxIncluded").GetBoolean()!=o.TaxIncluded)throw Unavailable();
            if(o.SnapshotVersion==2?o.Lines.Count!=0:o.LinesV2.Count!=0)throw Unavailable();
            var stored=Lines(o);var lines=root.GetProperty("Lines").EnumerateArray().ToArray();if(stored.Length is <1 or >64||lines.Length!=stored.Length||o.ShippingRequired!=stored.Any(l=>!l.IsDigital)||stored.Select(l=>l.Key).Distinct(StringComparer.OrdinalIgnoreCase).Count()!=stored.Length)throw Unavailable();
            foreach(var l in stored){var matches=lines.Where(x=>x.GetProperty(o.SnapshotVersion==2?"LineId":"VariantId").GetString()==l.Key).ToArray();if(matches.Length!=1)throw Unavailable();var x=matches[0];if(o.SnapshotVersion==2)ValidateAccepted(o.LinesV2.Single(r=>r.LineId==l.Key),x);if(x.GetProperty("VariantId").GetString()!=l.VariantId||x.GetProperty("ProductId").GetString()!=l.ProductId||x.GetProperty("Sku").GetString()!=l.Sku||x.GetProperty("Name").GetString()!=l.Name||x.GetProperty("Label").GetString()!=l.Label||x.GetProperty("Warranty").GetString()!=l.Warranty||x.GetProperty("IsDigital").GetBoolean()!=l.IsDigital||Amount(x,"Quantity")!=l.Quantity||Amount(x,"UnitPriceRial")!=l.UnitPriceRial||Amount(x,"LineTotalRial")!=l.LineTotalRial||l.Quantity<1||l.UnitPriceRial<0||checked(l.UnitPriceRial*l.Quantity)!=l.LineTotalRial)throw Unavailable();}
            if(o.PayableTotalRial<=0||o.GoodsTotalRial!=o.ItemsSubtotalRial||stored.Sum(l=>l.LineTotalRial)!=o.ItemsSubtotalRial||checked(o.GoodsTotalRial+o.ShippingRial+(o.TaxIncluded?0:o.TaxRial))!=o.PayableTotalRial)throw Unavailable();
            _=UsedOrderConditionSnapshots.Read(o.QuoteSnapshotJson,stored.Select(l=>(l.Key,l.VariantId,l.ProductId)));
            return Hash(o.QuoteSnapshotJson);
        }catch(Exception e)when(e is JsonException or InvalidOperationException or KeyNotFoundException or ArgumentException or FormatException or OverflowException){throw Unavailable();}
    }
    private static void ValidateAccepted(SalesOrderLineV2 line,JsonElement snapshot)
    {
        if(snapshot.GetProperty("LineKind").GetString()!=line.LineKind||snapshot.GetProperty("SellerId").GetString()!=line.SellerId||snapshot.GetProperty("CategoryId").GetString()!=line.CategoryId||snapshot.GetProperty("PriceVersion").GetString()!=line.PriceVersion)throw Unavailable();
        var accepted=snapshot.GetProperty("Accepted");if(line.LineKind=="ordinary"){if(accepted.ValueKind!=JsonValueKind.Null)throw Unavailable();return;}
        if(line.LineKind!="acceptedOffer"||accepted.ValueKind!=JsonValueKind.Object)throw Unavailable();
        var stored=JsonSerializer.Deserialize<AcceptedQuoteLineV5Data>(accepted.GetRawText(),new JsonSerializerOptions{NumberHandling=JsonNumberHandling.AllowReadingFromString,RespectRequiredConstructorParameters=true,RespectNullableAnnotations=true,UnmappedMemberHandling=JsonUnmappedMemberHandling.Disallow})??throw Unavailable();
        var expected=new AcceptedQuoteLineV5Data(line.ConversionId!,line.AgreementId!,line.AgreementLineId!,line.RequestId!,line.TaskId!,line.OfferId!,line.AcceptanceId!,line.AllocationId!,line.OfferLineId!,line.TermsHash!,line.AgreementVersion!,line.AllocationVersion!,line.PurchaseUntil??throw Unavailable(),line.AllocationExpiresAt??throw Unavailable(),line.Revision??throw Unavailable(),line.SnapshotHash!,line.TermsFa!,line.TermsEn!,line.MaterialFingerprint!,line.ContainsDemo);
        if(stored!=expected)throw Unavailable();
    }
    private static void Unique(JsonElement element){if(element.ValueKind==JsonValueKind.Object){var keys=new HashSet<string>(StringComparer.Ordinal);foreach(var p in element.EnumerateObject()){if(!keys.Add(p.Name))throw Unavailable();Unique(p.Value);}}else if(element.ValueKind==JsonValueKind.Array)foreach(var child in element.EnumerateArray())Unique(child);}
    private static long Amount(JsonElement x,string key){var value=x.GetProperty(key).GetString();if(value is null||value.Length>19||value.Length==0||value.Length>1&&value[0]=='0'||value.Any(c=>c<'0'||c>'9')||!long.TryParse(value,NumberStyles.None,CultureInfo.InvariantCulture,out var amount))throw Unavailable();return amount;}
    private static CashOrderSettlement Review(SalesOrder o,VerifiedCashPayment p,string reason,DateTimeOffset now)=>new(1,p.AttemptId,p.VerificationId,o.Id,"requires_review",reason,Money(p.AmountRial),Convert.ToBase64String(o.Version),now,o.ContainsDemo,false);
    private static CashOrderSettlement Receipt(OrderCashPayment row)
    {
        try{if(row.VerifiedAt>row.RecordedAt||CashPaymentProofRules.Fingerprint(new(row.AttemptId,row.VerificationId,row.OrderId,row.OwnerId,row.MethodId,row.AmountRial,row.SnapshotFingerprint,row.ProviderKey,row.AccountKey,row.AuthorityHash,row.ReferenceHash,row.VerifiedAt))!=row.ProofHash||Hash(row.ResponseJson)!=row.ResponseHash)throw Unavailable();var value=JsonSerializer.Deserialize<CashOrderSettlement>(row.ResponseJson,Json)??throw Unavailable();if(value.SchemaVersion!=1||value.OrderId!=row.OrderId||value.AttemptId!=row.AttemptId||value.VerificationId!=row.VerificationId||value.Disposition!="applied"||value.Reason!="verified_amount_and_reservation"||value.RecordedAt!=row.RecordedAt||value.ContainsDemo!=row.ContainsDemo||value.AmountRial!=Money(row.AmountRial)||value.Replayed||Convert.FromBase64String(value.OrderVersion).Length!=8)throw Unavailable();return value;}catch(Exception e)when(e is JsonException or FormatException or ArgumentException){throw Unavailable();}
    }
    private async Task LockAsync(string kind,string key,CancellationToken ct){CartOfferRules.RequireParent(db);await using var c=db.Database.GetDbConnection().CreateCommand();c.Transaction=db.Database.CurrentTransaction!.GetDbTransaction();c.CommandTimeout=12;c.CommandText="DECLARE @r int;EXEC @r=sys.sp_getapplock @Resource=@key,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;SELECT @r;";var p=c.CreateParameter();p.ParameterName="@key";p.Value="sayman:sales:"+kind+":"+Hash(key);c.Parameters.Add(p);if(Convert.ToInt32(await c.ExecuteScalarAsync(ct))<0)throw new BusinessException("payment_order_busy_conflict","Retry the same verified payment in a fresh transaction.");}
    private static string Money(long n)=>n.ToString(CultureInfo.InvariantCulture);
    private static string Hash(string s)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(s)));
    private static BusinessException Missing()=>new("not_found","Order not found.");
    private static BusinessException Unavailable()=>new("payment_order_unavailable","The original order, snapshot or payment history is inconsistent.");
}
