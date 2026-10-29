using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Credit
{
    /// <inheritdoc />
    public partial class ChequeSchedules : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddUniqueConstraint(
                name: "AK_PurchaseScopeUses_OrderId_ScopeId",
                schema: "credit",
                table: "PurchaseScopeUses",
                columns: new[] { "OrderId", "ScopeId" });

            migrationBuilder.CreateTable(
                name: "ChequeScheduleRevisions",
                schema: "credit",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    OrderId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ApplicationId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ScopeId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    CreditQuoteId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    QuoteFingerprint = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    SourceOrderVersion = table.Column<string>(type: "varchar(12)", unicode: false, maxLength: 12, nullable: false),
                    PreviousScheduleVersion = table.Column<string>(type: "varchar(12)", unicode: false, maxLength: 12, nullable: true),
                    SourceOrderCreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    SourceOrderExpiresAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Revision = table.Column<int>(type: "int", nullable: false),
                    Locale = table.Column<string>(type: "varchar(2)", unicode: false, maxLength: 2, nullable: false),
                    PlanName = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    CalendarKind = table.Column<string>(type: "varchar(16)", unicode: false, maxLength: 16, nullable: false),
                    AnchorDate = table.Column<DateOnly>(type: "date", nullable: false),
                    PayableTotalRial = table.Column<long>(type: "bigint", nullable: false),
                    PlanDownPaymentRial = table.Column<long>(type: "bigint", nullable: false),
                    ChargesOutsideChequesRial = table.Column<long>(type: "bigint", nullable: false),
                    UpfrontTotalRial = table.Column<long>(type: "bigint", nullable: false),
                    InstallmentsTotalRial = table.Column<long>(type: "bigint", nullable: false),
                    FinancialHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    PreviewFingerprint = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChequeScheduleRevisions", x => x.Id);
                    table.CheckConstraint("CK_ChequeSchedule_Amounts", "[PayableTotalRial]>0 AND [InstallmentsTotalRial]>=0 AND [InstallmentsTotalRial]<=[PayableTotalRial] AND [UpfrontTotalRial]=[PayableTotalRial]-[InstallmentsTotalRial] AND [PlanDownPaymentRial]>=0 AND [PlanDownPaymentRial]<=[UpfrontTotalRial] AND [ChargesOutsideChequesRial]=[UpfrontTotalRial]-[PlanDownPaymentRial]");
                    table.CheckConstraint("CK_ChequeSchedule_Revision", "[Revision]>0 AND [CalendarKind] IN ('Persian','Gregorian') AND [Locale] IN ('fa','en')");
                    table.CheckConstraint("CK_ChequeSchedule_Time", "DATEPART(TZOFFSET,[CreatedAt])=0 AND DATEPART(TZOFFSET,[SourceOrderCreatedAt])=0 AND DATEPART(TZOFFSET,[SourceOrderExpiresAt])=0 AND [CreatedAt]>=[SourceOrderCreatedAt] AND [CreatedAt]<[SourceOrderExpiresAt]");
                    table.ForeignKey(
                        name: "FK_ChequeScheduleRevisions_PurchaseScopeUses_OrderId_ScopeId",
                        columns: x => new { x.OrderId, x.ScopeId },
                        principalSchema: "credit",
                        principalTable: "PurchaseScopeUses",
                        principalColumns: new[] { "OrderId", "ScopeId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ChequeScheduleCommands",
                schema: "credit",
                columns: table => new
                {
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CommandId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    OrderId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    RevisionId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ResultHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ProtectedResult = table.Column<byte[]>(type: "varbinary(max)", maxLength: 65536, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChequeScheduleCommands", x => new { x.ActorId, x.CommandId });
                    table.CheckConstraint("CK_ChequeScheduleCommand_Result", "DATALENGTH([ProtectedResult]) BETWEEN 1 AND 65536");
                    table.CheckConstraint("CK_ChequeScheduleCommand_Time", "DATEPART(TZOFFSET,[At])=0");
                    table.ForeignKey(
                        name: "FK_ChequeScheduleCommands_ChequeScheduleRevisions_RevisionId",
                        column: x => x.RevisionId,
                        principalSchema: "credit",
                        principalTable: "ChequeScheduleRevisions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ChequeScheduleLines",
                schema: "credit",
                columns: table => new
                {
                    RevisionId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    Sequence = table.Column<int>(type: "int", nullable: false),
                    MonthOffset = table.Column<int>(type: "int", nullable: false),
                    DueDate = table.Column<DateOnly>(type: "date", nullable: false),
                    AmountRial = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChequeScheduleLines", x => new { x.RevisionId, x.Sequence });
                    table.CheckConstraint("CK_ChequeScheduleLine_Terms", "[Sequence] BETWEEN 1 AND 60 AND [MonthOffset] BETWEEN 1 AND 60 AND [AmountRial]>0");
                    table.ForeignKey(
                        name: "FK_ChequeScheduleLines_ChequeScheduleRevisions_RevisionId",
                        column: x => x.RevisionId,
                        principalSchema: "credit",
                        principalTable: "ChequeScheduleRevisions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ChequeScheduleCommands_RevisionId",
                schema: "credit",
                table: "ChequeScheduleCommands",
                column: "RevisionId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ChequeScheduleLines_RevisionId_MonthOffset",
                schema: "credit",
                table: "ChequeScheduleLines",
                columns: new[] { "RevisionId", "MonthOffset" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ChequeScheduleRevisions_OrderId_Revision",
                schema: "credit",
                table: "ChequeScheduleRevisions",
                columns: new[] { "OrderId", "Revision" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ChequeScheduleRevisions_OrderId_ScopeId",
                schema: "credit",
                table: "ChequeScheduleRevisions",
                columns: new[] { "OrderId", "ScopeId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS(SELECT 1 FROM [credit].[ChequeScheduleRevisions]) OR EXISTS(SELECT 1 FROM [credit].[ChequeScheduleLines]) OR EXISTS(SELECT 1 FROM [credit].[ChequeScheduleCommands]) THROW 51000, 'Cheque schedule revisions, lines and private command receipts must be retained.', 1;");
            migrationBuilder.DropTable(
                name: "ChequeScheduleCommands",
                schema: "credit");

            migrationBuilder.DropTable(
                name: "ChequeScheduleLines",
                schema: "credit");

            migrationBuilder.DropTable(
                name: "ChequeScheduleRevisions",
                schema: "credit");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_PurchaseScopeUses_OrderId_ScopeId",
                schema: "credit",
                table: "PurchaseScopeUses");
        }
    }
}
