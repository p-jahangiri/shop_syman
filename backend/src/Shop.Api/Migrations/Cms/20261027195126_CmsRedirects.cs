using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Cms
{
    /// <inheritdoc />
    public partial class CmsRedirects : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "RedirectCommands",
                schema: "cms",
                columns: table => new
                {
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CommandId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    RedirectId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    SourcePath = table.Column<string>(type: "varchar(192)", unicode: false, maxLength: 192, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ResultJson = table.Column<string>(type: "nvarchar(max)", maxLength: 4096, nullable: false),
                    ResultHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RedirectCommands", x => new { x.ActorId, x.CommandId });
                    table.CheckConstraint("CK_CmsRedirectCommand_Facts", "DATEPART(TZOFFSET,[At])=0 AND DATALENGTH([ResultJson]) BETWEEN 2 AND 8192");
                });

            migrationBuilder.CreateTable(
                name: "RedirectRevisions",
                schema: "cms",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    RedirectId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    SourcePath = table.Column<string>(type: "varchar(192)", unicode: false, maxLength: 192, nullable: false),
                    Publication = table.Column<int>(type: "int", nullable: false),
                    Action = table.Column<string>(type: "varchar(16)", unicode: false, maxLength: 16, nullable: false),
                    TargetPath = table.Column<string>(type: "varchar(192)", unicode: false, maxLength: 192, nullable: false),
                    Status = table.Column<int>(type: "int", nullable: false),
                    FactsHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RedirectRevisions", x => x.Id);
                    table.UniqueConstraint("AK_RedirectRevisions_RedirectId_Id", x => new { x.RedirectId, x.Id });
                    table.CheckConstraint("CK_CmsRedirectRevision_Facts", "[Publication] BETWEEN 1 AND 10000 AND [Action] IN ('Publish','Restore','Unpublish') AND [Status] IN (301,302) AND DATEPART(TZOFFSET,[At])=0");
                });

            migrationBuilder.CreateTable(
                name: "Redirects",
                schema: "cms",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    SourcePath = table.Column<string>(type: "varchar(192)", unicode: false, maxLength: 192, nullable: false),
                    IsDemo = table.Column<bool>(type: "bit", nullable: false),
                    DraftTargetPath = table.Column<string>(type: "varchar(192)", unicode: false, maxLength: 192, nullable: true),
                    DraftStatus = table.Column<int>(type: "int", nullable: true),
                    PublishedRevisionId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: true),
                    Publication = table.Column<int>(type: "int", nullable: false),
                    CreatedBy = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedBy = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Redirects", x => x.Id);
                    table.UniqueConstraint("AK_Redirects_Id_SourcePath", x => new { x.Id, x.SourcePath });
                    table.CheckConstraint("CK_CmsRedirect_Facts", "[Publication] BETWEEN 0 AND 10000 AND ([DraftStatus] IS NULL OR [DraftStatus] IN (301,302)) AND DATEPART(TZOFFSET,[CreatedAt])=0 AND DATEPART(TZOFFSET,[UpdatedAt])=0 AND [UpdatedAt]>=[CreatedAt]");
                    table.ForeignKey(
                        name: "FK_Redirects_RedirectRevisions_Id_PublishedRevisionId",
                        columns: x => new { x.Id, x.PublishedRevisionId },
                        principalSchema: "cms",
                        principalTable: "RedirectRevisions",
                        principalColumns: new[] { "RedirectId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_RedirectCommands_RedirectId_SourcePath",
                schema: "cms",
                table: "RedirectCommands",
                columns: new[] { "RedirectId", "SourcePath" });

            migrationBuilder.CreateIndex(
                name: "IX_RedirectRevisions_RedirectId_Publication",
                schema: "cms",
                table: "RedirectRevisions",
                columns: new[] { "RedirectId", "Publication" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_RedirectRevisions_RedirectId_SourcePath",
                schema: "cms",
                table: "RedirectRevisions",
                columns: new[] { "RedirectId", "SourcePath" });

            migrationBuilder.CreateIndex(
                name: "IX_Redirects_Id_PublishedRevisionId",
                schema: "cms",
                table: "Redirects",
                columns: new[] { "Id", "PublishedRevisionId" });

            migrationBuilder.CreateIndex(
                name: "IX_Redirects_SourcePath",
                schema: "cms",
                table: "Redirects",
                column: "SourcePath",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_RedirectCommands_Redirects_RedirectId_SourcePath",
                schema: "cms",
                table: "RedirectCommands",
                columns: new[] { "RedirectId", "SourcePath" },
                principalSchema: "cms",
                principalTable: "Redirects",
                principalColumns: new[] { "Id", "SourcePath" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_RedirectRevisions_Redirects_RedirectId_SourcePath",
                schema: "cms",
                table: "RedirectRevisions",
                columns: new[] { "RedirectId", "SourcePath" },
                principalSchema: "cms",
                principalTable: "Redirects",
                principalColumns: new[] { "Id", "SourcePath" },
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS (SELECT 1 FROM [cms].[Redirects]) OR EXISTS (SELECT 1 FROM [cms].[RedirectRevisions]) OR EXISTS (SELECT 1 FROM [cms].[RedirectCommands]) THROW 51000, 'CMS redirect history cannot be removed.', 1;");
            migrationBuilder.DropForeignKey(
                name: "FK_RedirectRevisions_Redirects_RedirectId_SourcePath",
                schema: "cms",
                table: "RedirectRevisions");

            migrationBuilder.DropTable(
                name: "RedirectCommands",
                schema: "cms");

            migrationBuilder.DropTable(
                name: "Redirects",
                schema: "cms");

            migrationBuilder.DropTable(
                name: "RedirectRevisions",
                schema: "cms");
        }
    }
}
