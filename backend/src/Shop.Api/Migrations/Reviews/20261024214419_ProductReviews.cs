using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Reviews
{
    /// <inheritdoc />
    public partial class ProductReviews : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "reviews");

            migrationBuilder.CreateTable(
                name: "Commands",
                schema: "reviews",
                columns: table => new
                {
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CommandId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ResultJson = table.Column<string>(type: "nvarchar(max)", maxLength: 16000, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Commands", x => new { x.ActorId, x.CommandId });
                    table.CheckConstraint("CK_Review_CommandJson", "ISJSON([ResultJson])=1");
                });

            migrationBuilder.CreateTable(
                name: "Reviews",
                schema: "reviews",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Sequence = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ProductId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    State = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    CurrentRevisionId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Reply = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ChangedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Reviews", x => x.Id);
                    table.CheckConstraint("CK_Review_State", "[State] IN ('Pending','Approved','Rejected','Hidden')");
                });

            migrationBuilder.CreateTable(
                name: "Events",
                schema: "reviews",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ReviewId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    RevisionId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Action = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    Reason = table.Column<string>(type: "nvarchar(400)", maxLength: 400, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Events", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Events_Reviews_ReviewId",
                        column: x => x.ReviewId,
                        principalSchema: "reviews",
                        principalTable: "Reviews",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Revisions",
                schema: "reviews",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    ReviewId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Locale = table.Column<string>(type: "nvarchar(2)", maxLength: 2, nullable: false),
                    Rating = table.Column<int>(type: "int", nullable: false),
                    DisplayName = table.Column<string>(type: "nvarchar(60)", maxLength: 60, nullable: false),
                    Title = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    Body = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Revisions", x => x.Id);
                    table.UniqueConstraint("AK_Revisions_ReviewId_Id", x => new { x.ReviewId, x.Id });
                    table.CheckConstraint("CK_Review_Locale", "[Locale] IN ('fa','en')");
                    table.CheckConstraint("CK_Review_Rating", "[Rating] BETWEEN 1 AND 5");
                    table.ForeignKey(
                        name: "FK_Revisions_Reviews_ReviewId",
                        column: x => x.ReviewId,
                        principalSchema: "reviews",
                        principalTable: "Reviews",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Reports",
                schema: "reviews",
                columns: table => new
                {
                    ReviewId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    RevisionId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Reason = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Reports", x => new { x.ReviewId, x.RevisionId, x.OwnerId });
                    table.CheckConstraint("CK_Review_ReportReason", "[Reason] IN ('spam','abuse','personal_data','unrelated')");
                    table.ForeignKey(
                        name: "FK_Reports_Revisions_ReviewId_RevisionId",
                        columns: x => new { x.ReviewId, x.RevisionId },
                        principalSchema: "reviews",
                        principalTable: "Revisions",
                        principalColumns: new[] { "ReviewId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Events_ReviewId_Id",
                schema: "reviews",
                table: "Events",
                columns: new[] { "ReviewId", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_Reviews_OwnerId_ProductId",
                schema: "reviews",
                table: "Reviews",
                columns: new[] { "OwnerId", "ProductId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Reviews_ProductId_State_Sequence",
                schema: "reviews",
                table: "Reviews",
                columns: new[] { "ProductId", "State", "Sequence" });

            migrationBuilder.CreateIndex(
                name: "IX_Reviews_Sequence",
                schema: "reviews",
                table: "Reviews",
                column: "Sequence",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Reviews_State_Sequence",
                schema: "reviews",
                table: "Reviews",
                columns: new[] { "State", "Sequence" });

            migrationBuilder.CreateIndex(
                name: "IX_Revisions_ReviewId_Id",
                schema: "reviews",
                table: "Revisions",
                columns: new[] { "ReviewId", "Id" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS (SELECT 1 FROM [reviews].[Reviews]) OR EXISTS (SELECT 1 FROM [reviews].[Commands]) THROW 51000, 'Review history must be preserved; automatic downgrade refused.', 1;");
            migrationBuilder.DropTable(
                name: "Commands",
                schema: "reviews");

            migrationBuilder.DropTable(
                name: "Events",
                schema: "reviews");

            migrationBuilder.DropTable(
                name: "Reports",
                schema: "reviews");

            migrationBuilder.DropTable(
                name: "Revisions",
                schema: "reviews");

            migrationBuilder.DropTable(
                name: "Reviews",
                schema: "reviews");
        }
    }
}
