using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Sales
{
    /// <inheritdoc />
    public partial class PrivateDigitalFulfillment : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_FulfillmentHeader_Identity",
                schema: "sales",
                table: "FulfillmentHeaders");

            migrationBuilder.CreateTable(
                name: "DigitalDeliveries",
                schema: "sales",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OrderId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    ReservationId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    AvailableAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    InventoryDispatchHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ContainsDemo = table.Column<bool>(type: "bit", nullable: false),
                    ProtectedManifest = table.Column<byte[]>(type: "varbinary(max)", maxLength: 131072, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DigitalDeliveries", x => x.Id);
                    table.UniqueConstraint("AK_DigitalDeliveries_Id_OrderId", x => new { x.Id, x.OrderId });
                    table.CheckConstraint("CK_DigitalDelivery_Identity", "LEN([Id])=32 AND LEN([OrderId])=32 AND LEN([ReservationId])=32 AND LEN([InventoryDispatchHash])=64");
                    table.CheckConstraint("CK_DigitalDelivery_Manifest", "DATALENGTH([ProtectedManifest]) BETWEEN 1 AND 131072");
                    table.ForeignKey(
                        name: "FK_DigitalDeliveries_FulfillmentHeaders_OrderId_OwnerId_ReservationId",
                        columns: x => new { x.OrderId, x.OwnerId, x.ReservationId },
                        principalSchema: "sales",
                        principalTable: "FulfillmentHeaders",
                        principalColumns: new[] { "OrderId", "OwnerId", "ReservationId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "DigitalDeliveryCommands",
                schema: "sales",
                columns: table => new
                {
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CommandId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OrderId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    DeliveryId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    RecordedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ContainsDemo = table.Column<bool>(type: "bit", nullable: false),
                    ProtectedReceipt = table.Column<byte[]>(type: "varbinary(max)", maxLength: 131072, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DigitalDeliveryCommands", x => new { x.ActorId, x.CommandId });
                    table.CheckConstraint("CK_DigitalCommand_Identity", "LEN([CommandId])=32 AND LEN([PayloadHash])=64");
                    table.CheckConstraint("CK_DigitalCommand_Receipt", "DATALENGTH([ProtectedReceipt]) BETWEEN 1 AND 131072");
                    table.ForeignKey(
                        name: "FK_DigitalDeliveryCommands_DigitalDeliveries_DeliveryId_OrderId",
                        columns: x => new { x.DeliveryId, x.OrderId },
                        principalSchema: "sales",
                        principalTable: "DigitalDeliveries",
                        principalColumns: new[] { "Id", "OrderId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "DigitalDeliveryItems",
                schema: "sales",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    DeliveryId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    LineKey = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Position = table.Column<int>(type: "int", nullable: false),
                    ProtectedContent = table.Column<byte[]>(type: "varbinary(max)", maxLength: 16384, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DigitalDeliveryItems", x => x.Id);
                    table.CheckConstraint("CK_DigitalItem_Content", "DATALENGTH([ProtectedContent]) BETWEEN 1 AND 16384");
                    table.CheckConstraint("CK_DigitalItem_Identity", "LEN([Id])=32 AND LEN([DeliveryId])=32 AND [Position] BETWEEN 1 AND 100");
                    table.ForeignKey(
                        name: "FK_DigitalDeliveryItems_DigitalDeliveries_DeliveryId",
                        column: x => x.DeliveryId,
                        principalSchema: "sales",
                        principalTable: "DigitalDeliveries",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_FulfillmentHeader_Identity",
                schema: "sales",
                table: "FulfillmentHeaders",
                sql: "LEN([OrderId])=32 AND LEN([ReservationId])=32 AND [ReservationContract] IN (1,2) AND [LastParcelNumber]>=0");

            migrationBuilder.CreateIndex(
                name: "IX_DigitalDeliveries_OrderId_AvailableAt_Id",
                schema: "sales",
                table: "DigitalDeliveries",
                columns: new[] { "OrderId", "AvailableAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_DigitalDeliveries_OrderId_OwnerId_ReservationId",
                schema: "sales",
                table: "DigitalDeliveries",
                columns: new[] { "OrderId", "OwnerId", "ReservationId" });

            migrationBuilder.CreateIndex(
                name: "IX_DigitalDeliveryCommands_DeliveryId",
                schema: "sales",
                table: "DigitalDeliveryCommands",
                column: "DeliveryId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_DigitalDeliveryCommands_DeliveryId_OrderId",
                schema: "sales",
                table: "DigitalDeliveryCommands",
                columns: new[] { "DeliveryId", "OrderId" });

            migrationBuilder.CreateIndex(
                name: "IX_DigitalDeliveryItems_DeliveryId_LineKey_Position",
                schema: "sales",
                table: "DigitalDeliveryItems",
                columns: new[] { "DeliveryId", "LineKey", "Position" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS (SELECT 1 FROM [sales].[DigitalDeliveries]) OR EXISTS (SELECT 1 FROM [sales].[DigitalDeliveryItems]) OR EXISTS (SELECT 1 FROM [sales].[DigitalDeliveryCommands]) OR EXISTS (SELECT 1 FROM [sales].[FulfillmentHeaders] WHERE [LastParcelNumber]=0) THROW 51000, 'Digital delivery history exists; destructive rollback is blocked.', 1;");
            migrationBuilder.DropTable(
                name: "DigitalDeliveryCommands",
                schema: "sales");

            migrationBuilder.DropTable(
                name: "DigitalDeliveryItems",
                schema: "sales");

            migrationBuilder.DropTable(
                name: "DigitalDeliveries",
                schema: "sales");

            migrationBuilder.DropCheckConstraint(
                name: "CK_FulfillmentHeader_Identity",
                schema: "sales",
                table: "FulfillmentHeaders");

            migrationBuilder.AddCheckConstraint(
                name: "CK_FulfillmentHeader_Identity",
                schema: "sales",
                table: "FulfillmentHeaders",
                sql: "LEN([OrderId])=32 AND LEN([ReservationId])=32 AND [ReservationContract] IN (1,2) AND [LastParcelNumber]>0");
        }
    }
}
