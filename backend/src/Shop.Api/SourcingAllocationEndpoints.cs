using System.Security.Claims;
using Shop.Modules.Inventory;
using Shop.Modules.Market;
using Shop.Modules.Sales;
using Shop.SharedKernel;

public static class SourcingAllocationEndpoints
{
    public static void MapAdminSourcingAllocations(this RouteGroupBuilder admin)
    {
        admin.MapGet("/inventory/sourcing-tasks/{taskId}/allocation",async(string taskId,SourcingAllocationCandidate service,CancellationToken ct)=>Results.Ok(await service.ReadAsync(taskId,ct))).RequireAuthorization("inventory.read");
        admin.MapPut("/inventory/sourcing-requests/{id}/tasks/{taskId}/allocations/{allocationId}",async(string id,string taskId,string allocationId,SourcingAllocationInput input,ClaimsPrincipal user,SupplyAllocationCoordinator service,CancellationToken ct)=>Results.Ok(await service.AllocateAsync(User(user),id,taskId,allocationId,input,ct))).RequireAuthorization("inventory.write");
        admin.MapPost("/inventory/sourcing-requests/{id}/tasks/{taskId}/allocations/{allocationId}/release",async(string id,string taskId,string allocationId,SourcingAllocationReleaseInput input,ClaimsPrincipal user,SupplyAllocationCoordinator service,CancellationToken ct)=>Results.Ok(await service.ReleaseAsync(User(user),id,taskId,allocationId,input,ct))).RequireAuthorization("inventory.write");
        admin.MapGet("/inventory/sourcing-allocations/{allocationId}",async(string allocationId,IInventorySourcingAllocations service,CancellationToken ct)=>Results.Ok(await service.ReadAsync(allocationId,null,ct))).RequireAuthorization("inventory.read");
        admin.MapGet("/inventory/sourcing-allocations/{allocationId}/events",async(string allocationId,string? cursor,IInventorySourcingAllocations service,CancellationToken ct)=>Results.Ok(await service.EventsAsync(allocationId,null,cursor,ct))).RequireAuthorization("inventory.read");
        admin.MapGet("/inventory/sourcing-allocations/{allocationId}/commands/{operation}/{commandId}",async(string allocationId,string operation,string commandId,ClaimsPrincipal user,IInventorySourcingAllocations service,CancellationToken ct)=>Results.Ok(await service.ReadCommandAsync(User(user),allocationId,operation,commandId,ct))).RequireAuthorization("inventory.read");
        admin.MapGet("/sourcing/requests/{id}/agreements/{agreementId}",async(string id,string agreementId,SourcingPriceAgreementService service,CancellationToken ct)=>Results.Ok(await service.ReadAsync(agreementId,id,null,ct))).RequireAuthorization("sales.read");
    }
    public static void MapSourcingAgreements(this WebApplication app,string[] origins)
    {
        var group=app.MapGroup("/api/sourcing/requests/{id}/agreements").RequireAuthorization("customer").RequireRateLimiting("orders");
        group.AddEndpointFilter(InputValidation.Filter);
        group.AddEndpointFilter(async(context,next)=>{
            var origin=context.HttpContext.Request.Headers.Origin.ToString();
            if(origin.Length>0&&!origins.Contains(origin,StringComparer.Ordinal))return Results.StatusCode(403);
            return await next(context);
        });
        group.MapGet("/{agreementId}",async(string id,string agreementId,ClaimsPrincipal user,SourcingPriceAgreementService service,CancellationToken ct)=>Results.Ok(await service.ReadAsync(agreementId,id,User(user),ct)));
    }
    public static bool IsAllocation(HttpRequest request)
    {
        if(!HttpMethods.IsPut(request.Method))return false;
        var p=(request.Path.Value??"").Split('/',StringSplitOptions.None);
        return p.Length==10&&p[0]==""&&p[1]=="api"&&p[2]=="admin"&&p[3]=="inventory"&&p[4]=="sourcing-requests"&&Canonical(p[5])&&p[6]=="tasks"&&Canonical(p[7])&&p[8]=="allocations"&&Canonical(p[9]);
    }
    private static bool Canonical(string value)=>value.Length==32&&value.All(c=>c is >= 'a' and <= 'f' or >= '0' and <= '9')&&Guid.TryParseExact(value,"N",out var id)&&id!=Guid.Empty;
    private static string User(ClaimsPrincipal user)=>user.FindFirstValue("sub")??throw new BusinessException("invalid_credentials","A complete session is required.");
}
