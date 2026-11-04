using Microsoft.EntityFrameworkCore;
using Shop.Modules.Catalog.Infrastructure;
using Shop.SharedKernel;
namespace Shop.Modules.Catalog.Media;

public sealed class SqlPublicImageRepository(CatalogDbContext db):IPublicImageRepository
{
    public async Task StageAsync(PublicImageAsset asset,CancellationToken ct){db.PublicImages.Add(asset);await db.SaveChangesAsync(ct);}
    public async Task ReadyAsync(PublicImageAsset asset,SanitizedImage image,CancellationToken ct){if(asset.Status!="Staged")throw new BusinessException("media_conflict","The staged image changed.");asset.Variants=image.Variants.Select(v=>new PublicImageVariant{AssetId=asset.Id,Name=v.Name,Width=v.Width,Height=v.Height,Bytes=v.Bytes.Length,Sha256=v.Sha256}).ToList();asset.Status="Ready";await db.SaveChangesAsync(ct);}
    public async Task FailAsync(PublicImageAsset asset,CancellationToken ct){asset.Status="Failed";await db.SaveChangesAsync(ct);}
    public Task<PublicImageAsset?> FindReadyAsync(string id,CancellationToken ct)=>db.PublicImages.AsNoTracking().Include(a=>a.Variants).SingleOrDefaultAsync(a=>a.Id==id&&a.Status=="Ready",ct);
}
