using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Catalog
{
    /// <inheritdoc />
    public partial class FacetSearchFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "FacetSearch",
                schema: "catalog",
                table: "VariantAttributeValue",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FacetSearch",
                schema: "catalog",
                table: "ProductAttributeValue",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FacetSearch",
                schema: "catalog",
                table: "AttributeOptions",
                type: "nvarchar(max)",
                nullable: false,
                defaultValue: "");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "FacetSearch",
                schema: "catalog",
                table: "VariantAttributeValue");

            migrationBuilder.DropColumn(
                name: "FacetSearch",
                schema: "catalog",
                table: "ProductAttributeValue");

            migrationBuilder.DropColumn(
                name: "FacetSearch",
                schema: "catalog",
                table: "AttributeOptions");
        }
    }
}
