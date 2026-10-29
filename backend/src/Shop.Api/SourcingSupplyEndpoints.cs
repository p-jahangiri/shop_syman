using System.Security.Claims;
using Shop.Modules.Market;
using Shop.SharedKernel;

public static class SourcingSupplyEndpoints
{
    public static void MapSourcingSupply(this WebApplication app,string[] origins)
    {
        var group=app.MapGroup("/api/sourcing/requests/{id}/supply").RequireAuthorization("customer").RequireRateLimiting("orders");
        group.AddEndpointFilter(InputValidation.Filter);
        group.AddEndpointFilter(async(context,next)=>{
            var http=context.HttpContext;var origin=http.Request.Headers.Origin.ToString();
            if((!HttpMethods.IsGet(http.Request.Method)||origin.Length>0)&&!origins.Contains(origin,StringComparer.Ordinal))return Results.StatusCode(403);
            return await next(context);
        });
        group.MapGet("",async(string id,string? cursor,ClaimsPrincipal user,SourcingSupplyProjection service,CancellationToken ct)=>Results.Ok(await service.PageV1Async(User(user),id,cursor,ct)));
        group.MapGet("/{taskId}",async(string id,string taskId,ClaimsPrincipal user,SourcingSupplyProjection service,CancellationToken ct)=>Results.Ok(await service.CustomerV1Async(User(user),id,taskId,ct)));
        group.MapGet("/v2",async(string id,string? cursor,ClaimsPrincipal user,SourcingSupplyProjection service,CancellationToken ct)=>Results.Ok(await service.PageAsync(User(user),id,cursor,ct)));
        group.MapGet("/v2/{taskId}",async(string id,string taskId,ClaimsPrincipal user,SourcingSupplyProjection service,CancellationToken ct)=>Results.Ok(await service.CustomerAsync(User(user),id,taskId,ct)));
        group.MapGet("/{taskId}/events",async(string id,string taskId,string? cursor,ClaimsPrincipal user,SourcingSupplyService service,CancellationToken ct)=>Results.Ok(await service.EventsAsync(User(user),id,taskId,cursor,ct)));
    }
    public static void MapAdminSourcingSupply(this RouteGroupBuilder admin)
    {
        admin.MapPut("/sourcing/requests/{id}/offers/{offerId}/supply/{taskId}",async(string id,string offerId,string taskId,SourcingSupplyStartInput input,ClaimsPrincipal user,SourcingSupplyService service,CancellationToken ct)=>Results.Ok(await service.StartAsync(User(user),id,offerId,taskId,input,ct))).RequireAuthorization("sales.write");
        var group=admin.MapGroup("/sourcing/requests/{id}/supply");
        group.MapGet("",async(string id,string? cursor,SourcingSupplyProjection service,CancellationToken ct)=>Results.Ok(await service.PageV1Async(null,id,cursor,ct))).RequireAuthorization("sales.read");
        group.MapGet("/{taskId}",async(string id,string taskId,SourcingSupplyProjection service,CancellationToken ct)=>Results.Ok(await service.AdminV1Async(id,taskId,ct))).RequireAuthorization("sales.read");
        group.MapGet("/v2",async(string id,string? cursor,SourcingSupplyProjection service,CancellationToken ct)=>Results.Ok(await service.PageAsync(null,id,cursor,ct))).RequireAuthorization("sales.read");
        group.MapGet("/v2/{taskId}",async(string id,string taskId,SourcingSupplyProjection service,CancellationToken ct)=>Results.Ok(await service.AdminAsync(id,taskId,ct))).RequireAuthorization("sales.read");
        group.MapGet("/{taskId}/events",async(string id,string taskId,string? cursor,SourcingSupplyService service,CancellationToken ct)=>Results.Ok(await service.AdminEventsAsync(id,taskId,cursor,ct))).RequireAuthorization("sales.read");
        group.MapGet("/{taskId}/commands/{operation}/{commandId}",async(string id,string taskId,string operation,string commandId,ClaimsPrincipal user,SourcingSupplyService service,CancellationToken ct)=>Results.Ok(await service.ReadReceiptAsync(User(user),id,taskId,operation,commandId,ct))).RequireAuthorization("sales.write");
        group.MapPost("/{taskId}/requested",async(string id,string taskId,SourcingSupplySourceInput input,ClaimsPrincipal user,SourcingSupplyService service,CancellationToken ct)=>Results.Ok(await service.RequestedAsync(User(user),id,taskId,input,ct))).RequireAuthorization("sales.write");
        group.MapPost("/{taskId}/ordered",async(string id,string taskId,SourcingSupplySourceInput input,ClaimsPrincipal user,SourcingSupplyService service,CancellationToken ct)=>Results.Ok(await service.OrderedAsync(User(user),id,taskId,input,ct))).RequireAuthorization("sales.write");
        group.MapPost("/{taskId}/progress",async(string id,string taskId,SourcingSupplyProgressInput input,ClaimsPrincipal user,SourcingSupplyService service,CancellationToken ct)=>Results.Ok(await service.ProgressAsync(User(user),id,taskId,input,ct))).RequireAuthorization("sales.write");
        group.MapPost("/{taskId}/cancel",async(string id,string taskId,SourcingSupplyCloseInput input,ClaimsPrincipal user,SourcingSupplyService service,CancellationToken ct)=>Results.Ok(await service.CancelAsync(User(user),id,taskId,input,ct))).RequireAuthorization("sales.write");
        group.MapPost("/{taskId}/fail",async(string id,string taskId,SourcingSupplyCloseInput input,ClaimsPrincipal user,SourcingSupplyService service,CancellationToken ct)=>Results.Ok(await service.FailAsync(User(user),id,taskId,input,ct))).RequireAuthorization("sales.write");

        admin.MapGet("/inventory/sourcing-tasks",async(string? state,string? query,string? cursor,SourcingSupplyProjection service,CancellationToken ct)=>Results.Ok(await service.InventoryPageV1Async(state,query,cursor,ct))).RequireAuthorization("inventory.read");
        admin.MapGet("/inventory/sourcing-tasks/{taskId}",async(string taskId,SourcingSupplyProjection service,CancellationToken ct)=>Results.Ok(await service.InventoryV1Async(taskId,ct))).RequireAuthorization("inventory.read");
        admin.MapGet("/inventory/sourcing-tasks/v2",async(string? state,string? query,string? cursor,SourcingSupplyProjection service,CancellationToken ct)=>Results.Ok(await service.InventoryPageAsync(state,query,cursor,ct))).RequireAuthorization("inventory.read");
        admin.MapGet("/inventory/sourcing-tasks/v2/{taskId}",async(string taskId,SourcingSupplyProjection service,CancellationToken ct)=>Results.Ok(await service.InventoryAsync(taskId,ct))).RequireAuthorization("inventory.read");
        admin.MapPost("/inventory/sourcing-requests/{id}/tasks/{taskId}/receipts/{receiptId}",async(string id,string taskId,string receiptId,SourcingReceiptInput input,ClaimsPrincipal user,SupplyReceivingCoordinator service,CancellationToken ct)=>Results.Ok(await service.ReceiveAsync(User(user),id,taskId,receiptId,input,ct))).RequireAuthorization("inventory.write");
        admin.MapGet("/inventory/sourcing-receipts/{receiptId}",async(string receiptId,IInventorySourcingReceiving service,CancellationToken ct)=>Results.Ok(await service.ReadAsync(receiptId,ct))).RequireAuthorization("inventory.read");
        admin.MapGet("/inventory/sourcing-receipts/{receiptId}/commands/{commandId}",async(string receiptId,string commandId,ClaimsPrincipal user,IInventorySourcingReceiving service,CancellationToken ct)=>Results.Ok(await service.ReadCommandAsync(User(user),receiptId,commandId,ct))).RequireAuthorization("inventory.read");
        admin.MapGet("/inventory/receiving-unit-mappings",async(string? originSystem,string? companyKey,string? warehouseKey,string? variantId,string? cursor,IReceivingUnitMappings service,CancellationToken ct)=>Results.Ok(await service.PageAsync(originSystem,companyKey,warehouseKey,variantId,cursor,ct))).RequireAuthorization("inventory.read");
        admin.MapGet("/inventory/receiving-unit-mappings/{mappingId}",async(string mappingId,IReceivingUnitMappings service,CancellationToken ct)=>Results.Ok(await service.ReadAsync(mappingId,ct))).RequireAuthorization("inventory.read");
        admin.MapPut("/inventory/receiving-unit-mappings/{mappingId}",async(string mappingId,ReceivingUnitMappingInput input,ClaimsPrincipal user,SupplyReceivingCoordinator service,CancellationToken ct)=>Results.Ok(await service.SaveMappingAsync(User(user),mappingId,input,ct))).RequireAuthorization("inventory.write");
        admin.MapGet("/inventory/receiving-unit-mappings/{mappingId}/commands/{commandId}",async(string mappingId,string commandId,ClaimsPrincipal user,IReceivingUnitMappings service,CancellationToken ct)=>Results.Ok(await service.ReadCommandAsync(User(user),mappingId,commandId,ct))).RequireAuthorization("inventory.read");
    }
    public static bool IsReceiving(HttpRequest request)
    {
        if(!HttpMethods.IsPost(request.Method))return false;
        var parts=(request.Path.Value??"").Split('/',StringSplitOptions.None);
        return parts.Length==10&&parts[0]==""&&parts[1]=="api"&&parts[2]=="admin"&&parts[3]=="inventory"&&parts[4]=="sourcing-requests"&&CanonicalId(parts[5])&&parts[6]=="tasks"&&CanonicalId(parts[7])&&parts[8]=="receipts"&&CanonicalId(parts[9]);
    }
    public static bool IsReceivingScope(string path)=>path.StartsWith("/api/admin/inventory/sourcing-requests/",StringComparison.OrdinalIgnoreCase)||path.StartsWith("/api/admin/inventory/receiving-unit-mappings",StringComparison.OrdinalIgnoreCase);
    private static bool CanonicalId(string value)=>value.Length==32&&value.All(c=>c is >= 'a' and <= 'f' or >= '0' and <= '9')&&Guid.TryParseExact(value,"N",out var id)&&id!=Guid.Empty;
    private static string User(ClaimsPrincipal user)=>user.FindFirstValue("sub")??throw new BusinessException("invalid_credentials","A complete session is required.");
}
