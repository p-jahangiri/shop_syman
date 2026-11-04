using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Serialization;
using Shop.Modules.Inventory;
using Shop.Modules.Market;
using Shop.Modules.Sales;
using Shop.SharedKernel;

public sealed record SourcingConversionCandidateData(
    int SchemaVersion,string RequestId,string RequestVersion,string TaskId,string TaskVersion,
    string OfferId,string OfferVersion,string AcceptanceId,string TermsHash,DateTimeOffset PurchaseUntil,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]SourcingPriceAgreementData? Agreement,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]SourcingStockConversionProof? Allocation,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? CartVersion,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]SourcingConversionExisting? Conversion,
    bool CanConvert,bool CanCheckout,bool CanPay,string[] Blockers);

// Composition is the only place where accepted prices and the price-free stock
// proof meet. Conversion never reserves stock, consumes an agreement or orders.
public sealed class SourcingConversionCoordinator(
    IServiceProvider services,SourcingConversionPlanService market,
    SourcingConversionService sales,CartV2Service carts,
    SourcingPriceAgreementService agreements,IInventorySourcingConversionGuard inventory,TimeProvider clock)
{
    public async Task<SourcingConversionCandidateData> CandidateAsync(string owner,string requestId,string offerId,CancellationToken ct)
    {
        SourcingAllocationTransaction.Assert(services,false);
        await market.AcquireOwnerAsync(owner,ct);
        await market.AcquireCandidateLocksAsync(owner,requestId,offerId,ct);
        var plan=await market.CandidateAsync(owner,requestId,offerId,ct);
        var cartVersion=await carts.ReadVersionAsync(new(owner,null),ct);
        await agreements.LockAsync(plan.AcceptanceId,ct);
        SourcingPriceAgreementData? agreement;
        try{agreement=await agreements.ReadAsync(plan.AcceptanceId,plan.RequestId,owner,ct);}
        catch(BusinessException e)when(e.Code=="not_found"){agreement=null;}
        var allocation=await inventory.ReadActiveAsync(owner,plan.AcceptanceId,ct);
        var previous=await sales.ReadExistingAsync(owner,plan.AcceptanceId,ct);
        var blockers=new List<string>();
        if(previous is not null)blockers.Add("already_converted");
        if(agreement is null||allocation is null)blockers.Add("allocation_required");
        if(agreement is not null){
            SourcingConversionRules.AssertCandidate(plan,agreement);
            if(agreement.EffectiveState!="Active")blockers.Add("agreement_unavailable");
            if(agreement.TaskId!=plan.TaskId||agreement.OfferId!=plan.OfferId||agreement.AcceptanceId!=plan.AcceptanceId||agreement.TermsHash!=plan.TermsHash)throw Changed();
        }
        if(allocation is not null){
            if(allocation.RequestId!=plan.RequestId||allocation.TaskId!=plan.TaskId||allocation.OfferId!=plan.OfferId||allocation.AcceptanceId!=plan.AcceptanceId||allocation.TermsHash!=plan.TermsHash)throw Changed();
            if(agreement is not null&&agreement.AllocationId!=allocation.AllocationId)blockers.Add("allocation_changed");
            if(allocation.ExpiresAt<=clock.GetUtcNow())blockers.Add("allocation_expired");
            else if(plan.PurchaseUntil>clock.GetUtcNow())SourcingStockConversionRules.ValidateCoverage(StockPlan(plan),allocation,clock.GetUtcNow());
        }
        if(plan.PurchaseUntil<=clock.GetUtcNow())blockers.Add("agreement_expired");
        var result=new SourcingConversionCandidateData(1,plan.RequestId,plan.RequestVersion,plan.TaskId,plan.TaskVersion,plan.OfferId,plan.OfferVersion,plan.AcceptanceId,plan.TermsHash,plan.PurchaseUntil,agreement,allocation,cartVersion,previous,blockers.Count==0,false,false,blockers.Distinct(StringComparer.Ordinal).ToArray());
        if(JsonSerializer.SerializeToUtf8Bytes(result,new JsonSerializerOptions(JsonSerializerDefaults.Web){MaxDepth=32}).Length>2*1024*1024)
            throw new BusinessException("sourcing_conversion_capacity_unavailable","The accepted purchase candidate exceeds supported response bounds.");
        return result;
    }

    public async Task<SourcingConversionMutation> ConvertAsync(string owner,string requestId,string offerId,SourcingConversionInput input,CancellationToken ct)
    {
        SourcingAllocationTransaction.Assert(services,false);
        input=CartOfferRules.Normalize(input);requestId=CartOfferRules.Id(requestId);offerId=CartOfferRules.Id(offerId);
        await market.AcquireOwnerAsync(owner,ct);
        await sales.AcquireCommandLockAsync(owner,input.RequestId,ct);
        var previous=await sales.ReplayAsync(owner,requestId,offerId,input,ct);
        if(previous is not null)return previous;
        await market.AcquireRequestTaskAsync(owner,requestId,offerId,input.TaskId,input.RequestId,ct);
        var plan=await market.PrepareAsync(owner,requestId,offerId,input,ct);
        var prepared=await sales.PrepareAsync(owner,plan,input,ct);
        var stock=StockPlan(plan);
        var proof=await inventory.AssertAsync(owner,stock,input.AllocationId,input.AllocationVersion,ct);
        var result=await sales.CompleteAsync(prepared,proof,ct);
        await market.CompleteAsync(owner,plan,result,ct);
        if(proof.ExpiresAt<=clock.GetUtcNow()||plan.PurchaseUntil<=clock.GetUtcNow())
            throw new BusinessException("sourcing_conversion_expired_conflict","The accepted price or stock hold expired before conversion finished. Refresh the current purchase terms.");
        return result;
    }
    private static SourcingStockAllocationPlan StockPlan(AcceptedSourcingPurchasePlan plan)=>new(plan.RequestId,plan.TaskId,plan.OfferId,plan.AcceptanceId,plan.OwnerId,plan.TermsHash,plan.PurchaseUntil,plan.ContainsDemo,plan.Lines.Select(l=>new SourcingStockAllocationPlanLine(l.OfferLineId,l.Sku.VariantId,l.Sku.ProductId,l.Quantity,l.Sku.MaterialFingerprint)).ToArray());
    private static BusinessException Changed()=>new("sourcing_conversion_state_conflict","The accepted purchase changed. Load its current terms again.");
}

