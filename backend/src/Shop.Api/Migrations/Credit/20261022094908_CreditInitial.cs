using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Credit
{
    /// <inheritdoc />
    public partial class CreditInitial : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "credit");

            migrationBuilder.CreateTable(
                name: "Plans",
                schema: "credit",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    NameFa = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    NameEn = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    Months = table.Column<int>(type: "int", nullable: false),
                    MarkupBasisPoints = table.Column<int>(type: "int", nullable: false),
                    DownPaymentBasisPoints = table.Column<int>(type: "int", nullable: false),
                    IntervalMonths = table.Column<int>(type: "int", nullable: false),
                    Enabled = table.Column<bool>(type: "bit", nullable: false),
                    MinAmountRial = table.Column<long>(type: "bigint", nullable: true),
                    MaxAmountRial = table.Column<long>(type: "bigint", nullable: true),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Plans", x => x.Id);
                    table.CheckConstraint("CK_Plan_Amount", "([MinAmountRial] IS NULL OR [MinAmountRial] >= 0) AND ([MaxAmountRial] IS NULL OR [MaxAmountRial] >= COALESCE([MinAmountRial],0))");
                    table.CheckConstraint("CK_Plan_Terms", "[Months] BETWEEN 1 AND 60 AND [IntervalMonths] BETWEEN 1 AND [Months] AND [Months] % [IntervalMonths] = 0 AND [MarkupBasisPoints] BETWEEN 0 AND 100000 AND [DownPaymentBasisPoints] BETWEEN 0 AND 10000");
                });

            migrationBuilder.CreateTable(
                name: "PlanCategory",
                schema: "credit",
                columns: table => new
                {
                    PlanId = table.Column<string>(type: "nvarchar(64)", nullable: false),
                    CategoryId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PlanCategory", x => new { x.PlanId, x.CategoryId });
                    table.ForeignKey(
                        name: "FK_PlanCategory_Plans_PlanId",
                        column: x => x.PlanId,
                        principalSchema: "credit",
                        principalTable: "Plans",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PlanCategory",
                schema: "credit");

            migrationBuilder.DropTable(
                name: "Plans",
                schema: "credit");
        }
    }
}
