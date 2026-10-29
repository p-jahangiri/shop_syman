using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Catalog
{
    /// <inheritdoc />
    public partial class CatalogSearchFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "SearchSku",
                schema: "catalog",
                table: "Variants",
                type: "nvarchar(500)",
                maxLength: 500,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "SearchName",
                schema: "catalog",
                table: "ProductTranslation",
                type: "nvarchar(500)",
                maxLength: 500,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "SearchName",
                schema: "catalog",
                table: "Brands",
                type: "nvarchar(500)",
                maxLength: 500,
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateIndex(
                name: "IX_Variants_SearchSku",
                schema: "catalog",
                table: "Variants",
                column: "SearchSku");

            migrationBuilder.CreateIndex(
                name: "IX_ProductTranslation_SearchName",
                schema: "catalog",
                table: "ProductTranslation",
                column: "SearchName");

            migrationBuilder.CreateIndex(
                name: "IX_Brands_SearchName",
                schema: "catalog",
                table: "Brands",
                column: "SearchName");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Variants_SearchSku",
                schema: "catalog",
                table: "Variants");

            migrationBuilder.DropIndex(
                name: "IX_ProductTranslation_SearchName",
                schema: "catalog",
                table: "ProductTranslation");

            migrationBuilder.DropIndex(
                name: "IX_Brands_SearchName",
                schema: "catalog",
                table: "Brands");

            migrationBuilder.DropColumn(
                name: "SearchSku",
                schema: "catalog",
                table: "Variants");

            migrationBuilder.DropColumn(
                name: "SearchName",
                schema: "catalog",
                table: "ProductTranslation");

            migrationBuilder.DropColumn(
                name: "SearchName",
                schema: "catalog",
                table: "Brands");
        }
    }
}
