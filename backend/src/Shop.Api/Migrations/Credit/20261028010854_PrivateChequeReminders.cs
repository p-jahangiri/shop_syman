using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Credit
{
    /// <inheritdoc />
    public partial class PrivateChequeReminders : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddUniqueConstraint(
                name: "AK_ReceivedCheques_Id_OrderId_OwnerId",
                schema: "credit",
                table: "ReceivedCheques",
                columns: new[] { "Id", "OrderId", "OwnerId" });

            migrationBuilder.CreateTable(
                name: "ReminderEvents",
                schema: "credit",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    OrderId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ChequeId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    Sequence = table.Column<int>(type: "int", nullable: false),
                    CivilDay = table.Column<DateOnly>(type: "date", nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ProtectedEvent = table.Column<byte[]>(type: "varbinary(max)", maxLength: 8192, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReminderEvents", x => x.Id);
                    table.UniqueConstraint("AK_ReminderEvents_Id_OrderId_OwnerId_ChequeId", x => new { x.Id, x.OrderId, x.OwnerId, x.ChequeId });
                    table.CheckConstraint("CK_ReminderEvent_Facts", "[Sequence] BETWEEN 1 AND 3650 AND DATEPART(TZOFFSET,[At])=0 AND DATALENGTH([ProtectedEvent]) BETWEEN 1 AND 8192");
                    table.ForeignKey(
                        name: "FK_ReminderEvents_ReceivedCheques_ChequeId_OrderId_OwnerId",
                        columns: x => new { x.ChequeId, x.OrderId, x.OwnerId },
                        principalSchema: "credit",
                        principalTable: "ReceivedCheques",
                        principalColumns: new[] { "Id", "OrderId", "OwnerId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ReminderCommands",
                schema: "credit",
                columns: table => new
                {
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CommandId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    OrderId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ChequeId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    EventId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ResultHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ProtectedResult = table.Column<byte[]>(type: "varbinary(max)", maxLength: 16384, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReminderCommands", x => new { x.ActorId, x.CommandId });
                    table.CheckConstraint("CK_ReminderCommand_Facts", "DATEPART(TZOFFSET,[At])=0 AND DATALENGTH([ProtectedResult]) BETWEEN 1 AND 16384");
                    table.ForeignKey(
                        name: "FK_ReminderCommands_ReminderEvents_EventId_OrderId_OwnerId_ChequeId",
                        columns: x => new { x.EventId, x.OrderId, x.OwnerId, x.ChequeId },
                        principalSchema: "credit",
                        principalTable: "ReminderEvents",
                        principalColumns: new[] { "Id", "OrderId", "OwnerId", "ChequeId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ReminderCommands_EventId",
                schema: "credit",
                table: "ReminderCommands",
                column: "EventId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReminderCommands_EventId_OrderId_OwnerId_ChequeId",
                schema: "credit",
                table: "ReminderCommands",
                columns: new[] { "EventId", "OrderId", "OwnerId", "ChequeId" });

            migrationBuilder.CreateIndex(
                name: "IX_ReminderEvents_ChequeId_CivilDay",
                schema: "credit",
                table: "ReminderEvents",
                columns: new[] { "ChequeId", "CivilDay" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReminderEvents_ChequeId_OrderId_OwnerId",
                schema: "credit",
                table: "ReminderEvents",
                columns: new[] { "ChequeId", "OrderId", "OwnerId" });

            migrationBuilder.CreateIndex(
                name: "IX_ReminderEvents_ChequeId_Sequence",
                schema: "credit",
                table: "ReminderEvents",
                columns: new[] { "ChequeId", "Sequence" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS(SELECT 1 FROM [credit].[ReminderEvents]) OR EXISTS(SELECT 1 FROM [credit].[ReminderCommands]) THROW 51000, 'Retain private cheque reminder history.', 1;");
            migrationBuilder.DropTable(
                name: "ReminderCommands",
                schema: "credit");

            migrationBuilder.DropTable(
                name: "ReminderEvents",
                schema: "credit");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_ReceivedCheques_Id_OrderId_OwnerId",
                schema: "credit",
                table: "ReceivedCheques");
        }
    }
}
