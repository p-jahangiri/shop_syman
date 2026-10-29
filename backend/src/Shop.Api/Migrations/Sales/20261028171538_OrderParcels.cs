using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Sales
{
    /// <inheritdoc />
    public partial class OrderParcels : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "FulfillmentHeaders",
                schema: "sales",
                columns: table => new
                {
                    OrderId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    ReservationId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    ReservationContract = table.Column<int>(type: "int", nullable: false),
                    LastParcelNumber = table.Column<long>(type: "bigint", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ChangedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    FirstDispatchRecordedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    ContainsDemo = table.Column<bool>(type: "bit", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FulfillmentHeaders", x => x.OrderId);
                    table.UniqueConstraint("AK_FulfillmentHeaders_OrderId_OwnerId_ReservationId", x => new { x.OrderId, x.OwnerId, x.ReservationId });
                    table.CheckConstraint("CK_FulfillmentHeader_Dates", "[ChangedAt]>=[CreatedAt] AND ([FirstDispatchRecordedAt] IS NULL OR ([FirstDispatchRecordedAt]>=[CreatedAt] AND [FirstDispatchRecordedAt]<=[ChangedAt]))");
                    table.CheckConstraint("CK_FulfillmentHeader_Identity", "LEN([OrderId])=32 AND LEN([ReservationId])=32 AND [ReservationContract] IN (1,2) AND [LastParcelNumber]>0");
                    table.ForeignKey(
                        name: "FK_FulfillmentHeaders_Orders_OrderId",
                        column: x => x.OrderId,
                        principalSchema: "sales",
                        principalTable: "Orders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "OrderParcels",
                schema: "sales",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OrderId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    ReservationId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Number = table.Column<long>(type: "bigint", nullable: false),
                    Reference = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    State = table.Column<string>(type: "varchar(12)", unicode: false, maxLength: 12, nullable: false),
                    PackingRevision = table.Column<int>(type: "int", nullable: false),
                    PackingFingerprint = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    PackedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ChangedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    DispatchedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    DeliveredAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    VoidedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    CarrierNameFa = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: true),
                    CarrierNameEn = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: true),
                    TrackingNumber = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: true),
                    InventoryDispatchHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: true),
                    ContainsDemo = table.Column<bool>(type: "bit", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OrderParcels", x => x.Id);
                    table.UniqueConstraint("AK_OrderParcels_Id_OrderId", x => new { x.Id, x.OrderId });
                    table.CheckConstraint("CK_OrderParcel_Dates", "[ChangedAt]>=[PackedAt] AND ([DispatchedAt] IS NULL OR ([DispatchedAt]>=[PackedAt] AND [DispatchedAt]<=[ChangedAt])) AND ([DeliveredAt] IS NULL OR ([DeliveredAt]>=[DispatchedAt] AND [DeliveredAt]<=[ChangedAt])) AND ([VoidedAt] IS NULL OR ([VoidedAt]>=[PackedAt] AND [VoidedAt]<=[ChangedAt]))");
                    table.CheckConstraint("CK_OrderParcel_Identity", "LEN([Id])=32 AND [Number]>0 AND [PackingRevision] BETWEEN 1 AND 1000000 AND LEN([PackingFingerprint])=64");
                    table.CheckConstraint("CK_OrderParcel_Stage", "([State]='packed' AND [DispatchedAt] IS NULL AND [DeliveredAt] IS NULL AND [VoidedAt] IS NULL AND [CarrierNameFa] IS NULL AND [CarrierNameEn] IS NULL AND [TrackingNumber] IS NULL AND [InventoryDispatchHash] IS NULL) OR ([State]='void' AND [DispatchedAt] IS NULL AND [DeliveredAt] IS NULL AND [VoidedAt] IS NOT NULL AND [CarrierNameFa] IS NULL AND [CarrierNameEn] IS NULL AND [TrackingNumber] IS NULL AND [InventoryDispatchHash] IS NULL) OR ([State]='dispatched' AND [DispatchedAt] IS NOT NULL AND [DeliveredAt] IS NULL AND [VoidedAt] IS NULL AND [CarrierNameFa] IS NOT NULL AND [CarrierNameEn] IS NOT NULL AND [InventoryDispatchHash] IS NOT NULL AND LEN([InventoryDispatchHash])=64) OR ([State]='delivered' AND [DispatchedAt] IS NOT NULL AND [DeliveredAt] IS NOT NULL AND [VoidedAt] IS NULL AND [CarrierNameFa] IS NOT NULL AND [CarrierNameEn] IS NOT NULL AND [InventoryDispatchHash] IS NOT NULL AND LEN([InventoryDispatchHash])=64)");
                    table.ForeignKey(
                        name: "FK_OrderParcels_FulfillmentHeaders_OrderId_OwnerId_ReservationId",
                        columns: x => new { x.OrderId, x.OwnerId, x.ReservationId },
                        principalSchema: "sales",
                        principalTable: "FulfillmentHeaders",
                        principalColumns: new[] { "OrderId", "OwnerId", "ReservationId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ParcelCommands",
                schema: "sales",
                columns: table => new
                {
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CommandId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OrderId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    ParcelId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    PackingRevision = table.Column<int>(type: "int", nullable: false),
                    Action = table.Column<string>(type: "varchar(8)", unicode: false, maxLength: 8, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ResponseHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ProtectedResult = table.Column<byte[]>(type: "varbinary(max)", maxLength: 8388608, nullable: false),
                    RecordedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ContainsDemo = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ParcelCommands", x => new { x.ActorId, x.CommandId });
                    table.CheckConstraint("CK_ParcelCommand_Identity", "LEN([CommandId])=32 AND LEN([PayloadHash])=64 AND LEN([ResponseHash])=64 AND [PackingRevision] BETWEEN 1 AND 1000000 AND [Action] IN ('pack','repack','void','dispatch','deliver')");
                    table.CheckConstraint("CK_ParcelCommand_ProtectedLength", "DATALENGTH([ProtectedResult]) BETWEEN 1 AND 8388608");
                    table.ForeignKey(
                        name: "FK_ParcelCommands_OrderParcels_ParcelId_OrderId",
                        columns: x => new { x.ParcelId, x.OrderId },
                        principalSchema: "sales",
                        principalTable: "OrderParcels",
                        principalColumns: new[] { "Id", "OrderId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ParcelLineSnapshots",
                schema: "sales",
                columns: table => new
                {
                    ParcelId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    PackingRevision = table.Column<int>(type: "int", nullable: false),
                    LineKey = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    VariantId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    ProductId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Sku = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false),
                    Name = table.Column<string>(type: "nvarchar(250)", maxLength: 250, nullable: false),
                    Label = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Warranty = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    TrackingMode = table.Column<string>(type: "varchar(8)", unicode: false, maxLength: 8, nullable: false),
                    Quantity = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ParcelLineSnapshots", x => new { x.ParcelId, x.PackingRevision, x.LineKey });
                    table.UniqueConstraint("AK_ParcelLineSnapshots_ParcelId_PackingRevision_LineKey_VariantId", x => new { x.ParcelId, x.PackingRevision, x.LineKey, x.VariantId });
                    table.CheckConstraint("CK_ParcelLine_Mode", "[TrackingMode] IN ('none','serial','imei')");
                    table.CheckConstraint("CK_ParcelLine_Quantity", "[Quantity] BETWEEN 1 AND 1000000 AND [PackingRevision] BETWEEN 1 AND 1000000");
                    table.ForeignKey(
                        name: "FK_ParcelLineSnapshots_OrderParcels_ParcelId",
                        column: x => x.ParcelId,
                        principalSchema: "sales",
                        principalTable: "OrderParcels",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ParcelUnitSnapshots",
                schema: "sales",
                columns: table => new
                {
                    ParcelId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    PackingRevision = table.Column<int>(type: "int", nullable: false),
                    UnitId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
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
                    table.PrimaryKey("PK_ParcelUnitSnapshots", x => new { x.ParcelId, x.PackingRevision, x.UnitId });
                    table.CheckConstraint("CK_ParcelUnit_Identity", "LEN([UnitId])=32 AND LEN([InventoryVersion])=12 AND [PackingRevision] BETWEEN 1 AND 1000000 AND ([Serial] IS NOT NULL OR [Imei1] IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_ParcelUnitSnapshots_ParcelLineSnapshots_ParcelId_PackingRevision_LineKey_VariantId",
                        columns: x => new { x.ParcelId, x.PackingRevision, x.LineKey, x.VariantId },
                        principalSchema: "sales",
                        principalTable: "ParcelLineSnapshots",
                        principalColumns: new[] { "ParcelId", "PackingRevision", "LineKey", "VariantId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ParcelUnitClaims",
                schema: "sales",
                columns: table => new
                {
                    UnitId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    ParcelId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    PackingRevision = table.Column<int>(type: "int", nullable: false),
                    OrderId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ParcelUnitClaims", x => x.UnitId);
                    table.ForeignKey(
                        name: "FK_ParcelUnitClaims_OrderParcels_ParcelId_OrderId",
                        columns: x => new { x.ParcelId, x.OrderId },
                        principalSchema: "sales",
                        principalTable: "OrderParcels",
                        principalColumns: new[] { "Id", "OrderId" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ParcelUnitClaims_ParcelUnitSnapshots_ParcelId_PackingRevision_UnitId",
                        columns: x => new { x.ParcelId, x.PackingRevision, x.UnitId },
                        principalSchema: "sales",
                        principalTable: "ParcelUnitSnapshots",
                        principalColumns: new[] { "ParcelId", "PackingRevision", "UnitId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_OrderParcels_OrderId_Number",
                schema: "sales",
                table: "OrderParcels",
                columns: new[] { "OrderId", "Number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_OrderParcels_OrderId_OwnerId_ReservationId",
                schema: "sales",
                table: "OrderParcels",
                columns: new[] { "OrderId", "OwnerId", "ReservationId" });

            migrationBuilder.CreateIndex(
                name: "IX_OrderParcels_OrderId_State_Id",
                schema: "sales",
                table: "OrderParcels",
                columns: new[] { "OrderId", "State", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_ParcelCommands_ParcelId_OrderId",
                schema: "sales",
                table: "ParcelCommands",
                columns: new[] { "ParcelId", "OrderId" });

            migrationBuilder.CreateIndex(
                name: "IX_ParcelCommands_ParcelId_PackingRevision_Action",
                schema: "sales",
                table: "ParcelCommands",
                columns: new[] { "ParcelId", "PackingRevision", "Action" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ParcelUnitClaims_OrderId_ParcelId",
                schema: "sales",
                table: "ParcelUnitClaims",
                columns: new[] { "OrderId", "ParcelId" });

            migrationBuilder.CreateIndex(
                name: "IX_ParcelUnitClaims_ParcelId_OrderId",
                schema: "sales",
                table: "ParcelUnitClaims",
                columns: new[] { "ParcelId", "OrderId" });

            migrationBuilder.CreateIndex(
                name: "IX_ParcelUnitClaims_ParcelId_PackingRevision_UnitId",
                schema: "sales",
                table: "ParcelUnitClaims",
                columns: new[] { "ParcelId", "PackingRevision", "UnitId" });

            migrationBuilder.CreateIndex(
                name: "IX_ParcelUnitSnapshots_ParcelId_PackingRevision_LineKey_VariantId",
                schema: "sales",
                table: "ParcelUnitSnapshots",
                columns: new[] { "ParcelId", "PackingRevision", "LineKey", "VariantId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS (SELECT 1 FROM [sales].[FulfillmentHeaders]) OR EXISTS (SELECT 1 FROM [sales].[OrderParcels]) OR EXISTS (SELECT 1 FROM [sales].[ParcelCommands]) OR EXISTS (SELECT 1 FROM [sales].[ParcelLineSnapshots]) OR EXISTS (SELECT 1 FROM [sales].[ParcelUnitSnapshots]) OR EXISTS (SELECT 1 FROM [sales].[ParcelUnitClaims]) THROW 51000, 'Nonempty parcel history must be retained.', 1;");
            migrationBuilder.DropTable(
                name: "ParcelCommands",
                schema: "sales");

            migrationBuilder.DropTable(
                name: "ParcelUnitClaims",
                schema: "sales");

            migrationBuilder.DropTable(
                name: "ParcelUnitSnapshots",
                schema: "sales");

            migrationBuilder.DropTable(
                name: "ParcelLineSnapshots",
                schema: "sales");

            migrationBuilder.DropTable(
                name: "OrderParcels",
                schema: "sales");

            migrationBuilder.DropTable(
                name: "FulfillmentHeaders",
                schema: "sales");
        }
    }
}
