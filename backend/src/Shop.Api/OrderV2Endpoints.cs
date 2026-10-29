using System.Security.Claims;
using System.Text.Json.Serialization;
using Shop.Modules.Sales;

// Browser selections only; accepted prices, allocations, quantities and owner
// are resolved again from the server's current cart and immutable agreements.
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CheckoutQuoteV5Input(string? CartVersion,string? MethodId,string? PlanId,string? RequestId);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record OrderAddressV2Input(string CountryCode,string Province,string City,string Address,string PostalCode);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CreateOrderV2Input(string QuoteId,string RequestId,string ContactName,string ContactPhone,OrderAddressV2Input? Delivery,string? Note,bool AcknowledgeTemporary)
{
    public CreateOrderInput ToDomain()=>new(QuoteId,RequestId,ContactName,ContactPhone,Delivery is null?null:new(Delivery.CountryCode,Delivery.Province,Delivery.City,Delivery.Address,Delivery.PostalCode),Note,AcknowledgeTemporary);
}
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CancelOrderV2Input(string Version);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record AdminCancelOrderV2Input(string OwnerId,string Version);

public static class OrderV2Endpoints
{
    public static void MapOrdersV2(this RouteGroupBuilder parent)
    {
        // The parent retains customer policy, origin, rate and input filters.
        var group=parent.MapGroup("/v2");
        group.MapPost("",async(CreateOrderV2Input input,HttpContext http,OrderV2Service service,CancellationToken ct)=>{
            var result=await service.CreateAsync(http.User.FindFirstValue("sub")!,input.ToDomain(),ct);
            http.Response.Headers.Location="/api/orders/v2/"+result.Order.Summary.Id;
            return Results.Json(result,statusCode:result.Replayed?200:201);
        }).AddEndpointFilter<CheckoutTransactionFilter>();
        group.MapGet("",async(string? cursor,ClaimsPrincipal user,OrderV2Service service,CancellationToken ct)=>Results.Ok(await service.ListAsync(user.FindFirstValue("sub")!,cursor,ct)));
        group.MapGet("/{id}",async(string id,ClaimsPrincipal user,OrderV2Service service,CancellationToken ct)=>Results.Ok(await service.ReadAsync(user.FindFirstValue("sub")!,id,ct)));
        group.MapPost("/{id}/cancel",async(string id,CancelOrderV2Input input,ClaimsPrincipal user,OrderV2Service service,CancellationToken ct)=>Results.Ok(await service.CancelAsync(user.FindFirstValue("sub")!,id,input.Version,user.FindFirstValue("sub")!,ct))).AddEndpointFilter<CheckoutTransactionFilter>();
    }

    public static void MapAdminOrdersV2(this RouteGroupBuilder admin)
    {
        admin.MapGet("/orders/v2",async(string? cursor,OrderV2Service service,CancellationToken ct)=>Results.Ok(await service.ListAsync(null,cursor,ct))).RequireAuthorization("sales.read");
        admin.MapGet("/orders/v2/{ownerId}/{id}",async(string ownerId,string id,OrderV2Service service,CancellationToken ct)=>Results.Ok(await service.ReadAsync(ownerId,id,ct))).RequireAuthorization("sales.write");
        admin.MapPost("/orders/v2/{id}/cancel",async(string id,AdminCancelOrderV2Input input,ClaimsPrincipal user,OrderV2Service service,CancellationToken ct)=>Results.Ok(await service.CancelAsync(input.OwnerId,id,input.Version,user.FindFirstValue("sub")!,ct))).RequireAuthorization("sales.write");
    }
}
