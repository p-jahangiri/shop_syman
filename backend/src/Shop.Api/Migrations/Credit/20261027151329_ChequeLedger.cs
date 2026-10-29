using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Credit
{
    /// <inheritdoc />
    public partial class ChequeLedger : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddUniqueConstraint(
                name: "AK_ChequeScheduleRevisions_Id_OrderId",
                schema: "credit",
                table: "ChequeScheduleRevisions",
                columns: new[] { "Id", "OrderId" });

            migrationBuilder.CreateTable(
                name: "ReceivedCheques",
                schema: "credit",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    OrderId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ScheduleId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    Sequence = table.Column<int>(type: "int", nullable: false),
                    DueDate = table.Column<DateOnly>(type: "date", nullable: false),
                    AmountRial = table.Column<long>(type: "bigint", nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    RecordedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ProtectedRegistration = table.Column<byte[]>(type: "varbinary(max)", maxLength: 8192, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReceivedCheques", x => x.Id);
                    table.CheckConstraint("CK_ReceivedCheque_Facts", "[Sequence] BETWEEN 1 AND 60 AND [AmountRial]>0 AND DATEPART(TZOFFSET,[RecordedAt])=0");
                    table.CheckConstraint("CK_ReceivedCheque_Sealed", "DATALENGTH([ProtectedRegistration]) BETWEEN 1 AND 8192");
                    table.ForeignKey(
                        name: "FK_ReceivedCheques_ChequeScheduleLines_ScheduleId_Sequence",
                        columns: x => new { x.ScheduleId, x.Sequence },
                        principalSchema: "credit",
                        principalTable: "ChequeScheduleLines",
                        principalColumns: new[] { "RevisionId", "Sequence" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ReceivedCheques_ChequeScheduleRevisions_ScheduleId_OrderId",
                        columns: x => new { x.ScheduleId, x.OrderId },
                        principalSchema: "credit",
                        principalTable: "ChequeScheduleRevisions",
                        principalColumns: new[] { "Id", "OrderId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ChequeLedgerEvents",
                schema: "credit",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ChequeId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    Sequence = table.Column<int>(type: "int", nullable: false),
                    Action = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    State = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    OccurredAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    RecordedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ProtectedEvent = table.Column<byte[]>(type: "varbinary(max)", maxLength: 8192, nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChequeLedgerEvents", x => x.Id);
                    table.CheckConstraint("CK_ChequeLedgerEvent_Facts", "[Sequence] BETWEEN 1 AND 200 AND DATEPART(TZOFFSET,[OccurredAt])=0 AND DATEPART(TZOFFSET,[RecordedAt])=0 AND [OccurredAt]<=[RecordedAt]");
                    table.CheckConstraint("CK_ChequeLedgerEvent_Sealed", "DATALENGTH([ProtectedEvent]) BETWEEN 1 AND 8192");
                    table.CheckConstraint("CK_ChequeLedgerEvent_State", "([Action]='Receive' AND [State]='Received' AND [Sequence]=1) OR ([Sequence]>1 AND (([Action]='Deposit' AND [State]='Deposited') OR ([Action]='ReportCollection' AND [State]='CollectedReported') OR ([Action]='ReportBounce' AND [State]='BouncedReported') OR ([Action]='Withdraw' AND [State]='Withdrawn') OR ([Action]='ReturnToCustomer' AND [State]='ReturnedToCustomer') OR ([Action]='CorrectCollectionReport' AND [State]='Deposited')))");
                    table.ForeignKey(
                        name: "FK_ChequeLedgerEvents_ReceivedCheques_ChequeId",
                        column: x => x.ChequeId,
                        principalSchema: "credit",
                        principalTable: "ReceivedCheques",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ChequeLedgerCommands",
                schema: "credit",
                columns: table => new
                {
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CommandId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    OrderId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ChequeId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    EventId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ResultHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ProtectedResult = table.Column<byte[]>(type: "varbinary(max)", maxLength: 16384, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChequeLedgerCommands", x => new { x.ActorId, x.CommandId });
                    table.CheckConstraint("CK_ChequeLedgerCommand_Facts", "DATALENGTH([ProtectedResult]) BETWEEN 1 AND 16384 AND DATEPART(TZOFFSET,[At])=0");
                    table.ForeignKey(
                        name: "FK_ChequeLedgerCommands_ChequeLedgerEvents_EventId",
                        column: x => x.EventId,
                        principalSchema: "credit",
                        principalTable: "ChequeLedgerEvents",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ChequeLedgerCommands_EventId",
                schema: "credit",
                table: "ChequeLedgerCommands",
                column: "EventId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ChequeLedgerEvents_ChequeId_Sequence",
                schema: "credit",
                table: "ChequeLedgerEvents",
                columns: new[] { "ChequeId", "Sequence" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReceivedCheques_OrderId_Sequence",
                schema: "credit",
                table: "ReceivedCheques",
                columns: new[] { "OrderId", "Sequence" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReceivedCheques_ScheduleId_OrderId",
                schema: "credit",
                table: "ReceivedCheques",
                columns: new[] { "ScheduleId", "OrderId" });

            migrationBuilder.CreateIndex(
                name: "IX_ReceivedCheques_ScheduleId_Sequence",
                schema: "credit",
                table: "ReceivedCheques",
                columns: new[] { "ScheduleId", "Sequence" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS (SELECT 1 FROM [credit].[ReceivedCheques]) OR EXISTS (SELECT 1 FROM [credit].[ChequeLedgerEvents]) OR EXISTS (SELECT 1 FROM [credit].[ChequeLedgerCommands]) THROW 51000, 'Cheque custody history must be preserved before downgrade.', 1;");
            migrationBuilder.DropTable(
                name: "ChequeLedgerCommands",
                schema: "credit");

            migrationBuilder.DropTable(
                name: "ChequeLedgerEvents",
                schema: "credit");

            migrationBuilder.DropTable(
                name: "ReceivedCheques",
                schema: "credit");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_ChequeScheduleRevisions_Id_OrderId",
                schema: "credit",
                table: "ChequeScheduleRevisions");
        }
    }
}
