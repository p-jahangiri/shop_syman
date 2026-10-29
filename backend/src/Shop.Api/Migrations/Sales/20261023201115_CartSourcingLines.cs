using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Sales
{
    /// <inheritdoc />
    public partial class CartSourcingLines : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CartSourcingLines",
                schema: "sales",
                columns: table => new
                {
                    CartId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    ListingId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Quantity = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CartSourcingLines", x => new { x.CartId, x.ListingId });
                    table.CheckConstraint("CK_CartSourcingLine_Quantity", "[Quantity] > 0 AND [Quantity] <= 1000000");
                    table.ForeignKey(
                        name: "FK_CartSourcingLines_Carts_CartId",
                        column: x => x.CartId,
                        principalSchema: "sales",
                        principalTable: "Carts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CartSourcingLines",
                schema: "sales");
        }
    }
}
