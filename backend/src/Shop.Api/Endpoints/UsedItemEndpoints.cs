using System.Security.Claims;
using Shop.Modules.Catalog.Infrastructure;
using Shop.SharedKernel;
public static class UsedItemEndpoints
{
    public static void MapAdminUsedItems(this RouteGroupBuilder admin)
    {
        admin.MapGet("/used-items/variants",async(string? query,bool? reported,UsedItemConditions service,CancellationToken ct)=>Results.Ok(await service.ChoicesAsync(query,ct,reported))).RequireAuthorization("catalog.read");
        admin.MapGet("/used-items/{variantId}",async(string variantId,UsedItemConditions service,CancellationToken ct)=>Results.Ok(await service.ReadAsync(variantId,ct))).RequireAuthorization("catalog.read");
        admin.MapPut("/used-items/{variantId}/commands/{commandId}",async(string variantId,string commandId,SaveUsedItemInput input,ClaimsPrincipal user,UsedItemConditions service,IUsedItemStockPolicy stock,CancellationToken ct)=>Results.Ok(await service.SaveAsync(user.FindFirstValue("sub")!,variantId,commandId,input,stock,ct))).RequireAuthorization("catalog.write","inventory.write");
    }
}
