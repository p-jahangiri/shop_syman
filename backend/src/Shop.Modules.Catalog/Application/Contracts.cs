using Shop.Modules.Catalog.Domain;

namespace Shop.Modules.Catalog.Application;

public record TranslationInput(string Locale, string Name, string Description = "", string? Badge = null);
public record BrandInput(string Name, string Slug, string LogoUrl, bool IsActive, string? Version);
public record CategoryAttributeInput(string AttributeId, bool IsRequired = false, bool IsFilterable = true, bool IsComparable = true, bool ShowInSpecs = true, bool IsVariantAxis = false, int SortOrder = 0, string GroupName = "general");
public record CategoryInput(string Slug, string? ParentId, string ImageUrl, int SortOrder, bool IsActive, TranslationInput[] Translations, CategoryAttributeInput[] Attributes, string? Version);
public record OptionInput(string? Id, string Value, string LabelFa, string LabelEn, int SortOrder);
public record AttributeInput(string Key, AttributeDataType DataType, string? Unit, TranslationInput[] Translations, OptionInput[] Options, string? Version);
public record AttributeValueInput(string AttributeId, string? TextFa = null, string? TextEn = null, decimal? Number = null, bool? Bool = null, string? OptionId = null, string[]? OptionIds = null);
public record VariantInput(string? Id, string Sku, string PriceRial, string? CompareAtRial, string Color, string ColorNameFa, string ColorNameEn, string LabelFa, string LabelEn, string WarrantyFa, string WarrantyEn, bool IsActive, AttributeValueInput[] Attributes, string[] PurchaseMethodIds, string? Version);
public record ProductInput(string CategoryId, string BrandId, string Slug, string Status, bool IsDigital, bool Featured, TranslationInput[] Translations, AttributeValueInput[] Attributes, VariantInput[] Variants, string[] ImageUrls, string[] PurchaseMethodIds, string[] ChequePlanIds, string? Version, ProductVideoInput[]? Videos = null);
public record ProductVideoInput(string Url,string? VariantId = null);
public record ProductVideoDto(string Url,string? VariantId);
public record FilterDto(string Key, string Label);
public record CategoryAttributeRuleDto(string Key, bool Comparable, bool ShowInSpecs, bool VariantAxis);
public record CategoryDto(string Key, string Name, string Description, string Image, FilterDto[] Filters, string? ParentId, CategoryAttributeRuleDto[] AttributeRules);
public record VariantDto(string Id, string Sku, string Label, string Color, string ColorName, string PriceRial, string? CompareAtRial, int Stock, string Warranty, Dictionary<string, string> Attributes, string[]? PurchaseMethodIds,[property:System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]Shop.SharedKernel.UsedItemConditionData? UsedCondition=null);
public record ProductDto(string Id, string Slug, string Name, string EnglishName, string Category, string Brand, string Description, string Image, string? Badge, bool IsDigital, bool Featured, Dictionary<string, string> Attributes, VariantDto[] Variants, string[] PurchaseMethodIds, string[] ChequePlanIds, string[]? Images = null, [property:System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]ProductVideoDto[]? Videos = null);
public record DefinitionDto(string Key, string Name, string DataType, string? Unit, bool Comparable, bool Filterable, bool ShowInSpecs);
public record CatalogSnapshot(CategoryDto[] Categories, ProductDto[] Products, DefinitionDto[] AttributeDefinitions, Dictionary<string, string> AttributeLabels);
public interface ICatalogService
{
    Task<bool> VariantExistsAsync(string id, CancellationToken cancellationToken);
    Task<bool> CategoriesExistAsync(string[] ids, CancellationToken cancellationToken);
    Task<string> SaveBrandAsync(string? id, BrandInput input, CancellationToken cancellationToken);
    Task<CatalogSnapshot> ReadAsync(string locale, CancellationToken cancellationToken, bool hideUsed = false);
    Task<CatalogSnapshot> ReadMetadataAsync(string locale, CancellationToken cancellationToken);
    Task<OfflineCatalogSlice> ReadOfflineAsync(string locale, int? limit, CancellationToken cancellationToken, bool hideUsed = false);
    Task<CatalogSitemapStatistics> SitemapStatisticsAsync(string locale, CancellationToken cancellationToken, bool hideUsed = false);
    Task<CatalogSitemapPage> SitemapPageAsync(string locale, string kind, int page, CancellationToken cancellationToken, bool hideUsed = false, bool hideUsedInAlternate = false);
    Task<CatalogSearchPage> SearchAsync(string locale, CatalogSearchInput input, CancellationToken cancellationToken, bool hideUsed = false);
    Task<CatalogFiltersDto> FiltersAsync(string locale, string? categoryId, CancellationToken cancellationToken, string? condition = null);
    Task<FacetValuesPage> FacetValuesAsync(string locale, FacetValuesInput input, CancellationToken cancellationToken);
    Task<ProductDto[]> LookupAsync(string locale, ProductLookupInput input, CancellationToken cancellationToken, bool hideUsed = false);
    Task RepairSearchFieldsAsync(CancellationToken cancellationToken);
    Task<bool> SearchFieldsReadyAsync(CancellationToken cancellationToken);
    Task<object> AdminReadAsync(CancellationToken cancellationToken);
    Task<object> AdminMetadataAsync(CancellationToken cancellationToken);
    Task<string> SaveCategoryAsync(string? id, CategoryInput input, CancellationToken cancellationToken);
    Task<string> SaveAttributeAsync(string? id, AttributeInput input, CancellationToken cancellationToken);
    Task<string> SaveProductAsync(string? id, ProductInput input, string actorId, CancellationToken cancellationToken);
    Task SeedAsync(string seedPath, CancellationToken cancellationToken);
}
