using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Catalog
{
    /// <inheritdoc />
    public partial class HolooProductLinks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AccountingProductLinks",
                schema: "catalog",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Provider = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    CompanyKey = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false, collation: "Latin1_General_100_BIN2"),
                    ExternalItemId = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false, collation: "Latin1_General_100_BIN2"),
                    ExternalCode = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: true),
                    VariantId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false),
                    SearchText = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    CreatedBy = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    ChangedBy = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ChangedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AccountingProductLinks", x => x.Id);
                    table.CheckConstraint("CK_AccountingLink_Provider", "[Provider]='holoo'");
                    table.ForeignKey(
                        name: "FK_AccountingProductLinks_Variants_VariantId",
                        column: x => x.VariantId,
                        principalSchema: "catalog",
                        principalTable: "Variants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AccountingProductLinks_Provider_CompanyKey_ExternalItemId",
                schema: "catalog",
                table: "AccountingProductLinks",
                columns: new[] { "Provider", "CompanyKey", "ExternalItemId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_AccountingProductLinks_Provider_CompanyKey_VariantId",
                schema: "catalog",
                table: "AccountingProductLinks",
                columns: new[] { "Provider", "CompanyKey", "VariantId" },
                unique: true,
                filter: "[IsActive] = 1");

            migrationBuilder.CreateIndex(
                name: "IX_AccountingProductLinks_Provider_Id",
                schema: "catalog",
                table: "AccountingProductLinks",
                columns: new[] { "Provider", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_AccountingProductLinks_VariantId",
                schema: "catalog",
                table: "AccountingProductLinks",
                column: "VariantId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AccountingProductLinks",
                schema: "catalog");
        }
    }
}
