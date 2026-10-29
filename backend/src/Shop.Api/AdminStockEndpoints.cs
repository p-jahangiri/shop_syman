using Shop.Modules.Catalog.Application;
using Shop.Modules.Inventory;
using Shop.SharedKernel;

public sealed record AdminStockRow(string VariantId, string ProductId, string Sku, string NameFa, string NameEn, bool IsActive, string ProductStatus, int OnHand, int Reserved, int Available, [property:System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.Never)] string? Version);
public sealed record AdminStockPage(int Version, int PageSize, AdminStockRow[] Items, [property:System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.Never)] string? NextCursor);
public sealed record AdminStockRowV2(string VariantId,string ProductId,string Sku,string NameFa,string NameEn,bool IsActive,string ProductStatus,int OnHand,int Reserved,int SourcingReserved,int Available,[property:System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.Never)]string? Version);
public sealed record AdminStockPageV2(int Version,int PageSize,AdminStockRowV2[] Items,[property:System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.Never)]string? NextCursor);
public sealed class AdminStockService(IAdminStockCatalog catalog, IAdminStockReader inventory)
{
    private async Task<AdminStockRowV2[]> ComposeV2(StockVariantMetadata[] variants,CancellationToken ct)
    {
        var stock = (await inventory.ReadAsync(variants.Select(v => v.Id).ToArray(), ct)).ToDictionary(x => x.VariantId, StringComparer.OrdinalIgnoreCase);
        return variants.Select(v=>{stock.TryGetValue(v.Id,out var row);return new AdminStockRowV2(v.Id,v.ProductId,v.Sku,v.NameFa,v.NameEn,v.IsActive,v.ProductStatus,row?.OnHand??0,row?.Reserved??0,row?.SourcingReserved??0,StockAvailability.Available(row?.OnHand??0,row?.Reserved??0,row?.SourcingReserved??0),row?.Version);}).ToArray();
    }
    private async Task<AdminStockRow[]> Compose(StockVariantMetadata[] variants,CancellationToken ct)
    {
        var rows=await ComposeV2(variants,ct);
        if(rows.Any(row=>row.SourcingReserved>0))throw new BusinessException("inventory_contract_upgrade_required","Sourcing-held inventory requires the version 2 inventory contract.");
        return rows.Select(row=>new AdminStockRow(row.VariantId,row.ProductId,row.Sku,row.NameFa,row.NameEn,row.IsActive,row.ProductStatus,row.OnHand,row.Reserved,row.Available,row.Version)).ToArray();
    }
    public async Task<AdminStockPage> PageAsync(AdminStockQuery query, string? cursor, CancellationToken ct)
    {
        AdminStockPaging.Decode(cursor, query); var page = await catalog.PageAsync(query, cursor, ct);
        return new(1, AdminStockPaging.PageSize, await Compose(page.Items, ct), page.NextCursor);
    }
    public async Task<AdminStockRow> FindAsync(string id, CancellationToken ct)
    {
        AdminStockQuery.Identifier(id); var variant = await catalog.FindAsync(id, ct) ?? throw new BusinessException("not_found", "Variant was not found.");
        return (await Compose([variant], ct))[0];
    }
    public async Task<AdminStockPageV2> PageV2Async(AdminStockQuery query,string? cursor,CancellationToken ct)
    {
        AdminStockPaging.Decode(cursor,query);var page=await catalog.PageAsync(query,cursor,ct);
        return new(2,AdminStockPaging.PageSize,await ComposeV2(page.Items,ct),page.NextCursor);
    }
    public async Task<AdminStockRowV2> FindV2Async(string id,CancellationToken ct)
    {
        AdminStockQuery.Identifier(id);var variant=await catalog.FindAsync(id,ct)??throw new BusinessException("not_found","Variant was not found.");
        return (await ComposeV2([variant],ct))[0];
    }
}
public static class AdminStockEndpoints
{
    public static void MapAdminStock(this RouteGroupBuilder admin)
    {
        admin.MapGet("/inventory/variants", async (string? query, string? active, string? cursor, AdminStockService service, CancellationToken ct) => Results.Ok(await service.PageAsync(AdminStockQuery.Create(query, active), cursor, ct))).RequireAuthorization("inventory.read");
        admin.MapGet("/inventory/variants/{id}", async (string id, AdminStockService service, CancellationToken ct) => Results.Ok(await service.FindAsync(id, ct))).RequireAuthorization("inventory.read");
        admin.MapGet("/inventory/v2/variants",async(string? query,string? active,string? cursor,AdminStockService service,CancellationToken ct)=>Results.Ok(await service.PageV2Async(AdminStockQuery.Create(query,active),cursor,ct))).RequireAuthorization("inventory.read");
        admin.MapGet("/inventory/v2/variants/{id}",async(string id,AdminStockService service,CancellationToken ct)=>Results.Ok(await service.FindV2Async(id,ct))).RequireAuthorization("inventory.read");
        admin.MapGet("/inventory/summary", async (IAdminStockReader service, CancellationToken ct) => Results.Ok(await service.SummaryAsync(ct))).RequireAuthorization("inventory.read");
        admin.MapGet("/catalog/summary", async (IAdminStockCatalog service, CancellationToken ct) => Results.Ok(await service.SummaryAsync(ct))).RequireAuthorization("catalog.read");
    }
}
