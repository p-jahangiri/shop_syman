namespace Shop.SharedKernel;

// Each module answers from its own context. Reviews never accesses Sales/Catalog tables.
public interface IReviewProductReader
{
    Task<bool> IsPublishedAsync(string productId,CancellationToken ct);
}
public sealed record ReviewPurchaseKey(string OwnerId,string ProductId);
public interface IReviewPurchaseReader
{
    Task<string[]> RecentDeliveredProductsAsync(string owner, CancellationToken ct);
    Task<IReadOnlySet<ReviewPurchaseKey>> VerifiedAsync(ReviewPurchaseKey[] keys,CancellationToken ct);
}
