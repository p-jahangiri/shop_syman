using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Catalog
{
    /// <inheritdoc />
    public partial class MarketAttributeReadViews : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(Shop.Modules.Catalog.Infrastructure.MarketAttributeViews.Filters);
            migrationBuilder.Sql(Shop.Modules.Catalog.Infrastructure.MarketAttributeViews.Values);
            migrationBuilder.Sql(Shop.Modules.Catalog.Infrastructure.MarketAttributeViews.Options);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP VIEW [catalog].[MarketFilterOptionsV1];");
            migrationBuilder.Sql("DROP VIEW [catalog].[MarketAttributeValuesV1];");
            migrationBuilder.Sql("DROP VIEW [catalog].[MarketFiltersV1];");
        }
    }
}
