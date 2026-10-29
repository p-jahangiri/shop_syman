using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Catalog
{
    /// <inheritdoc />
    public partial class MarketModelProjection : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Internal catalogue contract, never a public publication by itself.
            var sql = """
CREATE VIEW [catalog].[MarketModelsV1] AS
SELECT p.[Id] AS [ModelId],p.[Slug],p.[CategoryId],p.[BrandId],COALESCE(b.[Name],N'') AS [Brand],
 COALESCE(fa.[Name],N'') AS [NameFa],COALESCE(en.[Name],N'') AS [NameEn],
 COALESCE(fa.[SearchName],N'') AS [SearchFa],COALESCE(en.[SearchName],N'') AS [SearchEn],
 CONVERT(varbinary(8),p.[Version]) AS [Version],
 CONVERT(bit,CASE WHEN p.[Status]<>'Hidden' AND p.[IsDigital]=0 AND c.[IsActive]=1 AND b.[IsActive]=1
 AND LEN(LTRIM(RTRIM(COALESCE(fa.[Name],N''))))>0 AND LEN(LTRIM(RTRIM(COALESCE(en.[Name],N''))))>0
 AND EXISTS(SELECT 1 FROM [catalog].[ProductMedia] media WHERE media.[ProductId]=p.[Id])
 AND NOT EXISTS(SELECT 1 FROM [catalog].[CategoryAttributes] ca WHERE ca.[CategoryId]=p.[CategoryId] AND ca.[IsRequired]=1
   AND NOT EXISTS(SELECT 1 FROM [catalog].[ProductAttributeValue] pv WHERE pv.[ProductId]=p.[Id] AND pv.[AttributeId]=ca.[AttributeId]))
 THEN 1 ELSE 0 END) AS [IsEligible]
FROM [catalog].[Products] p
LEFT JOIN [catalog].[Categories] c ON c.[Id]=p.[CategoryId]
LEFT JOIN [catalog].[Brands] b ON b.[Id]=p.[BrandId]
LEFT JOIN [catalog].[ProductTranslation] fa ON fa.[ProductId]=p.[Id] AND fa.[Locale]='fa'
LEFT JOIN [catalog].[ProductTranslation] en ON en.[ProductId]=p.[Id] AND en.[Locale]='en' 
""";
            migrationBuilder.Sql("EXEC(N'" + sql.Replace("'", "''") + "');");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP VIEW [catalog].[MarketModelsV1];");
        }
    }
}
