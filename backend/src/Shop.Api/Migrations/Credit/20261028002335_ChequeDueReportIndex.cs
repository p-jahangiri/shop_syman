using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Credit
{
    /// <inheritdoc />
    public partial class ChequeDueReportIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_ReceivedCheques_DueDate_Id",
                schema: "credit",
                table: "ReceivedCheques",
                columns: new[] { "DueDate", "Id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_ReceivedCheques_DueDate_Id",
                schema: "credit",
                table: "ReceivedCheques");
        }
    }
}
