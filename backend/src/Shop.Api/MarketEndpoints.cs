using System.Security.Claims;
using Shop.Modules.Market;
using Shop.SharedKernel;

public static class MarketEndpoints
{
    public static void MapMarket(this WebApplication app)
    {
        var publicMarket=app.MapGroup("/api/market/{locale}").AllowAnonymous();
        publicMarket.AddEndpointFilter(InputValidation.Filter);
        publicMarket.MapPost("/search",async(string locale,MarketSearchInput input,MarketService service,CancellationToken ct)=>Results.Ok(await service.PageAsync(locale,input,ct)));
        publicMarket.MapPost("/facets",async(string locale,MarketSearchInput input,MarketService service,CancellationToken ct)=>Results.Ok(await service.FacetsAsync(locale,input,ct)));
        publicMarket.MapPost("/filters",async(string locale,MarketFiltersInput input,MarketService service,CancellationToken ct)=>Results.Ok(await service.FiltersAsync(locale,input,ct)));
        publicMarket.MapPost("/facet-values",async(string locale,MarketValuesInput input,MarketService service,CancellationToken ct)=>Results.Ok(await service.ValuesAsync(locale,input,ct)));
        publicMarket.MapGet("/{id}",async(string locale,string id,MarketService service,CancellationToken ct)=>Results.Ok(await service.DetailAsync(locale,id,ct)));
        publicMarket.MapGet("/{id}/sources",async(string locale,string id,MarketService service,CancellationToken ct)=>Results.Ok(await service.SourcesAsync(locale,id,ct)));
        publicMarket.MapGet("/{id}/sources/{sourceId}/history",async(string locale,string id,string sourceId,string? before,MarketService service,CancellationToken ct)=>Results.Ok(await service.ObservationsAsync(locale,id,sourceId,before,false,ct)));
    }
    public static void MapAdminMarket(this RouteGroupBuilder admin)
    {
        admin.MapAdminPhoneDiscovery();
        admin.MapPost("/market/source-import/preview",async(SourceCsvPreviewRequest input,MarketSourceCsvService service,CancellationToken ct)=>Results.Ok(await service.PreviewAsync(input.Csv,ct))).RequireAuthorization("catalog.write").WithMetadata(new ReadOnlyAdministrativeRequest());
        admin.MapPost("/market/source-import/commit",async(SourceCsvCommitRequest input,ClaimsPrincipal user,MarketSourceCsvService service,CancellationToken ct)=>Results.Ok(await service.CommitAsync(input,user.FindFirstValue("sub")!,ct))).RequireAuthorization("catalog.write");
        admin.MapGet("/market/source-import/receipts/{requestId}",async(string requestId,ClaimsPrincipal user,MarketSourceCsvService service,CancellationToken ct)=>Results.Ok(await service.ReceiptAsync(requestId,user.FindFirstValue("sub")!,ct))).RequireAuthorization("catalog.write");
        admin.MapGet("/market/source-import/template",()=>Results.File(System.Text.Encoding.UTF8.GetBytes("\uFEFF"+string.Join(',',MarketSourceCsv.Columns)+"\r\n"),"text/csv; charset=utf-8","sayman-extra-source-reports.csv")).RequireAuthorization("catalog.read");
        admin.MapGet("/market/source-commands/{requestId}",async(string requestId,ClaimsPrincipal user,MarketService service,CancellationToken ct)=>Results.Ok(await service.SourceReceiptAsync(requestId,user.FindFirstValue("sub")!,ct))).RequireAuthorization("catalog.write");
        admin.MapGet("/market/{id}/sources",async(string id,MarketService service,CancellationToken ct)=>Results.Ok(await service.AdminSourcesAsync(id,ct))).RequireAuthorization("catalog.read");
        admin.MapGet("/market/{id}/sources/{sourceId}/history",async(string id,string sourceId,string? before,MarketService service,CancellationToken ct)=>Results.Ok(await service.ObservationsAsync("fa",id,sourceId,before,true,ct))).RequireAuthorization("catalog.read");
        admin.MapPut("/market/{id}/sources/{sourceId}/commands/{requestId}",async(string id,string sourceId,string requestId,MarketSourceInput input,ClaimsPrincipal user,MarketService service,CancellationToken ct)=>Results.Ok(await service.SaveSourceAsync(id,sourceId,requestId,input,user.FindFirstValue("sub")!,ct))).RequireAuthorization("catalog.write");
        admin.MapPost("/market/import/preview",async(MarketCsvPreviewRequest input,MarketImportService service,CancellationToken ct)=>Results.Ok(await service.PreviewAsync(input.Csv,ct))).RequireAuthorization("catalog.write").WithMetadata(new ReadOnlyAdministrativeRequest());
        admin.MapPost("/market/import/commit",async(MarketCsvCommitRequest input,ClaimsPrincipal user,MarketImportService service,CancellationToken ct)=>Results.Ok(await service.CommitAsync(input,user.FindFirstValue("sub")!,ct))).RequireAuthorization("catalog.write");
        admin.MapGet("/market/import/receipts/{requestId}",async(string requestId,ClaimsPrincipal user,MarketImportService service,CancellationToken ct)=>Results.Ok(await service.ReadReceiptAsync(requestId,user.FindFirstValue("sub")!,ct))).RequireAuthorization("catalog.write");
        admin.MapGet("/market/import/template",()=>Results.File(System.Text.Encoding.UTF8.GetBytes("\uFEFF"+string.Join(',',MarketCsv.Columns)+"\r\n"),"text/csv; charset=utf-8","sayman-market-template.csv")).RequireAuthorization("catalog.read");
        admin.MapGet("/market/models/{id}",async(string id,IMarketModelCatalog service,CancellationToken ct)=>Results.Ok(new{SchemaVersion=1,Model=await service.ReadEditableAsync(id,ct)})).RequireAuthorization("catalog.read");
        admin.MapGet("/market",async(string? query,string? status,string? categoryId,string? brandId,string? cursor,MarketService service,CancellationToken ct)=>Results.Ok(await service.AdminPageAsync(query,status,categoryId,cursor,ct,brandId))).RequireAuthorization("catalog.read");
        admin.MapGet("/market/{id}",async(string id,MarketService service,CancellationToken ct)=>Results.Ok(await service.AdminDetailAsync(id,ct))).RequireAuthorization("catalog.read");
        admin.MapPost("/market",async(MarketListingInput input,MarketService service,CancellationToken ct)=>Results.Ok(new{Id=await service.SaveAsync(null,input,ct)})).RequireAuthorization("catalog.write");
        admin.MapPut("/market/{id}",async(string id,MarketListingInput input,MarketService service,CancellationToken ct)=>Results.Ok(new{Id=await service.SaveAsync(id,input,ct)})).RequireAuthorization("catalog.write");
        admin.MapPut("/market/{id}/edit",async(string id,EditMarketModelInput input,ClaimsPrincipal user,MarketService service,CancellationToken ct)=>Results.Ok(new{Id=await service.EditModelAsync(id,input,user.FindFirstValue("sub")!,ct)})).RequireAuthorization("catalog.write");
        admin.MapPost("/market/models",async(CreateMarketModelInput input,ClaimsPrincipal user,MarketService service,CancellationToken ct)=>Results.Ok(new{Id=await service.CreateModelAsync(input,user.FindFirstValue("sub")!,ct)})).RequireAuthorization("catalog.write");
        admin.MapPut("/market/models/{id}",async(string id,CatalogModelInput input,ClaimsPrincipal user,IMarketModelCatalog service,CancellationToken ct)=>Results.Ok(new{Id=await service.SaveAsync(id,input,user.FindFirstValue("sub")!,ct)})).RequireAuthorization("catalog.write");
    }
}
