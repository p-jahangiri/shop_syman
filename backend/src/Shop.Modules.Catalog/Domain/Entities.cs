namespace Shop.Modules.Catalog.Domain;

public abstract class CatalogEntity
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public byte[] Version { get; set; } = [];
}
public sealed class Category : CatalogEntity
{
    public string Slug { get; set; } = "";
    public string? ParentId { get; set; }
    public string ImageUrl { get; set; } = "";
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
    public List<CategoryTranslation> Translations { get; set; } = [];
    public List<CategoryAttribute> Attributes { get; set; } = [];
}
public sealed class CategoryTranslation
{
    public string CategoryId { get; set; } = "";
    public string Locale { get; set; } = "fa";
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public string SeoTitle { get; set; } = "";
    public string SeoDescription { get; set; } = "";
}
public sealed class Brand : CatalogEntity
{
    public string Name { get; set; } = "";
    public string SearchName { get; set; } = "";
    public string Slug { get; set; } = "";
    public string LogoUrl { get; set; } = "";
    public bool IsActive { get; set; } = true;
}
public enum AttributeDataType { Text, Number, Bool, Select, MultiSelect }
public sealed class AttributeDefinition : CatalogEntity
{
    public string Key { get; set; } = "";
    public AttributeDataType DataType { get; set; }
    public string? Unit { get; set; }
    public List<AttributeTranslation> Translations { get; set; } = [];
    public List<AttributeOption> Options { get; set; } = [];
}
public sealed class AttributeTranslation
{
    public string AttributeId { get; set; } = "";
    public string Locale { get; set; } = "fa";
    public string Name { get; set; } = "";
    public string? Unit { get; set; }
}
public sealed class AttributeOption
{
    [System.Text.Json.Serialization.JsonIgnore]
    public string FacetSearch { get; set; } = "";
    public string AttributeId { get; set; } = "";
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Value { get; set; } = "";
    public string LabelFa { get; set; } = "";
    public string LabelEn { get; set; } = "";
    public int SortOrder { get; set; }
}
public sealed class CategoryAttribute
{
    public string CategoryId { get; set; } = "";
    public string AttributeId { get; set; } = "";
    public bool IsRequired { get; set; }
    public bool IsFilterable { get; set; }
    public bool IsComparable { get; set; } = true;
    public bool ShowInSpecs { get; set; } = true;
    public bool IsVariantAxis { get; set; }
    public string GroupName { get; set; } = "general";
    public int SortOrder { get; set; }
}
public sealed class Product : CatalogEntity
{
    public string SellerId { get; set; } = "sayman";
    public string CategoryId { get; set; } = "";
    public string BrandId { get; set; } = "";
    public string Slug { get; set; } = "";
    public string Status { get; set; } = "Draft";
    public bool IsDigital { get; set; }
    public bool Featured { get; set; }
    public DateTimeOffset? PublishAt { get; set; }
    public List<ProductTranslation> Translations { get; set; } = [];
    public List<ProductVariant> Variants { get; set; } = [];
    public List<ProductAttributeValue> Attributes { get; set; } = [];
    public List<ProductMedia> Media { get; set; } = [];
    public List<ProductPurchaseMethod> PurchaseMethods { get; set; } = [];
    public List<ProductCreditPlan> CreditPlans { get; set; } = [];
}
public sealed class ProductTranslation
{
    public string ProductId { get; set; } = "";
    public string Locale { get; set; } = "fa";
    public string Name { get; set; } = "";
    public string SearchName { get; set; } = "";
    public string Description { get; set; } = "";
    public string? Badge { get; set; }
}
public sealed class ProductVariant : CatalogEntity
{
    public string ProductId { get; set; } = "";
    [System.Text.Json.Serialization.JsonIgnore]
    public string? UsedInspectionId { get; set; }
    public string Sku { get; set; } = "";
    public string SearchSku { get; set; } = "";
    public string? Barcode { get; set; }
    public long PriceRial { get; set; }
    public long? CompareAtPriceRial { get; set; }
    public string Color { get; set; } = "#777777";
    public string ColorNameFa { get; set; } = "";
    public string ColorNameEn { get; set; } = "";
    public string LabelFa { get; set; } = "";
    public string LabelEn { get; set; } = "";
    public string WarrantyFa { get; set; } = "";
    public string WarrantyEn { get; set; } = "";
    public bool IsActive { get; set; } = true;
    public List<VariantAttributeValue> Attributes { get; set; } = [];
    public List<VariantPurchaseMethod> PurchaseMethods { get; set; } = [];
}
public sealed class ProductAttributeValue
{
    [System.Text.Json.Serialization.JsonIgnore]
    public string? FacetSearch { get; set; }
    public string ProductId { get; set; } = "";
    public string AttributeId { get; set; } = "";
    public string? ValueTextFa { get; set; }
    public string? ValueTextEn { get; set; }
    public decimal? ValueNumber { get; set; }
    public bool? ValueBool { get; set; }
    public string? ValueOptionId { get; set; }
    public List<ProductAttributeSelection> Selections { get; set; } = [];
}
public sealed class ProductAttributeSelection
{
    public string ProductId { get; set; } = "";
    public string AttributeId { get; set; } = "";
    public string OptionId { get; set; } = "";
}
public sealed class VariantAttributeValue
{
    [System.Text.Json.Serialization.JsonIgnore]
    public string? FacetSearch { get; set; }
    public string VariantId { get; set; } = "";
    public string AttributeId { get; set; } = "";
    public string? ValueTextFa { get; set; }
    public string? ValueTextEn { get; set; }
    public decimal? ValueNumber { get; set; }
    public bool? ValueBool { get; set; }
    public string? ValueOptionId { get; set; }
}
public sealed class ProductMedia : CatalogEntity
{
    public string? AssetId { get; set; }
    public string ProductId { get; set; } = "";
    public string? VariantId { get; set; }
    public string Url { get; set; } = "";
    public string Type { get; set; } = "image";
    public int SortOrder { get; set; }
}
public sealed class ProductPurchaseMethod { public string ProductId { get; set; } = ""; public string MethodId { get; set; } = ""; }
public sealed class ProductCreditPlan { public string ProductId { get; set; } = ""; public string PlanId { get; set; } = ""; }
public sealed class VariantPurchaseMethod { public string VariantId { get; set; } = ""; public string MethodId { get; set; } = ""; }
public sealed class PriceHistory : CatalogEntity
{
    public string VariantId { get; set; } = "";
    public long OldPrice { get; set; }
    public long NewPrice { get; set; }
    public string ChangedBy { get; set; } = "";
}
