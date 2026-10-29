using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Credit
{
    /// <inheritdoc />
    public partial class PurchaseScopeUses : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_CreditApplicationEvent_Action",
                schema: "credit",
                table: "ApplicationEvents");

            migrationBuilder.CreateTable(
                name: "PurchaseScopeUses",
                schema: "credit",
                columns: table => new
                {
                    ScopeId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ApplicationId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    OrderId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    CreditQuoteId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    QuoteFingerprint = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    AssessedAmountRial = table.Column<long>(type: "bigint", nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PurchaseScopeUses", x => x.ScopeId);
                    table.CheckConstraint("CK_CreditScopeUse_Amount", "[AssessedAmountRial]>=0");
                    table.CheckConstraint("CK_CreditScopeUse_Identity", "LEN([ScopeId])=32 AND LEN([ApplicationId])=32 AND LEN([OrderId])=32 AND LEN([CreditQuoteId])=32 AND LEN([QuoteFingerprint])=64 AND LEN([ActorId]) BETWEEN 1 AND 64");
                    table.CheckConstraint("CK_CreditScopeUse_Time", "DATEPART(TZOFFSET,[At])=0");
                    table.ForeignKey(
                        name: "FK_PurchaseScopeUses_PurchaseScopes_ScopeId_ApplicationId",
                        columns: x => new { x.ScopeId, x.ApplicationId },
                        principalSchema: "credit",
                        principalTable: "PurchaseScopes",
                        principalColumns: new[] { "Id", "ApplicationId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_CreditApplicationEvent_Action",
                schema: "credit",
                table: "ApplicationEvents",
                sql: "[Action] IN ('Created','Cancelled','Consented','DocumentAttached','Submitted','Withdrawn','Returned','Approved','Declined','ScopeGranted','ScopeRevoked','ScopeUsed')");

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseScopeUses_CreditQuoteId",
                schema: "credit",
                table: "PurchaseScopeUses",
                column: "CreditQuoteId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseScopeUses_OrderId",
                schema: "credit",
                table: "PurchaseScopeUses",
                column: "OrderId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseScopeUses_ScopeId_ApplicationId",
                schema: "credit",
                table: "PurchaseScopeUses",
                columns: new[] { "ScopeId", "ApplicationId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS(SELECT 1 FROM [credit].[PurchaseScopeUses]) OR EXISTS(SELECT 1 FROM [credit].[ApplicationEvents] WHERE [Action]='ScopeUsed') THROW 51000, 'One-purchase scope use and its retained event history must be preserved.', 1;");
            migrationBuilder.DropTable(
                name: "PurchaseScopeUses",
                schema: "credit");

            migrationBuilder.DropCheckConstraint(
                name: "CK_CreditApplicationEvent_Action",
                schema: "credit",
                table: "ApplicationEvents");

            migrationBuilder.AddCheckConstraint(
                name: "CK_CreditApplicationEvent_Action",
                schema: "credit",
                table: "ApplicationEvents",
                sql: "[Action] IN ('Created','Cancelled','Consented','DocumentAttached','Submitted','Withdrawn','Returned','Approved','Declined','ScopeGranted','ScopeRevoked')");
        }
    }
}
