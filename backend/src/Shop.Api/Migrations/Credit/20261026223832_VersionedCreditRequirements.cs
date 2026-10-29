using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Credit
{
    /// <inheritdoc />
    public partial class VersionedCreditRequirements : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_CreditApplicationEvent_Action",
                schema: "credit",
                table: "ApplicationEvents");

            migrationBuilder.AddColumn<string>(
                name: "CurrentConsentId",
                schema: "credit",
                table: "Applications",
                type: "varchar(32)",
                unicode: false,
                maxLength: 32,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "RequirementsRevisions",
                schema: "credit",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    Sequence = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    TitleFa = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: false),
                    TitleEn = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: false),
                    TermsFa = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    TermsEn = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    ConsentLabelFa = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    ConsentLabelEn = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    Enabled = table.Column<bool>(type: "bit", nullable: false),
                    CreatedBy = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    SnapshotHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RequirementsRevisions", x => x.Id);
                    table.CheckConstraint("CK_CreditRequirementsRevision_Time", "DATEPART(TZOFFSET,[CreatedAt])=0");
                });

            migrationBuilder.CreateTable(
                name: "RequirementDocuments",
                schema: "credit",
                columns: table => new
                {
                    RevisionId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    Key = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    Position = table.Column<int>(type: "int", nullable: false),
                    NameFa = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    NameEn = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    HelpFa = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: false),
                    HelpEn = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: false),
                    Required = table.Column<bool>(type: "bit", nullable: false),
                    MaxBytes = table.Column<int>(type: "int", nullable: false),
                    ContentTypeMask = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RequirementDocuments", x => new { x.RevisionId, x.Key });
                    table.CheckConstraint("CK_CreditRequirementDocument_File", "[MaxBytes] BETWEEN 1 AND 8388608 AND [ContentTypeMask] BETWEEN 1 AND 15");
                    table.CheckConstraint("CK_CreditRequirementDocument_Position", "[Position] BETWEEN 0 AND 11");
                    table.ForeignKey(
                        name: "FK_RequirementDocuments_RequirementsRevisions_RevisionId",
                        column: x => x.RevisionId,
                        principalSchema: "credit",
                        principalTable: "RequirementsRevisions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "RequirementsConsents",
                schema: "credit",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ApplicationId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    RevisionId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Locale = table.Column<string>(type: "varchar(2)", unicode: false, maxLength: 2, nullable: false),
                    RequirementsHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    AcceptedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RequirementsConsents", x => x.Id);
                    table.UniqueConstraint("AK_RequirementsConsents_Id_ApplicationId", x => new { x.Id, x.ApplicationId });
                    table.CheckConstraint("CK_CreditRequirementsConsent_Locale", "[Locale] IN ('fa','en')");
                    table.CheckConstraint("CK_CreditRequirementsConsent_Time", "DATEPART(TZOFFSET,[AcceptedAt])=0");
                    table.ForeignKey(
                        name: "FK_RequirementsConsents_Applications_ApplicationId",
                        column: x => x.ApplicationId,
                        principalSchema: "credit",
                        principalTable: "Applications",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_RequirementsConsents_RequirementsRevisions_RevisionId",
                        column: x => x.RevisionId,
                        principalSchema: "credit",
                        principalTable: "RequirementsRevisions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "RequirementsHead",
                schema: "credit",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false),
                    PublishedRevisionId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ChangedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RequirementsHead", x => x.Id);
                    table.CheckConstraint("CK_CreditRequirementsHead_Only", "[Id]=1");
                    table.CheckConstraint("CK_CreditRequirementsHead_Time", "DATEPART(TZOFFSET,[ChangedAt])=0");
                    table.ForeignKey(
                        name: "FK_RequirementsHead_RequirementsRevisions_PublishedRevisionId",
                        column: x => x.PublishedRevisionId,
                        principalSchema: "credit",
                        principalTable: "RequirementsRevisions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "RequirementsPublishCommands",
                schema: "credit",
                columns: table => new
                {
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CommandId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    RevisionId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ResultHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ProtectedResult = table.Column<byte[]>(type: "varbinary(max)", maxLength: 65536, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RequirementsPublishCommands", x => new { x.ActorId, x.CommandId });
                    table.CheckConstraint("CK_CreditRequirementsPublishCommand_Result", "DATALENGTH([ProtectedResult]) BETWEEN 1 AND 65536");
                    table.CheckConstraint("CK_CreditRequirementsPublishCommand_Time", "DATEPART(TZOFFSET,[At])=0");
                    table.ForeignKey(
                        name: "FK_RequirementsPublishCommands_RequirementsRevisions_RevisionId",
                        column: x => x.RevisionId,
                        principalSchema: "credit",
                        principalTable: "RequirementsRevisions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "RequirementsConsentCommands",
                schema: "credit",
                columns: table => new
                {
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CommandId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ApplicationId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ConsentId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ResultHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ProtectedResult = table.Column<byte[]>(type: "varbinary(max)", maxLength: 65536, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RequirementsConsentCommands", x => new { x.ActorId, x.CommandId });
                    table.CheckConstraint("CK_CreditRequirementsConsentCommand_Result", "DATALENGTH([ProtectedResult]) BETWEEN 1 AND 65536");
                    table.CheckConstraint("CK_CreditRequirementsConsentCommand_Time", "DATEPART(TZOFFSET,[At])=0");
                    table.ForeignKey(
                        name: "FK_RequirementsConsentCommands_RequirementsConsents_ConsentId_ApplicationId",
                        columns: x => new { x.ConsentId, x.ApplicationId },
                        principalSchema: "credit",
                        principalTable: "RequirementsConsents",
                        principalColumns: new[] { "Id", "ApplicationId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Applications_CurrentConsentId_Id",
                schema: "credit",
                table: "Applications",
                columns: new[] { "CurrentConsentId", "Id" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_CreditApplicationEvent_Action",
                schema: "credit",
                table: "ApplicationEvents",
                sql: "[Action] IN ('Created','Cancelled','Consented')");

            migrationBuilder.CreateIndex(
                name: "IX_RequirementDocuments_RevisionId_Position",
                schema: "credit",
                table: "RequirementDocuments",
                columns: new[] { "RevisionId", "Position" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_RequirementsConsentCommands_ConsentId_ApplicationId",
                schema: "credit",
                table: "RequirementsConsentCommands",
                columns: new[] { "ConsentId", "ApplicationId" });

            migrationBuilder.CreateIndex(
                name: "IX_RequirementsConsents_ApplicationId_AcceptedAt",
                schema: "credit",
                table: "RequirementsConsents",
                columns: new[] { "ApplicationId", "AcceptedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_RequirementsConsents_RevisionId",
                schema: "credit",
                table: "RequirementsConsents",
                column: "RevisionId");

            migrationBuilder.CreateIndex(
                name: "IX_RequirementsHead_PublishedRevisionId",
                schema: "credit",
                table: "RequirementsHead",
                column: "PublishedRevisionId");

            migrationBuilder.CreateIndex(
                name: "IX_RequirementsPublishCommands_RevisionId",
                schema: "credit",
                table: "RequirementsPublishCommands",
                column: "RevisionId");

            migrationBuilder.CreateIndex(
                name: "IX_RequirementsRevisions_Sequence",
                schema: "credit",
                table: "RequirementsRevisions",
                column: "Sequence",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_Applications_RequirementsConsents_CurrentConsentId_Id",
                schema: "credit",
                table: "Applications",
                columns: new[] { "CurrentConsentId", "Id" },
                principalSchema: "credit",
                principalTable: "RequirementsConsents",
                principalColumns: new[] { "Id", "ApplicationId" },
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Reject before any schema change. An attempted downgrade below
            // draft applications must not partially remove this revision first.
            migrationBuilder.Sql("""
                IF EXISTS (SELECT 1 FROM [credit].[Applications])
                   OR EXISTS (SELECT 1 FROM [credit].[ApplicationEvents])
                   OR EXISTS (SELECT 1 FROM [credit].[ApplicationCommands])
                   OR EXISTS (SELECT 1 FROM [credit].[RequirementsHead])
                   OR EXISTS (SELECT 1 FROM [credit].[RequirementsRevisions])
                   OR EXISTS (SELECT 1 FROM [credit].[RequirementDocuments])
                   OR EXISTS (SELECT 1 FROM [credit].[RequirementsPublishCommands])
                   OR EXISTS (SELECT 1 FROM [credit].[RequirementsConsents])
                   OR EXISTS (SELECT 1 FROM [credit].[RequirementsConsentCommands])
                    THROW 51000, 'Credit requirements, applications and consent history must be retained.', 1;
                """);

            migrationBuilder.DropForeignKey(
                name: "FK_Applications_RequirementsConsents_CurrentConsentId_Id",
                schema: "credit",
                table: "Applications");

            migrationBuilder.DropTable(
                name: "RequirementDocuments",
                schema: "credit");

            migrationBuilder.DropTable(
                name: "RequirementsConsentCommands",
                schema: "credit");

            migrationBuilder.DropTable(
                name: "RequirementsHead",
                schema: "credit");

            migrationBuilder.DropTable(
                name: "RequirementsPublishCommands",
                schema: "credit");

            migrationBuilder.DropTable(
                name: "RequirementsConsents",
                schema: "credit");

            migrationBuilder.DropTable(
                name: "RequirementsRevisions",
                schema: "credit");

            migrationBuilder.DropIndex(
                name: "IX_Applications_CurrentConsentId_Id",
                schema: "credit",
                table: "Applications");

            migrationBuilder.DropCheckConstraint(
                name: "CK_CreditApplicationEvent_Action",
                schema: "credit",
                table: "ApplicationEvents");

            migrationBuilder.DropColumn(
                name: "CurrentConsentId",
                schema: "credit",
                table: "Applications");

            migrationBuilder.AddCheckConstraint(
                name: "CK_CreditApplicationEvent_Action",
                schema: "credit",
                table: "ApplicationEvents",
                sql: "[Action] IN ('Created','Cancelled')");
        }
    }
}
