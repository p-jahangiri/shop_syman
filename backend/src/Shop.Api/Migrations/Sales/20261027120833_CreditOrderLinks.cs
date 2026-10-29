using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Sales
{
    /// <inheritdoc />
    public partial class CreditOrderLinks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(name:"ChequeOrdersEnabled",schema:"sales",table:"CheckoutOrderSettings",type:"bit",nullable:false,defaultValue:false);
            migrationBuilder.CreateTable(
                name: "CreditOrderLinks",
                schema: "sales",
                columns: table => new
                {
                    OrderId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CommandId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    CreditQuoteId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ApplicationId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ScopeId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    QuoteFingerprint = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    LimitBasis = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    LimitAmountRial = table.Column<long>(type: "bigint", nullable: false),
                    AssessedAmountRial = table.Column<long>(type: "bigint", nullable: false),
                    AcceptedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ProtectedResult = table.Column<byte[]>(type: "varbinary(max)", maxLength: 1572864, nullable: false),
                    ResultHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CreditOrderLinks", x => x.OrderId);
                    table.CheckConstraint("CK_CreditOrderLink_Amount", "[LimitAmountRial]>0 AND [AssessedAmountRial]>=0 AND [AssessedAmountRial]<=[LimitAmountRial]");
                    table.CheckConstraint("CK_CreditOrderLink_Basis", "[LimitBasis] IN ('PayableTotalRial','InstallmentsTotalRial')");
                    table.CheckConstraint("CK_CreditOrderLink_Result", "DATALENGTH([ProtectedResult]) BETWEEN 1 AND 1572864");
                    table.CheckConstraint("CK_CreditOrderLink_Time", "DATEPART(TZOFFSET,[AcceptedAt])=0");
                    table.ForeignKey(
                        name: "FK_CreditOrderLinks_CreditCheckoutQuotes_CreditQuoteId",
                        column: x => x.CreditQuoteId,
                        principalSchema: "sales",
                        principalTable: "CreditCheckoutQuotes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CreditOrderLinks_Orders_OrderId",
                        column: x => x.OrderId,
                        principalSchema: "sales",
                        principalTable: "Orders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CreditOrderLinks_CreditQuoteId",
                schema: "sales",
                table: "CreditOrderLinks",
                column: "CreditQuoteId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CreditOrderLinks_OwnerId_CommandId",
                schema: "sales",
                table: "CreditOrderLinks",
                columns: new[] { "OwnerId", "CommandId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CreditOrderLinks_ScopeId",
                schema: "sales",
                table: "CreditOrderLinks",
                column: "ScopeId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS(SELECT 1 FROM [sales].[CreditOrderLinks]) OR EXISTS(SELECT 1 FROM [sales].[OrderEvents] WHERE [Reason]='credit_temporary_order_created') OR EXISTS(SELECT 1 FROM [sales].[CheckoutOrderSettings] WHERE [ChequeOrdersEnabled]=1) THROW 51000, 'Cheque order links and their retained creation history must be preserved.', 1;");
            migrationBuilder.DropTable(
                name: "CreditOrderLinks",
                schema: "sales");
            migrationBuilder.DropColumn(name:"ChequeOrdersEnabled",schema:"sales",table:"CheckoutOrderSettings");
        }
    }
}
