using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Inventory
{
    /// <inheritdoc />
    public partial class OrderReservationsV2 : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "OrderLineId",
                schema: "inventory",
                table: "SerialUnits",
                type: "nvarchar(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ContractVersion",
                schema: "inventory",
                table: "Reservations",
                type: "int",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ReservationLineEntitlements",
                schema: "inventory",
                columns: table => new
                {
                    ReservationId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    LineId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    VariantId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Quantity = table.Column<int>(type: "int", nullable: false),
                    TrackingMode = table.Column<string>(type: "nvarchar(8)", maxLength: 8, nullable: false),
                    AllocationId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    OfferLineId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReservationLineEntitlements", x => new { x.ReservationId, x.LineId });
                    table.CheckConstraint("CK_ReservationEntitlement_Identity", "LEN([ReservationId])=32 AND LEN([LineId])=32");
                    table.CheckConstraint("CK_ReservationEntitlement_Mode", "[TrackingMode] IN ('none','serial','imei')");
                    table.CheckConstraint("CK_ReservationEntitlement_Provenance", "([AllocationId] IS NULL AND [OfferLineId] IS NULL) OR ([AllocationId] IS NOT NULL AND [OfferLineId] IS NOT NULL)");
                    table.CheckConstraint("CK_ReservationEntitlement_Quantity", "[Quantity] BETWEEN 1 AND 1000000");
                    table.ForeignKey(
                        name: "FK_ReservationLineEntitlements_Reservations_ReservationId",
                        column: x => x.ReservationId,
                        principalSchema: "inventory",
                        principalTable: "Reservations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ReservationLineEntitlements_SourcingAllocationLines_AllocationId_OfferLineId",
                        columns: x => new { x.AllocationId, x.OfferLineId },
                        principalSchema: "inventory",
                        principalTable: "SourcingAllocationLines",
                        principalColumns: new[] { "AllocationId", "OfferLineId" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ReservationLineEntitlements_Stock_VariantId",
                        column: x => x.VariantId,
                        principalSchema: "inventory",
                        principalTable: "Stock",
                        principalColumn: "VariantId",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "SourcingAllocationTransfers",
                schema: "inventory",
                columns: table => new
                {
                    AllocationId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    ReservationId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OrderId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    AcceptanceId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    AllocationVersion = table.Column<string>(type: "varchar(12)", unicode: false, maxLength: 12, nullable: false),
                    OriginalExpiresAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    TransferredAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ContainsDemo = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SourcingAllocationTransfers", x => x.AllocationId);
                    table.CheckConstraint("CK_SourcingTransfer_Dates", "[TransferredAt]<[OriginalExpiresAt]");
                    table.CheckConstraint("CK_SourcingTransfer_Identity", "LEN([AllocationId])=32 AND LEN([ReservationId])=32 AND LEN([OrderId])=32 AND LEN([AcceptanceId])=32");
                    table.ForeignKey(
                        name: "FK_SourcingAllocationTransfers_Reservations_ReservationId",
                        column: x => x.ReservationId,
                        principalSchema: "inventory",
                        principalTable: "Reservations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SourcingAllocationTransfers_SourcingAllocations_AllocationId",
                        column: x => x.AllocationId,
                        principalSchema: "inventory",
                        principalTable: "SourcingAllocations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SerialUnits_ReservationId_OrderLineId",
                schema: "inventory",
                table: "SerialUnits",
                columns: new[] { "ReservationId", "OrderLineId" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_SerialUnit_OrderLine",
                schema: "inventory",
                table: "SerialUnits",
                sql: "[OrderLineId] IS NULL OR ([ReservationId] IS NOT NULL AND [OrderId] IS NOT NULL AND [State] IN ('assigned','delivered'))");

            migrationBuilder.CreateIndex(
                name: "IX_SerialUnitClaims_ReservationId_OrderLineId",
                schema: "inventory",
                table: "SerialUnitClaims",
                columns: new[] { "ReservationId", "OrderLineId" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_Reservation_Contract",
                schema: "inventory",
                table: "Reservations",
                sql: "[ContractVersion] IS NULL OR [ContractVersion]=2");

            migrationBuilder.CreateIndex(
                name: "IX_ReservationLineEntitlements_AllocationId_OfferLineId",
                schema: "inventory",
                table: "ReservationLineEntitlements",
                columns: new[] { "AllocationId", "OfferLineId" });

            migrationBuilder.CreateIndex(
                name: "IX_ReservationLineEntitlements_ReservationId_AllocationId_OfferLineId",
                schema: "inventory",
                table: "ReservationLineEntitlements",
                columns: new[] { "ReservationId", "AllocationId", "OfferLineId" },
                unique: true,
                filter: "[AllocationId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_ReservationLineEntitlements_VariantId",
                schema: "inventory",
                table: "ReservationLineEntitlements",
                column: "VariantId");

            migrationBuilder.CreateIndex(
                name: "IX_SourcingAllocationTransfers_ReservationId_AllocationId",
                schema: "inventory",
                table: "SourcingAllocationTransfers",
                columns: new[] { "ReservationId", "AllocationId" });

            migrationBuilder.AddForeignKey(
                name: "FK_SerialUnitClaims_ReservationLineEntitlements_ReservationId_OrderLineId",
                schema: "inventory",
                table: "SerialUnitClaims",
                columns: new[] { "ReservationId", "OrderLineId" },
                principalSchema: "inventory",
                principalTable: "ReservationLineEntitlements",
                principalColumns: new[] { "ReservationId", "LineId" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_SerialUnits_ReservationLineEntitlements_ReservationId_OrderLineId",
                schema: "inventory",
                table: "SerialUnits",
                columns: new[] { "ReservationId", "OrderLineId" },
                principalSchema: "inventory",
                principalTable: "ReservationLineEntitlements",
                principalColumns: new[] { "ReservationId", "LineId" },
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Preserve immutable order/transfer receipts before any schema change.
            migrationBuilder.Sql("IF EXISTS (SELECT 1 FROM [inventory].[Reservations] WHERE [ContractVersion] IS NOT NULL) OR EXISTS (SELECT 1 FROM [inventory].[ReservationLineEntitlements]) OR EXISTS (SELECT 1 FROM [inventory].[SourcingAllocationTransfers]) OR EXISTS (SELECT 1 FROM [inventory].[SerialUnits] WHERE [OrderLineId] IS NOT NULL) OR EXISTS (SELECT 1 FROM [inventory].[SerialUnitClaims] WHERE [OrderLineId] IS NOT NULL) OR EXISTS (SELECT 1 FROM [inventory].[SourcingAllocations] WHERE [State]='Transferred') THROW 51000, 'Order reservation history must be retained. This downgrade is unavailable.', 1;");

            migrationBuilder.DropForeignKey(
                name: "FK_SerialUnitClaims_ReservationLineEntitlements_ReservationId_OrderLineId",
                schema: "inventory",
                table: "SerialUnitClaims");

            migrationBuilder.DropForeignKey(
                name: "FK_SerialUnits_ReservationLineEntitlements_ReservationId_OrderLineId",
                schema: "inventory",
                table: "SerialUnits");

            migrationBuilder.DropTable(
                name: "ReservationLineEntitlements",
                schema: "inventory");

            migrationBuilder.DropTable(
                name: "SourcingAllocationTransfers",
                schema: "inventory");

            migrationBuilder.DropIndex(
                name: "IX_SerialUnits_ReservationId_OrderLineId",
                schema: "inventory",
                table: "SerialUnits");

            migrationBuilder.DropCheckConstraint(
                name: "CK_SerialUnit_OrderLine",
                schema: "inventory",
                table: "SerialUnits");

            migrationBuilder.DropIndex(
                name: "IX_SerialUnitClaims_ReservationId_OrderLineId",
                schema: "inventory",
                table: "SerialUnitClaims");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Reservation_Contract",
                schema: "inventory",
                table: "Reservations");

            migrationBuilder.DropColumn(
                name: "OrderLineId",
                schema: "inventory",
                table: "SerialUnits");

            migrationBuilder.DropColumn(
                name: "ContractVersion",
                schema: "inventory",
                table: "Reservations");
        }
    }
}
