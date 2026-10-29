using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Credit
{
    /// <inheritdoc />
    public partial class ChequeRoundingUnit : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "RoundingUnitRial",
                schema: "credit",
                table: "Plans",
                type: "int",
                nullable: false,
                defaultValue: 10);

            migrationBuilder.AddCheckConstraint(
                name: "CK_Plan_Rounding",
                schema: "credit",
                table: "Plans",
                sql: "[RoundingUnitRial] IN (1,10)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Plan_Rounding",
                schema: "credit",
                table: "Plans");

            migrationBuilder.DropColumn(
                name: "RoundingUnitRial",
                schema: "credit",
                table: "Plans");
        }
    }
}
