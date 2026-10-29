using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Catalog
{
    /// <inheritdoc />
    public partial class HolooImportStaging : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AccountingImportBatches",
                schema: "catalog",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    CompanyKey = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false, collation: "Latin1_General_100_BIN2"),
                    ExternalWarehouseKey = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false, collation: "Latin1_General_100_BIN2"),
                    QuantityMeaning = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    PriceCurrency = table.Column<string>(type: "nvarchar(8)", maxLength: 8, nullable: false, collation: "Latin1_General_100_BIN2"),
                    ObservedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    CreatedBy = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    IsDemo = table.Column<bool>(type: "bit", nullable: false),
                    RowCount = table.Column<int>(type: "int", nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AccountingImportBatches", x => x.Id);
                    table.CheckConstraint("CK_AccountingImport_Count", "[RowCount] BETWEEN 1 AND 200");
                    table.CheckConstraint("CK_AccountingImport_Currency", "[PriceCurrency] IN ('IRR','IRT','unknown')");
                    table.CheckConstraint("CK_AccountingImport_Dates", "[ObservedAt]<=[CreatedAt]");
                    table.CheckConstraint("CK_AccountingImport_Meaning", "[QuantityMeaning] IN ('physical','available','unknown')");
                });

            migrationBuilder.CreateTable(
                name: "AccountingImportRows",
                schema: "catalog",
                columns: table => new
                {
                    BatchId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    RowNumber = table.Column<int>(type: "int", nullable: false),
                    ExternalItemId = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false, collation: "Latin1_General_100_BIN2"),
                    ExternalCode = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: true),
                    ExternalName = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: true),
                    ExternalUnitKey = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false, collation: "Latin1_General_100_BIN2"),
                    QuantityRaw = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true),
                    PriceRaw = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AccountingImportRows", x => new { x.BatchId, x.RowNumber });
                    table.CheckConstraint("CK_AccountingImportRow_Number", "[RowNumber] BETWEEN 1 AND 200");
                    table.ForeignKey(
                        name: "FK_AccountingImportRows_AccountingImportBatches_BatchId",
                        column: x => x.BatchId,
                        principalSchema: "catalog",
                        principalTable: "AccountingImportBatches",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AccountingImportBatches_CompanyKey_Id",
                schema: "catalog",
                table: "AccountingImportBatches",
                columns: new[] { "CompanyKey", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_AccountingImportRows_BatchId_ExternalItemId",
                schema: "catalog",
                table: "AccountingImportRows",
                columns: new[] { "BatchId", "ExternalItemId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS (SELECT 1 FROM [catalog].[AccountingImportBatches]) OR EXISTS (SELECT 1 FROM [catalog].[AccountingImportRows]) THROW 51000, 'Staged accounting import history must be retained. This downgrade is unavailable.', 1;");
            migrationBuilder.DropTable(
                name: "AccountingImportRows",
                schema: "catalog");

            migrationBuilder.DropTable(
                name: "AccountingImportBatches",
                schema: "catalog");
        }
    }
}
