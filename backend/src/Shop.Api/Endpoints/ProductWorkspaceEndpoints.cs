using System.Security.Claims;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Infrastructure;
using Shop.SharedKernel;

public static class ProductWorkspaceEndpoints
{
    public static void MapProductWorkspace(this RouteGroupBuilder admin, string[] origins)
    {
        var group = admin.MapGroup("/catalog/workspace").RequireAuthorization("catalog.read");
        group.AddEndpointFilter(async (context, next) =>
        {
            var http = context.HttpContext;
            var origin = http.Request.Headers.Origin.ToString();
            if (http.Request.Headers["X-Sayman-Client"] != "admin" || (!HttpMethods.IsGet(http.Request.Method) || origin.Length > 0) && !origins.Contains(origin, StringComparer.Ordinal))
                return Results.StatusCode(403);
            if (http.Request.Path.Value != "/api/admin/catalog/workspace/products" && http.Request.Query.Count > 0)
                return Results.BadRequest();
            try
            {
                return await next(context);
            }
            catch (ProductFieldValidationException invalid) { return Results.ValidationProblem(invalid.Errors.ToDictionary(p => p.Key, p => p.Value), title: "invalid_product_fields"); }
        });
        group.MapGet("/products", async (string? search, string? status, string? categoryId, string? brandId, string? availability, string? sort, string? direction, int? page, int? pageSize, HttpContext http, IProductWorkspaceReader reader, CancellationToken ct) =>
        {
            var query = http.Request.Query;
            if (query.Any(p => p.Key is not ("search" or "status" or "categoryId" or "brandId" or "availability" or "sort" or "direction" or "page" or "pageSize"
                or "name" or "minPriceRial" or "maxPriceRial" or "minStock" or "maxStock" or "minVariants" or "maxVariants" or "updatedFrom" or "updatedBefore"
                or "categoryIds" or "brandIds" or "statuses") || p.Value.Count != 1))
                return Results.BadRequest();
            string? Optional(string key) => query.TryGetValue(key, out var values) ? values[0] : null;
            var filter = ProductWorkspaceFilter.Create(search, status, categoryId, brandId, availability, sort, direction, page ?? 0, pageSize ?? 25,
                name: Optional("name"), minPriceRial: Optional("minPriceRial"), maxPriceRial: Optional("maxPriceRial"),
                minStock: Optional("minStock"), maxStock: Optional("maxStock"), minVariants: Optional("minVariants"), maxVariants: Optional("maxVariants"),
                updatedFrom: Optional("updatedFrom"), updatedBefore: Optional("updatedBefore"),
                categoryIds: Optional("categoryIds"), brandIds: Optional("brandIds"), statuses: Optional("statuses"));
            return Results.Ok(await reader.PageAsync(filter, ct));
        });
        group.MapGet("/products/{id}", async (string id, IProductWorkspaceReader reader, CancellationToken ct) => Results.Ok(await reader.DetailAsync(id, ct)));
        group.MapGet("/commands/{requestId}", async (string requestId, HttpContext http, ProductWorkspaceCommands service, CancellationToken ct) => Results.Ok(await service.ReceiptAsync(Actor(http), requestId, ct))).RequireAuthorization("catalog.write");
        group.MapPost("/save", async (ProductWorkspaceSaveInput input, HttpContext http, ProductWorkspaceCommands service, CancellationToken ct) => Results.Ok(await service.SaveAsync(Actor(http), input, ct))).RequireAuthorization("catalog.write");
        group.MapPost("/prices", async (ProductWorkspacePricesInput input, HttpContext http, ProductWorkspaceCommands service, CancellationToken ct) => Results.Ok(await service.PricesAsync(Actor(http), input, ct))).RequireAuthorization("catalog.write");
        group.MapPost("/archive", async (ProductWorkspaceArchiveInput input, HttpContext http, ProductWorkspaceCommands service, CancellationToken ct) => Results.Ok(await service.ArchiveAsync(Actor(http), input, ct))).RequireAuthorization("catalog.write");
        group.MapGet("/fields", async (ProductFormFields service, CancellationToken ct) => Results.Ok(await service.ReadAsync(ct)));
        group.MapPut("/fields", async (ProductFormFieldsInput input, HttpContext http, ProductWorkspaceCommands service, CancellationToken ct) => Results.Ok(await service.FieldsAsync(Actor(http), input, ct))).RequireAuthorization("catalog.write");
    }
    private static string Actor(HttpContext http) => http.User.FindFirstValue("sub") ?? throw new BusinessException("invalid_credentials", "An authenticated actor is required.");
}
