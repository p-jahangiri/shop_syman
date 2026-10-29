using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Sales
{
    /// <inheritdoc />
    public partial class CheckoutQuotesV4 : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "ContractVersion",
                schema: "sales",
                table: "CheckoutQuotes",
                type: "int",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "CheckoutQuoteLinesV4",
                schema: "sales",
                columns: table => new
                {
                    QuoteId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    LineId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    LineKind = table.Column<string>(type: "varchar(16)", unicode: false, maxLength: 16, nullable: false),
                    VariantId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    ProductId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    SellerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CategoryId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Sku = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false),
                    Name = table.Column<string>(type: "nvarchar(250)", maxLength: 250, nullable: false),
                    Label = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Warranty = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    PriceVersion = table.Column<string>(type: "nvarchar(12)", maxLength: 12, nullable: true),
                    IsDigital = table.Column<bool>(type: "bit", nullable: false),
                    Quantity = table.Column<int>(type: "int", nullable: false),
                    UnitPriceRial = table.Column<long>(type: "bigint", nullable: false),
                    LineTotalRial = table.Column<long>(type: "bigint", nullable: false),
                    ConversionId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    AgreementId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    AgreementLineId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    RequestId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    TaskId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    OfferId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    AcceptanceId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    AllocationId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    OfferLineId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    TermsHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: true),
                    AgreementVersion = table.Column<string>(type: "nvarchar(12)", maxLength: 12, nullable: true),
                    AllocationVersion = table.Column<string>(type: "nvarchar(12)", maxLength: 12, nullable: true),
                    PurchaseUntil = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    AllocationExpiresAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CheckoutQuoteLinesV4", x => new { x.QuoteId, x.LineId });
                    table.CheckConstraint("CK_QuoteLineV4_Amount", "[Quantity] BETWEEN 1 AND 1000000 AND [UnitPriceRial]>=0 AND [LineTotalRial]>=0 AND CAST([LineTotalRial] AS decimal(38,0))=CAST([UnitPriceRial] AS decimal(38,0))*[Quantity]");
                    table.CheckConstraint("CK_QuoteLineV4_Identity", "LEN([QuoteId])=32 AND LEN([LineId])=32 AND LEN([VariantId]) BETWEEN 1 AND 64");
                    table.CheckConstraint("CK_QuoteLineV4_Provenance", "([LineKind]='ordinary' AND [PriceVersion] IS NOT NULL AND [ConversionId] IS NULL AND [AgreementId] IS NULL AND [AgreementLineId] IS NULL AND [RequestId] IS NULL AND [TaskId] IS NULL AND [OfferId] IS NULL AND [AcceptanceId] IS NULL AND [AllocationId] IS NULL AND [OfferLineId] IS NULL AND [TermsHash] IS NULL AND [AgreementVersion] IS NULL AND [AllocationVersion] IS NULL AND [PurchaseUntil] IS NULL AND [AllocationExpiresAt] IS NULL) OR ([LineKind]='acceptedOffer' AND [PriceVersion] IS NULL AND [IsDigital]=0 AND [ConversionId] IS NOT NULL AND [AgreementId] IS NOT NULL AND [AgreementLineId] IS NOT NULL AND [RequestId] IS NOT NULL AND [TaskId] IS NOT NULL AND [OfferId] IS NOT NULL AND [AcceptanceId] IS NOT NULL AND [AllocationId] IS NOT NULL AND [OfferLineId] IS NOT NULL AND [TermsHash] IS NOT NULL AND [AgreementVersion] IS NOT NULL AND [AllocationVersion] IS NOT NULL AND [PurchaseUntil] IS NOT NULL AND [AllocationExpiresAt] IS NOT NULL AND [AllocationExpiresAt]<=[PurchaseUntil])");
                    table.ForeignKey(
                        name: "FK_CheckoutQuoteLinesV4_CheckoutQuotes_QuoteId",
                        column: x => x.QuoteId,
                        principalSchema: "sales",
                        principalTable: "CheckoutQuotes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_Quote_ContractVersion",
                schema: "sales",
                table: "CheckoutQuotes",
                sql: "[ContractVersion] IS NULL OR [ContractVersion] IN (3,4)");

            migrationBuilder.CreateIndex(
                name: "IX_CheckoutQuoteLinesV4_QuoteId_AgreementId_AgreementLineId",
                schema: "sales",
                table: "CheckoutQuoteLinesV4",
                columns: new[] { "QuoteId", "AgreementId", "AgreementLineId" },
                unique: true,
                filter: "[AgreementId] IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Refuse to discard immutable V4 snapshots or their idempotency
            // history, including headers retained after line removal.
            migrationBuilder.Sql("""
                IF EXISTS (SELECT 1 FROM [sales].[CheckoutQuotes] WHERE [ContractVersion]=4)
                   OR EXISTS (SELECT 1 FROM [sales].[CheckoutQuoteLinesV4])
                    THROW 51000, 'Quote4 history exists; downgrade would discard retained checkout snapshots.', 1;
                """);
            migrationBuilder.DropTable(
                name: "CheckoutQuoteLinesV4",
                schema: "sales");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Quote_ContractVersion",
                schema: "sales",
                table: "CheckoutQuotes");

            migrationBuilder.DropColumn(
                name: "ContractVersion",
                schema: "sales",
                table: "CheckoutQuotes");
        }
    }
}
