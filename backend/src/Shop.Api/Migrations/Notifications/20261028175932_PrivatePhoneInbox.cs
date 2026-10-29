using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Notifications
{
    /// <inheritdoc />
    public partial class PrivatePhoneInbox : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "PhoneInbox",
                schema: "notifications",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    Sequence = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Kind = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ListingId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ConfigurationId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ReadAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ProtectedPayload = table.Column<byte[]>(type: "varbinary(max)", maxLength: 8192, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PhoneInbox", x => x.Id);
                    table.CheckConstraint("CK_PhoneInbox_Kind", "[Kind] IN ('phone_available','sourcing_offer_published')");
                    table.CheckConstraint("CK_PhoneInbox_Sealed", "DATALENGTH([ProtectedPayload]) BETWEEN 1 AND 8192");
                    table.CheckConstraint("CK_PhoneInbox_Time", "DATEPART(TZOFFSET,[At])=0 AND ([ReadAt] IS NULL OR (DATEPART(TZOFFSET,[ReadAt])=0 AND [ReadAt]>=[At]))");
                });

            migrationBuilder.CreateIndex(
                name: "IX_PhoneInbox_OwnerId_ReadAt_Sequence",
                schema: "notifications",
                table: "PhoneInbox",
                columns: new[] { "OwnerId", "ReadAt", "Sequence" });

            migrationBuilder.CreateIndex(
                name: "IX_PhoneInbox_OwnerId_Sequence",
                schema: "notifications",
                table: "PhoneInbox",
                columns: new[] { "OwnerId", "Sequence" });

            migrationBuilder.CreateIndex(
                name: "IX_PhoneInbox_Sequence",
                schema: "notifications",
                table: "PhoneInbox",
                column: "Sequence",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS (SELECT 1 FROM [notifications].[PhoneInbox]) THROW 51000, 'Private phone notifications must not be discarded.', 1;");
            migrationBuilder.DropTable(
                name: "PhoneInbox",
                schema: "notifications");
        }
    }
}
