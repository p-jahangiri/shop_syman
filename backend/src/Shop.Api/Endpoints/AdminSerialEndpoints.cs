using System.Security.Claims;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Inventory;
using Shop.SharedKernel;

public static class AdminSerialEndpoints
{
    public static void MapAdminSerials(this RouteGroupBuilder admin)
    {
        admin.MapGet("/inventory/variants/{id}/serials/v2",async(string id,string? state,string? query,string? cursor,IAdminStockCatalog catalog,IAdminSerialV2Reader serials,CancellationToken ct)=>{
            var filter=SerialPageQuery.Create(id,state,query);await Find(catalog,id,ct);return Results.Ok(await serials.PageAsync(filter,cursor,ct));
        }).RequireAuthorization("inventory.read");
        admin.MapGet("/inventory/variants/{id}/serials/{unitId}/history",async(string id,string unitId,string? before,IAdminStockCatalog catalog,IAdminSerialReader serials,CancellationToken ct)=>{
            await Find(catalog,id,ct);return Results.Ok(await serials.HistoryAsync(id,unitId,before,ct));
        }).RequireAuthorization("inventory.read");
        admin.MapGet("/inventory/variants/{id}/serials",async(string id,string? state,string? query,string? cursor,IAdminStockCatalog catalog,IAdminSerialReader serials,CancellationToken ct)=>{
            var filter=SerialPageQuery.Create(id,state,query);SerialPaging.Decode(cursor,filter);await Find(catalog,id,ct);return Results.Ok(await serials.PageAsync(filter,cursor,ct));
        }).RequireAuthorization("inventory.read");
        admin.MapPut("/inventory/variants/{id}/serial-mode",async(string id,SerialModeInput input,ClaimsPrincipal user,IAdminStockCatalog catalog,SerialInventoryService serials,CancellationToken ct)=>{
            var variant=await Find(catalog,id,ct);return Results.Ok(await serials.ConfigureAsync(variant.Id,variant.IsDigital,input,Actor(user),ct));
        }).RequireAuthorization("inventory.write");
        admin.MapPost("/inventory/variants/{id}/serials",async(string id,SerialReceiptInput input,ClaimsPrincipal user,IAdminStockCatalog catalog,SerialInventoryService serials,CancellationToken ct)=>{
            var variant=await Find(catalog,id,ct);return Results.Ok(await serials.ReceiveAsync(variant.Id,variant.IsDigital,input,Actor(user),ct));
        }).RequireAuthorization("inventory.write");
        admin.MapPost("/inventory/variants/{id}/serials/{unitId}/retire",async(string id,string unitId,SerialRetireInput input,ClaimsPrincipal user,IAdminStockCatalog catalog,SerialInventoryService serials,CancellationToken ct)=>{
            var variant=await Find(catalog,id,ct);return Results.Ok(await serials.RetireAsync(variant.Id,unitId,input,Actor(user),ct));
        }).RequireAuthorization("inventory.write");
    }
    private static async Task<StockVariantMetadata> Find(IAdminStockCatalog catalog,string id,CancellationToken ct){SerialRules.Identifier(id);return await catalog.FindAsync(id,ct)??throw new BusinessException("not_found","Variant not found.");}
    private static string Actor(ClaimsPrincipal user)=>user.FindFirstValue("sub")??throw new BusinessException("invalid_credentials","User identity is missing.");
}
