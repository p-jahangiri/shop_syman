using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Catalog
{
    /// <inheritdoc />
    public partial class PublicCatalogueImages : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AssetId",
                schema: "catalog",
                table: "ProductMedia",
                type: "nvarchar(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "PublicImages",
                schema: "catalog",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    CreatedBy = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    OriginalSha256 = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    InputBytes = table.Column<int>(type: "int", nullable: false),
                    Width = table.Column<int>(type: "int", nullable: false),
                    Height = table.Column<int>(type: "int", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PublicImages", x => x.Id);
                    table.CheckConstraint("CK_PublicImage_Size", "[InputBytes] > 0 AND [InputBytes] <= 8388608 AND [Width] > 0 AND [Height] > 0");
                    table.CheckConstraint("CK_PublicImage_Status", "[Status] IN ('Staged','Ready','Failed')");
                });

            migrationBuilder.CreateTable(
                name: "PublicImageVariants",
                schema: "catalog",
                columns: table => new
                {
                    AssetId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Name = table.Column<string>(type: "nvarchar(8)", maxLength: 8, nullable: false),
                    Width = table.Column<int>(type: "int", nullable: false),
                    Height = table.Column<int>(type: "int", nullable: false),
                    Bytes = table.Column<int>(type: "int", nullable: false),
                    Sha256 = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PublicImageVariants", x => new { x.AssetId, x.Name });
                    table.CheckConstraint("CK_PublicImageVariant_Name", "[Name] IN ('thumb','card','zoom')");
                    table.CheckConstraint("CK_PublicImageVariant_Size", "[Bytes] > 0 AND [Bytes] <= 8388608 AND [Width] > 0 AND [Height] > 0");
                    table.ForeignKey(
                        name: "FK_PublicImageVariants_PublicImages_AssetId",
                        column: x => x.AssetId,
                        principalSchema: "catalog",
                        principalTable: "PublicImages",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ProductMedia_AssetId",
                schema: "catalog",
                table: "ProductMedia",
                column: "AssetId");

            migrationBuilder.CreateIndex(
                name: "IX_PublicImages_Status_CreatedAt",
                schema: "catalog",
                table: "PublicImages",
                columns: new[] { "Status", "CreatedAt" });

            migrationBuilder.AddForeignKey(
                name: "FK_ProductMedia_PublicImages_AssetId",
                schema: "catalog",
                table: "ProductMedia",
                column: "AssetId",
                principalSchema: "catalog",
                principalTable: "PublicImages",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ProductMedia_PublicImages_AssetId",
                schema: "catalog",
                table: "ProductMedia");

            migrationBuilder.DropTable(
                name: "PublicImageVariants",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "PublicImages",
                schema: "catalog");

            migrationBuilder.DropIndex(
                name: "IX_ProductMedia_AssetId",
                schema: "catalog",
                table: "ProductMedia");

            migrationBuilder.DropColumn(
                name: "AssetId",
                schema: "catalog",
                table: "ProductMedia");
        }
    }
}
