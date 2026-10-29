using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Support
{
    /// <inheritdoc />
    public partial class PrivateSupportTickets : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "support");

            migrationBuilder.CreateTable(
                name: "Tickets",
                schema: "support",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    Sequence = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    ProtectedSubject = table.Column<byte[]>(type: "varbinary(max)", maxLength: 65536, nullable: false),
                    Locale = table.Column<string>(type: "varchar(2)", unicode: false, maxLength: 2, nullable: false),
                    State = table.Column<string>(type: "varchar(16)", unicode: false, maxLength: 16, nullable: false),
                    MessageCount = table.Column<int>(type: "int", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ChangedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Tickets", x => x.Id);
                    table.CheckConstraint("CK_Ticket_Locale", "[Locale] IN ('fa','en')");
                    table.CheckConstraint("CK_Ticket_MessageCount", "[MessageCount]>0");
                    table.CheckConstraint("CK_Ticket_State", "[State] IN ('Open','WaitingCustomer','Closed')");
                    table.CheckConstraint("CK_Ticket_Subject", "DATALENGTH([ProtectedSubject]) BETWEEN 1 AND 65536");
                });

            migrationBuilder.CreateTable(
                name: "Commands",
                schema: "support",
                columns: table => new
                {
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CommandId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    Audience = table.Column<string>(type: "varchar(8)", unicode: false, maxLength: 8, nullable: false),
                    TicketId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ProtectedResult = table.Column<byte[]>(type: "varbinary(max)", maxLength: 65536, nullable: false),
                    ResultHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Commands", x => new { x.ActorId, x.CommandId });
                    table.CheckConstraint("CK_TicketCommand_Audience", "[Audience] IN ('customer','support')");
                    table.CheckConstraint("CK_TicketCommand_Result", "DATALENGTH([ProtectedResult]) BETWEEN 1 AND 65536");
                    table.ForeignKey(
                        name: "FK_Commands_Tickets_TicketId",
                        column: x => x.TicketId,
                        principalSchema: "support",
                        principalTable: "Tickets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Events",
                schema: "support",
                columns: table => new
                {
                    Sequence = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    TicketId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Action = table.Column<string>(type: "varchar(16)", unicode: false, maxLength: 16, nullable: false),
                    State = table.Column<string>(type: "varchar(16)", unicode: false, maxLength: 16, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Events", x => x.Sequence);
                    table.CheckConstraint("CK_TicketEvent_Action", "[Action] IN ('Created','Replied','Closed','Reopened')");
                    table.CheckConstraint("CK_TicketEvent_State", "[State] IN ('Open','WaitingCustomer','Closed')");
                    table.ForeignKey(
                        name: "FK_Events_Tickets_TicketId",
                        column: x => x.TicketId,
                        principalSchema: "support",
                        principalTable: "Tickets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Messages",
                schema: "support",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    Sequence = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    TicketId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Author = table.Column<string>(type: "varchar(8)", unicode: false, maxLength: 8, nullable: false),
                    Locale = table.Column<string>(type: "varchar(2)", unicode: false, maxLength: 2, nullable: false),
                    ProtectedBody = table.Column<byte[]>(type: "varbinary(max)", maxLength: 65536, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Messages", x => x.Id);
                    table.CheckConstraint("CK_TicketMessage_Author", "[Author] IN ('customer','support')");
                    table.CheckConstraint("CK_TicketMessage_Body", "DATALENGTH([ProtectedBody]) BETWEEN 1 AND 65536");
                    table.CheckConstraint("CK_TicketMessage_Locale", "[Locale] IN ('fa','en')");
                    table.ForeignKey(
                        name: "FK_Messages_Tickets_TicketId",
                        column: x => x.TicketId,
                        principalSchema: "support",
                        principalTable: "Tickets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Commands_TicketId_At",
                schema: "support",
                table: "Commands",
                columns: new[] { "TicketId", "At" });

            migrationBuilder.CreateIndex(
                name: "IX_Events_TicketId_Sequence",
                schema: "support",
                table: "Events",
                columns: new[] { "TicketId", "Sequence" });

            migrationBuilder.CreateIndex(
                name: "IX_Messages_Sequence",
                schema: "support",
                table: "Messages",
                column: "Sequence",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Messages_TicketId_Sequence",
                schema: "support",
                table: "Messages",
                columns: new[] { "TicketId", "Sequence" });

            migrationBuilder.CreateIndex(
                name: "IX_Tickets_OwnerId_State_Sequence",
                schema: "support",
                table: "Tickets",
                columns: new[] { "OwnerId", "State", "Sequence" });

            migrationBuilder.CreateIndex(
                name: "IX_Tickets_Sequence",
                schema: "support",
                table: "Tickets",
                column: "Sequence",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Tickets_State_Sequence",
                schema: "support",
                table: "Tickets",
                columns: new[] { "State", "Sequence" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS(SELECT 1 FROM [support].[Tickets]) OR EXISTS(SELECT 1 FROM [support].[Messages]) OR EXISTS(SELECT 1 FROM [support].[Events]) OR EXISTS(SELECT 1 FROM [support].[Commands]) THROW 51000, 'Private support history must be retained.', 1;");
            migrationBuilder.DropTable(
                name: "Commands",
                schema: "support");

            migrationBuilder.DropTable(
                name: "Events",
                schema: "support");

            migrationBuilder.DropTable(
                name: "Messages",
                schema: "support");

            migrationBuilder.DropTable(
                name: "Tickets",
                schema: "support");
        }
    }
}
