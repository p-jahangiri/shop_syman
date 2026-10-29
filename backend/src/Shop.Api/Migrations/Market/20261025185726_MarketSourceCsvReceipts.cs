using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Market
{
    /// <inheritdoc />
    public partial class MarketSourceCsvReceipts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "SourceImportReceipts",
                schema: "market",
                columns: table => new
                {
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    RequestId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ResultJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    RowCount = table.Column<int>(type: "int", nullable: false),
                    ContainsDemo = table.Column<bool>(type: "bit", nullable: false),
                    RecordedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SourceImportReceipts", x => new { x.ActorId, x.RequestId });
                    table.CheckConstraint("CK_MarketSourceImport_Json", "ISJSON([ResultJson])=1 AND DATALENGTH([ResultJson])<=262144");
                    table.CheckConstraint("CK_MarketSourceImport_Rows", "[RowCount] BETWEEN 1 AND 50");
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS(SELECT 1 FROM [market].[SourceImportReceipts]) THROW 51000, 'Source CSV receipts must be retained. This downgrade is unavailable.', 1;");
            migrationBuilder.DropTable(
                name: "SourceImportReceipts",
                schema: "market");
        }
    }
}
