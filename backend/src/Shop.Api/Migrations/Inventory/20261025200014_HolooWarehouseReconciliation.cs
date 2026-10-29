using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Inventory
{
    /// <inheritdoc />
    public partial class HolooWarehouseReconciliation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AccountingWarehouseCommands",
                schema: "inventory",
                columns: table => new
                {
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CommandId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    TargetId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ResultJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AccountingWarehouseCommands", x => new { x.ActorId, x.CommandId });
                    table.CheckConstraint("CK_AccountingWarehouseCommand_Result", "ISJSON([ResultJson])=1 AND DATALENGTH([ResultJson])<=8192");
                });

            migrationBuilder.CreateTable(
                name: "AccountingWarehouseLinks",
                schema: "inventory",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    CompanyKey = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false, collation: "Latin1_General_100_BIN2"),
                    ExternalWarehouseKey = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false, collation: "Latin1_General_100_BIN2"),
                    NameFa = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    NameEn = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    Scope = table.Column<string>(type: "varchar(24)", unicode: false, maxLength: 24, nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false),
                    ChangedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AccountingWarehouseLinks", x => x.Id);
                    table.CheckConstraint("CK_AccountingWarehouse_Scope", "[Scope]='whole_store_physical'");
                });

            migrationBuilder.CreateIndex(
                name: "IX_AccountingWarehouseLinks_CompanyKey_ExternalWarehouseKey",
                schema: "inventory",
                table: "AccountingWarehouseLinks",
                columns: new[] { "CompanyKey", "ExternalWarehouseKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_AccountingWarehouseLinks_CompanyKey_Id",
                schema: "inventory",
                table: "AccountingWarehouseLinks",
                columns: new[] { "CompanyKey", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_AccountingWarehouseLinks_Scope",
                schema: "inventory",
                table: "AccountingWarehouseLinks",
                column: "Scope",
                unique: true,
                filter: "[IsActive]=1");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS(SELECT 1 FROM [inventory].[AccountingWarehouseCommands]) OR EXISTS(SELECT 1 FROM [inventory].[AccountingWarehouseLinks]) THROW 51000, 'Warehouse mapping history must be retained. Automatic destructive rollback is forbidden.', 1;");
            migrationBuilder.DropTable(
                name: "AccountingWarehouseCommands",
                schema: "inventory");

            migrationBuilder.DropTable(
                name: "AccountingWarehouseLinks",
                schema: "inventory");
        }
    }
}
