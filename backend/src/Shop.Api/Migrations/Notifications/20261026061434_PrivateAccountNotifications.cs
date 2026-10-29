using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Notifications
{
    /// <inheritdoc />
    public partial class PrivateAccountNotifications : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "notifications");

            migrationBuilder.CreateTable(
                name: "Inbox",
                schema: "notifications",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    Sequence = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    TicketId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    EventSequence = table.Column<long>(type: "bigint", nullable: false),
                    Kind = table.Column<string>(type: "varchar(24)", unicode: false, maxLength: 24, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ReadAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Inbox", x => x.Id);
                    table.CheckConstraint("CK_Inbox_Kind", "[Kind] IN ('support_reply','support_closed','support_reopened')");
                    table.CheckConstraint("CK_Inbox_Source", "[EventSequence]>0");
                    table.CheckConstraint("CK_Inbox_Time", "DATEPART(TZOFFSET,[At])=0 AND ([ReadAt] IS NULL OR (DATEPART(TZOFFSET,[ReadAt])=0 AND [ReadAt]>=[At]))");
                });

            migrationBuilder.CreateIndex(
                name: "IX_Inbox_OwnerId_ReadAt_Sequence",
                schema: "notifications",
                table: "Inbox",
                columns: new[] { "OwnerId", "ReadAt", "Sequence" });

            migrationBuilder.CreateIndex(
                name: "IX_Inbox_OwnerId_Sequence",
                schema: "notifications",
                table: "Inbox",
                columns: new[] { "OwnerId", "Sequence" });

            migrationBuilder.CreateIndex(
                name: "IX_Inbox_OwnerId_TicketId_EventSequence",
                schema: "notifications",
                table: "Inbox",
                columns: new[] { "OwnerId", "TicketId", "EventSequence" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Inbox_Sequence",
                schema: "notifications",
                table: "Inbox",
                column: "Sequence",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS (SELECT 1 FROM [notifications].[Inbox]) THROW 51000, 'Private notification history exists; automatic down migration is prohibited.', 1;");
            migrationBuilder.DropTable(
                name: "Inbox",
                schema: "notifications");
        }
    }
}
