using Shop.Modules.Catalog.Application;

public static class AdminProductEndpoints
{
    public static void MapAdminProducts(this RouteGroupBuilder admin)
    {
        admin.MapGet("/products",async(string? query,string? status,string? categoryId,string? brandId,string? cursor,IAdminProducts service,CancellationToken ct)=>{var filter=AdminProductQuery.Create(query,status,categoryId,brandId);AdminProductPaging.Decode(cursor,filter);return Results.Ok(await service.PageAsync(filter,cursor,ct));}).RequireAuthorization("catalog.read");
        admin.MapGet("/products/{id}",async(string id,IAdminProducts service,CancellationToken ct)=>{AdminProductQuery.Identifier(id);return Results.Ok(await service.DetailAsync(id,ct));}).RequireAuthorization("catalog.read");
        admin.MapGet("/catalog/product-lookup",async([Microsoft.AspNetCore.Mvc.FromQuery] string[]? ids,IAdminProducts service,CancellationToken ct)=>{var keys=ids??[];Shop.Modules.Catalog.Infrastructure.AdminProducts.ValidateLookup(keys);return Results.Ok(await service.LookupAsync(keys,ct));}).RequireAuthorization("catalog.read");
    }
}
