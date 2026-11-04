using System.Security.Claims;
using Shop.Modules.Sales;
using Shop.SharedKernel;

public static class CartEndpoints
{
    internal const string CookieName = "sayman_cart";
    public static void MapCart(this WebApplication app, string[] origins)
    {
        var group = app.MapGroup("/api/cart").RequireRateLimiting("cart"); group.AddEndpointFilter(InputValidation.Filter);
        group.AddEndpointFilter(async (context, next) => {
            var http = context.HttpContext;
            if (!HttpMethods.IsGet(http.Request.Method) && !origins.Contains(http.Request.Headers.Origin.ToString(), StringComparer.Ordinal)) return Results.StatusCode(403);
            try { return await next(context); }
            catch (BusinessException e) when (e.Code == "cart_session_expired") { http.Response.Cookies.Delete(CookieName, Cookie(app.Environment.IsDevelopment())); throw; }
        });
        group.MapGet("/{locale}", async (string locale, HttpContext http, CartService service, CancellationToken ct) => Results.Ok(await service.ReadAsync(Identity(http), locale, ct))).AllowAnonymous();
        group.MapPost("/{locale}/quote", async (string locale, CheckoutQuoteInput input, HttpContext http, CheckoutQuoteService service, CancellationToken ct) => Results.Ok(await service.CreateAsync(Identity(http), locale, input, ct))).AddEndpointFilter<CheckoutTransactionFilter>().AllowAnonymous();
        group.MapPost("/{locale}/v2/quote", async (string locale, CheckoutQuoteV4Input input, HttpContext http, CheckoutQuoteV4Service service, CancellationToken ct) => Results.Ok(await service.CreateAsync(Identity(http), locale, new(input.CartVersion,input.MethodId,input.PlanId,input.RequestId), ct))).AddEndpointFilter<CheckoutTransactionFilter>().RequireAuthorization("customer");
        group.MapPost("/{locale}/v2/order-quote", async (string locale, CheckoutQuoteV5Input input, HttpContext http, CheckoutQuoteV5Service service, CancellationToken ct) => Results.Ok(await service.CreateAsync(Identity(http),locale,new(input.CartVersion,input.MethodId,input.PlanId,input.RequestId),ct))).AddEndpointFilter<CheckoutTransactionFilter>().RequireAuthorization("customer");
        group.MapPut("/{locale}", async (string locale, CartInput input, HttpContext http, CartService service, CancellationToken ct) => {
            var identity = Identity(http); var created = identity.OwnerId is null && identity.GuestToken is null;
            if (created) identity = identity with { GuestToken = CartService.CreateGuestToken() };
            var result = await service.ReplaceAsync(identity, locale, input, ct);
            if (created) http.Response.Cookies.Append(CookieName, identity.GuestToken!, Cookie(app.Environment.IsDevelopment()));
            return Results.Ok(result);
        }).AllowAnonymous();
        group.MapPost("/{locale}/merge", async (string locale, HttpContext http, CartService service, CancellationToken ct) => {
            var result = await service.MergeAsync(http.User.FindFirstValue("sub")!, Guest(http), locale, ct);
            http.Response.Cookies.Delete(CookieName, Cookie(app.Environment.IsDevelopment())); return Results.Ok(result);
        }).RequireAuthorization("customer");
        group.MapGet("/{locale}/v2",async(string locale,HttpContext http,CartV2Service service,CancellationToken ct)=>Results.Ok(await service.ReadAsync(Identity(http),locale,ct))).AddEndpointFilter<SourcingTransactionFilter>().AllowAnonymous();
        group.MapPut("/{locale}/v2",async(string locale,CartV2Input input,HttpContext http,CartV2Service service,CancellationToken ct)=>{
            var identity=Identity(http);var created=identity.OwnerId is null&&identity.GuestToken is null;
            if(created)identity=identity with{GuestToken=CartService.CreateGuestToken()};
            var result=await service.ReplaceAsync(identity,locale,input,ct);
            if(created)http.Response.Cookies.Append(CookieName,identity.GuestToken!,Cookie(app.Environment.IsDevelopment()));
            return Results.Ok(result);
        }).AddEndpointFilter<SourcingTransactionFilter>().AllowAnonymous();
        group.MapPost("/{locale}/v2/merge",async(string locale,HttpContext http,CartV2Service service,CancellationToken ct)=>{
            var result=await service.MergeAsync(http.User.FindFirstValue("sub")!,Guest(http),locale,ct);
            http.Response.Cookies.Delete(CookieName,Cookie(app.Environment.IsDevelopment()));return Results.Ok(result);
        }).AddEndpointFilter<SourcingTransactionFilter>().RequireAuthorization("customer");
        group.MapDelete("/{locale}/v2/offers/{agreementId}",async(string locale,string agreementId,[Microsoft.AspNetCore.Mvc.FromBody]CartOfferRemoveInput input,HttpContext http,CartOfferService service,CancellationToken ct)=>Results.Ok(await service.RemoveAsync(http.User.FindFirstValue("sub")!,locale,agreementId,input,ct))).AddEndpointFilter<SourcingTransactionFilter>().RequireAuthorization("customer");
        group.MapGet("/{locale}/v2/offers/{agreementId}/commands/remove/{commandId}",async(string locale,string agreementId,string commandId,HttpContext http,CartOfferService service,CancellationToken ct)=>{
            if(locale is not("fa" or "en"))throw new BusinessException("invalid_locale","Use a supported locale.");
            return Results.Ok(await service.ReadRemovalCommandAsync(http.User.FindFirstValue("sub")!,agreementId,commandId,ct));
        }).RequireAuthorization("customer");
    }
    internal static CartIdentity Identity(HttpContext http)
    {
        if (http.User.Identity?.IsAuthenticated == true) {
            if (http.User.FindFirstValue("token_kind") != "access" || http.User.FindFirstValue("sub") is not { Length: > 0 } id) throw new BusinessException("invalid_credentials", "A complete customer session is required.");
            return new(id, null);
        }
        if (http.Request.Headers.ContainsKey("Authorization")) throw new BusinessException("invalid_credentials", "The customer session is invalid.");
        return new(null, Guest(http));
    }
    internal static string? Guest(HttpContext http)
    {
        var token = http.Request.Cookies[CookieName]; if (token is null) return null;
        if (CartService.ValidGuestToken(token)) return token;
        throw new BusinessException("cart_session_expired", "The guest cart session is unavailable.");
    }
    internal static CookieOptions Cookie(bool development) => new() { HttpOnly = true, Secure = !development, SameSite = SameSiteMode.Strict, Path = "/api/cart", MaxAge = TimeSpan.FromDays(30), IsEssential = true };
}
