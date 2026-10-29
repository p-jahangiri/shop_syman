using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Inventory
{
    /// <inheritdoc />
    public partial class SingleUnitUsedStock : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsSingleUnit",
                schema: "inventory",
                table: "Stock",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddCheckConstraint(
                name: "CK_Stock_SingleUnit",
                schema: "inventory",
                table: "Stock",
                sql: "[IsSingleUnit]=0 OR [OnHand]<=1");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS (SELECT 1 FROM [inventory].[Stock] WHERE [IsSingleUnit]=1) THROW 51000, 'Single-device stock constraints must be preserved; downgrade refused.', 1;");
            migrationBuilder.DropCheckConstraint(
                name: "CK_Stock_SingleUnit",
                schema: "inventory",
                table: "Stock");

            migrationBuilder.DropColumn(
                name: "IsSingleUnit",
                schema: "inventory",
                table: "Stock");
        }
    }
}
