using Microsoft.EntityFrameworkCore;
using Shop.Modules.Catalog.Domain;
using Shop.SharedKernel;
namespace Shop.Modules.Catalog.Infrastructure;
public sealed record CatalogReadVersion(string Id,byte[] Version);
// Read-only optimistic validation for graphs loaded by multiple SQL statements.
public static class CatalogReadVersions
{
    public const int BatchSize=500;
    public static CatalogReadVersion[] Capture<T>(IEnumerable<T> rows) where T:CatalogEntity=>rows.Select(r=>new CatalogReadVersion(r.Id,r.Version.ToArray())).ToArray();
    public static void EnsureUnchanged(IReadOnlyCollection<CatalogReadVersion> expected,IReadOnlyCollection<CatalogReadVersion> current)
    {
        Validate(expected);Validate(current);if(expected.Count!=current.Count)throw Changed();
        var map=current.ToDictionary(r=>r.Id,StringComparer.Ordinal);
        if(expected.Any(r=>!map.TryGetValue(r.Id,out var found)||!found.Version.SequenceEqual(r.Version)))throw Changed();
    }
    public static IQueryable<CatalogReadVersion> Query<T>(CatalogDbContext db,string[] ids) where T:CatalogEntity
    {
        if(ids.Length is <1 or >BatchSize||ids.Distinct(StringComparer.Ordinal).Count()!=ids.Length)throw Changed();
        return db.Set<T>().AsNoTracking().Where(r=>ids.Contains(r.Id)).Select(r=>new CatalogReadVersion(r.Id,r.Version));
    }
    public static async Task EnsureAsync<T>(CatalogDbContext db,IEnumerable<T> rows,CancellationToken ct) where T:CatalogEntity
    {
        await EnsureSnapshotsAsync<T>(db,Capture(rows),ct);
    }
    public static async Task EnsureSnapshotsAsync<T>(CatalogDbContext db,IReadOnlyCollection<CatalogReadVersion> snapshots,CancellationToken ct) where T:CatalogEntity
    {
        Validate(snapshots);var expected=snapshots.Select(r=>new CatalogReadVersion(r.Id,r.Version.ToArray())).ToArray();
        foreach(var batch in expected.Chunk(BatchSize)){var current=await Query<T>(db,batch.Select(r=>r.Id).ToArray()).ToArrayAsync(ct);EnsureUnchanged(batch,current);}
    }
    private static void Validate(IReadOnlyCollection<CatalogReadVersion> rows)
    {
        if(rows.Any(r=>string.IsNullOrEmpty(r.Id)||r.Version is not {Length:8})||rows.Select(r=>r.Id).Distinct(StringComparer.Ordinal).Count()!=rows.Count)throw Changed();
    }
    public static async Task EnsureProductsAsync(CatalogDbContext db,IEnumerable<Product> rows,CancellationToken ct)
    {
        var products=rows.ToArray();await EnsureAsync(db,products,ct);await EnsureAsync(db,products.SelectMany(p=>p.Variants),ct);
    }
    private static BusinessException Changed()=>new("version_conflict","Catalogue data changed while it was being read. Load the current details before editing.");
}
