using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Sales
{
    /// <inheritdoc />
    public partial class ServerCarts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "sales");

            migrationBuilder.CreateTable(
                name: "Carts",
                schema: "sales",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true),
                    GuestTokenHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: true),
                    GuestExpiresAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    MergedIntoCartId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    Revision = table.Column<long>(type: "bigint", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Carts", x => x.Id);
                    table.CheckConstraint("CK_Cart_Identity", "([OwnerId] IS NOT NULL AND [GuestTokenHash] IS NULL AND [GuestExpiresAt] IS NULL AND [MergedIntoCartId] IS NULL) OR ([OwnerId] IS NULL AND [GuestTokenHash] IS NOT NULL AND [GuestExpiresAt] IS NOT NULL)");
                    table.CheckConstraint("CK_Cart_Merge", "[MergedIntoCartId] IS NULL OR [MergedIntoCartId] <> [Id]");
                    table.CheckConstraint("CK_Cart_Revision", "[Revision] >= 0");
                    table.ForeignKey(
                        name: "FK_Carts_Carts_MergedIntoCartId",
                        column: x => x.MergedIntoCartId,
                        principalSchema: "sales",
                        principalTable: "Carts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "CartLines",
                schema: "sales",
                columns: table => new
                {
                    CartId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    VariantId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Quantity = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CartLines", x => new { x.CartId, x.VariantId });
                    table.CheckConstraint("CK_CartLine_Quantity", "[Quantity] > 0 AND [Quantity] <= 1000000");
                    table.ForeignKey(
                        name: "FK_CartLines_Carts_CartId",
                        column: x => x.CartId,
                        principalSchema: "sales",
                        principalTable: "Carts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Carts_GuestExpiresAt",
                schema: "sales",
                table: "Carts",
                column: "GuestExpiresAt");

            migrationBuilder.CreateIndex(
                name: "IX_Carts_GuestTokenHash",
                schema: "sales",
                table: "Carts",
                column: "GuestTokenHash",
                unique: true,
                filter: "[GuestTokenHash] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Carts_MergedIntoCartId",
                schema: "sales",
                table: "Carts",
                column: "MergedIntoCartId");

            migrationBuilder.CreateIndex(
                name: "IX_Carts_OwnerId",
                schema: "sales",
                table: "Carts",
                column: "OwnerId",
                unique: true,
                filter: "[OwnerId] IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CartLines",
                schema: "sales");

            migrationBuilder.DropTable(
                name: "Carts",
                schema: "sales");
        }
    }
}
