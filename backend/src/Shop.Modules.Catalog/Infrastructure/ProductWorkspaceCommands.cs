using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Domain;
using Shop.SharedKernel;

namespace Shop.Modules.Catalog.Infrastructure;

public sealed partial class ProductWorkspaceCommands(CatalogDbContext db, ICatalogService catalog, TimeProvider clock)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { UnmappedMemberHandling = System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow };
    private static string Fingerprint<T>(string kind, T input) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(kind + ":" + JsonSerializer.Serialize(input, Json))));
    private async Task<ProductWorkspaceReceipt> ExecuteAsync<T>(string actor, string id, string kind, T input, Func<Task<ProductWorkspaceReceipt>> action, CancellationToken ct)
    {
        ProductWorkspaceRules.RequestId(id);
        if (string.IsNullOrWhiteSpace(actor) || actor.Length > 64)
            throw new BusinessException("invalid_product_command", "An authenticated actor is required.");
        if (db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel != IsolationLevel.Serializable)
            throw new InvalidOperationException("Product workspace commands require the audited root Serializable transaction.");
        await db.Database.ExecuteSqlRawAsync("DECLARE @result int; EXEC @result=sys.sp_getapplock @Resource=N'Sayman.Catalog.Workspace.v1',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; IF @result<0 THROW 51000,'Product workspace lock unavailable',1;", ct);
        var hash = Fingerprint(kind, input);
        var prior = await db.Set<ProductWorkspaceCommand>().AsNoTracking().SingleOrDefaultAsync(x => x.ActorId == actor && x.RequestId == id, ct);
        if (prior is not null)
        {
            if (prior.Kind != kind || prior.Fingerprint != hash)
                throw new BusinessException("product_command_conflict", "This command id belongs to different product changes.");
            return JsonSerializer.Deserialize<ProductWorkspaceReceipt>(prior.ReceiptJson, Json) ?? throw new BusinessException("product_command_unavailable", "Saved receipt cannot be verified.");
        }
        var result = await action();
        db.Add(new ProductWorkspaceCommand { ActorId = actor, RequestId = id, Kind = kind, Fingerprint = hash, ReceiptJson = JsonSerializer.Serialize(result, Json), CreatedAt = clock.GetUtcNow() });
        await db.SaveChangesAsync(ct);
        return result;
    }
    public async Task<ProductWorkspaceReceipt> ReceiptAsync(string actor, string id, CancellationToken ct)
    {
        ProductWorkspaceRules.RequestId(id);
        var row = await db.Set<ProductWorkspaceCommand>().AsNoTracking().SingleOrDefaultAsync(x => x.ActorId == actor && x.RequestId == id, ct) ?? throw new BusinessException("not_found", "This actor has no committed product command with that id.");
        return JsonSerializer.Deserialize<ProductWorkspaceReceipt>(row.ReceiptJson, Json) ?? throw new BusinessException("product_command_unavailable", "Saved receipt cannot be verified.");
    }
    private async Task<Product> ProductAsync(string id, string version, CancellationToken ct)
    {
        AdminProductQuery.Identifier(id);
        var product = await db.Products.Include(p => p.Variants).SingleOrDefaultAsync(p => p.Id == id, ct) ?? throw new BusinessException("not_found", "Product was not found.");
        await db.Entry(product).ReloadAsync(ct);
        CatalogRules.Version(product.Version, version);
        return product;
    }
    private ProductWorkspaceReceipt Result(string request, string kind, Product product) => new(1, request, kind, product.Id, Convert.ToBase64String(product.Version), product.Variants.OrderBy(v => v.Id, StringComparer.Ordinal).Select(v => v.Id).ToArray());
    public Task<ProductWorkspaceReceipt> SaveAsync(string actor, ProductWorkspaceSaveInput input, CancellationToken ct) => ExecuteAsync(actor, input.RequestId, "save", input, async () =>
    {
        if (input.ProductId is not null)
            AdminProductQuery.Identifier(input.ProductId);
        if (input.Product.Variants.Length > 500)
            throw new BusinessException("invalid_product_command", "Use bounded product variants.");
        await new ProductFieldValidation(db).ValidateAsync(input.ProductId, input.Product, ct);
        var id = await catalog.SaveProductAsync(input.ProductId, input.Product, actor, ct);
        var product = await db.Products.Include(p => p.Variants).SingleAsync(p => p.Id == id, ct);
        return Result(input.RequestId, "save", product);
    }, ct);
    public Task<ProductWorkspaceReceipt> ArchiveAsync(string actor, ProductWorkspaceArchiveInput input, CancellationToken ct) => ExecuteAsync(actor, input.RequestId, input.Restore ? "restore" : "archive", input, async () =>
    {
        var product = await ProductAsync(input.ProductId, input.Version, ct);
        if (input.Restore)
        {
            if (product.ArchivedAt is null)
                throw new BusinessException("product_archive_conflict", "Product is not archived.");
            product.ArchivedAt = null;
            product.Status = "Draft";
            product.PublishAt = null;
        }
        else
        {
            if (product.ArchivedAt is not null)
                throw new BusinessException("product_archive_conflict", "Product is already archived.");
            product.ArchivedAt = clock.GetUtcNow();
            product.Status = "Hidden";
        }
        product.UpdatedAt = clock.GetUtcNow();
        await db.SaveChangesAsync(ct);
        return Result(input.RequestId, input.Restore ? "restore" : "archive", product);
    }, ct);
    public Task<ProductWorkspaceReceipt> PricesAsync(string actor, ProductWorkspacePricesInput input, CancellationToken ct) => ExecuteAsync(actor, input.RequestId, "prices", input, async () =>
    {
        if (input.Lines.Length is < 1 or > 100 || input.Lines.Select(l => l.VariantId).Distinct(StringComparer.OrdinalIgnoreCase).Count() != input.Lines.Length)
            throw new BusinessException("invalid_product_prices", "Use1to100 distinct variants.");
        var product = await ProductAsync(input.ProductId, input.Version, ct);
        if (product.ArchivedAt is not null)
            throw new BusinessException("product_archived", "Restore the product before changing its prices.");
        var now = clock.GetUtcNow();
        foreach (var line in input.Lines)
        {
            ProductWorkspaceRules.Price(line.PriceRial, line.CompareAtRial);
            var variant = product.Variants.SingleOrDefault(v => v.Id == line.VariantId) ?? throw new BusinessException("unknown_variant", "Variant does not belong to this product.");
            CatalogRules.Version(variant.Version, line.Version);
            var price = CatalogRules.Money(line.PriceRial);
            if (price != variant.PriceRial)
                db.PriceHistory.Add(new()
                {
                    VariantId = variant.Id,
                    OldPrice = variant.PriceRial,
                    NewPrice = price,
                    ChangedBy = actor,
                    CreatedAt = now,
                    UpdatedAt = now
                });
            variant.PriceRial = price;
            variant.CompareAtPriceRial = line.CompareAtRial is null ? null : CatalogRules.Money(line.CompareAtRial);
            variant.IsActive = line.IsActive;
            variant.UpdatedAt = now;
            db.Entry(variant).Property(v => v.UpdatedAt).IsModified = true;
        }
        if (product.Status == "Published" && !product.Variants.Any(v => v.IsActive))
            throw new BusinessException("incomplete_product", "A published product needs an active variant; hide the product first.");
        product.UpdatedAt = now;
        db.Entry(product).Property(p => p.UpdatedAt).IsModified = true;
        await db.SaveChangesAsync(ct);
        return Result(input.RequestId, "prices", product);
    }, ct);
}
