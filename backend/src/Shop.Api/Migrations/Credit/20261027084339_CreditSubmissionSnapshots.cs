using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Credit
{
    /// <inheritdoc />
    public partial class CreditSubmissionSnapshots : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_CreditApplication_State",
                schema: "credit",
                table: "Applications");

            migrationBuilder.DropCheckConstraint(
                name: "CK_CreditApplicationEvent_Action",
                schema: "credit",
                table: "ApplicationEvents");

            migrationBuilder.AddColumn<string>(
                name: "CurrentSubmissionId",
                schema: "credit",
                table: "Applications",
                type: "varchar(32)",
                unicode: false,
                maxLength: 32,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "Submissions",
                schema: "credit",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    Sequence = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ApplicationId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ConsentId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    RequirementsRevisionId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ApplicationVersion = table.Column<string>(type: "varchar(12)", unicode: false, maxLength: 12, nullable: false),
                    RequirementsVersion = table.Column<string>(type: "varchar(12)", unicode: false, maxLength: 12, nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Locale = table.Column<string>(type: "varchar(2)", unicode: false, maxLength: 2, nullable: false),
                    DocumentCount = table.Column<int>(type: "int", nullable: false),
                    ProtectedNote = table.Column<byte[]>(type: "varbinary(max)", maxLength: 16384, nullable: false),
                    NoteHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    SubmittedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Submissions", x => x.Id);
                    table.UniqueConstraint("AK_Submissions_Id_ApplicationId", x => new { x.Id, x.ApplicationId });
                    table.UniqueConstraint("AK_Submissions_Id_ApplicationId_ConsentId_RequirementsRevisionId", x => new { x.Id, x.ApplicationId, x.ConsentId, x.RequirementsRevisionId });
                    table.CheckConstraint("CK_CreditSubmission_Documents", "[DocumentCount] BETWEEN 0 AND 12");
                    table.CheckConstraint("CK_CreditSubmission_Locale", "[Locale] IN ('fa','en')");
                    table.CheckConstraint("CK_CreditSubmission_Note", "DATALENGTH([ProtectedNote]) BETWEEN 1 AND 16384");
                    table.CheckConstraint("CK_CreditSubmission_Time", "DATEPART(TZOFFSET,[SubmittedAt])=0");
                    table.ForeignKey(
                        name: "FK_Submissions_RequirementsConsents_ConsentId_ApplicationId_RequirementsRevisionId",
                        columns: x => new { x.ConsentId, x.ApplicationId, x.RequirementsRevisionId },
                        principalSchema: "credit",
                        principalTable: "RequirementsConsents",
                        principalColumns: new[] { "Id", "ApplicationId", "RevisionId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "SubmissionCommands",
                schema: "credit",
                columns: table => new
                {
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CommandId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ApplicationId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    SubmissionId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ResultHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ProtectedResult = table.Column<byte[]>(type: "varbinary(max)", maxLength: 65536, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SubmissionCommands", x => new { x.ActorId, x.CommandId });
                    table.CheckConstraint("CK_CreditSubmissionCommand_Result", "DATALENGTH([ProtectedResult]) BETWEEN 1 AND 65536");
                    table.CheckConstraint("CK_CreditSubmissionCommand_Time", "DATEPART(TZOFFSET,[At])=0");
                    table.ForeignKey(
                        name: "FK_SubmissionCommands_Submissions_SubmissionId_ApplicationId",
                        columns: x => new { x.SubmissionId, x.ApplicationId },
                        principalSchema: "credit",
                        principalTable: "Submissions",
                        principalColumns: new[] { "Id", "ApplicationId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "SubmissionDocuments",
                schema: "credit",
                columns: table => new
                {
                    SubmissionId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    DocumentKey = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ApplicationId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ConsentId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    RequirementsRevisionId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    Position = table.Column<int>(type: "int", nullable: false),
                    AttachmentId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    MetadataHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SubmissionDocuments", x => new { x.SubmissionId, x.DocumentKey });
                    table.CheckConstraint("CK_CreditSubmissionDocument_Position", "[Position] BETWEEN 0 AND 11");
                    table.ForeignKey(
                        name: "FK_SubmissionDocuments_DocumentAttachments_AttachmentId_ApplicationId_ConsentId_DocumentKey",
                        columns: x => new { x.AttachmentId, x.ApplicationId, x.ConsentId, x.DocumentKey },
                        principalSchema: "credit",
                        principalTable: "DocumentAttachments",
                        principalColumns: new[] { "Id", "ApplicationId", "ConsentId", "DocumentKey" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SubmissionDocuments_Submissions_SubmissionId_ApplicationId_ConsentId_RequirementsRevisionId",
                        columns: x => new { x.SubmissionId, x.ApplicationId, x.ConsentId, x.RequirementsRevisionId },
                        principalSchema: "credit",
                        principalTable: "Submissions",
                        principalColumns: new[] { "Id", "ApplicationId", "ConsentId", "RequirementsRevisionId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Applications_CurrentSubmissionId_Id",
                schema: "credit",
                table: "Applications",
                columns: new[] { "CurrentSubmissionId", "Id" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_CreditApplication_State",
                schema: "credit",
                table: "Applications",
                sql: "[State] IN ('Draft','Submitted','Cancelled')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_CreditApplication_Submission",
                schema: "credit",
                table: "Applications",
                sql: "[State] <> 'Submitted' OR [CurrentSubmissionId] IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "CK_CreditApplicationEvent_Action",
                schema: "credit",
                table: "ApplicationEvents",
                sql: "[Action] IN ('Created','Cancelled','Consented','DocumentAttached','Submitted','Withdrawn')");

            migrationBuilder.CreateIndex(
                name: "IX_SubmissionCommands_SubmissionId_ApplicationId",
                schema: "credit",
                table: "SubmissionCommands",
                columns: new[] { "SubmissionId", "ApplicationId" });

            migrationBuilder.CreateIndex(
                name: "IX_SubmissionDocuments_AttachmentId_ApplicationId_ConsentId_DocumentKey",
                schema: "credit",
                table: "SubmissionDocuments",
                columns: new[] { "AttachmentId", "ApplicationId", "ConsentId", "DocumentKey" });

            migrationBuilder.CreateIndex(
                name: "IX_SubmissionDocuments_SubmissionId_ApplicationId_ConsentId_RequirementsRevisionId",
                schema: "credit",
                table: "SubmissionDocuments",
                columns: new[] { "SubmissionId", "ApplicationId", "ConsentId", "RequirementsRevisionId" });

            migrationBuilder.CreateIndex(
                name: "IX_SubmissionDocuments_SubmissionId_AttachmentId",
                schema: "credit",
                table: "SubmissionDocuments",
                columns: new[] { "SubmissionId", "AttachmentId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SubmissionDocuments_SubmissionId_Position",
                schema: "credit",
                table: "SubmissionDocuments",
                columns: new[] { "SubmissionId", "Position" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Submissions_ApplicationId_Sequence",
                schema: "credit",
                table: "Submissions",
                columns: new[] { "ApplicationId", "Sequence" });

            migrationBuilder.CreateIndex(
                name: "IX_Submissions_ConsentId_ApplicationId_RequirementsRevisionId",
                schema: "credit",
                table: "Submissions",
                columns: new[] { "ConsentId", "ApplicationId", "RequirementsRevisionId" });

            migrationBuilder.CreateIndex(
                name: "IX_Submissions_Sequence",
                schema: "credit",
                table: "Submissions",
                column: "Sequence",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_Applications_Submissions_CurrentSubmissionId_Id",
                schema: "credit",
                table: "Applications",
                columns: new[] { "CurrentSubmissionId", "Id" },
                principalSchema: "credit",
                principalTable: "Submissions",
                principalColumns: new[] { "Id", "ApplicationId" },
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                IF EXISTS (SELECT 1 FROM [credit].[Submissions])
                   OR EXISTS (SELECT 1 FROM [credit].[SubmissionDocuments])
                   OR EXISTS (SELECT 1 FROM [credit].[SubmissionCommands])
                   OR EXISTS (SELECT 1 FROM [credit].[Applications])
                   OR EXISTS (SELECT 1 FROM [credit].[ApplicationEvents])
                   OR EXISTS (SELECT 1 FROM [credit].[ApplicationCommands])
                   OR EXISTS (SELECT 1 FROM [credit].[DocumentAttachments])
                   OR EXISTS (SELECT 1 FROM [credit].[DocumentCommands])
                   OR EXISTS (SELECT 1 FROM [credit].[RequirementsHead])
                   OR EXISTS (SELECT 1 FROM [credit].[RequirementsRevisions])
                   OR EXISTS (SELECT 1 FROM [credit].[RequirementDocuments])
                   OR EXISTS (SELECT 1 FROM [credit].[RequirementsPublishCommands])
                   OR EXISTS (SELECT 1 FROM [credit].[RequirementsConsents])
                   OR EXISTS (SELECT 1 FROM [credit].[RequirementsConsentCommands])
                    THROW 51000, 'Credit submission, documents, consent and application history must be retained.', 1;
                """);

            migrationBuilder.DropForeignKey(
                name: "FK_Applications_Submissions_CurrentSubmissionId_Id",
                schema: "credit",
                table: "Applications");

            migrationBuilder.DropTable(
                name: "SubmissionCommands",
                schema: "credit");

            migrationBuilder.DropTable(
                name: "SubmissionDocuments",
                schema: "credit");

            migrationBuilder.DropTable(
                name: "Submissions",
                schema: "credit");

            migrationBuilder.DropIndex(
                name: "IX_Applications_CurrentSubmissionId_Id",
                schema: "credit",
                table: "Applications");

            migrationBuilder.DropCheckConstraint(
                name: "CK_CreditApplication_State",
                schema: "credit",
                table: "Applications");

            migrationBuilder.DropCheckConstraint(
                name: "CK_CreditApplication_Submission",
                schema: "credit",
                table: "Applications");

            migrationBuilder.DropCheckConstraint(
                name: "CK_CreditApplicationEvent_Action",
                schema: "credit",
                table: "ApplicationEvents");

            migrationBuilder.DropColumn(
                name: "CurrentSubmissionId",
                schema: "credit",
                table: "Applications");

            migrationBuilder.AddCheckConstraint(
                name: "CK_CreditApplication_State",
                schema: "credit",
                table: "Applications",
                sql: "[State] IN ('Draft','Cancelled')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_CreditApplicationEvent_Action",
                schema: "credit",
                table: "ApplicationEvents",
                sql: "[Action] IN ('Created','Cancelled','Consented','DocumentAttached')");
        }
    }
}
