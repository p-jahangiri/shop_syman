using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Inventory
{
    /// <inheritdoc />
    public partial class PartialInventoryDispatches : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "PartialDispatches",
                schema: "inventory",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    ReservationId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OrderId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    RequestId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Sequence = table.Column<int>(type: "int", nullable: false),
                    ReservationContract = table.Column<int>(type: "int", nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ResponseHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    FingerprintBefore = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ReservationVersionAfter = table.Column<string>(type: "varchar(12)", unicode: false, maxLength: 12, nullable: false),
                    StateAfter = table.Column<string>(type: "varchar(16)", unicode: false, maxLength: 16, nullable: false),
                    RecordedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ContainsDemo = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PartialDispatches", x => x.Id);
                    table.UniqueConstraint("AK_PartialDispatches_Id_ReservationId", x => new { x.Id, x.ReservationId });
                    table.CheckConstraint("CK_PartialDispatch_Evidence", "LEN([PayloadHash])=64 AND LEN([ResponseHash])=64 AND LEN([FingerprintBefore])=64 AND LEN([ReservationVersionAfter])=12 AND [StateAfter] IN ('Allocated','Fulfilled')");
                    table.CheckConstraint("CK_PartialDispatch_Identity", "LEN([Id])=32 AND LEN([ReservationId])=32 AND LEN([OrderId])=32 AND LEN([RequestId])=32 AND [ReservationContract] IN (1,2) AND [Sequence] BETWEEN 1 AND 64");
                    table.ForeignKey(
                        name: "FK_PartialDispatches_Reservations_ReservationId",
                        column: x => x.ReservationId,
                        principalSchema: "inventory",
                        principalTable: "Reservations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PartialDispatchLines",
                schema: "inventory",
                columns: table => new
                {
                    DispatchId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    LineKey = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    VariantId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Quantity = table.Column<int>(type: "int", nullable: false),
                    TrackingMode = table.Column<string>(type: "varchar(8)", unicode: false, maxLength: 8, nullable: false),
                    MovementId = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PartialDispatchLines", x => new { x.DispatchId, x.LineKey });
                    table.UniqueConstraint("AK_PartialDispatchLines_DispatchId_LineKey_VariantId", x => new { x.DispatchId, x.LineKey, x.VariantId });
                    table.CheckConstraint("CK_PartialDispatchLine_Mode", "[TrackingMode] IN ('none','serial','imei')");
                    table.CheckConstraint("CK_PartialDispatchLine_Quantity", "[Quantity] BETWEEN 1 AND 1000000");
                    table.ForeignKey(
                        name: "FK_PartialDispatchLines_Movements_MovementId",
                        column: x => x.MovementId,
                        principalSchema: "inventory",
                        principalTable: "Movements",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_PartialDispatchLines_PartialDispatches_DispatchId",
                        column: x => x.DispatchId,
                        principalSchema: "inventory",
                        principalTable: "PartialDispatches",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_PartialDispatchLines_Stock_VariantId",
                        column: x => x.VariantId,
                        principalSchema: "inventory",
                        principalTable: "Stock",
                        principalColumn: "VariantId",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PartialDispatchUnits",
                schema: "inventory",
                columns: table => new
                {
                    DispatchId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    UnitId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    ReservationId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    LineKey = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    VariantId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    InventoryVersion = table.Column<string>(type: "varchar(12)", unicode: false, maxLength: 12, nullable: false),
                    Serial = table.Column<string>(type: "varchar(100)", unicode: false, maxLength: 100, nullable: true),
                    Imei1 = table.Column<string>(type: "varchar(15)", unicode: false, maxLength: 15, nullable: true),
                    Imei2 = table.Column<string>(type: "varchar(15)", unicode: false, maxLength: 15, nullable: true),
                    WarrantyUntil = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PartialDispatchUnits", x => new { x.DispatchId, x.UnitId });
                    table.CheckConstraint("CK_PartialDispatchUnit_Identity", "LEN([UnitId])=32 AND LEN([InventoryVersion])=12 AND ([Serial] IS NOT NULL OR [Imei1] IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_PartialDispatchUnits_PartialDispatchLines_DispatchId_LineKey_VariantId",
                        columns: x => new { x.DispatchId, x.LineKey, x.VariantId },
                        principalSchema: "inventory",
                        principalTable: "PartialDispatchLines",
                        principalColumns: new[] { "DispatchId", "LineKey", "VariantId" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_PartialDispatchUnits_PartialDispatches_DispatchId_ReservationId",
                        columns: x => new { x.DispatchId, x.ReservationId },
                        principalSchema: "inventory",
                        principalTable: "PartialDispatches",
                        principalColumns: new[] { "Id", "ReservationId" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_PartialDispatchUnits_SerialUnits_UnitId",
                        column: x => x.UnitId,
                        principalSchema: "inventory",
                        principalTable: "SerialUnits",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PartialDispatches_ActorId_RequestId",
                schema: "inventory",
                table: "PartialDispatches",
                columns: new[] { "ActorId", "RequestId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PartialDispatches_ReservationId_Sequence",
                schema: "inventory",
                table: "PartialDispatches",
                columns: new[] { "ReservationId", "Sequence" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PartialDispatchLines_MovementId",
                schema: "inventory",
                table: "PartialDispatchLines",
                column: "MovementId");

            migrationBuilder.CreateIndex(
                name: "IX_PartialDispatchLines_VariantId",
                schema: "inventory",
                table: "PartialDispatchLines",
                column: "VariantId");

            migrationBuilder.CreateIndex(
                name: "IX_PartialDispatchUnits_DispatchId_LineKey_VariantId",
                schema: "inventory",
                table: "PartialDispatchUnits",
                columns: new[] { "DispatchId", "LineKey", "VariantId" });

            migrationBuilder.CreateIndex(
                name: "IX_PartialDispatchUnits_DispatchId_ReservationId",
                schema: "inventory",
                table: "PartialDispatchUnits",
                columns: new[] { "DispatchId", "ReservationId" });

            migrationBuilder.CreateIndex(
                name: "IX_PartialDispatchUnits_ReservationId_UnitId",
                schema: "inventory",
                table: "PartialDispatchUnits",
                columns: new[] { "ReservationId", "UnitId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PartialDispatchUnits_UnitId",
                schema: "inventory",
                table: "PartialDispatchUnits",
                column: "UnitId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS (SELECT 1 FROM [inventory].[PartialDispatches]) OR EXISTS (SELECT 1 FROM [inventory].[PartialDispatchLines]) OR EXISTS (SELECT 1 FROM [inventory].[PartialDispatchUnits]) THROW 51000, 'Retain partial dispatch history before reverting this migration.', 1;");
            migrationBuilder.DropTable(
                name: "PartialDispatchUnits",
                schema: "inventory");

            migrationBuilder.DropTable(
                name: "PartialDispatchLines",
                schema: "inventory");

            migrationBuilder.DropTable(
                name: "PartialDispatches",
                schema: "inventory");
        }
    }
}
