using Microsoft.EntityFrameworkCore;
using Shop.Modules.Catalog.Infrastructure;
using Shop.SharedKernel;

namespace Shop.Modules.Catalog.Media;

public sealed class CatalogPublicImageReferences(CatalogDbContext db) : IPublicImageReferences
{
    public async Task RequireReadyAsync(IReadOnlyCollection<string> urls, CancellationToken ct)
    {
        // Existing callers have tighter document/product limits. Keep this
        // shared boundary bounded independently of a particular HTTP caller.
        if (urls.Count > 256) throw new BusinessException("invalid_image_url", "Too many public image references.");
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var url in urls)
        {
            if (!PublicImageUrlRules.IsValid(url)) throw new BusinessException("invalid_image_url", "Use an issued public image path, a bundled product image or an HTTPS image URL without credentials or a fragment.");
            if (!url.StartsWith("/media/", StringComparison.Ordinal)) continue;
            if (!PublicImagePaths.TryParse(url, out var id, out _)) throw new BusinessException("invalid_image_url", "Use an issued public catalogue image.");
            ids.Add(id);
        }
        if (ids.Count == 0) return;
        var selected = ids.ToArray();
        // Ready objects are immutable and are deliberately excluded from the
        // cleanup worker. Match the catalogue's existing Ready-row semantics.
        if (await db.PublicImages.CountAsync(a => selected.Contains(a.Id) && a.Status == "Ready", ct) != selected.Length)
            throw new BusinessException("image_not_ready", "An uploaded image has not completed scanning and storage.");
    }
}
