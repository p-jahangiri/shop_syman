using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;
namespace Shop.Modules.Catalog.Infrastructure;

public sealed class ReviewProductReader(CatalogDbContext db,TimeProvider time):IReviewProductReader
{
    public Task<bool> IsPublishedAsync(string productId,CancellationToken ct)
    {
        var now=time.GetUtcNow();
        return (from p in db.Products.AsNoTracking()
                join c in db.Categories on p.CategoryId equals c.Id
                join b in db.Brands on p.BrandId equals b.Id
                where p.Id==productId&&p.Status=="Published"&&(p.PublishAt==null||p.PublishAt<=now)&&c.IsActive&&b.IsActive
                select p.Id).AnyAsync(ct);
    }
}
