using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Inventory
{
    /// <inheritdoc />
    public partial class SourcingAllocations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Stock_Balance",
                schema: "inventory",
                table: "Stock");

            migrationBuilder.AddColumn<int>(
                name: "SourcingReserved",
                schema: "inventory",
                table: "Stock",
                type: "int",
                nullable: false,
                defaultValue: 0);

            // Preserve the existing Catalog read contract while excluding both
            // kinds of real hold from publicly purchasable Stock.
            migrationBuilder.Sql("EXEC(N'ALTER VIEW [inventory].[AvailableStockV1] WITH SCHEMABINDING AS SELECT [VariantId], [OnHand] - [Reserved] - [SourcingReserved] AS [Available] FROM [inventory].[Stock];');");

            migrationBuilder.CreateTable(
                name: "SourcingAllocationCommands",
                schema: "inventory",
                columns: table => new
                {
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Operation = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    CommandId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    AllocationId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    RequestId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    TaskId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ResultJson = table.Column<string>(type: "nvarchar(max)", maxLength: 8192, nullable: false),
                    ContainsDemo = table.Column<bool>(type: "bit", nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SourcingAllocationCommands", x => new { x.ActorId, x.Operation, x.CommandId });
                    table.CheckConstraint("CK_SourcingAllocationCommand_Operation", "[Operation] IN ('allocate','release')");
                    table.CheckConstraint("CK_SourcingAllocationCommand_Result", "ISJSON([ResultJson])=1 AND DATALENGTH([ResultJson])<=16384");
                });

            migrationBuilder.CreateTable(
                name: "SourcingAllocations",
                schema: "inventory",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    RequestId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    TaskId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OfferId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    AcceptanceId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    TermsHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    State = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false),
                    ContainsDemo = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ChangedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SourcingAllocations", x => x.Id);
                    table.CheckConstraint("CK_SourcingAllocation_Active", "([IsActive]=1 AND [State]='Active') OR ([IsActive]=0 AND [State]<>'Active')");
                    table.CheckConstraint("CK_SourcingAllocation_Dates", "[ExpiresAt]>[CreatedAt] AND [ChangedAt]>=[CreatedAt]");
                    table.CheckConstraint("CK_SourcingAllocation_State", "[State] IN ('Active','Released','Expired','Transferred')");
                });

            migrationBuilder.CreateTable(
                name: "SourcingAllocationEvents",
                schema: "inventory",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    AllocationId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    State = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Reason = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SourcingAllocationEvents", x => x.Id);
                    table.CheckConstraint("CK_SourcingAllocationEvent_State", "[State] IN ('Active','Released','Expired','Transferred')");
                    table.ForeignKey(
                        name: "FK_SourcingAllocationEvents_SourcingAllocations_AllocationId",
                        column: x => x.AllocationId,
                        principalSchema: "inventory",
                        principalTable: "SourcingAllocations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "SourcingAllocationLines",
                schema: "inventory",
                columns: table => new
                {
                    AllocationId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OfferLineId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    VariantId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Quantity = table.Column<int>(type: "int", nullable: false),
                    TrackingMode = table.Column<string>(type: "nvarchar(8)", maxLength: 8, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SourcingAllocationLines", x => new { x.AllocationId, x.OfferLineId });
                    table.CheckConstraint("CK_SourcingAllocationLine_Mode", "[TrackingMode] IN ('none','serial','imei')");
                    table.CheckConstraint("CK_SourcingAllocationLine_Quantity", "[Quantity] BETWEEN 1 AND 1000000");
                    table.ForeignKey(
                        name: "FK_SourcingAllocationLines_SourcingAllocations_AllocationId",
                        column: x => x.AllocationId,
                        principalSchema: "inventory",
                        principalTable: "SourcingAllocations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SourcingAllocationLines_Stock_VariantId",
                        column: x => x.VariantId,
                        principalSchema: "inventory",
                        principalTable: "Stock",
                        principalColumn: "VariantId",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "SerialUnitClaims",
                schema: "inventory",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    UnitId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    VariantId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    OriginAllocationId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OfferLineId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    State = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false),
                    ReservationId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    OrderId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    OrderLineId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ChangedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SerialUnitClaims", x => x.Id);
                    table.CheckConstraint("CK_SerialUnitClaim_Active", "([IsActive]=1 AND [State] IN ('AllocationHeld','OrderHeld')) OR ([IsActive]=0 AND [State] IN ('Released','Expired','Assigned','Fulfilled'))");
                    table.CheckConstraint("CK_SerialUnitClaim_Order", "([ReservationId] IS NULL AND [OrderId] IS NULL AND [OrderLineId] IS NULL AND [State] NOT IN ('OrderHeld','Assigned','Fulfilled')) OR ([ReservationId] IS NOT NULL AND [OrderId] IS NOT NULL AND [OrderLineId] IS NOT NULL AND [State]<>'AllocationHeld')");
                    table.CheckConstraint("CK_SerialUnitClaim_State", "[State] IN ('AllocationHeld','OrderHeld','Released','Expired','Assigned','Fulfilled')");
                    table.ForeignKey(
                        name: "FK_SerialUnitClaims_Reservations_ReservationId",
                        column: x => x.ReservationId,
                        principalSchema: "inventory",
                        principalTable: "Reservations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SerialUnitClaims_SerialUnits_UnitId",
                        column: x => x.UnitId,
                        principalSchema: "inventory",
                        principalTable: "SerialUnits",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SerialUnitClaims_SourcingAllocationLines_OriginAllocationId_OfferLineId",
                        columns: x => new { x.OriginAllocationId, x.OfferLineId },
                        principalSchema: "inventory",
                        principalTable: "SourcingAllocationLines",
                        principalColumns: new[] { "AllocationId", "OfferLineId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_Stock_Balance",
                schema: "inventory",
                table: "Stock",
                sql: "[OnHand] >= 0 AND [Reserved] >= 0 AND [SourcingReserved] >= 0 AND [Reserved] <= [OnHand] AND CAST([Reserved] AS bigint) + CAST([SourcingReserved] AS bigint) <= [OnHand]");

            migrationBuilder.CreateIndex(
                name: "IX_SerialUnitClaims_OriginAllocationId_IsActive_UnitId",
                schema: "inventory",
                table: "SerialUnitClaims",
                columns: new[] { "OriginAllocationId", "IsActive", "UnitId" });

            migrationBuilder.CreateIndex(
                name: "IX_SerialUnitClaims_OriginAllocationId_OfferLineId",
                schema: "inventory",
                table: "SerialUnitClaims",
                columns: new[] { "OriginAllocationId", "OfferLineId" });

            migrationBuilder.CreateIndex(
                name: "IX_SerialUnitClaims_ReservationId_IsActive_UnitId",
                schema: "inventory",
                table: "SerialUnitClaims",
                columns: new[] { "ReservationId", "IsActive", "UnitId" });

            migrationBuilder.CreateIndex(
                name: "IX_SerialUnitClaims_UnitId",
                schema: "inventory",
                table: "SerialUnitClaims",
                column: "UnitId",
                unique: true,
                filter: "[IsActive] = 1");

            migrationBuilder.CreateIndex(
                name: "IX_SourcingAllocationEvents_AllocationId_Id",
                schema: "inventory",
                table: "SourcingAllocationEvents",
                columns: new[] { "AllocationId", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_SourcingAllocationLines_VariantId",
                schema: "inventory",
                table: "SourcingAllocationLines",
                column: "VariantId");

            migrationBuilder.CreateIndex(
                name: "IX_SourcingAllocations_AcceptanceId",
                schema: "inventory",
                table: "SourcingAllocations",
                column: "AcceptanceId",
                unique: true,
                filter: "[IsActive] = 1");

            migrationBuilder.CreateIndex(
                name: "IX_SourcingAllocations_OwnerId_Id",
                schema: "inventory",
                table: "SourcingAllocations",
                columns: new[] { "OwnerId", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_SourcingAllocations_State_ExpiresAt_Id",
                schema: "inventory",
                table: "SourcingAllocations",
                columns: new[] { "State", "ExpiresAt", "Id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS (SELECT 1 FROM [inventory].[Stock] WHERE [SourcingReserved]<>0) OR EXISTS (SELECT 1 FROM [inventory].[SourcingAllocations] WHERE [State] IN ('Active','Transferred')) THROW 51000, 'Cannot downgrade Inventory while a sourcing allocation or transferred order has stock authority.', 1;");
            migrationBuilder.Sql("EXEC(N'ALTER VIEW [inventory].[AvailableStockV1] WITH SCHEMABINDING AS SELECT [VariantId], [OnHand] - [Reserved] AS [Available] FROM [inventory].[Stock];');");
            migrationBuilder.DropTable(
                name: "SerialUnitClaims",
                schema: "inventory");

            migrationBuilder.DropTable(
                name: "SourcingAllocationCommands",
                schema: "inventory");

            migrationBuilder.DropTable(
                name: "SourcingAllocationEvents",
                schema: "inventory");

            migrationBuilder.DropTable(
                name: "SourcingAllocationLines",
                schema: "inventory");

            migrationBuilder.DropTable(
                name: "SourcingAllocations",
                schema: "inventory");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Stock_Balance",
                schema: "inventory",
                table: "Stock");

            migrationBuilder.DropColumn(
                name: "SourcingReserved",
                schema: "inventory",
                table: "Stock");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Stock_Balance",
                schema: "inventory",
                table: "Stock",
                sql: "[OnHand] >= 0 AND [Reserved] >= 0 AND [Reserved] <= [OnHand]");
        }
    }
}
