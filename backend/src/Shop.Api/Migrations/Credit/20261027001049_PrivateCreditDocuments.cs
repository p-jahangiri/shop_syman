using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Credit
{
    /// <inheritdoc />
    public partial class PrivateCreditDocuments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_CreditApplicationEvent_Action",
                schema: "credit",
                table: "ApplicationEvents");

            migrationBuilder.AddUniqueConstraint(
                name: "AK_RequirementsConsents_Id_ApplicationId_RevisionId",
                schema: "credit",
                table: "RequirementsConsents",
                columns: new[] { "Id", "ApplicationId", "RevisionId" });

            migrationBuilder.CreateTable(
                name: "DocumentAttachments",
                schema: "credit",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    Sequence = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ApplicationId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ConsentId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    RequirementsRevisionId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    DocumentKey = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ReplacesFileId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: true),
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DocumentAttachments", x => x.Id);
                    table.UniqueConstraint("AK_DocumentAttachments_Id_ApplicationId", x => new { x.Id, x.ApplicationId });
                    table.UniqueConstraint("AK_DocumentAttachments_Id_ApplicationId_ConsentId_DocumentKey", x => new { x.Id, x.ApplicationId, x.ConsentId, x.DocumentKey });
                    table.CheckConstraint("CK_CreditDocument_Time", "DATEPART(TZOFFSET,[At])=0");
                    table.ForeignKey(
                        name: "FK_DocumentAttachments_DocumentAttachments_ReplacesFileId_ApplicationId_ConsentId_DocumentKey",
                        columns: x => new { x.ReplacesFileId, x.ApplicationId, x.ConsentId, x.DocumentKey },
                        principalSchema: "credit",
                        principalTable: "DocumentAttachments",
                        principalColumns: new[] { "Id", "ApplicationId", "ConsentId", "DocumentKey" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_DocumentAttachments_RequirementDocuments_RequirementsRevisionId_DocumentKey",
                        columns: x => new { x.RequirementsRevisionId, x.DocumentKey },
                        principalSchema: "credit",
                        principalTable: "RequirementDocuments",
                        principalColumns: new[] { "RevisionId", "Key" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_DocumentAttachments_RequirementsConsents_ConsentId_ApplicationId_RequirementsRevisionId",
                        columns: x => new { x.ConsentId, x.ApplicationId, x.RequirementsRevisionId },
                        principalSchema: "credit",
                        principalTable: "RequirementsConsents",
                        principalColumns: new[] { "Id", "ApplicationId", "RevisionId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "DocumentCommands",
                schema: "credit",
                columns: table => new
                {
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CommandId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ApplicationId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    FileId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ResultHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ProtectedResult = table.Column<byte[]>(type: "varbinary(max)", maxLength: 65536, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DocumentCommands", x => new { x.ActorId, x.CommandId });
                    table.CheckConstraint("CK_CreditDocumentCommand_Result", "DATALENGTH([ProtectedResult]) BETWEEN 1 AND 65536");
                    table.CheckConstraint("CK_CreditDocumentCommand_Time", "DATEPART(TZOFFSET,[At])=0");
                    table.ForeignKey(
                        name: "FK_DocumentCommands_Applications_ApplicationId",
                        column: x => x.ApplicationId,
                        principalSchema: "credit",
                        principalTable: "Applications",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_DocumentCommands_DocumentAttachments_FileId_ApplicationId",
                        columns: x => new { x.FileId, x.ApplicationId },
                        principalSchema: "credit",
                        principalTable: "DocumentAttachments",
                        principalColumns: new[] { "Id", "ApplicationId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_CreditApplicationEvent_Action",
                schema: "credit",
                table: "ApplicationEvents",
                sql: "[Action] IN ('Created','Cancelled','Consented','DocumentAttached')");

            migrationBuilder.CreateIndex(
                name: "IX_DocumentAttachments_ApplicationId_ConsentId_DocumentKey_Sequence",
                schema: "credit",
                table: "DocumentAttachments",
                columns: new[] { "ApplicationId", "ConsentId", "DocumentKey", "Sequence" });

            migrationBuilder.CreateIndex(
                name: "IX_DocumentAttachments_ConsentId_ApplicationId_RequirementsRevisionId",
                schema: "credit",
                table: "DocumentAttachments",
                columns: new[] { "ConsentId", "ApplicationId", "RequirementsRevisionId" });

            migrationBuilder.CreateIndex(
                name: "IX_DocumentAttachments_ReplacesFileId_ApplicationId_ConsentId_DocumentKey",
                schema: "credit",
                table: "DocumentAttachments",
                columns: new[] { "ReplacesFileId", "ApplicationId", "ConsentId", "DocumentKey" });

            migrationBuilder.CreateIndex(
                name: "IX_DocumentAttachments_RequirementsRevisionId_DocumentKey",
                schema: "credit",
                table: "DocumentAttachments",
                columns: new[] { "RequirementsRevisionId", "DocumentKey" });

            migrationBuilder.CreateIndex(
                name: "IX_DocumentAttachments_Sequence",
                schema: "credit",
                table: "DocumentAttachments",
                column: "Sequence",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_DocumentCommands_ApplicationId",
                schema: "credit",
                table: "DocumentCommands",
                column: "ApplicationId");

            migrationBuilder.CreateIndex(
                name: "IX_DocumentCommands_FileId_ApplicationId",
                schema: "credit",
                table: "DocumentCommands",
                columns: new[] { "FileId", "ApplicationId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Refuse before dropping anything, including when a caller asks
            // to continue below the already guarded prior credit migrations.
            migrationBuilder.Sql("""
                IF EXISTS (SELECT 1 FROM [credit].[DocumentAttachments])
                   OR EXISTS (SELECT 1 FROM [credit].[DocumentCommands])
                   OR EXISTS (SELECT 1 FROM [credit].[Applications])
                   OR EXISTS (SELECT 1 FROM [credit].[ApplicationEvents])
                   OR EXISTS (SELECT 1 FROM [credit].[ApplicationCommands])
                   OR EXISTS (SELECT 1 FROM [credit].[RequirementsHead])
                   OR EXISTS (SELECT 1 FROM [credit].[RequirementsRevisions])
                   OR EXISTS (SELECT 1 FROM [credit].[RequirementDocuments])
                   OR EXISTS (SELECT 1 FROM [credit].[RequirementsPublishCommands])
                   OR EXISTS (SELECT 1 FROM [credit].[RequirementsConsents])
                   OR EXISTS (SELECT 1 FROM [credit].[RequirementsConsentCommands])
                    THROW 51000, 'Private credit documents, consent and application history must be retained.', 1;
                """);

            migrationBuilder.DropTable(
                name: "DocumentCommands",
                schema: "credit");

            migrationBuilder.DropTable(
                name: "DocumentAttachments",
                schema: "credit");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_RequirementsConsents_Id_ApplicationId_RevisionId",
                schema: "credit",
                table: "RequirementsConsents");

            migrationBuilder.DropCheckConstraint(
                name: "CK_CreditApplicationEvent_Action",
                schema: "credit",
                table: "ApplicationEvents");

            migrationBuilder.AddCheckConstraint(
                name: "CK_CreditApplicationEvent_Action",
                schema: "credit",
                table: "ApplicationEvents",
                sql: "[Action] IN ('Created','Cancelled','Consented')");
        }
    }
}
