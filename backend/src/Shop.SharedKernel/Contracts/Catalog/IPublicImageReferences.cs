namespace Shop.SharedKernel;

// A module boundary for referencing already-uploaded public images. This checks
// committed metadata, not object-store availability, and never fetches a URL.
public interface IPublicImageReferences
{
    Task RequireReadyAsync(IReadOnlyCollection<string> urls, CancellationToken ct);
}
