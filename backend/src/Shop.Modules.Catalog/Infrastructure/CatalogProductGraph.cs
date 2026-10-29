using Microsoft.EntityFrameworkCore;
using Shop.Modules.Catalog.Domain;

namespace Shop.Modules.Catalog.Infrastructure;
internal static class CatalogProductGraph
{
    public static IQueryable<Product> Read(CatalogDbContext db)=>db.Products.Include(x=>x.Translations).Include(x=>x.Variants).ThenInclude(x=>x.Attributes)
        .Include(x=>x.Variants).ThenInclude(x=>x.PurchaseMethods).Include(x=>x.Attributes).ThenInclude(x=>x.Selections)
        .Include(x=>x.Media).Include(x=>x.PurchaseMethods).Include(x=>x.CreditPlans).AsSplitQuery();
}
