using Microsoft.EntityFrameworkCore;
using Shop.Modules.Catalog.Application;
using Shop.SharedKernel;
namespace Shop.Modules.Catalog.Infrastructure;

public sealed class ProductFormFields(CatalogDbContext db)
{
    public async Task<ProductFormFieldsData> ReadAsync(CancellationToken ct)
    {
        var profile = await db.Set<ProductFormConfiguration>().AsNoTracking().Include(p => p.Fields).SingleOrDefaultAsync(p => p.Id == "default", ct);
        return new(1, profile is null ? null : Convert.ToBase64String(profile.Version), ProductFormFieldRules.Defaults().Select(rule => { var field = profile?.Fields.SingleOrDefault(f => f.Key == rule.Key); return field is null ? rule : rule with { Label = field.Label, Help = field.Help, Visible = field.Visible, SortOrder = field.SortOrder }; }).OrderBy(f => f.SortOrder).ThenBy(f => f.Key, StringComparer.Ordinal).ToArray());
    }
}
public sealed partial class ProductWorkspaceCommands
{
    public Task<ProductWorkspaceReceipt> FieldsAsync(string actor, ProductFormFieldsInput input, CancellationToken ct) => ExecuteAsync(actor, input.RequestId, "fields", input, async () =>
    {
        ProductFormFieldRules.Validate(input.Fields);
        var profile = await db.Set<ProductFormConfiguration>().Include(p => p.Fields).SingleOrDefaultAsync(p => p.Id == "default", ct);
        if (profile is null)
        {
            if (input.Version is not null)
                throw new BusinessException("version_conflict", "Form settings changed; reload first.");
            profile = new();
            db.Add(profile);
        }
        else
            CatalogRules.Version(profile.Version, input.Version);
        foreach (var field in input.Fields)
        {
            var target = profile.Fields.SingleOrDefault(f => f.Key == field.Key);
            if (target is null)
            {
                target = new()
                {
                    Key = field.Key
                };
                profile.Fields.Add(target);
            }
            target.Label = field.Label.Trim();
            target.Help = field.Help.Trim();
            target.Visible = field.Visible;
            target.SortOrder = field.SortOrder;
        }
        profile.UpdatedAt = clock.GetUtcNow();
        await db.SaveChangesAsync(ct);
        return new(1, input.RequestId, "fields", null, Convert.ToBase64String(profile.Version), []);
    }, ct);
}
