namespace Shop.Modules.Catalog.Infrastructure;

public static class MarketAttributeViews
{
    public const string Filters="""
CREATE VIEW [catalog].[MarketFiltersV1] AS
SELECT c.Id CategoryId,d.Id AttributeId,d.[Key],d.DataType,
 COALESCE(fa.Name,d.[Key]) NameFa,COALESCE(en.Name,d.[Key]) NameEn,d.Unit,
 CONVERT(varbinary(8),c.Version) CategoryVersion,CONVERT(varbinary(8),d.Version) DefinitionVersion
FROM [catalog].[Categories] c
JOIN [catalog].[CategoryAttributes] ca ON ca.CategoryId=c.Id AND ca.IsFilterable=1
JOIN [catalog].[AttributeDefinitions] d ON d.Id=ca.AttributeId
LEFT JOIN [catalog].[AttributeTranslation] fa ON fa.AttributeId=d.Id AND fa.Locale='fa'
LEFT JOIN [catalog].[AttributeTranslation] en ON en.AttributeId=d.Id AND en.Locale='en'
WHERE c.IsActive=1
""";
    public const string Values="""
CREATE VIEW [catalog].[MarketAttributeValuesV1] AS
SELECT p.Id ModelId,p.CategoryId,pv.AttributeId,d.DataType,
 pv.ValueTextFa TextFa,pv.ValueTextEn TextEn,pv.FacetSearch [Search],
 pv.ValueNumber [Number],pv.ValueBool Bool,pv.ValueOptionId OptionId
FROM [catalog].[Products] p
JOIN [catalog].[ProductAttributeValue] pv ON pv.ProductId=p.Id
JOIN [catalog].[CategoryAttributes] ca ON ca.CategoryId=p.CategoryId AND ca.AttributeId=pv.AttributeId AND ca.IsFilterable=1
JOIN [catalog].[AttributeDefinitions] d ON d.Id=pv.AttributeId AND d.DataType<>'MultiSelect'
UNION ALL
SELECT p.Id,p.CategoryId,pv.AttributeId,d.DataType,
 CAST(NULL AS nvarchar(2000)),CAST(NULL AS nvarchar(2000)),CAST(NULL AS nvarchar(max)),
 CAST(NULL AS decimal(28,8)),CAST(NULL AS bit),s.OptionId
FROM [catalog].[Products] p
JOIN [catalog].[ProductAttributeValue] pv ON pv.ProductId=p.Id
JOIN [catalog].[ProductAttributeSelection] s ON s.ProductId=pv.ProductId AND s.AttributeId=pv.AttributeId
JOIN [catalog].[CategoryAttributes] ca ON ca.CategoryId=p.CategoryId AND ca.AttributeId=pv.AttributeId AND ca.IsFilterable=1
JOIN [catalog].[AttributeDefinitions] d ON d.Id=pv.AttributeId AND d.DataType='MultiSelect'
""";
    public const string Options="""
CREATE VIEW [catalog].[MarketFilterOptionsV1] AS
SELECT o.AttributeId,o.Id,o.LabelFa,o.LabelEn,o.FacetSearch [Search],o.SortOrder
FROM [catalog].[AttributeOptions] o
JOIN [catalog].[AttributeDefinitions] d ON d.Id=o.AttributeId AND d.DataType IN ('Select','MultiSelect')
""";
}
