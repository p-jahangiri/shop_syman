using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Inventory
{
    /// <inheritdoc />
    public partial class SourcingReceiving : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ReceivingCommands",
                schema: "inventory",
                columns: table => new
                {
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Operation = table.Column<string>(type: "nvarchar(8)", maxLength: 8, nullable: false),
                    CommandId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    TargetId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    RequestId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    TaskId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    ContainsDemo = table.Column<bool>(type: "bit", nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ResultJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReceivingCommands", x => new { x.ActorId, x.Operation, x.CommandId });
                    table.CheckConstraint("CK_ReceivingCommand_Operation", "[Operation] IN ('receive','mapping')");
                    table.CheckConstraint("CK_ReceivingCommand_Result", "ISJSON([ResultJson])=1 AND DATALENGTH([ResultJson])<=262144");
                });

            migrationBuilder.CreateTable(
                name: "ReceivingUnitMappings",
                schema: "inventory",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    IdentityHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    OriginSystem = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false, collation: "Latin1_General_100_BIN2"),
                    CompanyKey = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false, collation: "Latin1_General_100_BIN2"),
                    WarehouseKey = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false, collation: "Latin1_General_100_BIN2"),
                    SourceUnitKey = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false, collation: "Latin1_General_100_BIN2"),
                    VariantId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Numerator = table.Column<int>(type: "int", nullable: false),
                    Denominator = table.Column<int>(type: "int", nullable: false),
                    NameFa = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    NameEn = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ChangedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReceivingUnitMappings", x => x.Id);
                    table.CheckConstraint("CK_ReceivingMapping_Ratio", "[Numerator] BETWEEN 1 AND 1000000 AND [Denominator] BETWEEN 1 AND 1000000");
                });

            migrationBuilder.CreateTable(
                name: "SourcingReceipts",
                schema: "inventory",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    RequestId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    TaskId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OfferId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    AcceptanceId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    ContainsDemo = table.Column<bool>(type: "bit", nullable: false),
                    RequiresNewOffer = table.Column<bool>(type: "bit", nullable: false),
                    Channel = table.Column<string>(type: "nvarchar(8)", maxLength: 8, nullable: false),
                    OriginSystem = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false, collation: "Latin1_General_100_BIN2"),
                    CompanyKey = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false, collation: "Latin1_General_100_BIN2"),
                    WarehouseKey = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false, collation: "Latin1_General_100_BIN2"),
                    SourceReceiptKey = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false, collation: "Latin1_General_100_BIN2"),
                    ReceivedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    RecordedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Reason = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    AcknowledgeHistorical = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SourcingReceipts", x => x.Id);
                    table.CheckConstraint("CK_SourcingReceipt_Channel", "[Channel] IN ('manual','csv')");
                });

            migrationBuilder.CreateTable(
                name: "SourcingReceiptLines",
                schema: "inventory",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    ReceiptId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    ExternalIdentityHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    OfferLineId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    VariantId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    SourceReceiptLineKey = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false, collation: "Latin1_General_100_BIN2"),
                    MappingId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    MappingVersion = table.Column<string>(type: "varchar(12)", unicode: false, maxLength: 12, nullable: false),
                    SourceUnitKey = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false, collation: "Latin1_General_100_BIN2"),
                    UnitNameFa = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    UnitNameEn = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    Numerator = table.Column<int>(type: "int", nullable: false),
                    Denominator = table.Column<int>(type: "int", nullable: false),
                    SourceQuantity = table.Column<string>(type: "varchar(29)", unicode: false, maxLength: 29, nullable: false),
                    Quantity = table.Column<int>(type: "int", nullable: false),
                    TrackingMode = table.Column<string>(type: "nvarchar(8)", maxLength: 8, nullable: false),
                    MovementId = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SourcingReceiptLines", x => x.Id);
                    table.CheckConstraint("CK_SourcingReceiptLine_Mode", "[TrackingMode] IN ('none','serial','imei')");
                    table.CheckConstraint("CK_SourcingReceiptLine_Quantity", "[Quantity] BETWEEN 1 AND 1000000 AND [Numerator] BETWEEN 1 AND 1000000 AND [Denominator] BETWEEN 1 AND 1000000");
                    table.ForeignKey(
                        name: "FK_SourcingReceiptLines_Movements_MovementId",
                        column: x => x.MovementId,
                        principalSchema: "inventory",
                        principalTable: "Movements",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SourcingReceiptLines_ReceivingUnitMappings_MappingId",
                        column: x => x.MappingId,
                        principalSchema: "inventory",
                        principalTable: "ReceivingUnitMappings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SourcingReceiptLines_SourcingReceipts_ReceiptId",
                        column: x => x.ReceiptId,
                        principalSchema: "inventory",
                        principalTable: "SourcingReceipts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SourcingReceiptLines_Stock_VariantId",
                        column: x => x.VariantId,
                        principalSchema: "inventory",
                        principalTable: "Stock",
                        principalColumn: "VariantId",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "SourcingReceiptUnits",
                schema: "inventory",
                columns: table => new
                {
                    ReceiptLineId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    UnitId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SourcingReceiptUnits", x => new { x.ReceiptLineId, x.UnitId });
                    table.ForeignKey(
                        name: "FK_SourcingReceiptUnits_SerialUnits_UnitId",
                        column: x => x.UnitId,
                        principalSchema: "inventory",
                        principalTable: "SerialUnits",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SourcingReceiptUnits_SourcingReceiptLines_ReceiptLineId",
                        column: x => x.ReceiptLineId,
                        principalSchema: "inventory",
                        principalTable: "SourcingReceiptLines",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ReceivingUnitMappings_IdentityHash",
                schema: "inventory",
                table: "ReceivingUnitMappings",
                column: "IdentityHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReceivingUnitMappings_VariantId_Id",
                schema: "inventory",
                table: "ReceivingUnitMappings",
                columns: new[] { "VariantId", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_SourcingReceiptLines_ExternalIdentityHash",
                schema: "inventory",
                table: "SourcingReceiptLines",
                column: "ExternalIdentityHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SourcingReceiptLines_MappingId",
                schema: "inventory",
                table: "SourcingReceiptLines",
                column: "MappingId");

            migrationBuilder.CreateIndex(
                name: "IX_SourcingReceiptLines_MovementId",
                schema: "inventory",
                table: "SourcingReceiptLines",
                column: "MovementId");

            migrationBuilder.CreateIndex(
                name: "IX_SourcingReceiptLines_ReceiptId_SourceReceiptLineKey",
                schema: "inventory",
                table: "SourcingReceiptLines",
                columns: new[] { "ReceiptId", "SourceReceiptLineKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SourcingReceiptLines_VariantId",
                schema: "inventory",
                table: "SourcingReceiptLines",
                column: "VariantId");

            migrationBuilder.CreateIndex(
                name: "IX_SourcingReceipts_TaskId_RecordedAt_Id",
                schema: "inventory",
                table: "SourcingReceipts",
                columns: new[] { "TaskId", "RecordedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_SourcingReceiptUnits_UnitId",
                schema: "inventory",
                table: "SourcingReceiptUnits",
                column: "UnitId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ReceivingCommands",
                schema: "inventory");

            migrationBuilder.DropTable(
                name: "SourcingReceiptUnits",
                schema: "inventory");

            migrationBuilder.DropTable(
                name: "SourcingReceiptLines",
                schema: "inventory");

            migrationBuilder.DropTable(
                name: "ReceivingUnitMappings",
                schema: "inventory");

            migrationBuilder.DropTable(
                name: "SourcingReceipts",
                schema: "inventory");
        }
    }
}
