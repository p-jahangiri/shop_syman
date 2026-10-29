using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Cms
{
    /// <inheritdoc />
    public partial class CmsPages : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "PageCommands",
                schema: "cms",
                columns: table => new
                {
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CommandId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    PageId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ResultJson = table.Column<string>(type: "nvarchar(2048)", maxLength: 2048, nullable: false),
                    ResultHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PageCommands", x => new { x.ActorId, x.CommandId });
                    table.CheckConstraint("CK_CmsPageCommand_Facts", "DATEPART(TZOFFSET,[At])=0 AND DATALENGTH([ResultJson]) BETWEEN 2 AND 4096");
                });

            migrationBuilder.CreateTable(
                name: "PageRevisions",
                schema: "cms",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    PageId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    Publication = table.Column<int>(type: "int", nullable: false),
                    Action = table.Column<string>(type: "varchar(16)", unicode: false, maxLength: 16, nullable: false),
                    BodyJson = table.Column<string>(type: "nvarchar(max)", maxLength: 65536, nullable: false),
                    BodyHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PageRevisions", x => x.Id);
                    table.UniqueConstraint("AK_PageRevisions_PageId_Id", x => new { x.PageId, x.Id });
                    table.CheckConstraint("CK_CmsPageRevision_Facts", "[Publication] BETWEEN 1 AND 10000 AND [Action] IN ('Publish','Restore','Unpublish') AND DATEPART(TZOFFSET,[At])=0 AND DATALENGTH([BodyJson]) BETWEEN 2 AND 131072");
                });

            migrationBuilder.CreateTable(
                name: "Pages",
                schema: "cms",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    Slug = table.Column<string>(type: "varchar(80)", unicode: false, maxLength: 80, nullable: false),
                    IsDemo = table.Column<bool>(type: "bit", nullable: false),
                    DraftJson = table.Column<string>(type: "nvarchar(max)", maxLength: 65536, nullable: false),
                    DraftHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    Publication = table.Column<int>(type: "int", nullable: false),
                    PublishedRevisionId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: true),
                    CreatedBy = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedBy = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Pages", x => x.Id);
                    table.CheckConstraint("CK_CmsPage_Facts", "[Publication] BETWEEN 0 AND 10000 AND DATEPART(TZOFFSET,[CreatedAt])=0 AND DATEPART(TZOFFSET,[UpdatedAt])=0 AND [UpdatedAt]>=[CreatedAt] AND DATALENGTH([DraftJson]) BETWEEN 2 AND 131072");
                    table.ForeignKey(
                        name: "FK_Pages_PageRevisions_Id_PublishedRevisionId",
                        columns: x => new { x.Id, x.PublishedRevisionId },
                        principalSchema: "cms",
                        principalTable: "PageRevisions",
                        principalColumns: new[] { "PageId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PageCommands_PageId",
                schema: "cms",
                table: "PageCommands",
                column: "PageId");

            migrationBuilder.CreateIndex(
                name: "IX_PageRevisions_PageId_Publication",
                schema: "cms",
                table: "PageRevisions",
                columns: new[] { "PageId", "Publication" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Pages_Id_PublishedRevisionId",
                schema: "cms",
                table: "Pages",
                columns: new[] { "Id", "PublishedRevisionId" });

            migrationBuilder.CreateIndex(
                name: "IX_Pages_Slug",
                schema: "cms",
                table: "Pages",
                column: "Slug",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_PageCommands_Pages_PageId",
                schema: "cms",
                table: "PageCommands",
                column: "PageId",
                principalSchema: "cms",
                principalTable: "Pages",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_PageRevisions_Pages_PageId",
                schema: "cms",
                table: "PageRevisions",
                column: "PageId",
                principalSchema: "cms",
                principalTable: "Pages",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS (SELECT 1 FROM [cms].[Pages]) OR EXISTS (SELECT 1 FROM [cms].[PageRevisions]) OR EXISTS (SELECT 1 FROM [cms].[PageCommands]) THROW 51000, 'CMS page history cannot be removed.', 1;");
            migrationBuilder.DropForeignKey(
                name: "FK_PageRevisions_Pages_PageId",
                schema: "cms",
                table: "PageRevisions");

            migrationBuilder.DropTable(
                name: "PageCommands",
                schema: "cms");

            migrationBuilder.DropTable(
                name: "Pages",
                schema: "cms");

            migrationBuilder.DropTable(
                name: "PageRevisions",
                schema: "cms");
        }
    }
}
