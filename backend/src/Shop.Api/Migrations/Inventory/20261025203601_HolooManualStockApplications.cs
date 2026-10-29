using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Inventory
{
    /// <inheritdoc />
    public partial class HolooManualStockApplications : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AccountingStockApplications",
                schema: "inventory",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CommandId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    BatchId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    BatchPayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    PreviewFingerprint = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    CompanyKey = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false, collation: "Latin1_General_100_BIN2"),
                    ExternalWarehouseKey = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false, collation: "Latin1_General_100_BIN2"),
                    WarehouseId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    WarehouseVersion = table.Column<string>(type: "varchar(12)", unicode: false, maxLength: 12, nullable: false),
                    ObservedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    AppliedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Reason = table.Column<string>(type: "nvarchar(400)", maxLength: 400, nullable: false),
                    IsDemo = table.Column<bool>(type: "bit", nullable: false),
                    AcknowledgeWholeStorePhysical = table.Column<bool>(type: "bit", nullable: false),
                    AcknowledgeUnpostedSalesReconciled = table.Column<bool>(type: "bit", nullable: false),
                    RowCount = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AccountingStockApplications", x => x.Id);
                    table.CheckConstraint("CK_AccountingStockApplication_Consent", "[AcknowledgeWholeStorePhysical]=1 AND [AcknowledgeUnpostedSalesReconciled]=1");
                    table.CheckConstraint("CK_AccountingStockApplication_Count", "[RowCount] BETWEEN 1 AND 200");
                    table.CheckConstraint("CK_AccountingStockApplication_Time", "[ObservedAt]<=[AppliedAt]");
                    table.ForeignKey(
                        name: "FK_AccountingStockApplications_AccountingWarehouseLinks_WarehouseId",
                        column: x => x.WarehouseId,
                        principalSchema: "inventory",
                        principalTable: "AccountingWarehouseLinks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "AccountingStockApplicationLines",
                schema: "inventory",
                columns: table => new
                {
                    ApplicationId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    RowNumber = table.Column<int>(type: "int", nullable: false),
                    BatchId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    ObservedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ExternalItemId = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false, collation: "Latin1_General_100_BIN2"),
                    ExternalUnitKey = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false, collation: "Latin1_General_100_BIN2"),
                    SourceQuantity = table.Column<string>(type: "varchar(29)", unicode: false, maxLength: 29, nullable: false),
                    Numerator = table.Column<int>(type: "int", nullable: false),
                    Denominator = table.Column<int>(type: "int", nullable: false),
                    LinkId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    LinkVersion = table.Column<string>(type: "varchar(12)", unicode: false, maxLength: 12, nullable: false),
                    MappingId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    MappingVersion = table.Column<string>(type: "varchar(12)", unicode: false, maxLength: 12, nullable: false),
                    VariantId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    ProductId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    VariantVersion = table.Column<string>(type: "varchar(12)", unicode: false, maxLength: 12, nullable: false),
                    ProductVersion = table.Column<string>(type: "varchar(12)", unicode: false, maxLength: 12, nullable: false),
                    Sku = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false),
                    NameFa = table.Column<string>(type: "nvarchar(250)", maxLength: 250, nullable: false),
                    NameEn = table.Column<string>(type: "nvarchar(250)", maxLength: 250, nullable: false),
                    BeforeOnHand = table.Column<int>(type: "int", nullable: false),
                    AfterOnHand = table.Column<int>(type: "int", nullable: false),
                    Reserved = table.Column<int>(type: "int", nullable: false),
                    SourcingReserved = table.Column<int>(type: "int", nullable: false),
                    Delta = table.Column<int>(type: "int", nullable: false),
                    BeforeStockVersion = table.Column<string>(type: "varchar(12)", unicode: false, maxLength: 12, nullable: true),
                    AfterStockVersion = table.Column<string>(type: "varchar(12)", unicode: false, maxLength: 12, nullable: true),
                    MovementId = table.Column<long>(type: "bigint", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AccountingStockApplicationLines", x => new { x.ApplicationId, x.RowNumber });
                    table.CheckConstraint("CK_AccountingStockLine_Balance", "[BeforeOnHand]>=0 AND [AfterOnHand] BETWEEN 0 AND 1000000 AND [Reserved]>=0 AND [SourcingReserved]>=0 AND CAST([Reserved] AS bigint)+CAST([SourcingReserved] AS bigint)<=[BeforeOnHand] AND CAST([Reserved] AS bigint)+CAST([SourcingReserved] AS bigint)<=[AfterOnHand] AND CAST([AfterOnHand] AS bigint)-CAST([BeforeOnHand] AS bigint)=[Delta] AND [Delta] BETWEEN -1000000 AND 1000000");
                    table.CheckConstraint("CK_AccountingStockLine_Movement", "([Delta]=0 AND [MovementId] IS NULL) OR ([Delta]<>0 AND [MovementId] IS NOT NULL)");
                    table.CheckConstraint("CK_AccountingStockLine_RowRatio", "[RowNumber] BETWEEN 1 AND 200 AND [Numerator] BETWEEN 1 AND 1000000 AND [Denominator] BETWEEN 1 AND 1000000");
                    table.ForeignKey(
                        name: "FK_AccountingStockApplicationLines_AccountingStockApplications_ApplicationId",
                        column: x => x.ApplicationId,
                        principalSchema: "inventory",
                        principalTable: "AccountingStockApplications",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_AccountingStockApplicationLines_Movements_MovementId",
                        column: x => x.MovementId,
                        principalSchema: "inventory",
                        principalTable: "Movements",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_AccountingStockApplicationLines_ReceivingUnitMappings_MappingId",
                        column: x => x.MappingId,
                        principalSchema: "inventory",
                        principalTable: "ReceivingUnitMappings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AccountingStockApplicationLines_BatchId_RowNumber",
                schema: "inventory",
                table: "AccountingStockApplicationLines",
                columns: new[] { "BatchId", "RowNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_AccountingStockApplicationLines_MappingId",
                schema: "inventory",
                table: "AccountingStockApplicationLines",
                column: "MappingId");

            migrationBuilder.CreateIndex(
                name: "IX_AccountingStockApplicationLines_MovementId",
                schema: "inventory",
                table: "AccountingStockApplicationLines",
                column: "MovementId");

            migrationBuilder.CreateIndex(
                name: "IX_AccountingStockApplicationLines_VariantId_ObservedAt",
                schema: "inventory",
                table: "AccountingStockApplicationLines",
                columns: new[] { "VariantId", "ObservedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_AccountingStockApplications_ActorId_CommandId",
                schema: "inventory",
                table: "AccountingStockApplications",
                columns: new[] { "ActorId", "CommandId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_AccountingStockApplications_BatchId_Id",
                schema: "inventory",
                table: "AccountingStockApplications",
                columns: new[] { "BatchId", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_AccountingStockApplications_WarehouseId",
                schema: "inventory",
                table: "AccountingStockApplications",
                column: "WarehouseId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS(SELECT 1 FROM [inventory].[AccountingStockApplications]) OR EXISTS(SELECT 1 FROM [inventory].[AccountingStockApplicationLines]) THROW 51000, 'Manual stock application history and ledger links must be preserved.', 1;");
            migrationBuilder.DropTable(
                name: "AccountingStockApplicationLines",
                schema: "inventory");

            migrationBuilder.DropTable(
                name: "AccountingStockApplications",
                schema: "inventory");
        }
    }
}
