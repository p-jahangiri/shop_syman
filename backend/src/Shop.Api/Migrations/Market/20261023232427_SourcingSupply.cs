using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Market
{
    /// <inheritdoc />
    public partial class SourcingSupply : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "SourcingSupplyCommandReceipts",
                schema: "market",
                columns: table => new
                {
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Operation = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    CommandId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    RequestId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    TaskId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ResultJson = table.Column<string>(type: "nvarchar(max)", maxLength: 8192, nullable: false),
                    ContainsDemo = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SourcingSupplyCommandReceipts", x => new { x.ActorId, x.Operation, x.CommandId });
                    table.CheckConstraint("CK_SourcingSupplyReceipt_Operation", "[Operation] IN ('start','requested','ordered','progress','cancel','fail')");
                    table.CheckConstraint("CK_SourcingSupplyReceipt_Result", "ISJSON([ResultJson])=1 AND DATALENGTH([ResultJson])<=16384");
                });

            migrationBuilder.CreateTable(
                name: "SourcingSupplyTasks",
                schema: "market",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    RequestId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OfferId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    AcceptanceId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    TermsHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    State = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    IsOpen = table.Column<bool>(type: "bit", nullable: false),
                    ContainsDemo = table.Column<bool>(type: "bit", nullable: false),
                    SourceKind = table.Column<string>(type: "nvarchar(8)", maxLength: 8, nullable: true),
                    SourceKey = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: true, collation: "Latin1_General_100_BIN2"),
                    SourceNameFa = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    SourceNameEn = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    Reference = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true, collation: "Latin1_General_100_BIN2"),
                    ActionAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    ExpectedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    PublicMessageFa = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    PublicMessageEn = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    ProtectedNote = table.Column<string>(type: "nvarchar(max)", maxLength: 65536, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ChangedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SourcingSupplyTasks", x => x.Id);
                    table.CheckConstraint("CK_SourcingSupply_Dates", "[ChangedAt]>=[CreatedAt]");
                    table.CheckConstraint("CK_SourcingSupply_Open", "([IsOpen]=1 AND [State] IN ('PendingSupply','SupplierRequested','SupplierOrderRecorded')) OR ([IsOpen]=0 AND [State] IN ('Cancelled','Failed'))");
                    table.CheckConstraint("CK_SourcingSupply_Ordered", "[State]<>'SupplierOrderRecorded' OR [Reference] IS NOT NULL");
                    table.CheckConstraint("CK_SourcingSupply_Source", "([SourceKind] IS NULL AND [SourceKey] IS NULL AND [SourceNameFa] IS NULL AND [SourceNameEn] IS NULL AND [Reference] IS NULL) OR ([SourceKind] IS NOT NULL AND [SourceKind] IN ('manual','csv') AND [SourceKey] IS NOT NULL AND [SourceNameFa] IS NOT NULL AND [SourceNameEn] IS NOT NULL)");
                    table.CheckConstraint("CK_SourcingSupply_SourceState", "[State] NOT IN ('SupplierRequested','SupplierOrderRecorded') OR [SourceKind] IS NOT NULL");
                    table.CheckConstraint("CK_SourcingSupply_State", "[State] IN ('PendingSupply','SupplierRequested','SupplierOrderRecorded','Cancelled','Failed')");
                    table.ForeignKey(
                        name: "FK_SourcingSupplyTasks_SourcingOfferAcceptances_OfferId",
                        column: x => x.OfferId,
                        principalSchema: "market",
                        principalTable: "SourcingOfferAcceptances",
                        principalColumn: "OfferId",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SourcingSupplyTasks_SourcingRequests_RequestId",
                        column: x => x.RequestId,
                        principalSchema: "market",
                        principalTable: "SourcingRequests",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "SourcingSupplyEvents",
                schema: "market",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    TaskId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    ActorKind = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    StateBefore = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: true),
                    StateAfter = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    ReceiptProgress = table.Column<string>(type: "nvarchar(12)", maxLength: 12, nullable: false),
                    ReasonCode = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    PublicMessageFa = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    PublicMessageEn = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    SourceKind = table.Column<string>(type: "nvarchar(8)", maxLength: 8, nullable: true),
                    SourceKey = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: true, collation: "Latin1_General_100_BIN2"),
                    SourceNameFa = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    SourceNameEn = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    Reference = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true, collation: "Latin1_General_100_BIN2"),
                    ProtectedNote = table.Column<string>(type: "nvarchar(max)", maxLength: 65536, nullable: false),
                    ActionAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    ExpectedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SourcingSupplyEvents", x => x.Id);
                    table.CheckConstraint("CK_SourcingSupplyEvent_Actor", "[ActorKind] IN ('staff','customer','system')");
                    table.CheckConstraint("CK_SourcingSupplyEvent_Progress", "[ReceiptProgress] IN ('None','Partial','Complete')");
                    table.CheckConstraint("CK_SourcingSupplyEvent_State", "([StateBefore] IS NULL OR [StateBefore] IN ('PendingSupply','SupplierRequested','SupplierOrderRecorded','Cancelled','Failed')) AND [StateAfter] IN ('PendingSupply','SupplierRequested','SupplierOrderRecorded','Cancelled','Failed')");
                    table.ForeignKey(
                        name: "FK_SourcingSupplyEvents_SourcingSupplyTasks_TaskId",
                        column: x => x.TaskId,
                        principalSchema: "market",
                        principalTable: "SourcingSupplyTasks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SourcingSupplyReceiptApplications",
                schema: "market",
                columns: table => new
                {
                    ReceiptId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    TaskId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SourcingSupplyReceiptApplications", x => x.ReceiptId);
                    table.ForeignKey(
                        name: "FK_SourcingSupplyReceiptApplications_SourcingSupplyTasks_TaskId",
                        column: x => x.TaskId,
                        principalSchema: "market",
                        principalTable: "SourcingSupplyTasks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "SourcingSupplyTaskLines",
                schema: "market",
                columns: table => new
                {
                    TaskId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OfferLineId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    VariantId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    ProductId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Sku = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false),
                    NameFa = table.Column<string>(type: "nvarchar(250)", maxLength: 250, nullable: false),
                    NameEn = table.Column<string>(type: "nvarchar(250)", maxLength: 250, nullable: false),
                    LabelFa = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    LabelEn = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    MaterialFingerprint = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    RequiredQuantity = table.Column<int>(type: "int", nullable: false),
                    ReceivedQuantity = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SourcingSupplyTaskLines", x => new { x.TaskId, x.OfferLineId });
                    table.CheckConstraint("CK_SourcingSupplyLine_Quantity", "[RequiredQuantity] BETWEEN 1 AND 1000000 AND [ReceivedQuantity] BETWEEN 0 AND [RequiredQuantity]");
                    table.ForeignKey(
                        name: "FK_SourcingSupplyTaskLines_SourcingSupplyTasks_TaskId",
                        column: x => x.TaskId,
                        principalSchema: "market",
                        principalTable: "SourcingSupplyTasks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SourcingSupplyEvents_TaskId_Id",
                schema: "market",
                table: "SourcingSupplyEvents",
                columns: new[] { "TaskId", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_SourcingSupplyReceiptApplications_TaskId",
                schema: "market",
                table: "SourcingSupplyReceiptApplications",
                column: "TaskId");

            migrationBuilder.CreateIndex(
                name: "IX_SourcingSupplyTasks_AcceptanceId",
                schema: "market",
                table: "SourcingSupplyTasks",
                column: "AcceptanceId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SourcingSupplyTasks_CreatedAt_Id",
                schema: "market",
                table: "SourcingSupplyTasks",
                columns: new[] { "CreatedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_SourcingSupplyTasks_OfferId",
                schema: "market",
                table: "SourcingSupplyTasks",
                column: "OfferId");

            migrationBuilder.CreateIndex(
                name: "IX_SourcingSupplyTasks_RequestId",
                schema: "market",
                table: "SourcingSupplyTasks",
                column: "RequestId",
                unique: true,
                filter: "[IsOpen] = 1");

            migrationBuilder.CreateIndex(
                name: "IX_SourcingSupplyTasks_RequestId_CreatedAt_Id",
                schema: "market",
                table: "SourcingSupplyTasks",
                columns: new[] { "RequestId", "CreatedAt", "Id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "SourcingSupplyCommandReceipts",
                schema: "market");

            migrationBuilder.DropTable(
                name: "SourcingSupplyEvents",
                schema: "market");

            migrationBuilder.DropTable(
                name: "SourcingSupplyReceiptApplications",
                schema: "market");

            migrationBuilder.DropTable(
                name: "SourcingSupplyTaskLines",
                schema: "market");

            migrationBuilder.DropTable(
                name: "SourcingSupplyTasks",
                schema: "market");
        }
    }
}
