using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Credit
{
    /// <inheritdoc />
    public partial class PurchaseApprovalScopes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_CreditApplicationEvent_Action",
                schema: "credit",
                table: "ApplicationEvents");

            migrationBuilder.AddColumn<string>(
                name: "CurrentPurchaseScopeId",
                schema: "credit",
                table: "Applications",
                type: "varchar(32)",
                unicode: false,
                maxLength: 32,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "PurchaseScopes",
                schema: "credit",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ApplicationId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ReviewId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    SubmissionId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ApplicationVersion = table.Column<string>(type: "varchar(12)", unicode: false, maxLength: 12, nullable: false),
                    LimitBasis = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    LimitAmountRial = table.Column<long>(type: "bigint", nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    PlanId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    PlanVersion = table.Column<string>(type: "varchar(12)", unicode: false, maxLength: 12, nullable: false),
                    PlanSnapshotHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    GrantedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PurchaseScopes", x => x.Id);
                    table.UniqueConstraint("AK_PurchaseScopes_Id_ApplicationId", x => new { x.Id, x.ApplicationId });
                    table.UniqueConstraint("AK_PurchaseScopes_Id_ApplicationId_ReviewId", x => new { x.Id, x.ApplicationId, x.ReviewId });
                    table.CheckConstraint("CK_CreditPurchaseScope_Amount", "[LimitAmountRial]>0");
                    table.CheckConstraint("CK_CreditPurchaseScope_Basis", "[LimitBasis] IN ('PayableTotalRial','InstallmentsTotalRial')");
                    table.CheckConstraint("CK_CreditPurchaseScope_Time", "[ExpiresAt]>[GrantedAt] AND DATEPART(TZOFFSET,[ExpiresAt])=0 AND DATEPART(TZOFFSET,[GrantedAt])=0");
                    table.ForeignKey(
                        name: "FK_PurchaseScopes_ApplicationReviews_ReviewId_ApplicationId_SubmissionId",
                        columns: x => new { x.ReviewId, x.ApplicationId, x.SubmissionId },
                        principalSchema: "credit",
                        principalTable: "ApplicationReviews",
                        principalColumns: new[] { "Id", "ApplicationId", "SubmissionId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ScopeCommands",
                schema: "credit",
                columns: table => new
                {
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CommandId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ApplicationId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ScopeId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    Kind = table.Column<string>(type: "varchar(8)", unicode: false, maxLength: 8, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ResultHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ProtectedResult = table.Column<byte[]>(type: "varbinary(max)", maxLength: 65536, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ScopeCommands", x => new { x.ActorId, x.CommandId });
                    table.CheckConstraint("CK_CreditScopeCommand_Kind", "[Kind] IN ('Grant','Revoke')");
                    table.CheckConstraint("CK_CreditScopeCommand_Result", "DATALENGTH([ProtectedResult]) BETWEEN 1 AND 65536");
                    table.CheckConstraint("CK_CreditScopeCommand_Time", "DATEPART(TZOFFSET,[At])=0");
                    table.ForeignKey(
                        name: "FK_ScopeCommands_PurchaseScopes_ScopeId_ApplicationId",
                        columns: x => new { x.ScopeId, x.ApplicationId },
                        principalSchema: "credit",
                        principalTable: "PurchaseScopes",
                        principalColumns: new[] { "Id", "ApplicationId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ScopeRevocations",
                schema: "credit",
                columns: table => new
                {
                    ScopeId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ApplicationId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    ActorKind = table.Column<string>(type: "varchar(8)", unicode: false, maxLength: 8, nullable: false),
                    Locale = table.Column<string>(type: "varchar(2)", unicode: false, maxLength: 2, nullable: false),
                    ProtectedNote = table.Column<byte[]>(type: "varbinary(max)", maxLength: 16384, nullable: false),
                    NoteHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ScopeRevocations", x => x.ScopeId);
                    table.CheckConstraint("CK_CreditScopeRevocation_Actor", "[ActorKind] IN ('Owner','Staff')");
                    table.CheckConstraint("CK_CreditScopeRevocation_Locale", "[Locale] IN ('fa','en')");
                    table.CheckConstraint("CK_CreditScopeRevocation_Note", "DATALENGTH([ProtectedNote]) BETWEEN 1 AND 16384");
                    table.CheckConstraint("CK_CreditScopeRevocation_Time", "DATEPART(TZOFFSET,[At])=0");
                    table.ForeignKey(
                        name: "FK_ScopeRevocations_PurchaseScopes_ScopeId_ApplicationId",
                        columns: x => new { x.ScopeId, x.ApplicationId },
                        principalSchema: "credit",
                        principalTable: "PurchaseScopes",
                        principalColumns: new[] { "Id", "ApplicationId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Applications_CurrentPurchaseScopeId_Id_CurrentReviewId",
                schema: "credit",
                table: "Applications",
                columns: new[] { "CurrentPurchaseScopeId", "Id", "CurrentReviewId" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_CreditApplication_Scope",
                schema: "credit",
                table: "Applications",
                sql: "[CurrentPurchaseScopeId] IS NULL OR ([CurrentReviewId] IS NOT NULL AND [CurrentSubmissionId] IS NOT NULL AND [State]='Approved')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_CreditApplicationEvent_Action",
                schema: "credit",
                table: "ApplicationEvents",
                sql: "[Action] IN ('Created','Cancelled','Consented','DocumentAttached','Submitted','Withdrawn','Returned','Approved','Declined','ScopeGranted','ScopeRevoked')");

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseScopes_ReviewId",
                schema: "credit",
                table: "PurchaseScopes",
                column: "ReviewId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseScopes_ReviewId_ApplicationId_SubmissionId",
                schema: "credit",
                table: "PurchaseScopes",
                columns: new[] { "ReviewId", "ApplicationId", "SubmissionId" });

            migrationBuilder.CreateIndex(
                name: "IX_ScopeCommands_ScopeId_ApplicationId",
                schema: "credit",
                table: "ScopeCommands",
                columns: new[] { "ScopeId", "ApplicationId" });

            migrationBuilder.CreateIndex(
                name: "IX_ScopeRevocations_ScopeId_ApplicationId",
                schema: "credit",
                table: "ScopeRevocations",
                columns: new[] { "ScopeId", "ApplicationId" });

            migrationBuilder.AddForeignKey(
                name: "FK_Applications_PurchaseScopes_CurrentPurchaseScopeId_Id_CurrentReviewId",
                schema: "credit",
                table: "Applications",
                columns: new[] { "CurrentPurchaseScopeId", "Id", "CurrentReviewId" },
                principalSchema: "credit",
                principalTable: "PurchaseScopes",
                principalColumns: new[] { "Id", "ApplicationId", "ReviewId" },
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                IF EXISTS (SELECT 1 FROM [credit].[PurchaseScopes])
                   OR EXISTS (SELECT 1 FROM [credit].[ScopeRevocations])
                   OR EXISTS (SELECT 1 FROM [credit].[ScopeCommands])
                   OR EXISTS (SELECT 1 FROM [credit].[ApplicationReviews])
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
                    THROW 51000, 'Credit purchase scope, review, submission and consent history must be retained.', 1;
                """);

            migrationBuilder.DropForeignKey(
                name: "FK_Applications_PurchaseScopes_CurrentPurchaseScopeId_Id_CurrentReviewId",
                schema: "credit",
                table: "Applications");

            migrationBuilder.DropTable(
                name: "ScopeCommands",
                schema: "credit");

            migrationBuilder.DropTable(
                name: "ScopeRevocations",
                schema: "credit");

            migrationBuilder.DropTable(
                name: "PurchaseScopes",
                schema: "credit");

            migrationBuilder.DropIndex(
                name: "IX_Applications_CurrentPurchaseScopeId_Id_CurrentReviewId",
                schema: "credit",
                table: "Applications");

            migrationBuilder.DropCheckConstraint(
                name: "CK_CreditApplication_Scope",
                schema: "credit",
                table: "Applications");

            migrationBuilder.DropCheckConstraint(
                name: "CK_CreditApplicationEvent_Action",
                schema: "credit",
                table: "ApplicationEvents");

            migrationBuilder.DropColumn(
                name: "CurrentPurchaseScopeId",
                schema: "credit",
                table: "Applications");

            migrationBuilder.AddCheckConstraint(
                name: "CK_CreditApplicationEvent_Action",
                schema: "credit",
                table: "ApplicationEvents",
                sql: "[Action] IN ('Created','Cancelled','Consented','DocumentAttached','Submitted','Withdrawn','Returned','Approved','Declined')");
        }
    }
}
