using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Reviews;

public partial class ReviewAlbum : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        foreach (var column in new[] { "Photo2Id", "Photo3Id" })
        {
            migrationBuilder.AddColumn<string>(column, "Revisions", "nvarchar(32)", maxLength: 32, schema: "reviews", nullable: true);
            migrationBuilder.CreateIndex($"IX_Revisions_{column}", "Revisions", column, schema: "reviews");
            migrationBuilder.AddForeignKey($"FK_Revisions_Photos_{column}", "Revisions", column, "Photos",
                schema: "reviews", principalSchema: "reviews", principalColumn: "Id", onDelete: ReferentialAction.Restrict);
        }
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("""
            IF EXISTS(SELECT 1 FROM [reviews].[Revisions] WHERE [Photo2Id] IS NOT NULL OR [Photo3Id] IS NOT NULL)
                THROW 51000, 'Review album data prevents downgrade.', 1;
            """);
        foreach (var column in new[] { "Photo3Id", "Photo2Id" })
        {
            migrationBuilder.DropForeignKey($"FK_Revisions_Photos_{column}", "Revisions", schema: "reviews");
            migrationBuilder.DropIndex($"IX_Revisions_{column}", "Revisions", schema: "reviews");
            migrationBuilder.DropColumn(column, "Revisions", schema: "reviews");
        }
    }
}
