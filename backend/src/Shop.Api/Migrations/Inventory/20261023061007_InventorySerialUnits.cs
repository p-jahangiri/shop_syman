using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Inventory
{
    /// <inheritdoc />
    public partial class InventorySerialUnits : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "TrackingMode",
                schema: "inventory",
                table: "Stock",
                type: "nvarchar(8)",
                maxLength: 8,
                nullable: false,
                defaultValue: "none");

            migrationBuilder.CreateTable(
                name: "SerialCommands",
                schema: "inventory",
                columns: table => new
                {
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    RequestId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ResponseJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SerialCommands", x => new { x.ActorId, x.RequestId });
                    table.CheckConstraint("CK_SerialCommand_Response", "ISJSON([ResponseJson])=1 AND DATALENGTH([ResponseJson])<=262144");
                });

            migrationBuilder.CreateTable(
                name: "SerialUnits",
                schema: "inventory",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    VariantId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Serial = table.Column<string>(type: "varchar(100)", unicode: false, maxLength: 100, nullable: true),
                    Imei1 = table.Column<string>(type: "varchar(15)", unicode: false, maxLength: 15, nullable: true),
                    Imei2 = table.Column<string>(type: "varchar(15)", unicode: false, maxLength: 15, nullable: true),
                    State = table.Column<string>(type: "nvarchar(12)", maxLength: 12, nullable: false),
                    ReservationId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    OrderId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    WarrantyUntil = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ChangedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SerialUnits", x => x.Id);
                    table.CheckConstraint("CK_SerialUnit_Identity", "[Serial] IS NOT NULL OR [Imei1] IS NOT NULL");
                    table.CheckConstraint("CK_SerialUnit_Order", "([State] IN ('available','retired') AND [ReservationId] IS NULL AND [OrderId] IS NULL AND [WarrantyUntil] IS NULL) OR ([State] IN ('assigned','delivered') AND [ReservationId] IS NOT NULL AND [OrderId] IS NOT NULL)");
                    table.CheckConstraint("CK_SerialUnit_State", "[State] IN ('available','assigned','delivered','retired')");
                    table.ForeignKey(
                        name: "FK_SerialUnits_Reservations_ReservationId",
                        column: x => x.ReservationId,
                        principalSchema: "inventory",
                        principalTable: "Reservations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SerialUnits_Stock_VariantId",
                        column: x => x.VariantId,
                        principalSchema: "inventory",
                        principalTable: "Stock",
                        principalColumn: "VariantId",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "SerialIdentifiers",
                schema: "inventory",
                columns: table => new
                {
                    Key = table.Column<string>(type: "varchar(170)", unicode: false, maxLength: 170, nullable: false),
                    UnitId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SerialIdentifiers", x => x.Key);
                    table.ForeignKey(
                        name: "FK_SerialIdentifiers_SerialUnits_UnitId",
                        column: x => x.UnitId,
                        principalSchema: "inventory",
                        principalTable: "SerialUnits",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "SerialUnitEvents",
                schema: "inventory",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    UnitId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    State = table.Column<string>(type: "nvarchar(12)", maxLength: 12, nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Reason = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    OrderId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SerialUnitEvents", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SerialUnitEvents_SerialUnits_UnitId",
                        column: x => x.UnitId,
                        principalSchema: "inventory",
                        principalTable: "SerialUnits",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_Stock_TrackingMode",
                schema: "inventory",
                table: "Stock",
                sql: "[TrackingMode] IN ('none','serial','imei')");

            migrationBuilder.CreateIndex(
                name: "IX_SerialIdentifiers_UnitId",
                schema: "inventory",
                table: "SerialIdentifiers",
                column: "UnitId");

            migrationBuilder.CreateIndex(
                name: "IX_SerialUnitEvents_UnitId_Id",
                schema: "inventory",
                table: "SerialUnitEvents",
                columns: new[] { "UnitId", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_SerialUnits_ReservationId_VariantId_State",
                schema: "inventory",
                table: "SerialUnits",
                columns: new[] { "ReservationId", "VariantId", "State" });

            migrationBuilder.CreateIndex(
                name: "IX_SerialUnits_VariantId_State_Id",
                schema: "inventory",
                table: "SerialUnits",
                columns: new[] { "VariantId", "State", "Id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "SerialCommands",
                schema: "inventory");

            migrationBuilder.DropTable(
                name: "SerialIdentifiers",
                schema: "inventory");

            migrationBuilder.DropTable(
                name: "SerialUnitEvents",
                schema: "inventory");

            migrationBuilder.DropTable(
                name: "SerialUnits",
                schema: "inventory");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Stock_TrackingMode",
                schema: "inventory",
                table: "Stock");

            migrationBuilder.DropColumn(
                name: "TrackingMode",
                schema: "inventory",
                table: "Stock");
        }
    }
}
