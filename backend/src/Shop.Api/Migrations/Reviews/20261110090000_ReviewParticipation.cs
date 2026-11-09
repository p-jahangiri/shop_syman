using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Reviews;

public partial class ReviewParticipation : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<bool>("IsWithdrawn", "Reviews", "bit", schema: "reviews", nullable: false, defaultValue: false);
        migrationBuilder.CreateTable(
            name: "Votes", schema: "reviews",
            columns: table => new
            {
                ReviewId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                RevisionId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                VoterId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                Value = table.Column<int>(type: "int", nullable: false),
                Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_Votes", x => new { x.ReviewId, x.RevisionId, x.VoterId });
                table.CheckConstraint("CK_Review_VoteValue", "[Value] IN (-1,0,1)");
                table.ForeignKey("FK_Votes_Revisions_ReviewId_RevisionId",
                    columns: x => new { x.ReviewId, x.RevisionId }, principalSchema: "reviews", principalTable: "Revisions", principalColumns: new[] { "ReviewId", "Id" },
                    onDelete: ReferentialAction.Restrict);
            });
        migrationBuilder.CreateIndex("IX_Votes_ReviewId_RevisionId_Value", "Votes", new[] { "ReviewId", "RevisionId", "Value" }, schema: "reviews");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("""
            IF EXISTS(SELECT 1 FROM [reviews].[Votes]) OR EXISTS(SELECT 1 FROM [reviews].[Events] WHERE [Action] = N'Withdrawn')
                THROW 51000, 'Review participation data prevents downgrade.', 1;
            """);
        migrationBuilder.DropTable("Votes", "reviews");
        migrationBuilder.DropColumn("IsWithdrawn", "Reviews", schema: "reviews");
    }
}
