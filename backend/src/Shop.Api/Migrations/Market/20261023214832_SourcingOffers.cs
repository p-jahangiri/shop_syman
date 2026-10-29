using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Market
{
    /// <inheritdoc />
    public partial class SourcingOffers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "SourcingOfferCommandReceipts",
                schema: "market",
                columns: table => new
                {
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Operation = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    CommandId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    RequestId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OfferId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ResultJson = table.Column<string>(type: "nvarchar(max)", maxLength: 8192, nullable: false),
                    ContainsDemo = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SourcingOfferCommandReceipts", x => new { x.ActorId, x.Operation, x.CommandId });
                    table.CheckConstraint("CK_SourcingOfferReceipt_Operation", "[Operation] IN ('save','publish','withdraw','accept','decline')");
                    table.CheckConstraint("CK_SourcingOfferReceipt_Result", "ISJSON([ResultJson])=1 AND DATALENGTH([ResultJson])<=16384");
                });

            migrationBuilder.CreateTable(
                name: "SourcingOffers",
                schema: "market",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    RequestId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Revision = table.Column<int>(type: "int", nullable: false),
                    State = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false),
                    ContainsDemo = table.Column<bool>(type: "bit", nullable: false),
                    TermsFa = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    TermsEn = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    TermsHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    TotalRial = table.Column<long>(type: "bigint", nullable: false),
                    AcceptUntil = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    PurchaseUntil = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ExpectedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ChangedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    PublishedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    AcceptedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    AcceptanceId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SourcingOffers", x => x.Id);
                    table.CheckConstraint("CK_SourcingOffer_Acceptance", "([State]='Accepted' AND [AcceptedAt] IS NOT NULL AND [AcceptanceId] IS NOT NULL) OR ([State]<>'Accepted' AND [AcceptedAt] IS NULL AND [AcceptanceId] IS NULL)");
                    table.CheckConstraint("CK_SourcingOffer_Active", "[IsActive]=0 OR ([State] IN ('Published','Accepted') AND [PublishedAt] IS NOT NULL)");
                    table.CheckConstraint("CK_SourcingOffer_Amounts", "[TotalRial]>=0 AND [Revision]>=1");
                    table.CheckConstraint("CK_SourcingOffer_Dates", "[ChangedAt]>=[CreatedAt] AND [PurchaseUntil]>=[AcceptUntil]");
                    table.CheckConstraint("CK_SourcingOffer_State", "[State] IN ('Draft','Published','Accepted','Declined','Withdrawn','Superseded')");
                    table.ForeignKey(
                        name: "FK_SourcingOffers_SourcingRequests_RequestId",
                        column: x => x.RequestId,
                        principalSchema: "market",
                        principalTable: "SourcingRequests",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SourcingOfferAcceptances",
                schema: "market",
                columns: table => new
                {
                    OfferId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    TermsHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    OfferVersion = table.Column<string>(type: "nvarchar(12)", maxLength: 12, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SourcingOfferAcceptances", x => x.OfferId);
                    table.ForeignKey(
                        name: "FK_SourcingOfferAcceptances_SourcingOffers_OfferId",
                        column: x => x.OfferId,
                        principalSchema: "market",
                        principalTable: "SourcingOffers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SourcingOfferEvents",
                schema: "market",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    OfferId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Revision = table.Column<int>(type: "int", nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    ActorKind = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    StateBefore = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: true),
                    StateAfter = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    ReasonCode = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    PublicMessage = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    IsPublic = table.Column<bool>(type: "bit", nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SourcingOfferEvents", x => x.Id);
                    table.CheckConstraint("CK_SourcingOfferEvent_Actor", "[ActorKind] IN ('customer','staff','system')");
                    table.CheckConstraint("CK_SourcingOfferEvent_State", "([StateBefore] IS NULL OR [StateBefore] IN ('Draft','Published','Accepted','Declined','Withdrawn','Superseded')) AND [StateAfter] IN ('Draft','Published','Accepted','Declined','Withdrawn','Superseded')");
                    table.ForeignKey(
                        name: "FK_SourcingOfferEvents_SourcingOffers_OfferId",
                        column: x => x.OfferId,
                        principalSchema: "market",
                        principalTable: "SourcingOffers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SourcingOfferLines",
                schema: "market",
                columns: table => new
                {
                    OfferId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    LineId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    ListingId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Quantity = table.Column<int>(type: "int", nullable: false),
                    UnitPriceRial = table.Column<long>(type: "bigint", nullable: false),
                    VariantId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    ProductId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    SellerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Sku = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false),
                    Slug = table.Column<string>(type: "nvarchar(150)", maxLength: 150, nullable: false),
                    CategoryId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CategoryNameFa = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    CategoryNameEn = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    BrandId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Brand = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    NameFa = table.Column<string>(type: "nvarchar(250)", maxLength: 250, nullable: false),
                    NameEn = table.Column<string>(type: "nvarchar(250)", maxLength: 250, nullable: false),
                    DescriptionFa = table.Column<string>(type: "nvarchar(max)", maxLength: 8000, nullable: false),
                    DescriptionEn = table.Column<string>(type: "nvarchar(max)", maxLength: 8000, nullable: false),
                    LabelFa = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    LabelEn = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    Color = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    ColorNameFa = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    ColorNameEn = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    WarrantyFa = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    WarrantyEn = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    HasVariantMethods = table.Column<bool>(type: "bit", nullable: false),
                    PublicPriceRial = table.Column<long>(type: "bigint", nullable: false),
                    CatalogVersion = table.Column<string>(type: "nvarchar(12)", maxLength: 12, nullable: false),
                    CurrentFingerprint = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    MaterialFingerprint = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SourcingOfferLines", x => new { x.OfferId, x.LineId });
                    table.CheckConstraint("CK_SourcingOfferLine_Values", "[Quantity] BETWEEN 1 AND 1000000 AND [UnitPriceRial]>=0 AND [PublicPriceRial]>=0");
                    table.ForeignKey(
                        name: "FK_SourcingOfferLines_SourcingOffers_OfferId",
                        column: x => x.OfferId,
                        principalSchema: "market",
                        principalTable: "SourcingOffers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SourcingOfferAttributes",
                schema: "market",
                columns: table => new
                {
                    OfferId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    LineId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Scope = table.Column<string>(type: "nvarchar(8)", maxLength: 8, nullable: false),
                    AttributeId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Key = table.Column<string>(type: "nvarchar(150)", maxLength: 150, nullable: false),
                    DataType = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    LabelFa = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    LabelEn = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    Unit = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: true),
                    UnitFa = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true),
                    UnitEn = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true),
                    TextFa = table.Column<string>(type: "nvarchar(max)", maxLength: 8000, nullable: true),
                    TextEn = table.Column<string>(type: "nvarchar(max)", maxLength: 8000, nullable: true),
                    Number = table.Column<decimal>(type: "decimal(28,8)", precision: 28, scale: 8, nullable: true),
                    Bool = table.Column<bool>(type: "bit", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SourcingOfferAttributes", x => new { x.OfferId, x.LineId, x.Scope, x.AttributeId });
                    table.CheckConstraint("CK_SourcingOfferAttribute_Scope", "[Scope] IN ('model','variant')");
                    table.CheckConstraint("CK_SourcingOfferAttribute_Type", "[DataType] IN ('Text','Number','Bool','Select','MultiSelect')");
                    table.CheckConstraint("CK_SourcingOfferAttribute_Value", "([DataType]='Text' AND [TextFa] IS NOT NULL AND [TextEn] IS NOT NULL AND [Number] IS NULL AND [Bool] IS NULL) OR ([DataType]='Number' AND [Number] IS NOT NULL AND [TextFa] IS NULL AND [TextEn] IS NULL AND [Bool] IS NULL) OR ([DataType]='Bool' AND [Bool] IS NOT NULL AND [TextFa] IS NULL AND [TextEn] IS NULL AND [Number] IS NULL) OR ([DataType] IN ('Select','MultiSelect') AND [TextFa] IS NULL AND [TextEn] IS NULL AND [Number] IS NULL AND [Bool] IS NULL)");
                    table.ForeignKey(
                        name: "FK_SourcingOfferAttributes_SourcingOfferLines_OfferId_LineId",
                        columns: x => new { x.OfferId, x.LineId },
                        principalSchema: "market",
                        principalTable: "SourcingOfferLines",
                        principalColumns: new[] { "OfferId", "LineId" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SourcingOfferImages",
                schema: "market",
                columns: table => new
                {
                    OfferId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    LineId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    SortOrder = table.Column<int>(type: "int", nullable: false),
                    Url = table.Column<string>(type: "nvarchar(1500)", maxLength: 1500, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SourcingOfferImages", x => new { x.OfferId, x.LineId, x.SortOrder });
                    table.CheckConstraint("CK_SourcingOfferImage_Order", "[SortOrder] BETWEEN 0 AND 23");
                    table.ForeignKey(
                        name: "FK_SourcingOfferImages_SourcingOfferLines_OfferId_LineId",
                        columns: x => new { x.OfferId, x.LineId },
                        principalSchema: "market",
                        principalTable: "SourcingOfferLines",
                        principalColumns: new[] { "OfferId", "LineId" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SourcingOfferPurchaseRules",
                schema: "market",
                columns: table => new
                {
                    OfferId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    LineId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Kind = table.Column<string>(type: "nvarchar(8)", maxLength: 8, nullable: false),
                    RuleId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SourcingOfferPurchaseRules", x => new { x.OfferId, x.LineId, x.Kind, x.RuleId });
                    table.CheckConstraint("CK_SourcingOfferRule_Kind", "[Kind] IN ('product','variant','plan')");
                    table.ForeignKey(
                        name: "FK_SourcingOfferPurchaseRules_SourcingOfferLines_OfferId_LineId",
                        columns: x => new { x.OfferId, x.LineId },
                        principalSchema: "market",
                        principalTable: "SourcingOfferLines",
                        principalColumns: new[] { "OfferId", "LineId" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SourcingOfferOptions",
                schema: "market",
                columns: table => new
                {
                    OfferId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    LineId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Scope = table.Column<string>(type: "nvarchar(8)", maxLength: 8, nullable: false),
                    AttributeId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    OptionId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    LabelFa = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    LabelEn = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SourcingOfferOptions", x => new { x.OfferId, x.LineId, x.Scope, x.AttributeId, x.OptionId });
                    table.ForeignKey(
                        name: "FK_SourcingOfferOptions_SourcingOfferAttributes_OfferId_LineId_Scope_AttributeId",
                        columns: x => new { x.OfferId, x.LineId, x.Scope, x.AttributeId },
                        principalSchema: "market",
                        principalTable: "SourcingOfferAttributes",
                        principalColumns: new[] { "OfferId", "LineId", "Scope", "AttributeId" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SourcingOfferAcceptances_Id",
                schema: "market",
                table: "SourcingOfferAcceptances",
                column: "Id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SourcingOfferEvents_OfferId_Id",
                schema: "market",
                table: "SourcingOfferEvents",
                columns: new[] { "OfferId", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_SourcingOffers_RequestId",
                schema: "market",
                table: "SourcingOffers",
                column: "RequestId",
                unique: true,
                filter: "[IsActive] = 1");

            migrationBuilder.CreateIndex(
                name: "IX_SourcingOffers_RequestId_CreatedAt_Id",
                schema: "market",
                table: "SourcingOffers",
                columns: new[] { "RequestId", "CreatedAt", "Id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "SourcingOfferAcceptances",
                schema: "market");

            migrationBuilder.DropTable(
                name: "SourcingOfferCommandReceipts",
                schema: "market");

            migrationBuilder.DropTable(
                name: "SourcingOfferEvents",
                schema: "market");

            migrationBuilder.DropTable(
                name: "SourcingOfferImages",
                schema: "market");

            migrationBuilder.DropTable(
                name: "SourcingOfferOptions",
                schema: "market");

            migrationBuilder.DropTable(
                name: "SourcingOfferPurchaseRules",
                schema: "market");

            migrationBuilder.DropTable(
                name: "SourcingOfferAttributes",
                schema: "market");

            migrationBuilder.DropTable(
                name: "SourcingOfferLines",
                schema: "market");

            migrationBuilder.DropTable(
                name: "SourcingOffers",
                schema: "market");
        }
    }
}
