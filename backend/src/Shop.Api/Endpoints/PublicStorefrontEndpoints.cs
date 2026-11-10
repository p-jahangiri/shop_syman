using System.Globalization;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Cms;
using Shop.SharedKernel;

internal static class PublicStorefrontEndpoints
{
    internal static void MapPublicStorefront(this WebApplication app)
    {
        app.MapGet("/api/storefront/{locale}", async (string locale, bool? metadataOnly, ICatalogService catalog, IPurchaseConfiguration purchasing, ContentService cms, ICustomerSmsSettings sms, CancellationToken ct) => {
            CheckLocale(locale);
            var metadata = metadataOnly == true ? await catalog.ReadMetadataAsync(locale, ct) : null;
            var site = await cms.ReadAsync("site", locale, ct);
            var data = metadata ?? await catalog.ReadAsync(locale, ct, !SiteAppearanceRules.ShowUsedProducts(site));
            if (site.Count == 0) throw new BusinessException("content_unpublished", "Storefront content has not been published.");
            var returns = await cms.ReadAsync(CategoryReturnGuidance.DocumentKey, locale, ct);
            site.Remove("categoryReturnGuidance");
            if (returns["items"] is System.Text.Json.Nodes.JsonArray { Count: > 0 } items)
                site["categoryReturnGuidance"] = items.DeepClone();
            var auth = await cms.ReadAsync("auth", "fa", ct);
            CustomerAuthSettingsRules.ApplyEffective(auth, await sms.CustomerLoginAvailableAsync(ct));
            var methods = await purchasing.MethodsAsync(locale, ct);
            var plans = await purchasing.PlansAsync(locale, ct);
            return Results.Ok(new { Version = 1, IsPreview = true, DataSource = "api", Locale = locale, Site = site, data.Products, data.Categories, data.AttributeDefinitions, data.AttributeLabels,
                PurchaseMethods = methods.Select(m => new { m.Id, m.Kind, m.Name, m.Description, m.Enabled, m.RequiresApproval, m.CategoryIds, MinAmountRial = m.MinAmountRial?.ToString(CultureInfo.InvariantCulture), MaxAmountRial = m.MaxAmountRial?.ToString(CultureInfo.InvariantCulture) }),
                ChequePlans = plans.Select(p => new { p.Id, p.Name, p.Months, MarkupPercent = p.MarkupBasisPoints / 100m, DownPaymentPercent = p.DownPaymentBasisPoints / 100m, RoundingUnitRial = p.RoundingUnitRial.ToString(CultureInfo.InvariantCulture), p.IntervalMonths, p.Enabled, p.CategoryIds, MinAmountRial = p.MinAmountRial?.ToString(CultureInfo.InvariantCulture), MaxAmountRial = p.MaxAmountRial?.ToString(CultureInfo.InvariantCulture) }), AuthSettings = auth });
        }).AllowAnonymous();
        var publicCatalog = app.MapGroup("/api/catalog/{locale}").AllowAnonymous();
        publicCatalog.AddEndpointFilter(async (context, next) => { context.HttpContext.Response.Headers.CacheControl = "no-store"; return await InputValidation.Filter(context, next); });
        publicCatalog.MapOfflineCatalog();
        publicCatalog.MapCatalogSitemap();
        publicCatalog.MapPost("/search", async (string locale, CatalogSearchInput input, ICatalogService catalog, ContentService cms, CancellationToken ct) => {
            CatalogSearchQuery.Create(input);
            var (condition, hideUsed) = await PublicCatalogCondition(locale, input.Condition, cms, ct);
            return Results.Ok(await catalog.SearchAsync(locale, input with { Condition = condition }, ct, hideUsed));
        });
        publicCatalog.MapPost("/lookup", async (string locale, ProductLookupInput input, ICatalogService catalog, ContentService cms, CancellationToken ct) => {
            CatalogSearchQuery.ValidateLookup(input);
            var (_, hideUsed) = await PublicCatalogCondition(locale, null, cms, ct);
            return Results.Ok(new { Version = 1, Locale = locale, Products = await catalog.LookupAsync(locale, input, ct, hideUsed) });
        });
        publicCatalog.MapPost("/facet-values", async (string locale, FacetValuesInput input, ICatalogService catalog, ContentService cms, CancellationToken ct) => {
            FacetValuesQuery.Create(input);
            var (condition, _) = await PublicCatalogCondition(locale, input.Condition, cms, ct);
            return Results.Ok(await catalog.FacetValuesAsync(locale, input with { Condition = condition }, ct));
        });
        publicCatalog.MapGet("/filters", async (string locale, string? categoryId, string? condition, ICatalogService catalog, ContentService cms, CancellationToken ct) => {
            var query = CatalogSearchQuery.Create(new(CategoryId: categoryId, Condition: condition));
            var (effectiveCondition, _) = await PublicCatalogCondition(locale, query.Condition, cms, ct);
            return Results.Ok(await catalog.FiltersAsync(locale, query.CategoryId, ct, effectiveCondition));
        });
    }

    private static void CheckLocale(string locale)
    {
        if (locale is not ("fa" or "en"))
            throw new BusinessException("invalid_locale", "Use fa or en.");
    }

    private static async Task<(string? Condition, bool HideUsed)> PublicCatalogCondition(string locale, string? condition, ContentService cms, CancellationToken ct)
    {
        CheckLocale(locale);
        bool hideUsed;
        try
        {
            hideUsed = !SiteAppearanceRules.ShowUsedProducts(await cms.ReadAsync("site", locale, ct));
        }
        catch (System.Data.Common.DbException)
        {
            throw new BusinessException("catalog_unavailable", "Published catalogue settings are unavailable.");
        }
        if (hideUsed && condition == "used")
            throw new BusinessException("not_found", "The catalogue section is unavailable.");
        return (hideUsed ? "new" : condition, hideUsed);
    }
}
