using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Sales
{
    /// <inheritdoc />
    public partial class CheckoutQuotes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CheckoutQuotes",
                schema: "sales",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    ActorKey = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    RequestId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    CartId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    CartVersion = table.Column<string>(type: "nvarchar(12)", maxLength: 12, nullable: false),
                    PricingFingerprint = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ItemsSubtotalRial = table.Column<long>(type: "bigint", nullable: false),
                    MarkupRial = table.Column<long>(type: "bigint", nullable: false),
                    DownPaymentRial = table.Column<long>(type: "bigint", nullable: false),
                    GoodsTotalRial = table.Column<long>(type: "bigint", nullable: false),
                    ShippingRial = table.Column<long>(type: "bigint", nullable: true),
                    TaxRial = table.Column<long>(type: "bigint", nullable: true),
                    PayableTotalRial = table.Column<long>(type: "bigint", nullable: true),
                    ResponseJson = table.Column<string>(type: "nvarchar(max)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CheckoutQuotes", x => x.Id);
                    table.CheckConstraint("CK_Quote_Amounts", "[ItemsSubtotalRial]>=0 AND [MarkupRial]>=0 AND [DownPaymentRial]>=0 AND [DownPaymentRial]<=[ItemsSubtotalRial] AND [GoodsTotalRial]>=[ItemsSubtotalRial] AND ([ShippingRial] IS NULL OR [ShippingRial]>=0) AND ([TaxRial] IS NULL OR [TaxRial]>=0) AND ([PayableTotalRial] IS NULL OR [PayableTotalRial]>=0)");
                    table.CheckConstraint("CK_Quote_Expiry", "[ExpiresAt]>[CreatedAt]");
                    table.CheckConstraint("CK_Quote_Response", "ISJSON([ResponseJson])=1 AND DATALENGTH([ResponseJson])<=1048576");
                });

            migrationBuilder.CreateTable(
                name: "CheckoutQuoteInstallments",
                schema: "sales",
                columns: table => new
                {
                    QuoteId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Sequence = table.Column<int>(type: "int", nullable: false),
                    MonthOffset = table.Column<int>(type: "int", nullable: false),
                    AmountRial = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CheckoutQuoteInstallments", x => new { x.QuoteId, x.Sequence });
                    table.CheckConstraint("CK_QuoteCheque_Amount", "[Sequence] BETWEEN 1 AND 60 AND [MonthOffset] BETWEEN 1 AND 60 AND [AmountRial]>0");
                    table.ForeignKey(
                        name: "FK_CheckoutQuoteInstallments_CheckoutQuotes_QuoteId",
                        column: x => x.QuoteId,
                        principalSchema: "sales",
                        principalTable: "CheckoutQuotes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "CheckoutQuoteLines",
                schema: "sales",
                columns: table => new
                {
                    QuoteId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    VariantId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    ProductId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    SellerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CategoryId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Sku = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false),
                    Name = table.Column<string>(type: "nvarchar(250)", maxLength: 250, nullable: false),
                    Label = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Warranty = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    PriceVersion = table.Column<string>(type: "nvarchar(12)", maxLength: 12, nullable: false),
                    IsDigital = table.Column<bool>(type: "bit", nullable: false),
                    Quantity = table.Column<int>(type: "int", nullable: false),
                    UnitPriceRial = table.Column<long>(type: "bigint", nullable: false),
                    LineTotalRial = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CheckoutQuoteLines", x => new { x.QuoteId, x.VariantId });
                    table.CheckConstraint("CK_QuoteLine_Amount", "[Quantity] BETWEEN 1 AND 1000000 AND [UnitPriceRial]>=0 AND [LineTotalRial]>=0");
                    table.ForeignKey(
                        name: "FK_CheckoutQuoteLines_CheckoutQuotes_QuoteId",
                        column: x => x.QuoteId,
                        principalSchema: "sales",
                        principalTable: "CheckoutQuotes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CheckoutQuotes_ActorKey_RequestId",
                schema: "sales",
                table: "CheckoutQuotes",
                columns: new[] { "ActorKey", "RequestId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CheckoutQuotes_ExpiresAt",
                schema: "sales",
                table: "CheckoutQuotes",
                column: "ExpiresAt");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CheckoutQuoteInstallments",
                schema: "sales");

            migrationBuilder.DropTable(
                name: "CheckoutQuoteLines",
                schema: "sales");

            migrationBuilder.DropTable(
                name: "CheckoutQuotes",
                schema: "sales");
        }
    }
}
