using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;
namespace Shop.Modules.Catalog.Infrastructure;
public sealed partial class CatalogService:IWishlistCatalogReader
{
    public async Task<string[]> PublishedProductIdsAsync(string[] ids,CancellationToken ct)
    {
        if(ids.Length>200)throw new BusinessException("invalid_wishlist","Use at most200 products.");
        var now=time.GetUtcNow();
        return await db.Products.AsNoTracking().Where(p=>ids.Contains(p.Id)&&p.Status=="Published"&&(p.PublishAt==null||p.PublishAt<=now)&&db.Categories.Any(c=>c.Id==p.CategoryId&&c.IsActive)&&db.Brands.Any(b=>b.Id==p.BrandId&&b.IsActive)&&p.Variants.Any(v=>v.IsActive)).Select(p=>p.Id).ToArrayAsync(ct);
    }
}
