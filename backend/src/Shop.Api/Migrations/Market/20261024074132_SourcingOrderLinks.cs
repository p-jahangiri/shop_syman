using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Market
{
    /// <inheritdoc />
    public partial class SourcingOrderLinks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "SourcingOrderLinks",
                schema: "market",
                columns: table => new
                {
                    AgreementId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    EventId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    PayloadHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    OrderId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    RequestId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    TaskId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OfferId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    AcceptanceId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    AllocationId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    ContainsDemo = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ProjectedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SourcingOrderLinks", x => x.AgreementId);
                    table.CheckConstraint("CK_SourcingOrderLink_Dates", "[ProjectedAt]>=[CreatedAt]");
                    table.CheckConstraint("CK_SourcingOrderLink_Identity", "LEN([AgreementId])=32 AND LEN([EventId])=32 AND LEN([OrderId])=32 AND LEN([RequestId])=32 AND LEN([TaskId])=32 AND LEN([OfferId])=32 AND LEN([AcceptanceId])=32 AND LEN([AllocationId])=32");
                    table.ForeignKey(
                        name: "FK_SourcingOrderLinks_SourcingOfferAcceptances_OfferId",
                        column: x => x.OfferId,
                        principalSchema: "market",
                        principalTable: "SourcingOfferAcceptances",
                        principalColumn: "OfferId",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SourcingOrderLinks_SourcingOffers_OfferId",
                        column: x => x.OfferId,
                        principalSchema: "market",
                        principalTable: "SourcingOffers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SourcingOrderLinks_SourcingRequests_RequestId",
                        column: x => x.RequestId,
                        principalSchema: "market",
                        principalTable: "SourcingRequests",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SourcingOrderLinks_SourcingSupplyTasks_TaskId",
                        column: x => x.TaskId,
                        principalSchema: "market",
                        principalTable: "SourcingSupplyTasks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SourcingOrderLinks_EventId",
                schema: "market",
                table: "SourcingOrderLinks",
                column: "EventId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SourcingOrderLinks_OfferId",
                schema: "market",
                table: "SourcingOrderLinks",
                column: "OfferId");

            migrationBuilder.CreateIndex(
                name: "IX_SourcingOrderLinks_OwnerId_RequestId_CreatedAt_AgreementId",
                schema: "market",
                table: "SourcingOrderLinks",
                columns: new[] { "OwnerId", "RequestId", "CreatedAt", "AgreementId" });

            migrationBuilder.CreateIndex(
                name: "IX_SourcingOrderLinks_RequestId",
                schema: "market",
                table: "SourcingOrderLinks",
                column: "RequestId");

            migrationBuilder.CreateIndex(
                name: "IX_SourcingOrderLinks_TaskId",
                schema: "market",
                table: "SourcingOrderLinks",
                column: "TaskId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS (SELECT 1 FROM [market].[SourcingOrderLinks]) THROW 51000, 'Historical request/order projections must be retained. This downgrade is unavailable.', 1;");

            migrationBuilder.DropTable(
                name: "SourcingOrderLinks",
                schema: "market");
        }
    }
}
