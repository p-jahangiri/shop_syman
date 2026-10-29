using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Credit
{
    /// <inheritdoc />
    public partial class CreditFinancialClearance : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ClearanceEvents",
                schema: "credit",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    OrderId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    Sequence = table.Column<int>(type: "int", nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Action = table.Column<string>(type: "varchar(16)", unicode: false, maxLength: 16, nullable: false),
                    State = table.Column<string>(type: "varchar(16)", unicode: false, maxLength: 16, nullable: false),
                    RecordedAt = table.Column<DateTimeOffset>(type: "datetimeoffset(7)", precision: 7, nullable: false),
                    ProtectedEvent = table.Column<byte[]>(type: "varbinary(max)", maxLength: 65536, nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ClearanceEvents", x => x.Id);
                    table.UniqueConstraint("AK_ClearanceEvents_OrderId_Id", x => new { x.OrderId, x.Id });
                    table.CheckConstraint("CK_ClearanceEvent_Facts", "[Sequence] BETWEEN 1 AND 200 AND DATEPART(TZOFFSET,[RecordedAt])=0 AND DATALENGTH([ProtectedEvent]) BETWEEN 1 AND 65536");
                    table.CheckConstraint("CK_ClearanceEvent_State", "([Action]='Approve' AND [State]='Approved') OR ([Action]='Revoke' AND [State]='Revoked' AND [Sequence]>1)");
                });

            migrationBuilder.CreateTable(
                name: "ClearanceCommands",
                schema: "credit",
                columns: table => new
                {
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CommandId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    OrderId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    EventId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ResultHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ProtectedResult = table.Column<byte[]>(type: "varbinary(max)", maxLength: 16384, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ClearanceCommands", x => new { x.ActorId, x.CommandId });
                    table.CheckConstraint("CK_ClearanceCommand_Facts", "DATEPART(TZOFFSET,[At])=0 AND DATALENGTH([ProtectedResult]) BETWEEN 1 AND 16384");
                    table.ForeignKey(
                        name: "FK_ClearanceCommands_ClearanceEvents_OrderId_EventId",
                        columns: x => new { x.OrderId, x.EventId },
                        principalSchema: "credit",
                        principalTable: "ClearanceEvents",
                        principalColumns: new[] { "OrderId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ClearanceCommands_EventId",
                schema: "credit",
                table: "ClearanceCommands",
                column: "EventId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ClearanceCommands_OrderId_EventId",
                schema: "credit",
                table: "ClearanceCommands",
                columns: new[] { "OrderId", "EventId" });

            migrationBuilder.CreateIndex(
                name: "IX_ClearanceEvents_OrderId_Sequence",
                schema: "credit",
                table: "ClearanceEvents",
                columns: new[] { "OrderId", "Sequence" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS(SELECT 1 FROM [credit].[ClearanceEvents]) OR EXISTS(SELECT 1 FROM [credit].[ClearanceCommands]) THROW 51000, 'Retain independent credit financial clearance history.', 1;");
            migrationBuilder.DropTable(
                name: "ClearanceCommands",
                schema: "credit");

            migrationBuilder.DropTable(
                name: "ClearanceEvents",
                schema: "credit");
        }
    }
}
