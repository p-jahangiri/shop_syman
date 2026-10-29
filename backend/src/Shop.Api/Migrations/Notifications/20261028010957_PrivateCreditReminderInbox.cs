using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Notifications
{
    /// <inheritdoc />
    public partial class PrivateCreditReminderInbox : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CreditInbox",
                schema: "notifications",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    Sequence = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    OrderId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ChequeId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ReadAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ProtectedPayload = table.Column<byte[]>(type: "varbinary(max)", maxLength: 8192, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CreditInbox", x => x.Id);
                    table.CheckConstraint("CK_CreditInbox_Sealed", "DATALENGTH([ProtectedPayload]) BETWEEN 1 AND 8192");
                    table.CheckConstraint("CK_CreditInbox_Time", "DATEPART(TZOFFSET,[At])=0 AND ([ReadAt] IS NULL OR (DATEPART(TZOFFSET,[ReadAt])=0 AND [ReadAt]>=[At]))");
                });

            migrationBuilder.CreateIndex(
                name: "IX_CreditInbox_OwnerId_ReadAt_Sequence",
                schema: "notifications",
                table: "CreditInbox",
                columns: new[] { "OwnerId", "ReadAt", "Sequence" });

            migrationBuilder.CreateIndex(
                name: "IX_CreditInbox_OwnerId_Sequence",
                schema: "notifications",
                table: "CreditInbox",
                columns: new[] { "OwnerId", "Sequence" });

            migrationBuilder.CreateIndex(
                name: "IX_CreditInbox_Sequence",
                schema: "notifications",
                table: "CreditInbox",
                column: "Sequence",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS(SELECT 1 FROM [notifications].[CreditInbox]) THROW 51000, 'Retain private credit reminder inbox history.', 1;");
            migrationBuilder.DropTable(
                name: "CreditInbox",
                schema: "notifications");
        }
    }
}
