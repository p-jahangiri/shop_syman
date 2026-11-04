using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Reviews;

public partial class ReviewPhotos : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "Photos",
            schema: "reviews",
            columns: table => new
            {
                Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                Webp = table.Column<byte[]>(type: "varbinary(max)", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_Photos", x => x.Id);
                table.CheckConstraint("CK_Review_PhotoBytes", "DATALENGTH([Webp]) BETWEEN 12 AND 2097152");
            });

        migrationBuilder.AddColumn<string>(
            name: "PhotoId",
            schema: "reviews",
            table: "Revisions",
            type: "nvarchar(32)",
            maxLength: 32,
            nullable: true);
        migrationBuilder.CreateIndex("IX_Revisions_PhotoId", "Revisions", "PhotoId", schema: "reviews");
        migrationBuilder.AddForeignKey(
            name: "FK_Revisions_Photos_PhotoId",
            schema: "reviews",
            table: "Revisions",
            column: "PhotoId",
            principalSchema: "reviews",
            principalTable: "Photos",
            principalColumn: "Id",
            onDelete: ReferentialAction.Restrict);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropForeignKey("FK_Revisions_Photos_PhotoId", "Revisions", schema: "reviews");
        migrationBuilder.DropIndex("IX_Revisions_PhotoId", "Revisions", schema: "reviews");
        migrationBuilder.DropColumn("PhotoId", "Revisions", schema: "reviews");
        migrationBuilder.DropTable("Photos", schema: "reviews");
    }
}
