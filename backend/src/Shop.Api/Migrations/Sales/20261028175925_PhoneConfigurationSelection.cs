using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Sales
{
    /// <inheritdoc />
    public partial class PhoneConfigurationSelection : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ConfigurationId",
                schema: "sales",
                table: "CartSourcingLines",
                type: "nvarchar(32)",
                maxLength: 32,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS (SELECT 1 FROM [sales].[CartSourcingLines] WHERE [ConfigurationId] IS NOT NULL) THROW 51000, 'Explicit phone selections must not be discarded.', 1;");
            migrationBuilder.DropColumn(
                name: "ConfigurationId",
                schema: "sales",
                table: "CartSourcingLines");
        }
    }
}
