using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Market
{
    /// <inheritdoc />
    public partial class MarketListings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "market");

            migrationBuilder.CreateTable(
                name: "Listings",
                schema: "market",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    ModelId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    SourceKey = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    SourceItemKey = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    SourceNameFa = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    SourceNameEn = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    SourceUrl = table.Column<string>(type: "nvarchar(1500)", maxLength: 1500, nullable: true),
                    Availability = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    ObservedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    ValidUntil = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    ReferencePriceRial = table.Column<long>(type: "bigint", nullable: true),
                    IsDemo = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Listings", x => x.Id);
                    table.CheckConstraint("CK_Market_Availability", "[Availability] IN ('unknown','available','unavailable')");
                    table.CheckConstraint("CK_Market_Observation", "([ObservedAt] IS NULL AND [ValidUntil] IS NULL AND [Availability]='unknown' AND [ReferencePriceRial] IS NULL) OR ([ObservedAt] IS NOT NULL AND [ValidUntil] IS NOT NULL AND [ValidUntil]>[ObservedAt])");
                    table.CheckConstraint("CK_Market_Price", "[ReferencePriceRial] IS NULL OR [ReferencePriceRial]>0");
                    table.CheckConstraint("CK_Market_Status", "[Status] IN ('Draft','Published','Hidden')");
                });

            migrationBuilder.CreateIndex(
                name: "IX_Listings_ModelId",
                schema: "market",
                table: "Listings",
                column: "ModelId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Listings_SourceKey_SourceItemKey",
                schema: "market",
                table: "Listings",
                columns: new[] { "SourceKey", "SourceItemKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Listings_Status_Id",
                schema: "market",
                table: "Listings",
                columns: new[] { "Status", "Id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Listings",
                schema: "market");
        }
    }
}
