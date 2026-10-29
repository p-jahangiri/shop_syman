using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Credit
{
    /// <inheritdoc />
    public partial class ChequeApprovals : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ChequeApprovals",
                schema: "credit",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    OrderId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ChequeId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ScheduleId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    RecordedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ProtectedOrigin = table.Column<byte[]>(type: "varbinary(max)", maxLength: 8192, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChequeApprovals", x => x.Id);
                    table.UniqueConstraint("AK_ChequeApprovals_Id_OrderId_ChequeId", x => new { x.Id, x.OrderId, x.ChequeId });
                    table.CheckConstraint("CK_ChequeApproval_Facts", "DATALENGTH([ProtectedOrigin]) BETWEEN 1 AND 8192 AND DATEPART(TZOFFSET,[RecordedAt])=0");
                    table.ForeignKey(
                        name: "FK_ChequeApprovals_ChequeScheduleRevisions_ScheduleId_OrderId",
                        columns: x => new { x.ScheduleId, x.OrderId },
                        principalSchema: "credit",
                        principalTable: "ChequeScheduleRevisions",
                        principalColumns: new[] { "Id", "OrderId" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ChequeApprovals_ReceivedCheques_ChequeId",
                        column: x => x.ChequeId,
                        principalSchema: "credit",
                        principalTable: "ReceivedCheques",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ChequeApprovalEvents",
                schema: "credit",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ApprovalId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    OrderId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ChequeId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    LedgerEventId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    Sequence = table.Column<int>(type: "int", nullable: false),
                    Action = table.Column<string>(type: "varchar(16)", unicode: false, maxLength: 16, nullable: false),
                    State = table.Column<string>(type: "varchar(16)", unicode: false, maxLength: 16, nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    OccurredAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    RecordedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ProtectedEvent = table.Column<byte[]>(type: "varbinary(max)", maxLength: 8192, nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChequeApprovalEvents", x => x.Id);
                    table.UniqueConstraint("AK_ChequeApprovalEvents_ApprovalId_Id", x => new { x.ApprovalId, x.Id });
                    table.CheckConstraint("CK_ChequeApprovalEvent_Facts", "[Sequence] BETWEEN 1 AND 200 AND DATALENGTH([ProtectedEvent]) BETWEEN 1 AND 8192 AND DATEPART(TZOFFSET,[OccurredAt])=0 AND DATEPART(TZOFFSET,[RecordedAt])=0 AND [OccurredAt]<=[RecordedAt]");
                    table.CheckConstraint("CK_ChequeApprovalEvent_State", "([Action]='Approve' AND [State]='Approved') OR ([Action]='Revoke' AND [State]='Revoked' AND [Sequence]>1)");
                    table.ForeignKey(
                        name: "FK_ChequeApprovalEvents_ChequeApprovals_ApprovalId_OrderId_ChequeId",
                        columns: x => new { x.ApprovalId, x.OrderId, x.ChequeId },
                        principalSchema: "credit",
                        principalTable: "ChequeApprovals",
                        principalColumns: new[] { "Id", "OrderId", "ChequeId" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ChequeApprovalEvents_ChequeLedgerEvents_LedgerEventId",
                        column: x => x.LedgerEventId,
                        principalSchema: "credit",
                        principalTable: "ChequeLedgerEvents",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ChequeApprovalCommands",
                schema: "credit",
                columns: table => new
                {
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CommandId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    OrderId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ChequeId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ApprovalId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    EventId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ResultHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ProtectedResult = table.Column<byte[]>(type: "varbinary(max)", maxLength: 16384, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChequeApprovalCommands", x => new { x.ActorId, x.CommandId });
                    table.CheckConstraint("CK_ChequeApprovalCommand_Facts", "DATALENGTH([ProtectedResult]) BETWEEN 1 AND 16384 AND DATEPART(TZOFFSET,[At])=0");
                    table.ForeignKey(
                        name: "FK_ChequeApprovalCommands_ChequeApprovalEvents_ApprovalId_EventId",
                        columns: x => new { x.ApprovalId, x.EventId },
                        principalSchema: "credit",
                        principalTable: "ChequeApprovalEvents",
                        principalColumns: new[] { "ApprovalId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ChequeApprovalCommands_ChequeApprovals_ApprovalId_OrderId_ChequeId",
                        columns: x => new { x.ApprovalId, x.OrderId, x.ChequeId },
                        principalSchema: "credit",
                        principalTable: "ChequeApprovals",
                        principalColumns: new[] { "Id", "OrderId", "ChequeId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ChequeApprovalCommands_ApprovalId_EventId",
                schema: "credit",
                table: "ChequeApprovalCommands",
                columns: new[] { "ApprovalId", "EventId" });

            migrationBuilder.CreateIndex(
                name: "IX_ChequeApprovalCommands_ApprovalId_OrderId_ChequeId",
                schema: "credit",
                table: "ChequeApprovalCommands",
                columns: new[] { "ApprovalId", "OrderId", "ChequeId" });

            migrationBuilder.CreateIndex(
                name: "IX_ChequeApprovalCommands_EventId",
                schema: "credit",
                table: "ChequeApprovalCommands",
                column: "EventId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ChequeApprovalEvents_ApprovalId_OrderId_ChequeId",
                schema: "credit",
                table: "ChequeApprovalEvents",
                columns: new[] { "ApprovalId", "OrderId", "ChequeId" });

            migrationBuilder.CreateIndex(
                name: "IX_ChequeApprovalEvents_ApprovalId_Sequence",
                schema: "credit",
                table: "ChequeApprovalEvents",
                columns: new[] { "ApprovalId", "Sequence" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ChequeApprovalEvents_LedgerEventId",
                schema: "credit",
                table: "ChequeApprovalEvents",
                column: "LedgerEventId");

            migrationBuilder.CreateIndex(
                name: "IX_ChequeApprovals_ChequeId",
                schema: "credit",
                table: "ChequeApprovals",
                column: "ChequeId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ChequeApprovals_ScheduleId_OrderId",
                schema: "credit",
                table: "ChequeApprovals",
                columns: new[] { "ScheduleId", "OrderId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS(SELECT 1 FROM [credit].[ChequeApprovals]) OR EXISTS(SELECT 1 FROM [credit].[ChequeApprovalEvents]) OR EXISTS(SELECT 1 FROM [credit].[ChequeApprovalCommands]) THROW 51000, 'Manual cheque approval history cannot be removed.', 1;");
            migrationBuilder.DropTable(
                name: "ChequeApprovalCommands",
                schema: "credit");

            migrationBuilder.DropTable(
                name: "ChequeApprovalEvents",
                schema: "credit");

            migrationBuilder.DropTable(
                name: "ChequeApprovals",
                schema: "credit");
        }
    }
}
