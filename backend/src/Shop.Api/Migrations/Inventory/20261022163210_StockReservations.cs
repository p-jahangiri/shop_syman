using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Inventory
{
    /// <inheritdoc />
    public partial class StockReservations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Reservations",
                schema: "inventory",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    OrderId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    RequestId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    State = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ChangedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Reservations", x => x.Id);
                    table.CheckConstraint("CK_Reservation_Deadline", "[ExpiresAt] > [CreatedAt]");
                    table.CheckConstraint("CK_Reservation_State", "[State] IN ('Active','Allocated','Released','Expired','Fulfilled')");
                });

            migrationBuilder.CreateTable(
                name: "ReservationEvents",
                schema: "inventory",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ReservationId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    State = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReservationEvents", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ReservationEvents_Reservations_ReservationId",
                        column: x => x.ReservationId,
                        principalSchema: "inventory",
                        principalTable: "Reservations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ReservationItems",
                schema: "inventory",
                columns: table => new
                {
                    ReservationId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    VariantId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Quantity = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReservationItems", x => new { x.ReservationId, x.VariantId });
                    table.CheckConstraint("CK_ReservationItem_Quantity", "[Quantity] > 0 AND [Quantity] <= 1000000");
                    table.ForeignKey(
                        name: "FK_ReservationItems_Reservations_ReservationId",
                        column: x => x.ReservationId,
                        principalSchema: "inventory",
                        principalTable: "Reservations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ReservationItems_Stock_VariantId",
                        column: x => x.VariantId,
                        principalSchema: "inventory",
                        principalTable: "Stock",
                        principalColumn: "VariantId",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ReservationEvents_ReservationId_State",
                schema: "inventory",
                table: "ReservationEvents",
                columns: new[] { "ReservationId", "State" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReservationItems_VariantId",
                schema: "inventory",
                table: "ReservationItems",
                column: "VariantId");

            migrationBuilder.CreateIndex(
                name: "IX_Reservations_OrderId",
                schema: "inventory",
                table: "Reservations",
                column: "OrderId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Reservations_OwnerId_RequestId",
                schema: "inventory",
                table: "Reservations",
                columns: new[] { "OwnerId", "RequestId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Reservations_State_ExpiresAt_Id",
                schema: "inventory",
                table: "Reservations",
                columns: new[] { "State", "ExpiresAt", "Id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ReservationEvents",
                schema: "inventory");

            migrationBuilder.DropTable(
                name: "ReservationItems",
                schema: "inventory");

            migrationBuilder.DropTable(
                name: "Reservations",
                schema: "inventory");
        }
    }
}
