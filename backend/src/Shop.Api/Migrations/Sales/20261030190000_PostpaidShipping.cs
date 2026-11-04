using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Sales;
public partial class PostpaidShipping : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropCheckConstraint(name: "CK_ChargePolicy_Shipping", schema: "sales", table: "CheckoutChargePolicies");
        migrationBuilder.DropCheckConstraint(name: "CK_ChargePolicy_Tax", schema: "sales", table: "CheckoutChargePolicies");
        migrationBuilder.DropCheckConstraint(name: "CK_Order_Amounts", schema: "sales", table: "Orders");
        migrationBuilder.AlterColumn<string>(name: "TaxMode", schema: "sales", table: "CheckoutChargePolicies", type: "varchar(24)", unicode: false, maxLength: 24, nullable: false, oldClrType: typeof(string), oldType: "varchar(16)", oldUnicode: false, oldMaxLength: 16);
        migrationBuilder.AlterColumn<string>(name: "TaxMode", schema: "sales", table: "CheckoutQuotes", type: "varchar(24)", unicode: false, maxLength: 24, nullable: true, oldClrType: typeof(string), oldType: "varchar(16)", oldUnicode: false, oldMaxLength: 16, oldNullable: true);
        migrationBuilder.AlterColumn<long>(name: "TaxRial", schema: "sales", table: "Orders", type: "bigint", nullable: true, oldClrType: typeof(long), oldType: "bigint");
        migrationBuilder.AddColumn<bool>(name: "TaxBreakdownKnown", schema: "sales", table: "Orders", type: "bit", nullable: false, defaultValue: true);
        migrationBuilder.AddCheckConstraint(name: "CK_ChargePolicy_Shipping", schema: "sales", table: "CheckoutChargePolicies", sql: "([ShippingMode] IN ('unconfigured','free','postpaid') AND [ShippingFeeRial] IS NULL AND [ShippingFreeFromRial] IS NULL) OR ([ShippingMode]='flat' AND [ShippingFeeRial] IS NOT NULL AND [ShippingFeeRial]>0 AND ([ShippingFreeFromRial] IS NULL OR [ShippingFreeFromRial]>0))");
        migrationBuilder.AddCheckConstraint(name: "CK_ChargePolicy_Tax", schema: "sales", table: "CheckoutChargePolicies", sql: "([TaxMode] IN ('unconfigured','exempt','included_unitemized') AND [TaxRateBasisPoints] IS NULL) OR ([TaxMode] IN ('exclusive','inclusive') AND [TaxRateBasisPoints] IS NOT NULL AND [TaxRateBasisPoints] BETWEEN 1 AND 10000)");
        migrationBuilder.AddCheckConstraint(name: "CK_Order_Amounts", schema: "sales", table: "Orders", sql: "[ItemsSubtotalRial]>=0 AND [GoodsTotalRial]>=[ItemsSubtotalRial] AND [ShippingRial]>=0 AND (([TaxBreakdownKnown]=1 AND [TaxRial] IS NOT NULL AND [TaxRial]>=0) OR ([TaxBreakdownKnown]=0 AND [TaxIncluded]=1 AND [TaxRial] IS NULL)) AND [PayableTotalRial]>0 AND CAST([PayableTotalRial] AS decimal(38,0))=CAST([GoodsTotalRial] AS decimal(38,0))+[ShippingRial]+CASE WHEN [TaxIncluded]=1 THEN 0 ELSE [TaxRial] END");
        migrationBuilder.AddCheckConstraint(name: "CK_Order_TaxDisclosure", schema: "sales", table: "Orders", sql: "([TaxBreakdownKnown]=1 AND COALESCE(JSON_VALUE([QuoteSnapshotJson],'$.ChargeRules.TaxMode'),'')<>'included_unitemized') OR ([TaxBreakdownKnown]=0 AND [TaxIncluded]=1 AND [TaxRial] IS NULL AND COALESCE(JSON_VALUE([QuoteSnapshotJson],'$.ChargeRules.TaxMode'),'')='included_unitemized' AND COALESCE(JSON_VALUE([QuoteSnapshotJson],'$.ChargeRules.TaxIncluded'),'')='true' AND JSON_VALUE([QuoteSnapshotJson],'$.ChargeRules.TaxRateBasisPoints') IS NULL AND JSON_VALUE([QuoteSnapshotJson],'$.TaxRial') IS NULL)");
    }
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("IF EXISTS (SELECT 1 FROM [sales].[CheckoutChargePolicies] WHERE [ShippingMode]='postpaid' OR [TaxMode]='included_unitemized') OR EXISTS (SELECT 1 FROM [sales].[CheckoutQuotes] WHERE [ShippingMode]='postpaid' OR [TaxMode]='included_unitemized') OR EXISTS (SELECT 1 FROM [sales].[Orders] WHERE [TaxBreakdownKnown]=0 OR [TaxRial] IS NULL OR JSON_VALUE([QuoteSnapshotJson],'$.ChargeRules.ShippingMode')='postpaid' OR JSON_VALUE([QuoteSnapshotJson],'$.ChargeRules.TaxMode')='included_unitemized') THROW 51000, 'Postpaid shipping or unitemized included-tax policy/history exists; rollback requires compatible code.', 1;");
        migrationBuilder.DropCheckConstraint(name: "CK_Order_TaxDisclosure", schema: "sales", table: "Orders");
        migrationBuilder.DropCheckConstraint(name: "CK_ChargePolicy_Shipping", schema: "sales", table: "CheckoutChargePolicies");
        migrationBuilder.DropCheckConstraint(name: "CK_ChargePolicy_Tax", schema: "sales", table: "CheckoutChargePolicies");
        migrationBuilder.DropCheckConstraint(name: "CK_Order_Amounts", schema: "sales", table: "Orders");
        migrationBuilder.DropColumn(name: "TaxBreakdownKnown", schema: "sales", table: "Orders");
        migrationBuilder.AlterColumn<long>(name: "TaxRial", schema: "sales", table: "Orders", type: "bigint", nullable: false, oldClrType: typeof(long), oldType: "bigint", oldNullable: true);
        migrationBuilder.AlterColumn<string>(name: "TaxMode", schema: "sales", table: "CheckoutChargePolicies", type: "varchar(16)", unicode: false, maxLength: 16, nullable: false, oldClrType: typeof(string), oldType: "varchar(24)", oldUnicode: false, oldMaxLength: 24);
        migrationBuilder.AlterColumn<string>(name: "TaxMode", schema: "sales", table: "CheckoutQuotes", type: "varchar(16)", unicode: false, maxLength: 16, nullable: true, oldClrType: typeof(string), oldType: "varchar(24)", oldUnicode: false, oldMaxLength: 24, oldNullable: true);
        migrationBuilder.AddCheckConstraint(name: "CK_ChargePolicy_Shipping", schema: "sales", table: "CheckoutChargePolicies", sql: "([ShippingMode] IN ('unconfigured','free') AND [ShippingFeeRial] IS NULL AND [ShippingFreeFromRial] IS NULL) OR ([ShippingMode]='flat' AND [ShippingFeeRial] IS NOT NULL AND [ShippingFeeRial]>0 AND ([ShippingFreeFromRial] IS NULL OR [ShippingFreeFromRial]>0))");
        migrationBuilder.AddCheckConstraint(name: "CK_ChargePolicy_Tax", schema: "sales", table: "CheckoutChargePolicies", sql: "([TaxMode] IN ('unconfigured','exempt') AND [TaxRateBasisPoints] IS NULL) OR ([TaxMode] IN ('exclusive','inclusive') AND [TaxRateBasisPoints] IS NOT NULL AND [TaxRateBasisPoints] BETWEEN 1 AND 10000)");
        migrationBuilder.AddCheckConstraint(name: "CK_Order_Amounts", schema: "sales", table: "Orders", sql: "[ItemsSubtotalRial]>=0 AND [GoodsTotalRial]>=[ItemsSubtotalRial] AND [ShippingRial]>=0 AND [TaxRial]>=0 AND [PayableTotalRial]>0 AND CAST([PayableTotalRial] AS decimal(38,0))=CAST([GoodsTotalRial] AS decimal(38,0))+[ShippingRial]+CASE WHEN [TaxIncluded]=1 THEN 0 ELSE [TaxRial] END");
    }
}
