using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;
namespace Shop.Modules.Sales;

public sealed class ReviewPurchaseReader(SalesDbContext db):IReviewPurchaseReader
{
    public async Task<IReadOnlySet<ReviewPurchaseKey>> VerifiedAsync(ReviewPurchaseKey[] keys,CancellationToken ct)
    {
        if(keys.Length>20||keys.Any(k=>string.IsNullOrEmpty(k.OwnerId)||string.IsNullOrEmpty(k.ProductId)))throw new ArgumentException("At most20 purchase facts may be requested.",nameof(keys));
        if(keys.Length==0)return new HashSet<ReviewPurchaseKey>();
        var owners=keys.Select(k=>k.OwnerId).Distinct().ToArray();var products=keys.Select(k=>k.ProductId).Distinct().ToArray();
        var orders=db.Orders.AsNoTracking().Where(o=>owners.Contains(o.OwnerId)&&!o.ContainsDemo&&(o.State==OrderState.Paid||o.State==OrderState.Fulfilled));
        var v1=await orders.Where(o=>o.SnapshotVersion==null).SelectMany(o=>o.Lines.Where(l=>products.Contains(l.ProductId)).Select(l=>new{ o.OwnerId,l.ProductId})).Distinct().ToArrayAsync(ct);
        var v2=await orders.Where(o=>o.SnapshotVersion==2).SelectMany(o=>o.LinesV2.Where(l=>products.Contains(l.ProductId)).Select(l=>new{ o.OwnerId,l.ProductId})).Distinct().ToArrayAsync(ct);
        var facts=v1.Concat(v2).ToArray();return keys.Where(k=>facts.Any(v=>string.Equals(v.OwnerId,k.OwnerId,StringComparison.Ordinal)&&string.Equals(v.ProductId,k.ProductId,StringComparison.OrdinalIgnoreCase))).ToHashSet();
    }
}
