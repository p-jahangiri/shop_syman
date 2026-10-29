using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Sales
{
    /// <inheritdoc />
    public partial class AccountWishlists : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "WishlistHeads",
                schema: "sales",
                columns: table => new
                {
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Revision = table.Column<long>(type: "bigint", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WishlistHeads", x => x.OwnerId);
                    table.CheckConstraint("CK_WishlistHead_Revision", "[Revision]>0");
                });

            migrationBuilder.CreateTable(
                name: "WishlistItems",
                schema: "sales",
                columns: table => new
                {
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    ProductId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    AddedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WishlistItems", x => new { x.OwnerId, x.ProductId });
                    table.ForeignKey(
                        name: "FK_WishlistItems_WishlistHeads_OwnerId",
                        column: x => x.OwnerId,
                        principalSchema: "sales",
                        principalTable: "WishlistHeads",
                        principalColumn: "OwnerId",
                        onDelete: ReferentialAction.Restrict);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS (SELECT 1 FROM [sales].[WishlistHeads]) OR EXISTS (SELECT 1 FROM [sales].[WishlistItems]) THROW 51000, 'Retain account wishlist data before reverting this migration.', 1;");
            migrationBuilder.DropTable(
                name: "WishlistItems",
                schema: "sales");

            migrationBuilder.DropTable(
                name: "WishlistHeads",
                schema: "sales");
        }
    }
}
