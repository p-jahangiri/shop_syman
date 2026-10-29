using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Inventory;

public sealed record SerialStockV2(string VariantId,string Mode,int OnHand,int Reserved,int SourcingReserved,int Available,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? Version);
public sealed record SerialUnitRowV2(SerialUnitData Unit,bool HasActiveClaim);
public sealed record SerialUnitPageV2(int SchemaVersion,int PageSize,SerialStockV2 Stock,SerialUnitRowV2[] Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? NextCursor);

public static class SerialPagingV2
{
    public const int PageSize=50;
    public const int MaximumCursorLength=512;
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web){UnmappedMemberHandling=JsonUnmappedMemberHandling.Disallow,RespectRequiredConstructorParameters=true,MaxDepth=4};
    private sealed record Cursor(int SchemaVersion,string After,string Binding,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? StockVersion);
    private static string Binding(SerialPageQuery query,string? version)=>SerialRules.Hash(new{Contract="serial-page-v2",VariantId=query.VariantId.ToUpperInvariant(),query.State,query.Search,StockVersion=version});
    public static string Encode(string after,SerialPageQuery query,string? stockVersion)
    {
        query=SerialPageQuery.Create(query.VariantId,query.State,query.Search);stockVersion=SerialRules.Version(stockVersion);return Convert.ToBase64String(JsonSerializer.SerializeToUtf8Bytes(new Cursor(2,SerialRules.Uuid(after),Binding(query,stockVersion),stockVersion),Json)).TrimEnd('=').Replace('+','-').Replace('/','_');
    }
    public static string? Decode(string? cursor,SerialPageQuery query,string? stockVersion)
    {
        if(cursor is null)return null;Cursor value;
        try{
            if(cursor.Length is <1 or >MaximumCursorLength||cursor.Any(c=>!char.IsAsciiLetterOrDigit(c)&&c is not ('-' or '_')))throw new FormatException();var raw=cursor.Replace('-','+').Replace('_','/');value=JsonSerializer.Deserialize<Cursor>(Convert.FromBase64String(raw.PadRight((raw.Length+3)/4*4,'=')),Json)??throw new FormatException();if(value.SchemaVersion!=2||value.After!=SerialRules.Uuid(value.After)||value.StockVersion!=SerialRules.Version(value.StockVersion)||value.Binding!=Binding(query,value.StockVersion))throw new FormatException();
        }catch(Exception e)when(e is FormatException or JsonException or BusinessException){throw new BusinessException("invalid_serial_cursor","Start version 2 serial paging again with the current variant and filter.");}
        if(value.StockVersion!=stockVersion)throw new BusinessException("version_conflict","Stock changed between serial pages. Start the list again.");return value.After;
    }
}

// Inventory-only projection. Physical state and active entitlement are separate;
// an expired, unreleased claim continues to protect its real physical unit.
public sealed class SerialInventoryV2Reader(InventoryDbContext db):IAdminSerialV2Reader
{
    private sealed record ClaimVersion(string Id,string UnitId,byte[] Version);
    private static string? Version(StockItem? stock)=>stock is null?null:Convert.ToBase64String(stock.Version);
    private static BusinessException Changed()=>new("version_conflict","Stock, units or their active claims changed while reading the serial page. Refresh the page.");
    private async Task<ClaimVersion[]> Claims(string[] ids,CancellationToken ct)
    {
        if(ids.Length==0)return [];var rows=await db.SerialUnitClaims.AsNoTracking().Where(c=>c.IsActive&&ids.Contains(c.UnitId)).OrderBy(c=>c.UnitId).Select(c=>new ClaimVersion(c.Id,c.UnitId,c.Version)).Take(SerialPagingV2.PageSize+2).ToArrayAsync(ct);if(rows.Length>ids.Length||rows.Select(c=>c.UnitId).Distinct(StringComparer.Ordinal).Count()!=rows.Length)throw Changed();return rows;
    }
    public async Task<SerialUnitPageV2> PageAsync(SerialPageQuery query,string? cursor,CancellationToken ct)
    {
        if(query is null)throw new BusinessException("invalid_serial_input","Choose a bounded serial variant and filter.");query=SerialPageQuery.Create(query.VariantId,query.State,query.Search);var stock=await db.Stock.AsNoTracking().SingleOrDefaultAsync(s=>s.VariantId==query.VariantId,ct);var stockVersion=Version(stock);var available=stock is null?0:StockAvailability.Available(stock.OnHand,stock.Reserved,stock.SourcingReserved);var after=SerialPagingV2.Decode(cursor,query,stockVersion);
        var rows=await SerialInventoryService.Query(db,query,after).ToArrayAsync(ct);var ids=rows.Select(u=>u.Id).ToArray();var claims=await Claims(ids,ct);if(query.State=="available"&&claims.Length!=0)throw Changed();
        var freshUnits=await db.SerialUnits.AsNoTracking().Where(u=>ids.Contains(u.Id)).Select(u=>new{u.Id,u.Version}).Take(SerialPagingV2.PageSize+2).ToArrayAsync(ct);if(freshUnits.Length!=rows.Length||rows.Any(u=>!freshUnits.Any(f=>f.Id==u.Id&&f.Version.SequenceEqual(u.Version))))throw Changed();var currentClaims=await Claims(ids,ct);if(claims.Length!=currentClaims.Length||claims.Where((claim,index)=>claim.Id!=currentClaims[index].Id||claim.UnitId!=currentClaims[index].UnitId||!claim.Version.SequenceEqual(currentClaims[index].Version)).Any())throw Changed();
        var current=await db.Stock.AsNoTracking().SingleOrDefaultAsync(s=>s.VariantId==query.VariantId,ct);if(stock is null?current is not null:current is null||!stock.Version.SequenceEqual(current.Version))throw Changed();var held=claims.Select(c=>c.UnitId).ToHashSet(StringComparer.Ordinal);var page=rows.Take(SerialPagingV2.PageSize).ToArray();return new(2,SerialPagingV2.PageSize,new(query.VariantId,stock?.TrackingMode??"none",stock?.OnHand??0,stock?.Reserved??0,stock?.SourcingReserved??0,available,stockVersion),page.Select(u=>new SerialUnitRowV2(SerialInventoryService.Data(u),held.Contains(u.Id))).ToArray(),rows.Length>SerialPagingV2.PageSize?SerialPagingV2.Encode(page[^1].Id,query,stockVersion):null);
    }
}
