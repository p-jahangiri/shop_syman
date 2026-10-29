using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Credit
{
    /// <inheritdoc />
    public partial class ManualCreditReviews : Migration
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
                name: "CurrentReviewId",
                schema: "credit",
                table: "Applications",
                type: "varchar(32)",
                unicode: false,
                maxLength: 32,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ApplicationReviews",
                schema: "credit",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    Sequence = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ApplicationId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    SubmissionId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    Outcome = table.Column<string>(type: "varchar(16)", unicode: false, maxLength: 16, nullable: false),
                    Locale = table.Column<string>(type: "varchar(2)", unicode: false, maxLength: 2, nullable: false),
                    ApprovedAmountRial = table.Column<long>(type: "bigint", nullable: true),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    ProtectedNote = table.Column<byte[]>(type: "varbinary(max)", maxLength: 16384, nullable: false),
                    NoteHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ApplicationReviews", x => x.Id);
                    table.UniqueConstraint("AK_ApplicationReviews_Id_ApplicationId", x => new { x.Id, x.ApplicationId });
                    table.UniqueConstraint("AK_ApplicationReviews_Id_ApplicationId_SubmissionId", x => new { x.Id, x.ApplicationId, x.SubmissionId });
                    table.CheckConstraint("CK_CreditReview_Approval", "([Outcome]='Approved' AND [ApprovedAmountRial] IS NOT NULL AND [ExpiresAt] IS NOT NULL AND [ApprovedAmountRial]>0 AND [ExpiresAt]>[At] AND DATEPART(TZOFFSET,[ExpiresAt])=0) OR ([Outcome]<>'Approved' AND [ApprovedAmountRial] IS NULL AND [ExpiresAt] IS NULL)");
                    table.CheckConstraint("CK_CreditReview_Locale", "[Locale] IN ('fa','en')");
                    table.CheckConstraint("CK_CreditReview_Note", "DATALENGTH([ProtectedNote]) BETWEEN 1 AND 16384");
                    table.CheckConstraint("CK_CreditReview_Outcome", "[Outcome] IN ('Returned','Declined','Approved')");
                    table.CheckConstraint("CK_CreditReview_Time", "DATEPART(TZOFFSET,[At])=0");
                    table.ForeignKey(
                        name: "FK_ApplicationReviews_Submissions_SubmissionId_ApplicationId",
                        columns: x => new { x.SubmissionId, x.ApplicationId },
                        principalSchema: "credit",
                        principalTable: "Submissions",
                        principalColumns: new[] { "Id", "ApplicationId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ReviewCommands",
                schema: "credit",
                columns: table => new
                {
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CommandId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ApplicationId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ReviewId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ResultHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ProtectedResult = table.Column<byte[]>(type: "varbinary(max)", maxLength: 65536, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReviewCommands", x => new { x.ActorId, x.CommandId });
                    table.CheckConstraint("CK_CreditReviewCommand_Result", "DATALENGTH([ProtectedResult]) BETWEEN 1 AND 65536");
                    table.CheckConstraint("CK_CreditReviewCommand_Time", "DATEPART(TZOFFSET,[At])=0");
                    table.ForeignKey(
                        name: "FK_ReviewCommands_ApplicationReviews_ReviewId_ApplicationId",
                        columns: x => new { x.ReviewId, x.ApplicationId },
                        principalSchema: "credit",
                        principalTable: "ApplicationReviews",
                        principalColumns: new[] { "Id", "ApplicationId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Applications_CurrentReviewId_Id_CurrentSubmissionId",
                schema: "credit",
                table: "Applications",
                columns: new[] { "CurrentReviewId", "Id", "CurrentSubmissionId" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_CreditApplication_Review",
                schema: "credit",
                table: "Applications",
                sql: "([CurrentReviewId] IS NULL OR [CurrentSubmissionId] IS NOT NULL) AND ([State] NOT IN ('Approved','Declined') OR [CurrentReviewId] IS NOT NULL)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_CreditApplication_State",
                schema: "credit",
                table: "Applications",
                sql: "[State] IN ('Draft','Submitted','Cancelled','Approved','Declined')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_CreditApplicationEvent_Action",
                schema: "credit",
                table: "ApplicationEvents",
                sql: "[Action] IN ('Created','Cancelled','Consented','DocumentAttached','Submitted','Withdrawn','Returned','Approved','Declined')");

            migrationBuilder.CreateIndex(
                name: "IX_ApplicationReviews_ApplicationId_Sequence",
                schema: "credit",
                table: "ApplicationReviews",
                columns: new[] { "ApplicationId", "Sequence" });

            migrationBuilder.CreateIndex(
                name: "IX_ApplicationReviews_Sequence",
                schema: "credit",
                table: "ApplicationReviews",
                column: "Sequence",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ApplicationReviews_SubmissionId",
                schema: "credit",
                table: "ApplicationReviews",
                column: "SubmissionId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ApplicationReviews_SubmissionId_ApplicationId",
                schema: "credit",
                table: "ApplicationReviews",
                columns: new[] { "SubmissionId", "ApplicationId" });

            migrationBuilder.CreateIndex(
                name: "IX_ReviewCommands_ReviewId_ApplicationId",
                schema: "credit",
                table: "ReviewCommands",
                columns: new[] { "ReviewId", "ApplicationId" });

            migrationBuilder.AddForeignKey(
                name: "FK_Applications_ApplicationReviews_CurrentReviewId_Id_CurrentSubmissionId",
                schema: "credit",
                table: "Applications",
                columns: new[] { "CurrentReviewId", "Id", "CurrentSubmissionId" },
                principalSchema: "credit",
                principalTable: "ApplicationReviews",
                principalColumns: new[] { "Id", "ApplicationId", "SubmissionId" },
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                IF EXISTS (SELECT 1 FROM [credit].[ApplicationReviews])
                   OR EXISTS (SELECT 1 FROM [credit].[ReviewCommands])
                   OR EXISTS (SELECT 1 FROM [credit].[Submissions])
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
                    THROW 51000, 'Credit human review, submission, documents and consent history must be retained.', 1;
                """);

            migrationBuilder.DropForeignKey(
                name: "FK_Applications_ApplicationReviews_CurrentReviewId_Id_CurrentSubmissionId",
                schema: "credit",
                table: "Applications");

            migrationBuilder.DropTable(
                name: "ReviewCommands",
                schema: "credit");

            migrationBuilder.DropTable(
                name: "ApplicationReviews",
                schema: "credit");

            migrationBuilder.DropIndex(
                name: "IX_Applications_CurrentReviewId_Id_CurrentSubmissionId",
                schema: "credit",
                table: "Applications");

            migrationBuilder.DropCheckConstraint(
                name: "CK_CreditApplication_Review",
                schema: "credit",
                table: "Applications");

            migrationBuilder.DropCheckConstraint(
                name: "CK_CreditApplication_State",
                schema: "credit",
                table: "Applications");

            migrationBuilder.DropCheckConstraint(
                name: "CK_CreditApplicationEvent_Action",
                schema: "credit",
                table: "ApplicationEvents");

            migrationBuilder.DropColumn(
                name: "CurrentReviewId",
                schema: "credit",
                table: "Applications");

            migrationBuilder.AddCheckConstraint(
                name: "CK_CreditApplication_State",
                schema: "credit",
                table: "Applications",
                sql: "[State] IN ('Draft','Submitted','Cancelled')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_CreditApplicationEvent_Action",
                schema: "credit",
                table: "ApplicationEvents",
                sql: "[Action] IN ('Created','Cancelled','Consented','DocumentAttached','Submitted','Withdrawn')");
        }
    }
}
