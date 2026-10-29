using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Inventory
{
    /// <inheritdoc />
    public partial class InventoryPublicAvailability : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("EXEC(N'CREATE VIEW [inventory].[AvailableStockV1] WITH SCHEMABINDING AS SELECT [VariantId], [OnHand] - [Reserved] AS [Available] FROM [inventory].[Stock];');");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP VIEW [inventory].[AvailableStockV1];");
        }
    }
}
