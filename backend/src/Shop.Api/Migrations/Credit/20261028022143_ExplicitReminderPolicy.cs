using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Credit
{
    /// <inheritdoc />
    public partial class ExplicitReminderPolicy : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ReminderPolicyRevisions",
                schema: "credit",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    Revision = table.Column<int>(type: "int", nullable: false),
                    Enabled = table.Column<bool>(type: "bit", nullable: false),
                    SendAt = table.Column<string>(type: "varchar(5)", unicode: false, maxLength: 5, nullable: true),
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false),
                    ProtectedData = table.Column<byte[]>(type: "varbinary(max)", maxLength: 8192, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReminderPolicyRevisions", x => x.Id);
                    table.CheckConstraint("CK_ReminderPolicyRevision_Facts", "[Revision] BETWEEN 1 AND 10000 AND DATEPART(TZOFFSET,[At])=0 AND DATALENGTH([ProtectedData]) BETWEEN 1 AND 8192");
                    table.CheckConstraint("CK_ReminderPolicyRevision_Time", "([Enabled]=0 AND [SendAt] IS NULL) OR ([Enabled]=1 AND LEN([SendAt])=5 AND [SendAt] LIKE '[0-2][0-9]:[0-5][0-9]' AND [SendAt]<'24:00')");
                });

            migrationBuilder.CreateTable(
                name: "ReminderPolicyCommands",
                schema: "credit",
                columns: table => new
                {
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CommandId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    RevisionId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ResultHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ProtectedResult = table.Column<byte[]>(type: "varbinary(max)", maxLength: 16384, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReminderPolicyCommands", x => new { x.ActorId, x.CommandId });
                    table.CheckConstraint("CK_ReminderPolicyCommand_Facts", "DATEPART(TZOFFSET,[At])=0 AND DATALENGTH([ProtectedResult]) BETWEEN 1 AND 16384");
                    table.ForeignKey(
                        name: "FK_ReminderPolicyCommands_ReminderPolicyRevisions_RevisionId",
                        column: x => x.RevisionId,
                        principalSchema: "credit",
                        principalTable: "ReminderPolicyRevisions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ReminderPolicyOffsets",
                schema: "credit",
                columns: table => new
                {
                    RevisionId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    Days = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReminderPolicyOffsets", x => new { x.RevisionId, x.Days });
                    table.CheckConstraint("CK_ReminderPolicyOffset_Days", "[Days] BETWEEN -365 AND 365");
                    table.ForeignKey(
                        name: "FK_ReminderPolicyOffsets_ReminderPolicyRevisions_RevisionId",
                        column: x => x.RevisionId,
                        principalSchema: "credit",
                        principalTable: "ReminderPolicyRevisions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ReminderPolicyCommands_RevisionId",
                schema: "credit",
                table: "ReminderPolicyCommands",
                column: "RevisionId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReminderPolicyRevisions_Revision",
                schema: "credit",
                table: "ReminderPolicyRevisions",
                column: "Revision",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS(SELECT 1 FROM [credit].[ReminderPolicyRevisions]) OR EXISTS(SELECT 1 FROM [credit].[ReminderPolicyOffsets]) OR EXISTS(SELECT 1 FROM [credit].[ReminderPolicyCommands]) THROW 51000, 'Retained reminder policy history cannot be removed.', 1;");
            migrationBuilder.DropTable(
                name: "ReminderPolicyCommands",
                schema: "credit");

            migrationBuilder.DropTable(
                name: "ReminderPolicyOffsets",
                schema: "credit");

            migrationBuilder.DropTable(
                name: "ReminderPolicyRevisions",
                schema: "credit");
        }
    }
}
