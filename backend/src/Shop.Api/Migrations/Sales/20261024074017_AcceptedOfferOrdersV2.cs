using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Sales
{
    /// <inheritdoc />
    public partial class AcceptedOfferOrdersV2 : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Quote_ContractVersion",
                schema: "sales",
                table: "CheckoutQuotes");

            migrationBuilder.AddColumn<bool>(
                name: "ContainsDemo",
                schema: "sales",
                table: "Orders",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "SnapshotVersion",
                schema: "sales",
                table: "Orders",
                type: "int",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "OrderLinesV2",
                schema: "sales",
                columns: table => new
                {
                    OrderId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
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
                    AllocationExpiresAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    Revision = table.Column<int>(type: "int", nullable: true),
                    SnapshotHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: true),
                    TermsFa = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: true),
                    TermsEn = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: true),
                    MaterialFingerprint = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: true),
                    ContainsDemo = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OrderLinesV2", x => new { x.OrderId, x.LineId });
                    table.CheckConstraint("CK_OrderLineV2_Amount", "[Quantity] BETWEEN 1 AND 1000000 AND [UnitPriceRial]>=0 AND [LineTotalRial]>=0 AND CAST([LineTotalRial] AS decimal(38,0))=CAST([UnitPriceRial] AS decimal(38,0))*[Quantity]");
                    table.CheckConstraint("CK_OrderLineV2_Identity", "LEN([OrderId])=32 AND LEN([LineId])=32 AND LEN([VariantId]) BETWEEN 1 AND 64");
                    table.CheckConstraint("CK_OrderLineV2_Provenance", "([LineKind]='ordinary' AND [PriceVersion] IS NOT NULL AND [ContainsDemo]=0 AND [ConversionId] IS NULL AND [AgreementId] IS NULL AND [AgreementLineId] IS NULL AND [RequestId] IS NULL AND [TaskId] IS NULL AND [OfferId] IS NULL AND [AcceptanceId] IS NULL AND [AllocationId] IS NULL AND [OfferLineId] IS NULL AND [TermsHash] IS NULL AND [AgreementVersion] IS NULL AND [AllocationVersion] IS NULL AND [PurchaseUntil] IS NULL AND [AllocationExpiresAt] IS NULL AND [Revision] IS NULL AND [SnapshotHash] IS NULL AND [TermsFa] IS NULL AND [TermsEn] IS NULL AND [MaterialFingerprint] IS NULL) OR ([LineKind]='acceptedOffer' AND [PriceVersion] IS NULL AND [IsDigital]=0 AND [ConversionId] IS NOT NULL AND [AgreementId] IS NOT NULL AND [AgreementLineId] IS NOT NULL AND [RequestId] IS NOT NULL AND [TaskId] IS NOT NULL AND [OfferId] IS NOT NULL AND [AcceptanceId] IS NOT NULL AND [AllocationId] IS NOT NULL AND [OfferLineId] IS NOT NULL AND [TermsHash] IS NOT NULL AND [AgreementVersion] IS NOT NULL AND [AllocationVersion] IS NOT NULL AND [PurchaseUntil] IS NOT NULL AND [AllocationExpiresAt] IS NOT NULL AND [Revision] IS NOT NULL AND [SnapshotHash] IS NOT NULL AND [TermsFa] IS NOT NULL AND [TermsEn] IS NOT NULL AND [MaterialFingerprint] IS NOT NULL AND [Revision]>0 AND [AllocationExpiresAt]<=[PurchaseUntil])");
                    table.ForeignKey(
                        name: "FK_OrderLinesV2_Orders_OrderId",
                        column: x => x.OrderId,
                        principalSchema: "sales",
                        principalTable: "Orders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "OrderOutbox",
                schema: "sales",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OrderId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    AgreementId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    EventType = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    PayloadJson = table.Column<string>(type: "nvarchar(max)", maxLength: 8192, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    DeliveredAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    Attempts = table.Column<int>(type: "int", nullable: false),
                    LastAttemptAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    NextAttemptAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OrderOutbox", x => x.Id);
                    table.CheckConstraint("CK_OrderOutbox_EventType", "[EventType]='SourcingAgreementOrdered'");
                    table.CheckConstraint("CK_OrderOutbox_Payload", "ISJSON([PayloadJson])=1 AND DATALENGTH([PayloadJson])<=16384");
                    table.CheckConstraint("CK_OrderOutbox_Progress", "[Attempts] BETWEEN 0 AND 1000000 AND ([LastAttemptAt] IS NULL OR [LastAttemptAt]>=[CreatedAt]) AND ([NextAttemptAt] IS NULL OR [NextAttemptAt]>=[CreatedAt]) AND ([DeliveredAt] IS NULL OR ([DeliveredAt]>=[CreatedAt] AND [NextAttemptAt] IS NULL))");
                    table.ForeignKey(
                        name: "FK_OrderOutbox_Orders_OrderId",
                        column: x => x.OrderId,
                        principalSchema: "sales",
                        principalTable: "Orders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_Order_SnapshotVersion",
                schema: "sales",
                table: "Orders",
                sql: "[SnapshotVersion] IS NULL OR [SnapshotVersion]=2");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Quote_ContractVersion",
                schema: "sales",
                table: "CheckoutQuotes",
                sql: "[ContractVersion] IS NULL OR [ContractVersion] IN (3,4,5)");

            migrationBuilder.CreateIndex(
                name: "IX_OrderLinesV2_OrderId_AgreementId_AgreementLineId",
                schema: "sales",
                table: "OrderLinesV2",
                columns: new[] { "OrderId", "AgreementId", "AgreementLineId" },
                unique: true,
                filter: "[AgreementId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_OrderOutbox_DeliveredAt_NextAttemptAt_CreatedAt_Id",
                schema: "sales",
                table: "OrderOutbox",
                columns: new[] { "DeliveredAt", "NextAttemptAt", "CreatedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_OrderOutbox_OrderId_AgreementId_EventType",
                schema: "sales",
                table: "OrderOutbox",
                columns: new[] { "OrderId", "AgreementId", "EventType" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Preserve immutable order/transfer receipts before any schema change.
            migrationBuilder.Sql("IF EXISTS (SELECT 1 FROM [sales].[Orders] WHERE [SnapshotVersion] IS NOT NULL OR [ContainsDemo]=1) OR EXISTS (SELECT 1 FROM [sales].[OrderLinesV2]) OR EXISTS (SELECT 1 FROM [sales].[OrderOutbox]) OR EXISTS (SELECT 1 FROM [sales].[CheckoutQuotes] WHERE [ContractVersion]=5 OR JSON_VALUE([ResponseJson],'$.SchemaVersion')='5' OR JSON_VALUE([ResponseJson],'$.schemaVersion')='5') THROW 51000, 'Accepted order and Quote5 history must be retained. This downgrade is unavailable.', 1;");

            migrationBuilder.DropTable(
                name: "OrderLinesV2",
                schema: "sales");

            migrationBuilder.DropTable(
                name: "OrderOutbox",
                schema: "sales");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Order_SnapshotVersion",
                schema: "sales",
                table: "Orders");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Quote_ContractVersion",
                schema: "sales",
                table: "CheckoutQuotes");

            migrationBuilder.DropColumn(
                name: "ContainsDemo",
                schema: "sales",
                table: "Orders");

            migrationBuilder.DropColumn(
                name: "SnapshotVersion",
                schema: "sales",
                table: "Orders");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Quote_ContractVersion",
                schema: "sales",
                table: "CheckoutQuotes",
                sql: "[ContractVersion] IS NULL OR [ContractVersion] IN (3,4)");
        }
    }
}
