using System.Security.Claims;
using Shop.Modules.Market;
using Shop.Modules.Sales;
using Shop.SharedKernel;

public static class SourcingEndpoints
{
    public static void MapSourcing(this WebApplication app,string[] origins)
    {
        var cart=app.MapGroup("/api/cart/{locale}/sourcing").RequireRateLimiting("cart");
        cart.AddEndpointFilter(InputValidation.Filter);cart.AddEndpointFilter(OriginFilter(origins));
        cart.AddEndpointFilter(async(context,next)=>{
            try{return await next(context);}
            catch(BusinessException e)when(e.Code=="cart_session_expired"){context.HttpContext.Response.Cookies.Delete(CartEndpoints.CookieName,CartEndpoints.Cookie(app.Environment.IsDevelopment()));throw;}
        });
        cart.MapGet("",async(string locale,HttpContext http,CartSourcingService service,CancellationToken ct)=>Results.Ok(await service.ReadAsync(CartEndpoints.Identity(http),locale,ct))).AddEndpointFilter<SourcingTransactionFilter>().AllowAnonymous();
        cart.MapPut("",async(string locale,CartSourcingInput input,HttpContext http,CartSourcingService service,CancellationToken ct)=>{
            var identity=CartEndpoints.Identity(http);var created=identity.OwnerId is null&&identity.GuestToken is null;
            if(created)identity=identity with{GuestToken=CartService.CreateGuestToken()};
            var result=await service.ReplaceAsync(identity,locale,input,ct);
            if(created)http.Response.Cookies.Append(CartEndpoints.CookieName,identity.GuestToken!,CartEndpoints.Cookie(app.Environment.IsDevelopment()));
            return Results.Ok(result);
        }).AddEndpointFilter<SourcingTransactionFilter>().AllowAnonymous();
        cart.MapPost("/submit",async(string locale,SourcingSubmitInput input,ClaimsPrincipal user,HttpContext http,SourcingRequestService service,CancellationToken ct)=>{
            var result=await service.SubmitAsync(User(user),locale,input,ct);http.Response.Headers.Location="/api/sourcing/requests/"+result.Id;
            return Results.Json(result,statusCode:result.Replayed?200:201);
        }).RequireAuthorization("customer").AddEndpointFilter<SourcingTransactionFilter>();

        var requests=app.MapGroup("/api/sourcing/requests").RequireAuthorization("customer").RequireRateLimiting("orders");
        requests.AddEndpointFilter(InputValidation.Filter);requests.AddEndpointFilter(OriginFilter(origins));
        requests.MapGet("",async(string? state,string? query,string? cursor,ClaimsPrincipal user,SourcingRequestService service,CancellationToken ct)=>Results.Ok(await service.PageAsync(User(user),state,query,cursor,ct)));
        requests.MapGet("/commands/{operation}/{commandId}",async(string operation,string commandId,ClaimsPrincipal user,SourcingRequestService service,CancellationToken ct)=>{
            if(operation is not ("submit" or "cancel"))return Results.StatusCode(403);
            return Results.Ok(await service.ReadReceiptAsync(User(user),operation,commandId,null,ct));
        });
        requests.MapGet("/{id}",async(string id,ClaimsPrincipal user,SourcingRequestService service,CancellationToken ct)=>Results.Ok(await service.ReadAsync(User(user),id,ct)));
        requests.MapGet("/{id}/events",async(string id,string? cursor,ClaimsPrincipal user,SourcingRequestService service,CancellationToken ct)=>Results.Ok(await service.EventsAsync(User(user),id,cursor,ct)));
        requests.MapGet("/{id}/orders",async(string id,string? cursor,ClaimsPrincipal user,IMarketOrderProjection service,CancellationToken ct)=>Results.Ok(await service.ReadAsync(User(user),id,cursor,ct)));
        requests.MapPost("/{id}/cancel",async(string id,SourcingActionInput input,ClaimsPrincipal user,SourcingRequestService service,CancellationToken ct)=>Results.Ok(await service.CancelAsync(User(user),id,input,ct))).AddEndpointFilter<SourcingTransactionFilter>();
    }
    public static void MapAdminSourcing(this RouteGroupBuilder admin)
    {
        admin.MapGet("/sourcing/requests",async(string? state,string? query,string? cursor,SourcingRequestService service,CancellationToken ct)=>Results.Ok(await service.PageAsync(null,state,query,cursor,ct))).RequireAuthorization("sales.read");
        admin.MapGet("/sourcing/requests/{id}",async(string id,SourcingRequestService service,CancellationToken ct)=>Results.Ok(await service.ReadAsync(null,id,ct))).RequireAuthorization("sales.read");
        admin.MapGet("/sourcing/requests/{id}/events",async(string id,string? cursor,SourcingRequestService service,CancellationToken ct)=>Results.Ok(await service.EventsAsync(null,id,cursor,ct))).RequireAuthorization("sales.read");
        admin.MapGet("/sourcing/requests/{id}/commands/{operation}/{commandId}",async(string id,string operation,string commandId,ClaimsPrincipal user,SourcingRequestService service,CancellationToken ct)=>{
            if(operation is not ("review" or "unavailable"))return Results.StatusCode(403);
            return Results.Ok(await service.ReadReceiptAsync(User(user),operation,commandId,id,ct));
        }).RequireAuthorization("sales.write");
        admin.MapPost("/sourcing/requests/{id}/review",async(string id,SourcingActionInput input,ClaimsPrincipal user,SourcingRequestService service,CancellationToken ct)=>Results.Ok(await service.ReviewAsync(User(user),id,input,ct))).RequireAuthorization("sales.write");
        admin.MapPost("/sourcing/requests/{id}/unavailable",async(string id,SourcingUnavailableInput input,ClaimsPrincipal user,SourcingRequestService service,CancellationToken ct)=>Results.Ok(await service.UnavailableAsync(User(user),id,input,ct))).RequireAuthorization("sales.write");
    }
    private static string User(ClaimsPrincipal user)=>user.FindFirstValue("sub")??throw new BusinessException("invalid_credentials","A complete session is required.");
    private static Func<EndpointFilterInvocationContext,EndpointFilterDelegate,ValueTask<object?>> OriginFilter(string[] origins)=>async(context,next)=>{
        var http=context.HttpContext;var origin=http.Request.Headers.Origin.ToString();
        if((!HttpMethods.IsGet(http.Request.Method)||origin.Length>0)&&!origins.Contains(origin,StringComparer.Ordinal))return Results.StatusCode(403);
        return await next(context);
    };
    public static async Task LimitBodyAsync(HttpContext http,RequestDelegate next)
    {
        var path=http.Request.Path.Value??"";
        var creditOrder=CreditOrderEndpoints.IsScope(path);var creditQuote=CreditCheckoutQuoteEndpoints.IsScope(path);var credit=CreditApplicationEndpoints.IsScope(http.Request.Path);
        var pages=http.Request.Path.StartsWithSegments("/api/admin/pages")||http.Request.Path.StartsWithSegments("/api/admin/blog-posts");var redirects=http.Request.Path.StartsWithSegments("/api/admin/redirects");
        var scoped=path.StartsWith("/api/phones/",StringComparison.OrdinalIgnoreCase)||path.StartsWith("/api/admin/market/",StringComparison.OrdinalIgnoreCase)&&path.Contains("/phone-configurations/",StringComparison.OrdinalIgnoreCase)||redirects||pages||creditOrder||creditQuote||credit||PrivateRealtimeTransport.IsScope(path)||path.StartsWith("/api/notifications",StringComparison.OrdinalIgnoreCase)||TicketEndpoints.IsScope(path)||path.StartsWith("/api/sourcing/",StringComparison.OrdinalIgnoreCase)||path.StartsWith("/api/admin/sourcing/",StringComparison.OrdinalIgnoreCase)||path.StartsWith("/api/cart/",StringComparison.OrdinalIgnoreCase)&&(path.Contains("/sourcing",StringComparison.OrdinalIgnoreCase)||path.Contains("/v2",StringComparison.OrdinalIgnoreCase))||SourcingSupplyEndpoints.IsReceivingScope(path);
        if(!scoped||CreditDocumentEndpoints.IsUpload(http.Request)||HttpMethods.IsGet(http.Request.Method)||HttpMethods.IsHead(http.Request.Method)){await next(http);return;}
        var maximum=redirects?16*1024:pages?128*1024:creditOrder?16*1024:creditQuote?8*1024:credit?(path.StartsWith("/api/admin/credit/requirements/commands/",StringComparison.Ordinal)&&HttpMethods.IsPost(http.Request.Method)?48*1024:8*1024):TicketEndpoints.IsScope(path)?32*1024:SourcingOfferEndpoints.IsDraftSave(http.Request)||SourcingSupplyEndpoints.IsReceiving(http.Request)||SourcingAllocationEndpoints.IsAllocation(http.Request)?64*1024:16*1024;
        if(http.Request.ContentLength>maximum)throw new BadHttpRequestException("Sourcing body limit exceeded.",413);
        var original=http.Request.Body;await using var buffered=new MemoryStream();var buffer=new byte[4096];
        while(true){var read=await original.ReadAsync(buffer,http.RequestAborted);if(read==0)break;if(buffered.Length+read>maximum)throw new BadHttpRequestException("Sourcing body limit exceeded.",413);await buffered.WriteAsync(buffer.AsMemory(0,read),http.RequestAborted);}
        buffered.Position=0;http.Request.Body=buffered;
        try{await next(http);}finally{http.Request.Body=original;}
    }
}
