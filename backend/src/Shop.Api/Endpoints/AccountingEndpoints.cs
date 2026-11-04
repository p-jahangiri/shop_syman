using System.Security.Claims;
using Shop.SharedKernel;
public static class AccountingEndpoints
{
    public static void MapAdminAccounting(this RouteGroupBuilder admin)
    {
        // No vendor endpoint, password format or inventory semantics is guessed.
        admin.MapGet("/accounting/holoo/status",()=>Results.Ok(new{SchemaVersion=1,Provider="holoo",LiveConfigured=false,CanReceive=false,CanWrite=false,Reason="holoo_contract_required",MappingAvailable=true})).RequireAuthorization("catalog.read");
        admin.MapGet("/accounting/holoo/links",async(string? companyKey,string? query,string? enabled,string? cursor,IAccountingCatalogLinks service,CancellationToken ct)=>Results.Ok(await service.PageAsync(companyKey,query,enabled,cursor,ct))).RequireAuthorization("catalog.read");
        admin.MapGet("/accounting/holoo/links/{id}",async(string id,IAccountingCatalogLinks service,CancellationToken ct)=>Results.Ok(await service.DetailAsync(id,ct))).RequireAuthorization("catalog.read");
        admin.MapGet("/accounting/holoo/variants",async(string? query,IAccountingCatalogLinks service,CancellationToken ct)=>Results.Ok(new{SchemaVersion=1,Items=await service.VariantsAsync(query,ct)})).RequireAuthorization("catalog.read");
        admin.MapPut("/accounting/holoo/links/{id}",async(string id,AccountingProductLinkInput input,ClaimsPrincipal user,IAccountingCatalogLinks service,CancellationToken ct)=>Results.Ok(new{Id=await service.SaveAsync(id,input,user.FindFirstValue("sub")!,ct)})).RequireAuthorization("catalog.write");
        admin.MapGet("/accounting/holoo/imports",async(string? companyKey,string? externalWarehouseKey,string? cursor,IAccountingImports service,CancellationToken ct)=>Results.Ok(await service.PageAsync(companyKey,cursor,ct,externalWarehouseKey))).RequireAuthorization("catalog.read");
        admin.MapGet("/accounting/holoo/imports/{id}",async(string id,IAccountingImports service,CancellationToken ct)=>Results.Ok(await service.ReadAsync(id,ct))).RequireAuthorization("catalog.read");
        admin.MapPut("/accounting/holoo/imports/{id}",async(string id,AccountingImportInput input,ClaimsPrincipal user,IAccountingImports service,CancellationToken ct)=>Results.Ok(await service.StageAsync(id,input,user.FindFirstValue("sub")!,ct))).RequireAuthorization("catalog.write");
        admin.MapGet("/accounting/holoo/warehouses",async(string? companyKey,string? cursor,IAccountingInventory service,CancellationToken ct)=>Results.Ok(await service.WarehousesAsync(companyKey,cursor,ct))).RequireAuthorization("inventory.read");
        admin.MapGet("/accounting/holoo/warehouses/{id}",async(string id,IAccountingInventory service,CancellationToken ct)=>Results.Ok(await service.WarehouseAsync(id,ct))).RequireAuthorization("inventory.read");
        admin.MapPut("/accounting/holoo/warehouses/{id}",async(string id,AccountingWarehouseInput input,ClaimsPrincipal user,IAccountingInventory service,CancellationToken ct)=>Results.Ok(await service.SaveWarehouseAsync(user.FindFirstValue("sub")!,id,input,ct))).RequireAuthorization("inventory.write");
        admin.MapGet("/accounting/holoo/warehouse-commands/{commandId}",async(string commandId,ClaimsPrincipal user,IAccountingInventory service,CancellationToken ct)=>Results.Ok(await service.WarehouseCommandAsync(user.FindFirstValue("sub")!,commandId,ct))).RequireAuthorization("inventory.write");
        admin.MapGet("/accounting/holoo/imports/{id}/reconciliation",async(string id,AccountingReconciliationCoordinator coordinator,CancellationToken ct)=>Results.Ok(await coordinator.ReadAsync(id,ct))).RequireAuthorization("catalog.read","inventory.read");
        admin.MapGet("/accounting/holoo/imports/{id}/stock-preview",async(string id,AccountingStockCoordinator coordinator,CancellationToken ct)=>Results.Ok(await coordinator.PreviewAsync(id,ct))).RequireAuthorization("catalog.read","inventory.read");
        admin.MapPost("/accounting/holoo/imports/{id}/stock-commands",async(string id,AccountingStockApplyInput input,ClaimsPrincipal user,AccountingStockCoordinator coordinator,CancellationToken ct)=>Results.Ok(await coordinator.ApplyAsync(user.FindFirstValue("sub")!,id,input,ct))).RequireAuthorization("catalog.read","inventory.write");
        admin.MapGet("/accounting/holoo/imports/{id}/stock-commands/{commandId}",async(string id,string commandId,ClaimsPrincipal user,IAccountingStockApplications service,CancellationToken ct)=>Results.Ok(await service.CommandAsync(user.FindFirstValue("sub")!,id,commandId,ct))).RequireAuthorization("catalog.read","inventory.write");
        admin.MapGet("/accounting/holoo/stock-applications/{id}",async(string id,IAccountingStockApplications service,CancellationToken ct)=>Results.Ok(await service.ApplicationAsync(id,ct))).RequireAuthorization("catalog.read","inventory.read");
    }
}
