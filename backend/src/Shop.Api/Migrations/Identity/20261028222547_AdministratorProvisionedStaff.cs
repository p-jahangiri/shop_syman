using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Shop.Api.Migrations.Identity
{
    /// <inheritdoc />
    public partial class AdministratorProvisionedStaff : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "MustChangePassword",
                schema: "identity",
                table: "AspNetUsers",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "ProvisionedByAdministrator",
                schema: "identity",
                table: "AspNetUsers",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "StaffCreationCommands",
                schema: "identity",
                columns: table => new
                {
                    ActorId = table.Column<string>(type: "nvarchar(450)", maxLength: 450, nullable: false),
                    RequestId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserId = table.Column<string>(type: "nvarchar(450)", maxLength: 450, nullable: false),
                    ProtectedFingerprint = table.Column<byte[]>(type: "varbinary(512)", maxLength: 512, nullable: false),
                    ProtectedReceipt = table.Column<byte[]>(type: "varbinary(max)", maxLength: 16384, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StaffCreationCommands", x => new { x.ActorId, x.RequestId })
                        .Annotation("SqlServer:Clustered", false);
                    table.CheckConstraint("CK_StaffCreation_Command", "[RequestId]<>'00000000-0000-0000-0000-000000000000'");
                    table.CheckConstraint("CK_StaffCreation_Protected", "DATALENGTH([ProtectedFingerprint]) BETWEEN 1 AND 512 AND DATALENGTH([ProtectedReceipt]) BETWEEN 1 AND 16384");
                    table.ForeignKey(
                        name: "FK_StaffCreationCommands_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalSchema: "identity",
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_User_InitialPasswordProvisioning",
                schema: "identity",
                table: "AspNetUsers",
                sql: "[MustChangePassword]=0 OR [ProvisionedByAdministrator]=1");

            migrationBuilder.AddCheckConstraint(
                name: "CK_User_ManagedStaffMfa",
                schema: "identity",
                table: "AspNetUsers",
                sql: "[ProvisionedByAdministrator]=0 OR [RequireMfa]=1");

            migrationBuilder.CreateIndex(
                name: "IX_StaffCreationCommands_UserId",
                schema: "identity",
                table: "StaffCreationCommands",
                column: "UserId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS (SELECT 1 FROM [identity].[StaffCreationCommands]) OR EXISTS (SELECT 1 FROM [identity].[AspNetUsers] WHERE [ProvisionedByAdministrator]=1 OR [MustChangePassword]=1) THROW 51000, 'Staff provisioning history exists; destructive rollback is blocked.', 1;");
            migrationBuilder.DropTable(
                name: "StaffCreationCommands",
                schema: "identity");

            migrationBuilder.DropCheckConstraint(
                name: "CK_User_InitialPasswordProvisioning",
                schema: "identity",
                table: "AspNetUsers");

            migrationBuilder.DropCheckConstraint(
                name: "CK_User_ManagedStaffMfa",
                schema: "identity",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "MustChangePassword",
                schema: "identity",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "ProvisionedByAdministrator",
                schema: "identity",
                table: "AspNetUsers");
        }
    }
}
