using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Credit
{
    /// <inheritdoc />
    public partial class CreditUpfront : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "UpfrontConfirmations",
                schema: "credit",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    OrderId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    OriginalScheduleId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    QuoteFingerprint = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    FinancialHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    RequiredAmountRial = table.Column<long>(type: "bigint", nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    RecordedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ProtectedOrigin = table.Column<byte[]>(type: "varbinary(max)", maxLength: 8192, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UpfrontConfirmations", x => x.Id);
                    table.UniqueConstraint("AK_UpfrontConfirmations_Id_OrderId", x => new { x.Id, x.OrderId });
                    table.CheckConstraint("CK_UpfrontConfirmation_Facts", "[RequiredAmountRial]>=0 AND DATALENGTH([ProtectedOrigin]) BETWEEN 1 AND 8192 AND DATEPART(TZOFFSET,[RecordedAt])=0");
                    table.ForeignKey(
                        name: "FK_UpfrontConfirmations_ChequeScheduleRevisions_OriginalScheduleId_OrderId",
                        columns: x => new { x.OriginalScheduleId, x.OrderId },
                        principalSchema: "credit",
                        principalTable: "ChequeScheduleRevisions",
                        principalColumns: new[] { "Id", "OrderId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "UpfrontEvents",
                schema: "credit",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ConfirmationId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    OrderId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ScheduleId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    Sequence = table.Column<int>(type: "int", nullable: false),
                    Action = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    State = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    RequiredAmountRial = table.Column<long>(type: "bigint", nullable: false),
                    AcknowledgedAmountRial = table.Column<long>(type: "bigint", nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    OccurredAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    RecordedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ProtectedEvent = table.Column<byte[]>(type: "varbinary(max)", maxLength: 8192, nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UpfrontEvents", x => x.Id);
                    table.UniqueConstraint("AK_UpfrontEvents_ConfirmationId_Id", x => new { x.ConfirmationId, x.Id });
                    table.CheckConstraint("CK_UpfrontEvent_Facts", "[Sequence] BETWEEN 1 AND 200 AND [RequiredAmountRial]>=0 AND DATALENGTH([ProtectedEvent]) BETWEEN 1 AND 8192 AND DATEPART(TZOFFSET,[OccurredAt])=0 AND DATEPART(TZOFFSET,[RecordedAt])=0 AND [OccurredAt]<=[RecordedAt]");
                    table.CheckConstraint("CK_UpfrontEvent_State", "([Action]='ConfirmReceipt' AND [State]='ReceiptConfirmed' AND [RequiredAmountRial]>0 AND [AcknowledgedAmountRial]=[RequiredAmountRial]) OR ([Action]='ConfirmNoUpfrontDue' AND [State]='NoUpfrontDue' AND [RequiredAmountRial]=0 AND [AcknowledgedAmountRial]=0) OR ([Action]='RevokeConfirmation' AND [State]='Revoked' AND [Sequence]>1 AND [AcknowledgedAmountRial]=0)");
                    table.ForeignKey(
                        name: "FK_UpfrontEvents_ChequeScheduleRevisions_ScheduleId_OrderId",
                        columns: x => new { x.ScheduleId, x.OrderId },
                        principalSchema: "credit",
                        principalTable: "ChequeScheduleRevisions",
                        principalColumns: new[] { "Id", "OrderId" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_UpfrontEvents_UpfrontConfirmations_ConfirmationId_OrderId",
                        columns: x => new { x.ConfirmationId, x.OrderId },
                        principalSchema: "credit",
                        principalTable: "UpfrontConfirmations",
                        principalColumns: new[] { "Id", "OrderId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "UpfrontCommands",
                schema: "credit",
                columns: table => new
                {
                    ActorId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    CommandId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    OrderId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    ConfirmationId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    EventId = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ResultHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    ProtectedResult = table.Column<byte[]>(type: "varbinary(max)", maxLength: 16384, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UpfrontCommands", x => new { x.ActorId, x.CommandId });
                    table.CheckConstraint("CK_UpfrontCommand_Facts", "DATALENGTH([ProtectedResult]) BETWEEN 1 AND 16384 AND DATEPART(TZOFFSET,[At])=0");
                    table.ForeignKey(
                        name: "FK_UpfrontCommands_UpfrontConfirmations_ConfirmationId_OrderId",
                        columns: x => new { x.ConfirmationId, x.OrderId },
                        principalSchema: "credit",
                        principalTable: "UpfrontConfirmations",
                        principalColumns: new[] { "Id", "OrderId" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_UpfrontCommands_UpfrontEvents_ConfirmationId_EventId",
                        columns: x => new { x.ConfirmationId, x.EventId },
                        principalSchema: "credit",
                        principalTable: "UpfrontEvents",
                        principalColumns: new[] { "ConfirmationId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_UpfrontCommands_ConfirmationId_EventId",
                schema: "credit",
                table: "UpfrontCommands",
                columns: new[] { "ConfirmationId", "EventId" });

            migrationBuilder.CreateIndex(
                name: "IX_UpfrontCommands_ConfirmationId_OrderId",
                schema: "credit",
                table: "UpfrontCommands",
                columns: new[] { "ConfirmationId", "OrderId" });

            migrationBuilder.CreateIndex(
                name: "IX_UpfrontCommands_EventId",
                schema: "credit",
                table: "UpfrontCommands",
                column: "EventId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_UpfrontConfirmations_OrderId",
                schema: "credit",
                table: "UpfrontConfirmations",
                column: "OrderId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_UpfrontConfirmations_OriginalScheduleId_OrderId",
                schema: "credit",
                table: "UpfrontConfirmations",
                columns: new[] { "OriginalScheduleId", "OrderId" });

            migrationBuilder.CreateIndex(
                name: "IX_UpfrontEvents_ConfirmationId_OrderId",
                schema: "credit",
                table: "UpfrontEvents",
                columns: new[] { "ConfirmationId", "OrderId" });

            migrationBuilder.CreateIndex(
                name: "IX_UpfrontEvents_ConfirmationId_Sequence",
                schema: "credit",
                table: "UpfrontEvents",
                columns: new[] { "ConfirmationId", "Sequence" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_UpfrontEvents_ScheduleId_OrderId",
                schema: "credit",
                table: "UpfrontEvents",
                columns: new[] { "ScheduleId", "OrderId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS (SELECT 1 FROM [credit].[UpfrontConfirmations]) OR EXISTS (SELECT 1 FROM [credit].[UpfrontEvents]) OR EXISTS (SELECT 1 FROM [credit].[UpfrontCommands]) THROW 51000, 'Credit upfront history cannot be removed.', 1;");
            migrationBuilder.DropTable(
                name: "UpfrontCommands",
                schema: "credit");

            migrationBuilder.DropTable(
                name: "UpfrontEvents",
                schema: "credit");

            migrationBuilder.DropTable(
                name: "UpfrontConfirmations",
                schema: "credit");
        }
    }
}
