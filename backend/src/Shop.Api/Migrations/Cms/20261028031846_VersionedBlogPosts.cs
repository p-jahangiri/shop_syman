using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Cms
{
    /// <inheritdoc />
    public partial class VersionedBlogPosts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "BlogPostCommands",
                schema: "cms",
                columns: table => new
                {
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CommandId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    PostId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ResultJson = table.Column<string>(type: "nvarchar(2048)", maxLength: 2048, nullable: false),
                    ResultHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BlogPostCommands", x => new { x.ActorId, x.CommandId });
                    table.CheckConstraint("CK_CmsBlogPostCommand_Facts", "DATEPART(TZOFFSET,[At])=0 AND DATALENGTH([ResultJson]) BETWEEN 2 AND 4096");
                });

            migrationBuilder.CreateTable(
                name: "BlogPostRevisions",
                schema: "cms",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    PostId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    Publication = table.Column<int>(type: "int", nullable: false),
                    Action = table.Column<string>(type: "varchar(16)", unicode: false, maxLength: 16, nullable: false),
                    BodyJson = table.Column<string>(type: "nvarchar(max)", maxLength: 65536, nullable: false),
                    BodyHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BlogPostRevisions", x => x.Id);
                    table.UniqueConstraint("AK_BlogPostRevisions_PostId_Id", x => new { x.PostId, x.Id });
                    table.CheckConstraint("CK_CmsBlogPostRevision_Facts", "[Publication] BETWEEN 1 AND 10000 AND [Action] IN ('Publish','Restore','Unpublish') AND DATEPART(TZOFFSET,[At])=0 AND DATALENGTH([BodyJson]) BETWEEN 2 AND 131072");
                });

            migrationBuilder.CreateTable(
                name: "BlogPosts",
                schema: "cms",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    Slug = table.Column<string>(type: "varchar(80)", unicode: false, maxLength: 80, nullable: false, collation: "Latin1_General_100_BIN2"),
                    IsDemo = table.Column<bool>(type: "bit", nullable: false),
                    DraftJson = table.Column<string>(type: "nvarchar(max)", maxLength: 65536, nullable: false),
                    DraftHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    Publication = table.Column<int>(type: "int", nullable: false),
                    FirstPublishedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    PublishedRevisionId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: true),
                    CreatedBy = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedBy = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BlogPosts", x => x.Id);
                    table.CheckConstraint("CK_CmsBlogPost_Facts", "[Publication] BETWEEN 0 AND 10000 AND (([Publication]=0 AND [FirstPublishedAt] IS NULL) OR ([Publication]>0 AND [FirstPublishedAt] IS NOT NULL)) AND DATEPART(TZOFFSET,[CreatedAt])=0 AND DATEPART(TZOFFSET,[UpdatedAt])=0 AND [UpdatedAt]>=[CreatedAt] AND DATALENGTH([DraftJson]) BETWEEN 2 AND 131072 AND ([FirstPublishedAt] IS NULL OR ([FirstPublishedAt]>=[CreatedAt] AND [FirstPublishedAt]<=[UpdatedAt] AND DATEPART(TZOFFSET,[FirstPublishedAt])=0))");
                    table.ForeignKey(
                        name: "FK_BlogPosts_BlogPostRevisions_Id_PublishedRevisionId",
                        columns: x => new { x.Id, x.PublishedRevisionId },
                        principalSchema: "cms",
                        principalTable: "BlogPostRevisions",
                        principalColumns: new[] { "PostId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "BlogRevisionTags",
                schema: "cms",
                columns: table => new
                {
                    RevisionId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    Slug = table.Column<string>(type: "varchar(80)", unicode: false, maxLength: 80, nullable: false, collation: "Latin1_General_100_BIN2"),
                    NameFa = table.Column<string>(type: "nvarchar(60)", maxLength: 60, nullable: false),
                    NameEn = table.Column<string>(type: "nvarchar(60)", maxLength: 60, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BlogRevisionTags", x => new { x.RevisionId, x.Slug });
                    table.ForeignKey(
                        name: "FK_BlogRevisionTags_BlogPostRevisions_RevisionId",
                        column: x => x.RevisionId,
                        principalSchema: "cms",
                        principalTable: "BlogPostRevisions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_BlogPostCommands_PostId",
                schema: "cms",
                table: "BlogPostCommands",
                column: "PostId");

            migrationBuilder.CreateIndex(
                name: "IX_BlogPostRevisions_PostId_Publication",
                schema: "cms",
                table: "BlogPostRevisions",
                columns: new[] { "PostId", "Publication" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BlogPosts_FirstPublishedAt_Id",
                schema: "cms",
                table: "BlogPosts",
                columns: new[] { "FirstPublishedAt", "Id" },
                descending: new bool[0]);

            migrationBuilder.CreateIndex(
                name: "IX_BlogPosts_Id_PublishedRevisionId",
                schema: "cms",
                table: "BlogPosts",
                columns: new[] { "Id", "PublishedRevisionId" });

            migrationBuilder.CreateIndex(
                name: "IX_BlogPosts_Slug",
                schema: "cms",
                table: "BlogPosts",
                column: "Slug",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BlogRevisionTags_Slug_RevisionId",
                schema: "cms",
                table: "BlogRevisionTags",
                columns: new[] { "Slug", "RevisionId" });

            migrationBuilder.AddForeignKey(
                name: "FK_BlogPostCommands_BlogPosts_PostId",
                schema: "cms",
                table: "BlogPostCommands",
                column: "PostId",
                principalSchema: "cms",
                principalTable: "BlogPosts",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_BlogPostRevisions_BlogPosts_PostId",
                schema: "cms",
                table: "BlogPostRevisions",
                column: "PostId",
                principalSchema: "cms",
                principalTable: "BlogPosts",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS(SELECT 1 FROM [cms].[BlogPosts]) OR EXISTS(SELECT 1 FROM [cms].[BlogPostRevisions]) OR EXISTS(SELECT 1 FROM [cms].[BlogPostCommands]) OR EXISTS(SELECT 1 FROM [cms].[BlogRevisionTags]) THROW 51000, 'Retained blog history cannot be removed.', 1;");
            migrationBuilder.DropForeignKey(
                name: "FK_BlogPostRevisions_BlogPosts_PostId",
                schema: "cms",
                table: "BlogPostRevisions");

            migrationBuilder.DropTable(
                name: "BlogPostCommands",
                schema: "cms");

            migrationBuilder.DropTable(
                name: "BlogRevisionTags",
                schema: "cms");

            migrationBuilder.DropTable(
                name: "BlogPosts",
                schema: "cms");

            migrationBuilder.DropTable(
                name: "BlogPostRevisions",
                schema: "cms");
        }
    }
}
