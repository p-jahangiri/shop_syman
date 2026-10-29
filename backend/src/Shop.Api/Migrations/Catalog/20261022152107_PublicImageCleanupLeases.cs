using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Catalog
{
    /// <inheritdoc />
    public partial class PublicImageCleanupLeases : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_PublicImage_Status",
                schema: "catalog",
                table: "PublicImages");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "CleanupLeaseExpiresAt",
                schema: "catalog",
                table: "PublicImages",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CleanupLeaseId",
                schema: "catalog",
                table: "PublicImages",
                type: "nvarchar(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "LastCleanupAt",
                schema: "catalog",
                table: "PublicImages",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_PublicImage_Status",
                schema: "catalog",
                table: "PublicImages",
                sql: "[Status] IN ('Staged','Ready','Failed','Cleaning','Purged')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Retain a non-public terminal state when rolling back lease support.
            migrationBuilder.Sql("UPDATE [catalog].[PublicImages] SET [Status] = 'Failed' WHERE [Status] IN ('Cleaning','Purged');");
            migrationBuilder.DropCheckConstraint(
                name: "CK_PublicImage_Status",
                schema: "catalog",
                table: "PublicImages");

            migrationBuilder.DropColumn(
                name: "CleanupLeaseExpiresAt",
                schema: "catalog",
                table: "PublicImages");

            migrationBuilder.DropColumn(
                name: "CleanupLeaseId",
                schema: "catalog",
                table: "PublicImages");

            migrationBuilder.DropColumn(
                name: "LastCleanupAt",
                schema: "catalog",
                table: "PublicImages");

            migrationBuilder.AddCheckConstraint(
                name: "CK_PublicImage_Status",
                schema: "catalog",
                table: "PublicImages",
                sql: "[Status] IN ('Staged','Ready','Failed')");
        }
    }
}
