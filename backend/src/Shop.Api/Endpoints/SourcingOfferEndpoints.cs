using System.Security.Claims;
using Shop.Modules.Market;
using Shop.SharedKernel;

public static class SourcingOfferEndpoints
{
    public static void MapSourcingOffers(this WebApplication app,string[] origins)
    {
        var offers=app.MapGroup("/api/sourcing/requests/{id}/offers").RequireAuthorization("customer").RequireRateLimiting("orders");
        offers.AddEndpointFilter(InputValidation.Filter);
        offers.AddEndpointFilter(async(context,next)=>{
            var http=context.HttpContext;var origin=http.Request.Headers.Origin.ToString();
            if((!HttpMethods.IsGet(http.Request.Method)||origin.Length>0)&&!origins.Contains(origin,StringComparer.Ordinal))return Results.StatusCode(403);
            return await next(context);
        });
        offers.MapGet("",async(string id,string? cursor,ClaimsPrincipal user,SourcingOfferService service,CancellationToken ct)=>Results.Ok(await service.PageAsync(User(user),id,cursor,ct)));
        offers.MapGet("/{offerId}",async(string id,string offerId,ClaimsPrincipal user,SourcingOfferService service,CancellationToken ct)=>Results.Ok(await service.ReadAsync(User(user),id,offerId,ct)));
        offers.MapGet("/{offerId}/events",async(string id,string offerId,string? cursor,ClaimsPrincipal user,SourcingOfferService service,CancellationToken ct)=>Results.Ok(await service.EventsAsync(User(user),id,offerId,cursor,ct)));
        offers.MapGet("/{offerId}/commands/{operation}/{commandId}",async(string id,string offerId,string operation,string commandId,ClaimsPrincipal user,SourcingOfferService service,CancellationToken ct)=>{
            if(operation is not ("accept" or "decline"))return Results.StatusCode(403);
            return Results.Ok(await service.ReadReceiptAsync(User(user),id,offerId,operation,commandId,ct));
        });
        offers.MapPost("/{offerId}/accept",async(string id,string offerId,SourcingOfferActionInput input,ClaimsPrincipal user,SourcingOfferService service,CancellationToken ct)=>Results.Ok(await service.AcceptAsync(User(user),id,offerId,input,ct))).AddEndpointFilter<SourcingOfferTransactionFilter>();
        offers.MapPost("/{offerId}/decline",async(string id,string offerId,SourcingOfferActionInput input,ClaimsPrincipal user,SourcingOfferService service,CancellationToken ct)=>Results.Ok(await service.DeclineAsync(User(user),id,offerId,input,ct))).AddEndpointFilter<SourcingOfferTransactionFilter>();
    }

    public static void MapAdminSourcingOffers(this RouteGroupBuilder admin)
    {
        var offers=admin.MapGroup("/sourcing/requests/{id}/offers");
        offers.MapGet("",async(string id,string? cursor,SourcingOfferService service,CancellationToken ct)=>Results.Ok(await service.PageAsync(null,id,cursor,ct))).RequireAuthorization("sales.read");
        offers.MapGet("/{offerId}",async(string id,string offerId,SourcingOfferService service,CancellationToken ct)=>Results.Ok(await service.ReadAsync(null,id,offerId,ct))).RequireAuthorization("sales.read");
        offers.MapGet("/{offerId}/events",async(string id,string offerId,string? cursor,SourcingOfferService service,CancellationToken ct)=>Results.Ok(await service.EventsAsync(null,id,offerId,cursor,ct))).RequireAuthorization("sales.read");
        offers.MapGet("/{offerId}/commands/{operation}/{commandId}",async(string id,string offerId,string operation,string commandId,ClaimsPrincipal user,SourcingOfferService service,CancellationToken ct)=>{
            if(operation is not ("save" or "publish" or "withdraw"))return Results.StatusCode(403);
            return Results.Ok(await service.ReadReceiptAsync(User(user),id,offerId,operation,commandId,ct));
        }).RequireAuthorization("finance.write");
        offers.MapPut("/{offerId}",async(string id,string offerId,SourcingOfferSaveInput input,ClaimsPrincipal user,SourcingOfferService service,CancellationToken ct)=>Results.Ok(await service.SaveDraftAsync(User(user),id,offerId,input,ct))).RequireAuthorization("finance.write");
        offers.MapPost("/{offerId}/publish",async(string id,string offerId,SourcingOfferPublishInput input,ClaimsPrincipal user,SourcingOfferService service,CancellationToken ct)=>Results.Ok(await service.PublishAsync(User(user),id,offerId,input,ct))).RequireAuthorization("finance.write");
        offers.MapPost("/{offerId}/withdraw",async(string id,string offerId,SourcingOfferActionInput input,ClaimsPrincipal user,SourcingOfferService service,CancellationToken ct)=>Results.Ok(await service.WithdrawAsync(User(user),id,offerId,input,ct))).RequireAuthorization("finance.write");
        admin.MapGet("/sourcing/requests/{id}/offer-skus",async(string id,string listingId,string? query,string? cursor,SourcingOfferService service,CancellationToken ct)=>Results.Ok(await service.LookupAsync(id,listingId,query,cursor,ct))).RequireAuthorization("sales.read");
        admin.MapGet("/sourcing/requests/{id}/offer-skus/{variantId}",async(string id,string listingId,string variantId,SourcingOfferService service,CancellationToken ct)=>Results.Ok(await service.ReadSkuAsync(id,listingId,variantId,ct))).RequireAuthorization("sales.read");
    }

    // Scope the larger draft limit to its actual route; old commands and any
    // misspelled/unrecognized Offer route keep the existing 16 KiB limit.
    public static bool IsDraftSave(HttpRequest request)
    {
        if(!HttpMethods.IsPut(request.Method))return false;
        var parts=(request.Path.Value??"").Split('/',StringSplitOptions.None);
        return parts.Length==8&&parts[0]==""&&parts[1]=="api"&&parts[2]=="admin"&&parts[3]=="sourcing"&&parts[4]=="requests"&&parts[6]=="offers"&&CanonicalId(parts[5])&&CanonicalId(parts[7]);
    }
    private static bool CanonicalId(string value)=>value.Length==32&&value.All(c=>c is >= 'a' and <= 'f' or >= '0' and <= '9')&&Guid.TryParseExact(value,"N",out var id)&&id!=Guid.Empty;
    private static string User(ClaimsPrincipal user)=>user.FindFirstValue("sub")??throw new BusinessException("invalid_credentials","A complete session is required.");
}

public sealed class SourcingOfferTransactionFilter:IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context,EndpointFilterDelegate next)=>await context.HttpContext.RequestServices.GetRequiredService<SourcingTransactionCoordinator>().RunAsync(async()=>await next(context),commit:result=>context.HttpContext.Response.StatusCode<400&&result is not IStatusCodeHttpResult{StatusCode:>=400},ct:context.HttpContext.RequestAborted,includePurchaseConfiguration:true);
}
