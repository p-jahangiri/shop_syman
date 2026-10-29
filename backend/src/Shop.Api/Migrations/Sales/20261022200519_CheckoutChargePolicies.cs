using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Sales
{
    /// <inheritdoc />
    public partial class CheckoutChargePolicies : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ChargePolicyVersion",
                schema: "sales",
                table: "CheckoutQuotes",
                type: "nvarchar(12)",
                maxLength: 12,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ShippingMode",
                schema: "sales",
                table: "CheckoutQuotes",
                type: "varchar(16)",
                unicode: false,
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "TaxIncluded",
                schema: "sales",
                table: "CheckoutQuotes",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "TaxMode",
                schema: "sales",
                table: "CheckoutQuotes",
                type: "varchar(16)",
                unicode: false,
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "TaxRateBasisPoints",
                schema: "sales",
                table: "CheckoutQuotes",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "TaxableBaseRial",
                schema: "sales",
                table: "CheckoutQuotes",
                type: "bigint",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "CheckoutChargePolicies",
                schema: "sales",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false),
                    ShippingMode = table.Column<string>(type: "varchar(16)", unicode: false, maxLength: 16, nullable: false),
                    ShippingNameFa = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    ShippingNameEn = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    ShippingDescriptionFa = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    ShippingDescriptionEn = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    ShippingFeeRial = table.Column<long>(type: "bigint", nullable: true),
                    ShippingFreeFromRial = table.Column<long>(type: "bigint", nullable: true),
                    TaxMode = table.Column<string>(type: "varchar(16)", unicode: false, maxLength: 16, nullable: false),
                    TaxRateBasisPoints = table.Column<int>(type: "int", nullable: true),
                    TaxBase = table.Column<string>(type: "varchar(16)", unicode: false, maxLength: 16, nullable: false),
                    TaxRounding = table.Column<string>(type: "varchar(16)", unicode: false, maxLength: 16, nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CheckoutChargePolicies", x => x.Id);
                    table.CheckConstraint("CK_ChargePolicy_Shipping", "([ShippingMode] IN ('unconfigured','free') AND [ShippingFeeRial] IS NULL AND [ShippingFreeFromRial] IS NULL) OR ([ShippingMode]='flat' AND [ShippingFeeRial] IS NOT NULL AND [ShippingFeeRial]>0 AND ([ShippingFreeFromRial] IS NULL OR [ShippingFreeFromRial]>0))");
                    table.CheckConstraint("CK_ChargePolicy_Singleton", "[Id]=1");
                    table.CheckConstraint("CK_ChargePolicy_Tax", "([TaxMode] IN ('unconfigured','exempt') AND [TaxRateBasisPoints] IS NULL) OR ([TaxMode] IN ('exclusive','inclusive') AND [TaxRateBasisPoints] IS NOT NULL AND [TaxRateBasisPoints] BETWEEN 1 AND 10000)");
                    table.CheckConstraint("CK_ChargePolicy_TaxRule", "[TaxBase] IN ('items','goods','goods_shipping') AND [TaxRounding] IN ('down','up','half_up')");
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_Quote_Tax",
                schema: "sales",
                table: "CheckoutQuotes",
                sql: "([TaxableBaseRial] IS NULL OR [TaxableBaseRial]>=0) AND ([TaxRateBasisPoints] IS NULL OR [TaxRateBasisPoints] BETWEEN 1 AND 10000)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CheckoutChargePolicies",
                schema: "sales");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Quote_Tax",
                schema: "sales",
                table: "CheckoutQuotes");

            migrationBuilder.DropColumn(
                name: "ChargePolicyVersion",
                schema: "sales",
                table: "CheckoutQuotes");

            migrationBuilder.DropColumn(
                name: "ShippingMode",
                schema: "sales",
                table: "CheckoutQuotes");

            migrationBuilder.DropColumn(
                name: "TaxIncluded",
                schema: "sales",
                table: "CheckoutQuotes");

            migrationBuilder.DropColumn(
                name: "TaxMode",
                schema: "sales",
                table: "CheckoutQuotes");

            migrationBuilder.DropColumn(
                name: "TaxRateBasisPoints",
                schema: "sales",
                table: "CheckoutQuotes");

            migrationBuilder.DropColumn(
                name: "TaxableBaseRial",
                schema: "sales",
                table: "CheckoutQuotes");
        }
    }
}
