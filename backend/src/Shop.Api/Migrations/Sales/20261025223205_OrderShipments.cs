using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Sales
{
    /// <inheritdoc />
    public partial class OrderShipments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "OrderShipmentCommands",
                schema: "sales",
                columns: table => new
                {
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CommandId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    PackingRevision = table.Column<int>(type: "int", nullable: false),
                    OrderId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Action = table.Column<string>(type: "varchar(8)", unicode: false, maxLength: 8, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ResponseHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ResponseJson = table.Column<string>(type: "nvarchar(max)", maxLength: 131072, nullable: false),
                    ContainsDemo = table.Column<bool>(type: "bit", nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OrderShipmentCommands", x => new { x.ActorId, x.CommandId });
                    table.CheckConstraint("CK_OrderShipmentCommand_Identity", "LEN([CommandId])=32 AND LEN([OrderId])=32 AND LEN([PayloadHash])=64 AND LEN([ResponseHash])=64 AND [Action] IN ('pack','repack','dispatch','deliver') AND [PackingRevision] BETWEEN 1 AND 1000000");
                    table.CheckConstraint("CK_OrderShipmentCommand_Response", "ISJSON([ResponseJson])=1 AND DATALENGTH([ResponseJson])<=262144");
                    table.ForeignKey(
                        name: "FK_OrderShipmentCommands_Orders_OrderId",
                        column: x => x.OrderId,
                        principalSchema: "sales",
                        principalTable: "Orders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "OrderShipments",
                schema: "sales",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OrderId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    State = table.Column<string>(type: "varchar(12)", unicode: false, maxLength: 12, nullable: false),
                    PackingRevision = table.Column<int>(type: "int", nullable: false),
                    ReservationId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    InventoryFingerprint = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    PackedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    DispatchedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    DeliveredAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    ChangedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    CarrierNameFa = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: true),
                    CarrierNameEn = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: true),
                    TrackingNumber = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: true),
                    ContainsDemo = table.Column<bool>(type: "bit", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OrderShipments", x => x.Id);
                    table.CheckConstraint("CK_OrderShipment_Dates", "[ChangedAt]>=[PackedAt] AND ([DispatchedAt] IS NULL OR ([DispatchedAt]>=[PackedAt] AND [DispatchedAt]<=[ChangedAt])) AND ([DeliveredAt] IS NULL OR ([DeliveredAt]>=[DispatchedAt] AND [DeliveredAt]<=[ChangedAt]))");
                    table.CheckConstraint("CK_OrderShipment_Identity", "LEN([Id])=32 AND LEN([OrderId])=32 AND LEN([ReservationId])=32 AND LEN([InventoryFingerprint])=64 AND [PackingRevision] BETWEEN 1 AND 1000000");
                    table.CheckConstraint("CK_OrderShipment_Stage", "([State]='packed' AND [DispatchedAt] IS NULL AND [DeliveredAt] IS NULL AND [CarrierNameFa] IS NULL AND [CarrierNameEn] IS NULL AND [TrackingNumber] IS NULL) OR ([State]='dispatched' AND [DispatchedAt] IS NOT NULL AND [DeliveredAt] IS NULL AND [CarrierNameFa] IS NOT NULL AND [CarrierNameEn] IS NOT NULL) OR ([State]='delivered' AND [DispatchedAt] IS NOT NULL AND [DeliveredAt] IS NOT NULL AND [CarrierNameFa] IS NOT NULL AND [CarrierNameEn] IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_OrderShipments_Orders_OrderId",
                        column: x => x.OrderId,
                        principalSchema: "sales",
                        principalTable: "Orders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "OrderShipmentLines",
                schema: "sales",
                columns: table => new
                {
                    PackingRevision = table.Column<int>(type: "int", nullable: false),
                    ShipmentId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    LineKey = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    VariantId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    ProductId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Sku = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false),
                    Name = table.Column<string>(type: "nvarchar(250)", maxLength: 250, nullable: false),
                    Label = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Warranty = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Quantity = table.Column<int>(type: "int", nullable: false),
                    TrackingMode = table.Column<string>(type: "varchar(8)", unicode: false, maxLength: 8, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OrderShipmentLines", x => new { x.ShipmentId, x.PackingRevision, x.LineKey });
                    table.CheckConstraint("CK_OrderShipmentLine_Mode", "[TrackingMode] IN ('none','serial','imei')");
                    table.CheckConstraint("CK_OrderShipmentLine_Quantity", "[Quantity] BETWEEN 1 AND 1000000 AND [PackingRevision] BETWEEN 1 AND 1000000");
                    table.ForeignKey(
                        name: "FK_OrderShipmentLines_OrderShipments_ShipmentId",
                        column: x => x.ShipmentId,
                        principalSchema: "sales",
                        principalTable: "OrderShipments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "OrderShipmentUnits",
                schema: "sales",
                columns: table => new
                {
                    PackingRevision = table.Column<int>(type: "int", nullable: false),
                    ShipmentId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    UnitId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    LineKey = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    VariantId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    InventoryVersion = table.Column<string>(type: "nvarchar(12)", maxLength: 12, nullable: false),
                    Serial = table.Column<string>(type: "varchar(100)", unicode: false, maxLength: 100, nullable: true),
                    Imei1 = table.Column<string>(type: "varchar(15)", unicode: false, maxLength: 15, nullable: true),
                    Imei2 = table.Column<string>(type: "varchar(15)", unicode: false, maxLength: 15, nullable: true),
                    WarrantyUntil = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OrderShipmentUnits", x => new { x.ShipmentId, x.PackingRevision, x.UnitId });
                    table.CheckConstraint("CK_OrderShipmentUnit_Identity", "LEN([UnitId])=32 AND [PackingRevision] BETWEEN 1 AND 1000000 AND ([Serial] IS NOT NULL OR [Imei1] IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_OrderShipmentUnits_OrderShipmentLines_ShipmentId_PackingRevision_LineKey",
                        columns: x => new { x.ShipmentId, x.PackingRevision, x.LineKey },
                        principalSchema: "sales",
                        principalTable: "OrderShipmentLines",
                        principalColumns: new[] { "ShipmentId", "PackingRevision", "LineKey" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_OrderShipmentUnits_OrderShipments_ShipmentId",
                        column: x => x.ShipmentId,
                        principalSchema: "sales",
                        principalTable: "OrderShipments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_OrderShipmentCommands_OrderId_PackingRevision_Action",
                schema: "sales",
                table: "OrderShipmentCommands",
                columns: new[] { "OrderId", "PackingRevision", "Action" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_OrderShipments_OrderId",
                schema: "sales",
                table: "OrderShipments",
                column: "OrderId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_OrderShipmentUnits_ShipmentId_PackingRevision_LineKey",
                schema: "sales",
                table: "OrderShipmentUnits",
                columns: new[] { "ShipmentId", "PackingRevision", "LineKey" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS(SELECT 1 FROM [sales].[OrderShipments]) OR EXISTS(SELECT 1 FROM [sales].[OrderShipmentCommands]) OR EXISTS(SELECT 1 FROM [sales].[OrderShipmentLines]) OR EXISTS(SELECT 1 FROM [sales].[OrderShipmentUnits]) THROW 51000, 'Historical packing revisions, warehouse hand-off, delivery and receipts must be retained. This downgrade is unavailable.', 1;");
            migrationBuilder.DropTable(
                name: "OrderShipmentCommands",
                schema: "sales");

            migrationBuilder.DropTable(
                name: "OrderShipmentUnits",
                schema: "sales");

            migrationBuilder.DropTable(
                name: "OrderShipmentLines",
                schema: "sales");

            migrationBuilder.DropTable(
                name: "OrderShipments",
                schema: "sales");
        }
    }
}