public static class SourcingConversionEndpoints
{
    public static void MapSourcingConversions(this WebApplication app,string[] origins)
    {
        var group=app.MapGroup("/api/sourcing/requests/{id}/offers/{offerId}").RequireAuthorization("customer").RequireRateLimiting("orders");
        group.AddEndpointFilter(InputValidation.Filter);
        group.AddEndpointFilter(async(context,next)=>{
            var http=context.HttpContext;var origin=http.Request.Headers.Origin.ToString();
            if((!HttpMethods.IsGet(http.Request.Method)||origin.Length>0)&&!origins.Contains(origin,StringComparer.Ordinal))return Results.StatusCode(403);
            return await next(context);
        });
        group.MapGet("/purchase",async(string id,string offerId,ClaimsPrincipal user,SourcingConversionCoordinator service,CancellationToken ct)=>Results.Ok(await service.CandidateAsync(User(user),id,offerId,ct))).AddEndpointFilter<SourcingOfferTransactionFilter>();
        group.MapPost("/convert",async(string id,string offerId,SourcingConversionInput input,ClaimsPrincipal user,SourcingConversionCoordinator service,CancellationToken ct)=>Results.Ok(await service.ConvertAsync(User(user),id,offerId,input,ct))).AddEndpointFilter<SourcingOfferTransactionFilter>();
        // The literal operation route takes precedence over the older offer
        // command endpoint; no legacy reader learns new response members.
        group.MapGet("/commands/convert/{commandId}",async(string id,string offerId,string commandId,ClaimsPrincipal user,SourcingConversionService service,CancellationToken ct)=>Results.Ok(await service.ReadCommandAsync(User(user),id,offerId,commandId,ct)));
    }
    private static string User(ClaimsPrincipal user)=>user.FindFirstValue("sub")??throw new BusinessException("invalid_credentials","A complete customer session is required.");
}
