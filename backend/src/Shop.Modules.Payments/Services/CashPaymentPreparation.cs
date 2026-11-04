using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;
namespace Shop.Modules.Payments;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CashPaymentPrepareInput(string CommandId,string OrderVersion);
public sealed record CashGatewayBinding(string MethodId,string ProviderKey,string AccountKey);
public sealed record CashPaymentAttemptData(int SchemaVersion,string Id,string OrderId,string State,string AmountRial,
    string Currency,DateTimeOffset CreatedAt,DateTimeOffset OrderExpiresAt,string Version,bool ContainsDemo);
public sealed record CashPaymentPrepared(CashPaymentAttemptData Attempt,bool Replayed);
public sealed class CashPaymentBindings
{
    private readonly Dictionary<string,CashGatewayBinding> methods=new(StringComparer.OrdinalIgnoreCase);
    public CashPaymentBindings(IEnumerable<CashGatewayBinding> values)
    {
        foreach(var value in values){if(!CashPaymentProofRules.Key(value.MethodId,64)||!CashPaymentProofRules.Key(value.ProviderKey,40)||!CashPaymentProofRules.Key(value.AccountKey,64)||value.ProviderKey!=value.ProviderKey.ToLowerInvariant()||value.AccountKey!=value.AccountKey.ToLowerInvariant()||!methods.TryAdd(value.MethodId,value))throw new InvalidOperationException("Payment method bindings must explicitly select one canonical provider/account per method.");}
    }
    public CashGatewayBinding? Resolve(string method)=>methods.GetValueOrDefault(method);
}
// Root host must own Serializable with Payments/Sales/Inventory on one connection,
// then the canonical Sales order-owner lock. This service never calls a network
// provider, accepts money or reads another module's context.
public sealed class CashPaymentPreparationService(PaymentsDbContext db,ICashPaymentOrders orders,CashPaymentBindings bindings,CashGatewayRegistry gateways,TimeProvider clock,bool allowDemo=false)
{
    public async Task<CashPaymentPrepared> PrepareAsync(string ownerId,string orderId,CashPaymentPrepareInput supplied,CancellationToken ct)
    {
        RequireTransaction();if(supplied is null)throw Invalid();if(!CashPaymentProofRules.Key(ownerId,64))throw Invalid();var order=CashPaymentProofRules.Id(orderId);var command=CashPaymentProofRules.Id(supplied.CommandId);var version=Version(supplied.OrderVersion);var hash=Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new{OrderId=order,Input=new CashPaymentPrepareInput(command,version)})));
        await orders.LockOwnerAsync(ownerId,ct);
        var previous=await db.CashAttempts.FromSqlInterpolated($"SELECT * FROM [payments].[CashPaymentAttempts] WITH (READCOMMITTEDLOCK) WHERE [OwnerId]={ownerId} AND [RequestId]={command}").AsNoTracking().SingleOrDefaultAsync(ct);
        if(previous is not null){if(previous.ContainsDemo&&!allowDemo)throw Missing();if(previous.PayloadHash!=hash||previous.OrderId!=order)throw new BusinessException("idempotency_conflict","The payment command id has another order or input.");return new(Data(previous),true);}
        var ready=await orders.ReadAsync(ownerId,order,ct);if(ready.OwnerId.Equals(ownerId,StringComparison.OrdinalIgnoreCase)==false||ready.OrderId!=order||ready.SchemaVersion!=1)throw Unavailable();if(ready.ContainsDemo&&!allowDemo)throw Missing();
        if(ready.Version!=version)throw new BusinessException("version_conflict","Review the order's current version before starting payment.");
        if(!ready.CanInitiate||ready.Blockers.Length!=0||ready.AmountRial<=0||ready.State!="AwaitingPayment")throw new BusinessException("payment_order_conflict","The original order and reservation are not available for cash payment.");
        _=CashPaymentProofRules.Hash(ready.SnapshotFingerprint);var binding=bindings.Resolve(ready.MethodId);var gateway=binding is null?null:gateways.Resolve(binding.ProviderKey,binding.AccountKey);
        if(gateway is null)throw new BusinessException("gateway_unconfigured","This purchase method has no configured, idempotent cash gateway.");
        var method=await db.Methods.AsNoTracking().SingleOrDefaultAsync(x=>x.Id==ready.MethodId,ct);
        if(method is null||!method.Enabled||method.Kind!="online"||method.RequiresApproval||method.MinAmountRial is {} min&&ready.AmountRial<min||method.MaxAmountRial is {} max&&ready.AmountRial>max)throw new BusinessException("payment_method_conflict","The payment method is no longer available for this amount.");
        // One live attempt per order; a customer must reconcile an uncertain
        // initiation before creating a second attempt. No automatic double pay.
        var open=await db.CashAttempts.FromSqlInterpolated($"SELECT * FROM [payments].[CashPaymentAttempts] WITH (READCOMMITTEDLOCK) WHERE [OwnerId]={ownerId} AND [OrderId]={order}").AsNoTracking().AnyAsync(x=>x.State!="failed"&&x.State!="cancelled",ct);
        if(open)throw new BusinessException("payment_attempt_pending_conflict","Reconcile the existing payment attempt before starting another one.");
        var now=clock.GetUtcNow();if(ready.ExpiresAt<=now)throw new BusinessException("payment_order_expired_conflict","The original order deadline has passed.");
        var row=new CashPaymentAttempt{Id=Guid.NewGuid().ToString("N"),OwnerId=ready.OwnerId,RequestId=command,PayloadHash=hash,OrderId=order,MethodId=ready.MethodId,ProviderKey=binding!.ProviderKey,AccountKey=binding.AccountKey,AmountRial=ready.AmountRial,SnapshotFingerprint=ready.SnapshotFingerprint,OriginalOrderVersion=version,OrderExpiresAt=ready.ExpiresAt,ContainsDemo=ready.ContainsDemo,CreatedAt=now,ChangedAt=now};
        db.CashAttempts.Add(row);db.CashEvents.Add(new(){AttemptId=row.Id,State="created",Reason="cash_attempt_prepared",At=now});await db.SaveChangesAsync(ct);
        if(row.OrderExpiresAt<=clock.GetUtcNow())throw new BusinessException("payment_deadline_retry","Roll back this preparation and review the original order deadline.");return new(Data(row),false);
    }
    public async Task<CashPaymentAttemptData> ReadAsync(string ownerId,string attemptId,CancellationToken ct)
    {
        if(!CashPaymentProofRules.Key(ownerId,64))throw Invalid();var id=CashPaymentProofRules.Id(attemptId);var row=await db.CashAttempts.AsNoTracking().SingleOrDefaultAsync(x=>x.OwnerId==ownerId&&x.Id==id,ct)??throw Missing();if(row.ContainsDemo&&!allowDemo)throw Missing();return Data(row);
    }
    internal static CashPaymentAttemptData Data(CashPaymentAttempt row)
    {
        if(row.AmountRial<=0||row.Currency!="IRR"||row.State is not("created" or "initiating" or "pending" or "verified" or "review" or "failed" or "cancelled")||row.CreatedAt>=row.OrderExpiresAt||row.ChangedAt<row.CreatedAt)throw Unavailable();
        if(row.AuthorityHash is null){if(row.ProtectedAuthority is not null||row.RedirectUri is not null||row.State is "pending" or "verified")throw Unavailable();}
        else{_=CashPaymentProofRules.Hash(row.AuthorityHash);if(row.ProtectedAuthority is not{Length:>0 and <=4096}||!Uri.TryCreate(row.RedirectUri,UriKind.Absolute,out var redirect)||redirect.Scheme!="https"||redirect.UserInfo.Length!=0||redirect.Fragment.Length!=0)throw Unavailable();}
        _=CashPaymentProofRules.Id(row.Id);_=CashPaymentProofRules.Id(row.OrderId);return new(1,row.Id,row.OrderId,row.State,row.AmountRial.ToString(CultureInfo.InvariantCulture),"IRR",row.CreatedAt,row.OrderExpiresAt,Version(Convert.ToBase64String(row.Version)),row.ContainsDemo);
    }
    private void RequireTransaction(){if(db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel!=System.Data.IsolationLevel.Serializable)throw new InvalidOperationException("Cash attempt preparation requires the root Serializable transaction and canonical owner lock.");}
    private static string Version(string value){try{if(value is not{Length:12}||Convert.FromBase64String(value).Length!=8||Convert.ToBase64String(Convert.FromBase64String(value))!=value)throw Invalid();return value;}catch(FormatException){throw Invalid();}}
    private static BusinessException Invalid()=>new("invalid_payment_request","Provide only the exact order version and canonical payment command id.");
    private static BusinessException Missing()=>new("not_found","Payment attempt not found.");
    private static BusinessException Unavailable()=>new("payment_attempt_unavailable","The original payment attempt is inconsistent.");
}
