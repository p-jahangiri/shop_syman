using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Market
{
    /// <inheritdoc />
    public partial class MarketMultipleSources : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "SourceCommands",
                schema: "market",
                columns: table => new
                {
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    RequestId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ResultJson = table.Column<string>(type: "nvarchar(max)", maxLength: 16000, nullable: false),
                    ContainsDemo = table.Column<bool>(type: "bit", nullable: false),
                    RecordedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SourceCommands", x => new { x.ActorId, x.RequestId });
                    table.CheckConstraint("CK_MarketSourceCommand_Json", "ISJSON([ResultJson])=1 AND DATALENGTH([ResultJson])<=32000");
                });

            migrationBuilder.CreateTable(
                name: "SourceObservations",
                schema: "market",
                columns: table => new
                {
                    Sequence = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ListingId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    SourceId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    IsPrimary = table.Column<bool>(type: "bit", nullable: false),
                    Origin = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    RecordedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
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
                    IsDemo = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SourceObservations", x => x.Sequence);
                    table.CheckConstraint("CK_MarketObservation_Availability", "[Availability] IN ('unknown','available','unavailable')");
                    table.CheckConstraint("CK_MarketObservation_Origin", "[Origin] IN ('recorded','migrationBaseline')");
                    table.CheckConstraint("CK_MarketObservation_Price", "[ReferencePriceRial] IS NULL OR [ReferencePriceRial]>0");
                    table.CheckConstraint("CK_MarketObservation_Primary", "([IsPrimary]=1 AND [SourceId]=[ListingId]) OR ([IsPrimary]=0 AND [SourceId]<>[ListingId])");
                    table.CheckConstraint("CK_MarketObservation_Status", "[Status] IN ('Draft','Published','Hidden')");
                    table.CheckConstraint("CK_MarketObservation_Time", "([ObservedAt] IS NULL AND [ValidUntil] IS NULL AND [Availability]='unknown' AND [ReferencePriceRial] IS NULL) OR ([ObservedAt] IS NOT NULL AND [ValidUntil] IS NOT NULL AND [ValidUntil]>[ObservedAt] AND [ObservedAt]<=[RecordedAt])");
                    table.ForeignKey(
                        name: "FK_SourceObservations_Listings_ListingId",
                        column: x => x.ListingId,
                        principalSchema: "market",
                        principalTable: "Listings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Sources",
                schema: "market",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    ListingId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
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
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Sources", x => x.Id);
                    table.CheckConstraint("CK_MarketSource_Availability", "[Availability] IN ('unknown','available','unavailable')");
                    table.CheckConstraint("CK_MarketSource_Id", "[Id]<>[ListingId]");
                    table.CheckConstraint("CK_MarketSource_Observation", "([ObservedAt] IS NULL AND [ValidUntil] IS NULL AND [Availability]='unknown' AND [ReferencePriceRial] IS NULL) OR ([ObservedAt] IS NOT NULL AND [ValidUntil] IS NOT NULL AND [ValidUntil]>[ObservedAt])");
                    table.CheckConstraint("CK_MarketSource_Price", "[ReferencePriceRial] IS NULL OR [ReferencePriceRial]>0");
                    table.CheckConstraint("CK_MarketSource_Status", "[Status] IN ('Draft','Published','Hidden')");
                    table.ForeignKey(
                        name: "FK_Sources_Listings_ListingId",
                        column: x => x.ListingId,
                        principalSchema: "market",
                        principalTable: "Listings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SourceObservations_ListingId_SourceId_Sequence",
                schema: "market",
                table: "SourceObservations",
                columns: new[] { "ListingId", "SourceId", "Sequence" });

            migrationBuilder.CreateIndex(
                name: "IX_Sources_ListingId_Id",
                schema: "market",
                table: "Sources",
                columns: new[] { "ListingId", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_Sources_SourceKey_SourceItemKey",
                schema: "market",
                table: "Sources",
                columns: new[] { "SourceKey", "SourceItemKey" },
                unique: true);

            // One honest baseline of the state that exists at upgrade time.
            // UpdatedAt is not evidence of previous observations: do not turn
            // it into invented historical records or inferred source dates.
            migrationBuilder.Sql("""
                INSERT INTO [market].[SourceObservations]
                ([ListingId],[SourceId],[IsPrimary],[Origin],[RecordedAt],[Status],[SourceKey],[SourceItemKey],[SourceNameFa],[SourceNameEn],[SourceUrl],[Availability],[ObservedAt],[ValidUntil],[ReferencePriceRial],[IsDemo])
                SELECT [Id],[Id],1,N'migrationBaseline',TODATETIMEOFFSET(SYSUTCDATETIME(),'+00:00'),[Status],[SourceKey],[SourceItemKey],[SourceNameFa],[SourceNameEn],[SourceUrl],[Availability],[ObservedAt],[ValidUntil],[ReferencePriceRial],[IsDemo]
                FROM [market].[Listings];
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                IF EXISTS(SELECT 1 FROM [market].[Sources]) OR EXISTS(SELECT 1 FROM [market].[SourceObservations]) OR EXISTS(SELECT 1 FROM [market].[SourceCommands])
                    THROW 51000, 'Market source history or receipts exist. Preserve them; automatic downgrade would lose historical data.', 1;
                """);
            migrationBuilder.DropTable(
                name: "SourceCommands",
                schema: "market");

            migrationBuilder.DropTable(
                name: "SourceObservations",
                schema: "market");

            migrationBuilder.DropTable(
                name: "Sources",
                schema: "market");
        }
    }
}
