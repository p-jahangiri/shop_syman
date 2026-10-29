namespace Shop.SharedKernel;
public interface IWishlistCatalogReader
{
    Task<string[]> PublishedProductIdsAsync(string[] ids,CancellationToken ct);
}
