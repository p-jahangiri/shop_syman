using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Catalog
{
    /// <inheritdoc />
    public partial class ProductWorkspace : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ArchivedAt",
                schema: "catalog",
                table: "Products",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "VideoAssetId",
                schema: "catalog",
                table: "ProductMedia",
                type: "nvarchar(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ProductFormConfigurations",
                schema: "catalog",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProductFormConfigurations", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ProductWorkspaceCommands",
                schema: "catalog",
                columns: table => new
                {
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    RequestId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Fingerprint = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Kind = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    ReceiptJson = table.Column<string>(type: "nvarchar(max)", maxLength: 16384, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProductWorkspaceCommands", x => new { x.ActorId, x.RequestId });
                    table.CheckConstraint("CK_ProductWorkspaceCommand_Kind", "[Kind] IN ('save','prices','archive','restore','fields')");
                });

            migrationBuilder.CreateTable(
                name: "PublicVideos",
                schema: "catalog",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    CreatedBy = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    Extension = table.Column<string>(type: "nvarchar(4)", maxLength: 4, nullable: false),
                    Sha256 = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Bytes = table.Column<int>(type: "int", nullable: false),
                    InputBytes = table.Column<int>(type: "int", nullable: false),
                    Width = table.Column<int>(type: "int", nullable: false),
                    Height = table.Column<int>(type: "int", nullable: false),
                    DurationMilliseconds = table.Column<int>(type: "int", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PublicVideos", x => x.Id);
                    table.CheckConstraint("CK_PublicVideo_Extension", "[Extension] IN ('mp4','webm')");
                    table.CheckConstraint("CK_PublicVideo_Size", "[InputBytes] > 0 AND [InputBytes] <= 33554432 AND [Bytes] > 0 AND [Bytes] <= 41943040 AND [Width] > 0 AND [Width] <= 4096 AND [Height] > 0 AND [Height] <= 4096 AND [DurationMilliseconds] > 0 AND [DurationMilliseconds] <= 600000");
                    table.CheckConstraint("CK_PublicVideo_Status", "[Status] IN ('Staged','Ready','Failed')");
                });

            migrationBuilder.CreateTable(
                name: "ProductFormFields",
                schema: "catalog",
                columns: table => new
                {
                    ConfigurationId = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    Key = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    Label = table.Column<string>(type: "nvarchar(150)", maxLength: 150, nullable: false),
                    Help = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: false),
                    Visible = table.Column<bool>(type: "bit", nullable: false),
                    SortOrder = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProductFormFields", x => new { x.ConfigurationId, x.Key });
                    table.CheckConstraint("CK_ProductFormField_Order", "[SortOrder] >= 0 AND [SortOrder] <= 1000");
                    table.ForeignKey(
                        name: "FK_ProductFormFields_ProductFormConfigurations_ConfigurationId",
                        column: x => x.ConfigurationId,
                        principalSchema: "catalog",
                        principalTable: "ProductFormConfigurations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Products_ArchivedAt_UpdatedAt_Id",
                schema: "catalog",
                table: "Products",
                columns: new[] { "ArchivedAt", "UpdatedAt", "Id" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_Product_ArchivedVisibility",
                schema: "catalog",
                table: "Products",
                sql: "[ArchivedAt] IS NULL OR [Status] = 'Hidden'");

            migrationBuilder.CreateIndex(
                name: "IX_ProductMedia_VideoAssetId",
                schema: "catalog",
                table: "ProductMedia",
                column: "VideoAssetId");

            migrationBuilder.CreateIndex(
                name: "IX_ProductWorkspaceCommands_CreatedAt",
                schema: "catalog",
                table: "ProductWorkspaceCommands",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_PublicVideos_Status_CreatedAt",
                schema: "catalog",
                table: "PublicVideos",
                columns: new[] { "Status", "CreatedAt" });

            migrationBuilder.AddForeignKey(
                name: "FK_ProductMedia_PublicVideos_VideoAssetId",
                schema: "catalog",
                table: "ProductMedia",
                column: "VideoAssetId",
                principalSchema: "catalog",
                principalTable: "PublicVideos",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS(SELECT 1 FROM [catalog].[ProductWorkspaceCommands]) OR EXISTS(SELECT 1 FROM [catalog].[ProductFormConfigurations]) OR EXISTS(SELECT 1 FROM [catalog].[PublicVideos]) OR EXISTS(SELECT 1 FROM [catalog].[Products] WHERE [ArchivedAt] IS NOT NULL) OR EXISTS(SELECT 1 FROM [catalog].[ProductMedia] WHERE [Type]='video' OR [VideoAssetId] IS NOT NULL) THROW 51000, 'Product workspace data exists; forward-only recovery is required.', 1;");
            migrationBuilder.DropForeignKey(
                name: "FK_ProductMedia_PublicVideos_VideoAssetId",
                schema: "catalog",
                table: "ProductMedia");

            migrationBuilder.DropTable(
                name: "ProductFormFields",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "ProductWorkspaceCommands",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "PublicVideos",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "ProductFormConfigurations",
                schema: "catalog");

            migrationBuilder.DropIndex(
                name: "IX_Products_ArchivedAt_UpdatedAt_Id",
                schema: "catalog",
                table: "Products");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Product_ArchivedVisibility",
                schema: "catalog",
                table: "Products");

            migrationBuilder.DropIndex(
                name: "IX_ProductMedia_VideoAssetId",
                schema: "catalog",
                table: "ProductMedia");

            migrationBuilder.DropColumn(
                name: "ArchivedAt",
                schema: "catalog",
                table: "Products");

            migrationBuilder.DropColumn(
                name: "VideoAssetId",
                schema: "catalog",
                table: "ProductMedia");
        }
    }
}
