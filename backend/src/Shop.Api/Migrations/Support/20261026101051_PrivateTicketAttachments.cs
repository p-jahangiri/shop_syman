using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Support
{
    /// <inheritdoc />
    public partial class PrivateTicketAttachments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddUniqueConstraint(
                name: "AK_Messages_Id_TicketId",
                schema: "support",
                table: "Messages",
                columns: new[] { "Id", "TicketId" });

            migrationBuilder.CreateTable(
                name: "Attachments",
                schema: "support",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    TicketId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    MessageId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Author = table.Column<string>(type: "varchar(8)", unicode: false, maxLength: 8, nullable: false),
                    Sequence = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Attachments", x => x.Id);
                    table.CheckConstraint("CK_TicketAttachment_Author", "[Author] IN ('customer','support')");
                    table.ForeignKey(
                        name: "FK_Attachments_Messages_MessageId_TicketId",
                        columns: x => new { x.MessageId, x.TicketId },
                        principalSchema: "support",
                        principalTable: "Messages",
                        principalColumns: new[] { "Id", "TicketId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Attachments_MessageId",
                schema: "support",
                table: "Attachments",
                column: "MessageId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Attachments_MessageId_TicketId",
                schema: "support",
                table: "Attachments",
                columns: new[] { "MessageId", "TicketId" });

            migrationBuilder.CreateIndex(
                name: "IX_Attachments_Sequence",
                schema: "support",
                table: "Attachments",
                column: "Sequence",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Attachments_TicketId_Sequence",
                schema: "support",
                table: "Attachments",
                columns: new[] { "TicketId", "Sequence" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS(SELECT 1 FROM [support].[Attachments]) THROW 51000, 'Private attachment history must be retained.', 1;");
            migrationBuilder.DropTable(
                name: "Attachments",
                schema: "support");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_Messages_Id_TicketId",
                schema: "support",
                table: "Messages");
        }
    }
}
