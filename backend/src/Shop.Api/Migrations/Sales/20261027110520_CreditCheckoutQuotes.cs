using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Sales
{
    /// <inheritdoc />
    public partial class CreditCheckoutQuotes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CreditCheckoutQuotes",
                schema: "sales",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    Locale = table.Column<string>(type: "varchar(2)", unicode: false, maxLength: 2, nullable: false),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CommandId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    BaseQuoteId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    BaseContractVersion = table.Column<int>(type: "int", nullable: false),
                    BaseSnapshotHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    Fingerprint = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ApplicationId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ApplicationVersion = table.Column<string>(type: "varchar(12)", unicode: false, maxLength: 12, nullable: false),
                    ScopeId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ScopeVersion = table.Column<string>(type: "varchar(12)", unicode: false, maxLength: 12, nullable: false),
                    ReviewId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    SubmissionId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    PlanId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    PlanVersion = table.Column<string>(type: "varchar(12)", unicode: false, maxLength: 12, nullable: false),
                    PlanSnapshotHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    LimitBasis = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    LimitAmountRial = table.Column<long>(type: "bigint", nullable: false),
                    ScopeExpiresAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    AssessedAmountRial = table.Column<long>(type: "bigint", nullable: true),
                    WithinLimit = table.Column<bool>(type: "bit", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ResultHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ProtectedResult = table.Column<byte[]>(type: "varbinary(max)", maxLength: 1572864, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CreditCheckoutQuotes", x => x.Id);
                    table.CheckConstraint("CK_CreditCheckoutQuote_Basis", "[LimitBasis] IN ('PayableTotalRial','InstallmentsTotalRial')");
                    table.CheckConstraint("CK_CreditCheckoutQuote_Contract", "[BaseContractVersion] IN (3,5)");
                    table.CheckConstraint("CK_CreditCheckoutQuote_Limit", "[LimitAmountRial]>0 AND (([AssessedAmountRial] IS NULL AND [WithinLimit] IS NULL) OR ([AssessedAmountRial] IS NOT NULL AND [WithinLimit] IS NOT NULL AND [AssessedAmountRial]>=0 AND (([AssessedAmountRial]<=[LimitAmountRial] AND [WithinLimit]=1) OR ([AssessedAmountRial]>[LimitAmountRial] AND [WithinLimit]=0))))");
                    table.CheckConstraint("CK_CreditCheckoutQuote_Locale", "[Locale] IN ('fa','en')");
                    table.CheckConstraint("CK_CreditCheckoutQuote_Result", "DATALENGTH([ProtectedResult]) BETWEEN 1 AND 1572864");
                    table.CheckConstraint("CK_CreditCheckoutQuote_Time", "[ExpiresAt]>[CreatedAt] AND [ExpiresAt]<=[ScopeExpiresAt] AND DATEPART(TZOFFSET,[CreatedAt])=0 AND DATEPART(TZOFFSET,[ExpiresAt])=0 AND DATEPART(TZOFFSET,[ScopeExpiresAt])=0");
                    table.ForeignKey(
                        name: "FK_CreditCheckoutQuotes_CheckoutQuotes_BaseQuoteId",
                        column: x => x.BaseQuoteId,
                        principalSchema: "sales",
                        principalTable: "CheckoutQuotes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CreditCheckoutQuotes_BaseQuoteId",
                schema: "sales",
                table: "CreditCheckoutQuotes",
                column: "BaseQuoteId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CreditCheckoutQuotes_OwnerId_CommandId",
                schema: "sales",
                table: "CreditCheckoutQuotes",
                columns: new[] { "OwnerId", "CommandId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CreditCheckoutQuotes_ScopeId_CreatedAt",
                schema: "sales",
                table: "CreditCheckoutQuotes",
                columns: new[] { "ScopeId", "CreatedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                IF EXISTS (SELECT 1 FROM [sales].[CreditCheckoutQuotes])
                    THROW 51000, 'Private cheque quote history must be retained.', 1;
                """);

            migrationBuilder.DropTable(
                name: "CreditCheckoutQuotes",
                schema: "sales");
        }
    }
}
