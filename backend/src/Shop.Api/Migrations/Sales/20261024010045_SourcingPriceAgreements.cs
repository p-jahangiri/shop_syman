using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Sales
{
    /// <inheritdoc />
    public partial class SourcingPriceAgreements : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "SourcingPriceAgreements",
                schema: "sales",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    RequestId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    TaskId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OfferId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Revision = table.Column<int>(type: "int", nullable: false),
                    AcceptanceId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    TermsHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    SnapshotHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    TermsFa = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    TermsEn = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    PurchaseUntil = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    AllocationId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    State = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    ConsumedOrderId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    ContainsDemo = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ChangedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SourcingPriceAgreements", x => x.Id);
                    table.CheckConstraint("CK_SourcingAgreement_Order", "([State]='Consumed' AND [ConsumedOrderId] IS NOT NULL) OR ([State] IN ('Active','Revoked') AND [ConsumedOrderId] IS NULL)");
                    table.CheckConstraint("CK_SourcingAgreement_Revision", "[Revision]>0");
                    table.CheckConstraint("CK_SourcingAgreement_State", "[State] IN ('Active','Revoked','Consumed')");
                });

            migrationBuilder.CreateTable(
                name: "SourcingPriceAgreementLines",
                schema: "sales",
                columns: table => new
                {
                    AgreementId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OfferLineId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    ListingId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    VariantId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Quantity = table.Column<int>(type: "int", nullable: false),
                    UnitPriceRial = table.Column<long>(type: "bigint", nullable: false),
                    LineTotalRial = table.Column<long>(type: "bigint", nullable: false),
                    SkuSnapshotJson = table.Column<string>(type: "nvarchar(max)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SourcingPriceAgreementLines", x => new { x.AgreementId, x.Id });
                    table.CheckConstraint("CK_SourcingAgreementLine_Amount", "[Quantity] BETWEEN 1 AND 1000000 AND [UnitPriceRial]>=0 AND [LineTotalRial]>=0 AND CAST([LineTotalRial] AS decimal(38,0))=CAST([UnitPriceRial] AS decimal(38,0))*[Quantity]");
                    table.CheckConstraint("CK_SourcingAgreementLine_Snapshot", "ISJSON([SkuSnapshotJson])=1 AND DATALENGTH([SkuSnapshotJson])<=2097152");
                    table.ForeignKey(
                        name: "FK_SourcingPriceAgreementLines_SourcingPriceAgreements_AgreementId",
                        column: x => x.AgreementId,
                        principalSchema: "sales",
                        principalTable: "SourcingPriceAgreements",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SourcingPriceAgreementLines_AgreementId_OfferLineId",
                schema: "sales",
                table: "SourcingPriceAgreementLines",
                columns: new[] { "AgreementId", "OfferLineId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SourcingPriceAgreements_AcceptanceId",
                schema: "sales",
                table: "SourcingPriceAgreements",
                column: "AcceptanceId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SourcingPriceAgreements_OwnerId_RequestId_TaskId",
                schema: "sales",
                table: "SourcingPriceAgreements",
                columns: new[] { "OwnerId", "RequestId", "TaskId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "SourcingPriceAgreementLines",
                schema: "sales");

            migrationBuilder.DropTable(
                name: "SourcingPriceAgreements",
                schema: "sales");
        }
    }
}
