using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Sales
{
    /// <inheritdoc />
    public partial class CashOrderPaymentLinks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "OrderCashPayments",
                schema: "sales",
                columns: table => new
                {
                    OrderId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    AttemptId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    VerificationId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    MethodId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    ProviderKey = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    AccountKey = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    AuthorityHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ReferenceHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    SnapshotFingerprint = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ProofHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    AmountRial = table.Column<long>(type: "bigint", nullable: false),
                    VerifiedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    RecordedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ContainsDemo = table.Column<bool>(type: "bit", nullable: false),
                    ResponseJson = table.Column<string>(type: "nvarchar(max)", maxLength: 8192, nullable: false),
                    ResponseHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OrderCashPayments", x => x.OrderId);
                    table.CheckConstraint("CK_OrderCashPayment_Amount", "[AmountRial]>0");
                    table.CheckConstraint("CK_OrderCashPayment_Dates", "[VerifiedAt]<=[RecordedAt]");
                    table.CheckConstraint("CK_OrderCashPayment_Identity", "LEN([OrderId])=32 AND LEN([AttemptId])=32 AND LEN([VerificationId])=32 AND LEN([ProofHash])=64 AND LEN([AuthorityHash])=64 AND LEN([ReferenceHash])=64 AND LEN([SnapshotFingerprint])=64 AND LEN([ResponseHash])=64");
                    table.CheckConstraint("CK_OrderCashPayment_Response", "ISJSON([ResponseJson])=1 AND DATALENGTH([ResponseJson])<=16384");
                    table.ForeignKey(
                        name: "FK_OrderCashPayments_Orders_OrderId",
                        column: x => x.OrderId,
                        principalSchema: "sales",
                        principalTable: "Orders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_OrderCashPayments_AttemptId",
                schema: "sales",
                table: "OrderCashPayments",
                column: "AttemptId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_OrderCashPayments_ProviderKey_AccountKey_AuthorityHash",
                schema: "sales",
                table: "OrderCashPayments",
                columns: new[] { "ProviderKey", "AccountKey", "AuthorityHash" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_OrderCashPayments_ProviderKey_AccountKey_ReferenceHash",
                schema: "sales",
                table: "OrderCashPayments",
                columns: new[] { "ProviderKey", "AccountKey", "ReferenceHash" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_OrderCashPayments_VerificationId",
                schema: "sales",
                table: "OrderCashPayments",
                column: "VerificationId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS(SELECT 1 FROM [sales].[OrderCashPayments]) THROW 51000, 'Verified cash payment links and their immutable historical receipts must be retained.', 1;");
            migrationBuilder.DropTable(
                name: "OrderCashPayments",
                schema: "sales");
        }
    }
}
