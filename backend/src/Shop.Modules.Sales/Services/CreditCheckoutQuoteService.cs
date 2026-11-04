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

public sealed partial class CreditCheckoutQuoteService(SalesDbContext db,CartService carts,CheckoutQuoteService ordinary,CheckoutQuoteV5Service accepted,ICreditPurchaseScopeReader scopes,ICreditCheckoutQuoteProtection protection,TimeProvider clock)
{
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web){MaxDepth=48,NumberHandling=JsonNumberHandling.AllowReadingFromString};
    private static readonly JsonSerializerOptions BaseSnapshotJson=new(){MaxDepth=32,NumberHandling=JsonNumberHandling.WriteAsString|JsonNumberHandling.AllowReadingFromString,DefaultIgnoreCondition=JsonIgnoreCondition.Never};
    public async Task<CreditCheckoutQuoteResult> CreateAsync(string owner,string locale,string commandId,CreditCheckoutQuoteInput input,CancellationToken ct)
    {
        owner=CreditCheckoutQuoteRules.Owner(owner);CreditCheckoutQuoteRules.Id(commandId);CartService.ValidateLocale(locale);input=CreditCheckoutQuoteRules.Validate(input);
        await Lock(owner,commandId,ct);var hash=Hash(JsonSerializer.Serialize(new{Locale=locale,Input=input},Json));
        var previous=await db.CreditCheckoutQuotes.FromSqlInterpolated($"SELECT * FROM [sales].[CreditCheckoutQuotes] WITH (READCOMMITTEDLOCK) WHERE [OwnerId]={owner} AND [CommandId]={commandId}").AsNoTracking().SingleOrDefaultAsync(ct);
        if(previous is not null){if(previous.PayloadHash!=hash||previous.Locale!=locale)throw new BusinessException("credit_quote_idempotency_conflict","This cheque quote command has different input.");return Read(previous)with{Replayed=true};}
        var authority=await scopes.ForQuoteAsync(owner,input.ApplicationId,input.ScopeId,input.ApplicationVersion,input.ScopeVersion,ct);
        if(authority.PlanId!=input.PlanId)throw new BusinessException("credit_quote_plan_conflict","Select the exact plan approved for this purchase scope.");
        var identity=new CartIdentity(owner,null);await carts.LockIdentityAsync(identity,false,ct);var cart=await carts.FindAsync(identity,false,ct);CartService.EnsureCapacity(cart);
        if(cart is null)throw new BusinessException("empty_cart","Add items to your cart first.");
        // Domain separation prevents rebinding an unrelated legacy quote which
        // happened to use the same client UUID. Prices remain in the old engines.
        var request=BaseRequestId(owner,commandId);var quoteInput=new CheckoutQuoteInput(input.CartVersion,input.MethodId,input.PlanId,request);
        CheckoutQuoteData? basic=null;CheckoutQuoteV5Data? mixed=null;CreditQuoteAssessmentData assessment;string baseId;DateTimeOffset created;DateTimeOffset until;
        if(cart.OfferLines.Count==0){
            basic=await ordinary.CreateAsync(identity,locale,quoteInput,ct);baseId=basic.QuoteId??throw CreditCheckoutQuoteRules.Invalid();created=basic.CreatedAt;until=basic.ExpiresAt??throw CreditCheckoutQuoteRules.Invalid();
            assessment=CreditQuoteAssessment.Assess(authority,basic.SelectedMethod,basic.SelectedPlan,basic.GoodsTotalRial,basic.DownPaymentRial,basic.PayableTotalRial,basic.Installments,basic.Blockers);
        }else{
            mixed=await accepted.CreateAsync(identity,locale,quoteInput,ct);baseId=mixed.QuoteId??throw CreditCheckoutQuoteRules.Invalid();created=mixed.CreatedAt;until=mixed.ExpiresAt??throw CreditCheckoutQuoteRules.Invalid();
            assessment=CreditQuoteAssessment.Assess(authority,mixed.SelectedMethod,mixed.SelectedPlan,mixed.GoodsTotalRial,mixed.DownPaymentRial,mixed.PayableTotalRial,mixed.Installments,mixed.Blockers);
        }
        if(authority.ExpiresAt<until)until=authority.ExpiresAt;
        if(until<=clock.GetUtcNow()||until<=created)throw new BusinessException("credit_quote_expired_conflict","The quote or its purchase scope expired during calculation.");
        var stored=await db.Quotes.AsNoTracking().SingleAsync(x=>x.Id==baseId&&x.ActorKey==CartService.ActorKey(identity),ct);var baseHash=Hash(stored.ResponseJson);
        var bound=CreditQuoteAssessment.Snapshot(authority);var fingerprint=Fingerprint(bound,assessment,baseId,baseHash,until);
        var row=new CreditCheckoutQuote{
            OwnerId=owner,Locale=locale,CommandId=commandId,PayloadHash=hash,BaseQuoteId=baseId,BaseContractVersion=mixed is null?3:5,BaseSnapshotHash=baseHash,Fingerprint=fingerprint,
            ApplicationId=authority.ApplicationId,ApplicationVersion=authority.ApplicationVersion,ScopeId=authority.ScopeId,ScopeVersion=authority.ScopeVersion,ReviewId=authority.ReviewId,SubmissionId=authority.SubmissionId,
            PlanId=authority.PlanId,PlanVersion=authority.PlanVersion,PlanSnapshotHash=authority.PlanSnapshotHash,LimitBasis=authority.LimitBasis,LimitAmountRial=authority.LimitAmountRial,ScopeExpiresAt=authority.ExpiresAt,
            AssessedAmountRial=assessment.AssessedAmountRial is{}amount?long.Parse(amount,CultureInfo.InvariantCulture):null,WithinLimit=assessment.WithinLimit,CreatedAt=created,ExpiresAt=until
        };
        var result=new CreditCheckoutQuoteResult(1,false,commandId,new(1,row.Id,locale,created,until,fingerprint,bound,assessment,basic,mixed));
        var raw=JsonSerializer.Serialize(result,Json);row.ResultHash=Hash(raw);row.ProtectedResult=protection.Protect(owner,row.Id,raw);db.CreditCheckoutQuotes.Add(row);await db.SaveChangesAsync(ct);
        if(until<=clock.GetUtcNow())throw new BusinessException("credit_quote_expired_conflict","The quote expired before it could be committed.");return result;
    }
    public async Task<CreditCheckoutQuoteResult> ReceiptAsync(string owner,string locale,string commandId,CancellationToken ct)
    {
        owner=CreditCheckoutQuoteRules.Owner(owner);CreditCheckoutQuoteRules.Id(commandId);CartService.ValidateLocale(locale);
        var row=await db.CreditCheckoutQuotes.AsNoTracking().SingleOrDefaultAsync(x=>x.OwnerId==owner&&x.CommandId==commandId&&x.Locale==locale,ct)??throw CreditCheckoutQuoteRules.Missing();return Read(row)with{Replayed=true};
    }
    public async Task<CreditCheckoutQuoteData> DetailAsync(string owner,string id,CancellationToken ct)
    {
        owner=CreditCheckoutQuoteRules.Owner(owner);CreditCheckoutQuoteRules.Id(id);var row=await db.CreditCheckoutQuotes.AsNoTracking().SingleOrDefaultAsync(x=>x.OwnerId==owner&&x.Id==id,ct)??throw CreditCheckoutQuoteRules.Missing();return Read(row).Quote;
    }
    public static string BaseRequestId(string owner,string commandId){CreditCheckoutQuoteRules.Owner(owner);CreditCheckoutQuoteRules.Id(commandId);return Hash("Sayman.Sales.CreditCheckoutQuote.v1|"+owner+"|"+commandId)[..32].ToLowerInvariant();}
    private async Task Lock(string owner,string commandId,CancellationToken ct)
    {
        CartOfferRules.RequireParent(db);var tx=db.Database.CurrentTransaction!;await using var cmd=db.Database.GetDbConnection().CreateCommand();cmd.Transaction=tx.GetDbTransaction();cmd.CommandTimeout=15;
        cmd.CommandText="DECLARE @r int;EXEC @r=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;SELECT @r;";
        var parameter=cmd.CreateParameter();parameter.ParameterName="@resource";parameter.Value="sayman:sales:credit-quote:"+Hash(owner+":"+commandId);cmd.Parameters.Add(parameter);
        if(Convert.ToInt32(await cmd.ExecuteScalarAsync(ct),CultureInfo.InvariantCulture)<0)throw new BusinessException("credit_quote_busy_conflict","The cheque quote is busy. Retry the original command.");
    }
    private CreditCheckoutQuoteResult Read(CreditCheckoutQuote row)
    {
        try{
            var raw=protection.Unprotect(row.OwnerId,row.Id,row.ProtectedResult);if(Hash(raw)!=row.ResultHash)throw CreditCheckoutQuoteRules.Invalid();
            var result=JsonSerializer.Deserialize<CreditCheckoutQuoteResult>(raw,Json)??throw CreditCheckoutQuoteRules.Invalid();var quote=result.Quote;
            var authority=new CreditPurchaseAuthority(row.ApplicationId,row.ApplicationVersion,row.ScopeId,row.ScopeVersion,row.ReviewId,row.SubmissionId,row.LimitBasis,row.LimitAmountRial,row.ScopeExpiresAt,row.PlanId,row.PlanVersion,row.PlanSnapshotHash);
            if(result.SchemaVersion!=1||result.Replayed||result.CommandId!=row.CommandId||quote.SchemaVersion!=1||quote.Id!=row.Id||quote.Locale!=row.Locale||quote.CreatedAt!=row.CreatedAt||quote.ExpiresAt!=row.ExpiresAt||quote.ExpiresAt>row.ScopeExpiresAt||quote.ExpiresAt<=quote.CreatedAt||quote.CanPlaceOrder||quote.CanPay||quote.Fingerprint!=row.Fingerprint||!Same(quote.Authority,CreditQuoteAssessment.Snapshot(authority)))throw CreditCheckoutQuoteRules.Invalid();
            CreditQuoteAssessmentData expected;string baseJson;
            if(row.BaseContractVersion==3&&quote.OrdinaryQuote is{}simple&&quote.AcceptedQuote is null){
                if(simple.SchemaVersion!=3||simple.QuoteId!=row.BaseQuoteId||simple.Locale!=row.Locale||simple.CreatedAt!=row.CreatedAt||simple.ExpiresAt is null||simple.ExpiresAt<row.ExpiresAt)throw CreditCheckoutQuoteRules.Invalid();
                baseJson=JsonSerializer.Serialize(simple,BaseSnapshotJson);expected=CreditQuoteAssessment.Assess(authority,simple.SelectedMethod,simple.SelectedPlan,simple.GoodsTotalRial,simple.DownPaymentRial,simple.PayableTotalRial,simple.Installments,simple.Blockers);
            }else if(row.BaseContractVersion==5&&quote.AcceptedQuote is{}mixed&&quote.OrdinaryQuote is null){
                if(mixed.SchemaVersion!=5||mixed.QuoteId!=row.BaseQuoteId||mixed.Locale!=row.Locale||mixed.CreatedAt!=row.CreatedAt||mixed.ExpiresAt is null||mixed.ExpiresAt<row.ExpiresAt)throw CreditCheckoutQuoteRules.Invalid();
                baseJson=JsonSerializer.Serialize(mixed,BaseSnapshotJson);expected=CreditQuoteAssessment.Assess(authority,mixed.SelectedMethod,mixed.SelectedPlan,mixed.GoodsTotalRial,mixed.DownPaymentRial,mixed.PayableTotalRial,mixed.Installments,mixed.Blockers);
            }else throw CreditCheckoutQuoteRules.Invalid();
            if(Hash(baseJson)!=row.BaseSnapshotHash||!Same(quote.Assessment,expected)||expected.AssessedAmountRial!=row.AssessedAmountRial?.ToString(CultureInfo.InvariantCulture)||expected.WithinLimit!=row.WithinLimit||row.Fingerprint!=Fingerprint(quote.Authority,expected,row.BaseQuoteId,row.BaseSnapshotHash,row.ExpiresAt))throw CreditCheckoutQuoteRules.Invalid();
            return result;
        }catch(Exception e)when(e is JsonException or NullReferenceException or OverflowException or BusinessException){throw CreditCheckoutQuoteRules.Unavailable();}
    }
    private static bool Same<T>(T a,T b)=>JsonSerializer.Serialize(a,Json)==JsonSerializer.Serialize(b,Json);
    private static string Fingerprint(CreditQuoteAuthorityData authority,CreditQuoteAssessmentData assessment,string baseId,string baseHash,DateTimeOffset until)=>Hash(JsonSerializer.Serialize(new{Authority=authority,Assessment=assessment,BaseQuoteId=baseId,BaseSnapshotHash=baseHash,ExpiresAt=until},Json));
    private static string Hash(string text)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)));
}
