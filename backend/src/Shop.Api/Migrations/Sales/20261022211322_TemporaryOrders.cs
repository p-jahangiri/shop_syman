using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Sales
{
    /// <inheritdoc />
    public partial class TemporaryOrders : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CheckoutOrderSettings",
                schema: "sales",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false),
                    TemporaryOrdersEnabled = table.Column<bool>(type: "bit", nullable: false),
                    ReservationMinutes = table.Column<int>(type: "int", nullable: false),
                    MaxOpenOrdersPerCustomer = table.Column<int>(type: "int", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CheckoutOrderSettings", x => x.Id);
                    table.CheckConstraint("CK_OrderSettings_Limits", "[ReservationMinutes] BETWEEN 1 AND 60 AND [MaxOpenOrdersPerCustomer] BETWEEN 1 AND 10");
                    table.CheckConstraint("CK_OrderSettings_Singleton", "[Id]=1");
                });

            migrationBuilder.CreateTable(
                name: "Orders",
                schema: "sales",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Number = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    RequestId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    QuoteId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    PricingFingerprint = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    Locale = table.Column<string>(type: "nvarchar(2)", maxLength: 2, nullable: false),
                    State = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    ReservationId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ChangedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ContactName = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    ContactPhone = table.Column<string>(type: "varchar(11)", unicode: false, maxLength: 11, nullable: false),
                    ShippingRequired = table.Column<bool>(type: "bit", nullable: false),
                    CountryCode = table.Column<string>(type: "varchar(2)", unicode: false, maxLength: 2, nullable: true),
                    Province = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    City = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    Address = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true),
                    PostalCode = table.Column<string>(type: "varchar(10)", unicode: false, maxLength: 10, nullable: true),
                    Note = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    MethodId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    MethodName = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    ShippingName = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    ItemsSubtotalRial = table.Column<long>(type: "bigint", nullable: false),
                    GoodsTotalRial = table.Column<long>(type: "bigint", nullable: false),
                    ShippingRial = table.Column<long>(type: "bigint", nullable: false),
                    TaxRial = table.Column<long>(type: "bigint", nullable: false),
                    PayableTotalRial = table.Column<long>(type: "bigint", nullable: false),
                    TaxIncluded = table.Column<bool>(type: "bit", nullable: false),
                    QuoteSnapshotJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Orders", x => x.Id);
                    table.CheckConstraint("CK_Order_Amounts", "[ItemsSubtotalRial]>=0 AND [GoodsTotalRial]>=[ItemsSubtotalRial] AND [ShippingRial]>=0 AND [TaxRial]>=0 AND [PayableTotalRial]>0 AND CAST([PayableTotalRial] AS decimal(38,0))=CAST([GoodsTotalRial] AS decimal(38,0))+[ShippingRial]+CASE WHEN [TaxIncluded]=1 THEN 0 ELSE [TaxRial] END");
                    table.CheckConstraint("CK_Order_Dates", "[ExpiresAt]>[CreatedAt] AND [ChangedAt]>=[CreatedAt]");
                    table.CheckConstraint("CK_Order_Delivery", "([ShippingRequired]=0 AND [CountryCode] IS NULL AND [Province] IS NULL AND [City] IS NULL AND [Address] IS NULL AND [PostalCode] IS NULL) OR ([ShippingRequired]=1 AND [CountryCode]='IR' AND [Province] IS NOT NULL AND [City] IS NOT NULL AND [Address] IS NOT NULL AND [PostalCode] IS NOT NULL)");
                    table.CheckConstraint("CK_Order_QuoteSnapshot", "ISJSON([QuoteSnapshotJson])=1 AND DATALENGTH([QuoteSnapshotJson])<=1048576");
                    table.CheckConstraint("CK_Order_State", "[State] IN ('AwaitingPayment','Paid','Cancelled','Expired','Fulfilled')");
                    table.ForeignKey(
                        name: "FK_Orders_CheckoutQuotes_QuoteId",
                        column: x => x.QuoteId,
                        principalSchema: "sales",
                        principalTable: "CheckoutQuotes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "OrderEvents",
                schema: "sales",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    OrderId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    State = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Reason = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OrderEvents", x => x.Id);
                    table.ForeignKey(
                        name: "FK_OrderEvents_Orders_OrderId",
                        column: x => x.OrderId,
                        principalSchema: "sales",
                        principalTable: "Orders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "OrderLines",
                schema: "sales",
                columns: table => new
                {
                    OrderId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    VariantId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    ProductId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    SellerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
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
                    table.PrimaryKey("PK_OrderLines", x => new { x.OrderId, x.VariantId });
                    table.CheckConstraint("CK_OrderLine_Amount", "[Quantity] BETWEEN 1 AND 1000000 AND [UnitPriceRial]>=0 AND [LineTotalRial]>=0 AND CAST([LineTotalRial] AS decimal(38,0))=CAST([UnitPriceRial] AS decimal(38,0))*[Quantity]");
                    table.ForeignKey(
                        name: "FK_OrderLines_Orders_OrderId",
                        column: x => x.OrderId,
                        principalSchema: "sales",
                        principalTable: "Orders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_OrderEvents_OrderId_Id",
                schema: "sales",
                table: "OrderEvents",
                columns: new[] { "OrderId", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_Orders_Number",
                schema: "sales",
                table: "Orders",
                column: "Number",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Orders_OwnerId_CreatedAt_Id",
                schema: "sales",
                table: "Orders",
                columns: new[] { "OwnerId", "CreatedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_Orders_OwnerId_RequestId",
                schema: "sales",
                table: "Orders",
                columns: new[] { "OwnerId", "RequestId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Orders_QuoteId",
                schema: "sales",
                table: "Orders",
                column: "QuoteId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Orders_State_ExpiresAt",
                schema: "sales",
                table: "Orders",
                columns: new[] { "State", "ExpiresAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CheckoutOrderSettings",
                schema: "sales");

            migrationBuilder.DropTable(
                name: "OrderEvents",
                schema: "sales");

            migrationBuilder.DropTable(
                name: "OrderLines",
                schema: "sales");

            migrationBuilder.DropTable(
                name: "Orders",
                schema: "sales");
        }
    }
}
