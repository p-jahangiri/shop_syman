using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Sales
{
    /// <inheritdoc />
    public partial class CustomerAddressBook : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AddressBooks",
                schema: "sales",
                columns: table => new
                {
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Revision = table.Column<long>(type: "bigint", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AddressBooks", x => x.OwnerId);
                    table.CheckConstraint("CK_AddressBook_Revision", "[Revision]>=0");
                });

            migrationBuilder.CreateTable(
                name: "Addresses",
                schema: "sales",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    OwnerId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    ProtectedData = table.Column<string>(type: "varchar(max)", unicode: false, maxLength: 32768, nullable: false),
                    IsDefault = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Addresses", x => x.Id);
                    table.CheckConstraint("CK_Address_ProtectedLength", "LEN([ProtectedData]) BETWEEN 1 AND 32768");
                    table.ForeignKey(
                        name: "FK_Addresses_AddressBooks_OwnerId",
                        column: x => x.OwnerId,
                        principalSchema: "sales",
                        principalTable: "AddressBooks",
                        principalColumn: "OwnerId",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Addresses_Owner",
                schema: "sales",
                table: "Addresses",
                columns: new[] { "OwnerId", "Id" });

            migrationBuilder.CreateIndex(
                name: "UX_Addresses_DefaultOwner",
                schema: "sales",
                table: "Addresses",
                column: "OwnerId",
                unique: true,
                filter: "[IsDefault]=1");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Addresses",
                schema: "sales");

            migrationBuilder.DropTable(
                name: "AddressBooks",
                schema: "sales");
        }
    }
}
