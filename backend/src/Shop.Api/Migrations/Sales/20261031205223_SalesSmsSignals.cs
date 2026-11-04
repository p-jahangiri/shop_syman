using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Sales
{
    /// <inheritdoc />
    public partial class SalesSmsSignals : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "SmsSignals",
                schema: "sales",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(32)", unicode: false, maxLength: 32, nullable: false),
                    OrderEventId = table.Column<long>(type: "bigint", nullable: false),
                    Kind = table.Column<string>(type: "varchar(24)", unicode: false, maxLength: 24, nullable: false),
                    TrackingCode = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: true),
                    ProcessedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SmsSignals", x => x.Id);
                    table.CheckConstraint("CK_SalesSmsSignal_Kind", "[Kind] IN ('orderCreated','orderPaid','orderCancelled','orderShipped','creditApproved','orderDigitalReady')");
                    table.ForeignKey(
                        name: "FK_SmsSignals_OrderEvents_OrderEventId",
                        column: x => x.OrderEventId,
                        principalSchema: "sales",
                        principalTable: "OrderEvents",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SmsSignals_OrderEventId",
                schema: "sales",
                table: "SmsSignals",
                column: "OrderEventId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SmsSignals_ProcessedAt_OrderEventId",
                schema: "sales",
                table: "SmsSignals",
                columns: new[] { "ProcessedAt", "OrderEventId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                IF EXISTS (SELECT 1 FROM [sales].[SmsSignals])
                    THROW 51069,'Retained SMS business signals require forward-compatible recovery.',1;
                """);
            migrationBuilder.DropTable(
                name: "SmsSignals",
                schema: "sales");
        }
    }
}
