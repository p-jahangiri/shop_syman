using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Sales
{
    /// <inheritdoc />
    public partial class CartAcceptedOffers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CartOfferCommandReceipts",
                schema: "sales",
                columns: table => new
                {
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Operation = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    CommandId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    AgreementId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    RequestId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    OfferId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ResultJson = table.Column<string>(type: "nvarchar(max)", maxLength: 32768, nullable: false),
                    ContainsDemo = table.Column<bool>(type: "bit", nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CartOfferCommandReceipts", x => new { x.ActorId, x.Operation, x.CommandId });
                    table.CheckConstraint("CK_CartOfferCommand_Operation", "([Operation]='convert' AND [RequestId] IS NOT NULL AND [OfferId] IS NOT NULL) OR ([Operation]='remove' AND [RequestId] IS NULL AND [OfferId] IS NULL)");
                    table.CheckConstraint("CK_CartOfferCommand_Result", "ISJSON([ResultJson])=1 AND DATALENGTH([ResultJson])<=65536");
                });

            migrationBuilder.CreateTable(
                name: "SourcingConversions",
                schema: "sales",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    RequestId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    TaskId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OfferId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    AcceptanceId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    AgreementId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    AllocationId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    CartId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    CartVersion = table.Column<string>(type: "nvarchar(12)", maxLength: 12, nullable: false),
                    CommandId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    LineLinksJson = table.Column<string>(type: "nvarchar(max)", maxLength: 16384, nullable: false),
                    ContainsDemo = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SourcingConversions", x => x.Id);
                    table.CheckConstraint("CK_SourcingConversion_Links", "ISJSON([LineLinksJson])=1 AND DATALENGTH([LineLinksJson])<=32768");
                });

            migrationBuilder.CreateTable(
                name: "CartOfferLines",
                schema: "sales",
                columns: table => new
                {
                    CartId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    AgreementLineId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    ConversionId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    AgreementId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    RequestId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    TaskId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OfferId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    AcceptanceId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    AllocationId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    AllocationVersion = table.Column<string>(type: "nvarchar(12)", maxLength: 12, nullable: false),
                    AllocationExpiresAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    OfferLineId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    VariantId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Quantity = table.Column<int>(type: "int", nullable: false),
                    ContainsDemo = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CartOfferLines", x => new { x.CartId, x.AgreementLineId });
                    table.CheckConstraint("CK_CartOfferLine_Quantity", "[Quantity] BETWEEN 1 AND 1000000");
                    table.ForeignKey(
                        name: "FK_CartOfferLines_Carts_CartId",
                        column: x => x.CartId,
                        principalSchema: "sales",
                        principalTable: "Carts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_CartOfferLines_SourcingConversions_ConversionId",
                        column: x => x.ConversionId,
                        principalSchema: "sales",
                        principalTable: "SourcingConversions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CartOfferLines_SourcingPriceAgreementLines_AgreementId_AgreementLineId",
                        columns: x => new { x.AgreementId, x.AgreementLineId },
                        principalSchema: "sales",
                        principalTable: "SourcingPriceAgreementLines",
                        principalColumns: new[] { "AgreementId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CartOfferLines_AgreementId",
                schema: "sales",
                table: "CartOfferLines",
                column: "AgreementId");

            migrationBuilder.CreateIndex(
                name: "IX_CartOfferLines_AgreementId_AgreementLineId",
                schema: "sales",
                table: "CartOfferLines",
                columns: new[] { "AgreementId", "AgreementLineId" });

            migrationBuilder.CreateIndex(
                name: "IX_CartOfferLines_CartId_Id",
                schema: "sales",
                table: "CartOfferLines",
                columns: new[] { "CartId", "Id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CartOfferLines_ConversionId",
                schema: "sales",
                table: "CartOfferLines",
                column: "ConversionId");

            migrationBuilder.CreateIndex(
                name: "IX_SourcingConversions_AcceptanceId",
                schema: "sales",
                table: "SourcingConversions",
                column: "AcceptanceId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SourcingConversions_OwnerId_Id",
                schema: "sales",
                table: "SourcingConversions",
                columns: new[] { "OwnerId", "Id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Historical receipts/conversions must survive even after the
            // customer explicitly removes every accepted group from the cart.
            migrationBuilder.Sql("""
                IF EXISTS (SELECT 1 FROM [sales].[CartOfferLines])
                   OR EXISTS (SELECT 1 FROM [sales].[SourcingConversions])
                   OR EXISTS (SELECT 1 FROM [sales].[CartOfferCommandReceipts])
                    THROW 51000, 'Cart2 history exists. Restore an approved backup instead of dropping conversion history.', 1;
                """);
            migrationBuilder.DropTable(
                name: "CartOfferCommandReceipts",
                schema: "sales");

            migrationBuilder.DropTable(
                name: "CartOfferLines",
                schema: "sales");

            migrationBuilder.DropTable(
                name: "SourcingConversions",
                schema: "sales");
        }
    }
}
