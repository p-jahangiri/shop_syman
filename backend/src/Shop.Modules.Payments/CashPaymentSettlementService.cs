using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;
namespace Shop.Modules.Payments;

// SQL phase only. The host must obtain this result by server-to-server Verify
// outside the transaction. No public HTTP route may bind CashGatewayVerified.
public sealed class CashPaymentSettlementService(PaymentsDbContext db,ICashPaymentOrders orders,CashGatewayRegistry gateways,TimeProvider clock,bool allowDemo=false)
{
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web){UnmappedMemberHandling=JsonUnmappedMemberHandling.Disallow,RespectRequiredConstructorParameters=true,RespectNullableAnnotations=true};
    public async Task<CashOrderSettlement> ApplyServerVerificationAsync(string ownerId,string attemptId,CashGatewayVerified verified,CancellationToken ct)
    {
        RequireTransaction();if(!CashPaymentProofRules.Key(ownerId,64))throw Invalid();var id=CashPaymentProofRules.Id(attemptId);await orders.LockOwnerAsync(ownerId,ct);await LockAsync("attempt",id,ct);
        var attempt=await db.CashAttempts.FromSqlInterpolated($"SELECT * FROM [payments].[CashPaymentAttempts] WITH (READCOMMITTEDLOCK) WHERE [OwnerId]={ownerId} AND [Id]={id}").SingleOrDefaultAsync(ct)??throw Missing();await db.Entry(attempt).ReloadAsync(ct);if(attempt.ContainsDemo&&!allowDemo)throw Missing();_=CashPaymentPreparationService.Data(attempt);
        if(verified is null||verified.State!="succeeded"||verified.Authority is null)throw Invalid();_=CashGatewayRules.Verified(verified,verified.Authority);var authority=CashGatewayRules.EvidenceHash(verified.Authority,512);var reference=CashGatewayRules.EvidenceHash(verified.Reference!,200);var amount=verified.AmountRial!.Value;
        if(attempt.AuthorityHash!=authority)throw new BusinessException("payment_authority_conflict","The server verification belongs to another gateway authority.");
        var previous=await db.CashVerifications.FromSqlInterpolated($"SELECT * FROM [payments].[CashPaymentVerifications] WITH (READCOMMITTEDLOCK) WHERE [AttemptId]={id}").AsNoTracking().SingleOrDefaultAsync(ct);
        if(previous is not null){if(previous.ContainsDemo&&!allowDemo)throw Missing();if(previous.AuthorityHash!=authority||previous.ReferenceHash!=reference||previous.AmountRial!=amount||previous.ProviderKey!=attempt.ProviderKey||previous.AccountKey!=attempt.AccountKey)throw new BusinessException("payment_proof_conflict","The same payment attempt has another verified result.");return Receipt(attempt,previous) with{Replayed=true};}
        if(attempt.State=="verified")throw Unavailable();
        if(gateways.Resolve(attempt.ProviderKey,attempt.AccountKey,forInitiation:false)is null)throw new BusinessException("gateway_unconfigured","Only a configured server gateway may settle this payment.");
        await LockAsync("reference",attempt.ProviderKey+":"+attempt.AccountKey+":"+reference,ct);var now=clock.GetUtcNow();var verificationId=Guid.NewGuid().ToString("N");var proof=CashPaymentProofRules.Normalize(new(attempt.Id,verificationId,attempt.OrderId,attempt.OwnerId,attempt.MethodId,amount,attempt.SnapshotFingerprint,attempt.ProviderKey,attempt.AccountKey,authority,reference,now));
        CashOrderSettlement result;
        var reused=await db.CashVerifications.FromSqlInterpolated($"SELECT * FROM [payments].[CashPaymentVerifications] WITH (READCOMMITTEDLOCK) WHERE [ProviderKey]={attempt.ProviderKey} AND [AccountKey]={attempt.AccountKey} AND [ReferenceHash]={reference}").AsNoTracking().AnyAsync(ct);
        if(reused||attempt.State!="pending")result=new(1,attempt.Id,verificationId,attempt.OrderId,"requires_review",reused?"payment_reference_already_used":"payment_attempt_state_conflict",amount.ToString(CultureInfo.InvariantCulture),attempt.OriginalOrderVersion,now,attempt.ContainsDemo,false);
        else result=await orders.ConfirmVerifiedAsync(proof,ct);
        if(result.SchemaVersion!=1||result.AttemptId!=attempt.Id||result.VerificationId!=verificationId||result.OrderId!=attempt.OrderId||result.AmountRial!=amount.ToString(CultureInfo.InvariantCulture)||result.ContainsDemo!=attempt.ContainsDemo||result.Disposition is not("applied" or "requires_review")||result.Replayed)throw Unavailable();
        attempt.State=result.Disposition=="applied"?"verified":"review";attempt.ChangedAt=clock.GetUtcNow();attempt.LeaseId=null;attempt.LeaseUntil=null;
        var json=JsonSerializer.Serialize(result,Json);db.CashVerifications.Add(new(){Id=verificationId,AttemptId=attempt.Id,ProviderKey=attempt.ProviderKey,AccountKey=attempt.AccountKey,AuthorityHash=authority,ReferenceHash=reference,AmountRial=amount,ProofHash=CashPaymentProofRules.Fingerprint(proof),Disposition=result.Disposition,Reason=result.Reason,VerifiedAt=now,ResponseJson=json,ResponseHash=Hash(json),ContainsDemo=attempt.ContainsDemo});db.CashEvents.Add(new(){AttemptId=attempt.Id,State=attempt.State,Reason=result.Reason,At=attempt.ChangedAt});await db.SaveChangesAsync(ct);return result;
    }
    private static CashOrderSettlement Receipt(CashPaymentAttempt attempt,CashPaymentVerification row)
    {
        try{
            var proof=new VerifiedCashPayment(attempt.Id,row.Id,attempt.OrderId,attempt.OwnerId,attempt.MethodId,row.AmountRial,attempt.SnapshotFingerprint,attempt.ProviderKey,attempt.AccountKey,row.AuthorityHash,row.ReferenceHash,row.VerifiedAt);
            if(row.ResponseJson.Length>8192||Hash(row.ResponseJson)!=row.ResponseHash||CashPaymentProofRules.Fingerprint(proof)!=row.ProofHash)throw Unavailable();var result=JsonSerializer.Deserialize<CashOrderSettlement>(row.ResponseJson,Json)??throw Unavailable();
            if(result.SchemaVersion!=1||result.AttemptId!=attempt.Id||result.VerificationId!=row.Id||result.OrderId!=attempt.OrderId||result.AmountRial!=row.AmountRial.ToString(CultureInfo.InvariantCulture)||result.ContainsDemo!=row.ContainsDemo||row.ContainsDemo!=attempt.ContainsDemo||result.Disposition!=row.Disposition||result.Reason!=row.Reason||result.RecordedAt<row.VerifiedAt||result.Replayed||Convert.FromBase64String(result.OrderVersion).Length!=8)throw Unavailable();return result;
        }catch(Exception e)when(e is JsonException or FormatException or ArgumentException){throw Unavailable();}
    }
    private async Task LockAsync(string kind,string key,CancellationToken ct){await using var command=db.Database.GetDbConnection().CreateCommand();command.Transaction=db.Database.CurrentTransaction!.GetDbTransaction();command.CommandTimeout=12;command.CommandText="DECLARE @r int;EXEC @r=sys.sp_getapplock @Resource=@key,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;SELECT @r;";var p=command.CreateParameter();p.ParameterName="@key";p.Value="sayman:payments:"+kind+":"+Hash(key);command.Parameters.Add(p);if(Convert.ToInt32(await command.ExecuteScalarAsync(ct))<0)throw new BusinessException("payment_busy_conflict","Retry the same verification in a fresh root transaction.");}
    private void RequireTransaction(){if(db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel!=System.Data.IsolationLevel.Serializable)throw new InvalidOperationException("Settlement requires the root Payments/Sales/Inventory Serializable transaction.");}
    private static string Hash(string value)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    private static BusinessException Invalid()=>new("invalid_payment_verification","Only a successful authority-bound server verification may enter settlement.");
    private static BusinessException Missing()=>new("not_found","Payment attempt not found.");
    private static BusinessException Unavailable()=>new("payment_verification_unavailable","The historical verified payment receipt is inconsistent.");
}
