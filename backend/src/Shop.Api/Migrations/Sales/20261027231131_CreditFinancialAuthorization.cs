using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Sales
{
    /// <inheritdoc />
    public partial class CreditFinancialAuthorization : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Order_State",
                schema: "sales",
                table: "Orders");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Order_State",
                schema: "sales",
                table: "Orders",
                sql: "[State] IN ('AwaitingPayment','Paid','Cancelled','Expired','Fulfilled','CreditApproved')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS(SELECT 1 FROM [sales].[Orders] WHERE [State]='CreditApproved') OR EXISTS(SELECT 1 FROM [sales].[OrderEvents] WHERE [State]='CreditApproved') THROW 51000, 'Retain credit financial authorization order history.', 1;");
            migrationBuilder.DropCheckConstraint(
                name: "CK_Order_State",
                schema: "sales",
                table: "Orders");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Order_State",
                schema: "sales",
                table: "Orders",
                sql: "[State] IN ('AwaitingPayment','Paid','Cancelled','Expired','Fulfilled')");
        }
    }
}
