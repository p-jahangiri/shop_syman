using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Payments
{
    /// <inheritdoc />
    public partial class PaymentsInitial : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "payments");

            migrationBuilder.CreateTable(
                name: "Methods",
                schema: "payments",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Kind = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    NameFa = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    NameEn = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    DescriptionFa = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    DescriptionEn = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    Enabled = table.Column<bool>(type: "bit", nullable: false),
                    RequiresApproval = table.Column<bool>(type: "bit", nullable: false),
                    MinAmountRial = table.Column<long>(type: "bigint", nullable: true),
                    MaxAmountRial = table.Column<long>(type: "bigint", nullable: true),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Methods", x => x.Id);
                    table.CheckConstraint("CK_Method_Amount", "([MinAmountRial] IS NULL OR [MinAmountRial] >= 0) AND ([MaxAmountRial] IS NULL OR [MaxAmountRial] >= COALESCE([MinAmountRial],0))");
                    table.CheckConstraint("CK_Method_Kind", "[Kind] IN ('online','cheque','installment')");
                });

            migrationBuilder.CreateTable(
                name: "MethodCategory",
                schema: "payments",
                columns: table => new
                {
                    MethodId = table.Column<string>(type: "nvarchar(64)", nullable: false),
                    CategoryId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MethodCategory", x => new { x.MethodId, x.CategoryId });
                    table.ForeignKey(
                        name: "FK_MethodCategory_Methods_MethodId",
                        column: x => x.MethodId,
                        principalSchema: "payments",
                        principalTable: "Methods",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "MethodCategory",
                schema: "payments");

            migrationBuilder.DropTable(
                name: "Methods",
                schema: "payments");
        }
    }
}
